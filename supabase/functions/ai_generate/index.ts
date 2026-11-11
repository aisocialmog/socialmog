// POST /functions/v1/ai_generate   { task, input, regenerate? }
// The one door to AI. Signed-in team members only (or the scheduler, for the
// Monday insight). Provider keys are Supabase secrets read here and nowhere else.
//   privacy filter → 24 h cache → providers in priority order (next one on any
//   rate limit or error) → every call logged in ai_logs.
// The result is always a draft: this function never saves business data.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.46.1'
import { corsHeaders, json } from '../_shared/cors.ts'
import { isCron, service } from '../_shared/server.ts'
import { scrub, scrubDeep } from '../_shared/privacy.ts'

type Input = Record<string, unknown>
interface Prompt { system: string; user: string; json?: boolean }
const HOUSE = 'You work for Social Mog, an Indian influencer production and campaign agency. Write plainly and specifically. Money is in Indian rupees (₹, Indian digit grouping). Never invent numbers, names or facts that are not in the input. Placeholders like [phone] or [email] are redacted on purpose: leave them out.'
const J = (v: unknown) => JSON.stringify(v, null, 1)

const TASKS: Record<string, (i: Input) => Prompt> = {
  brief_to_plan: i => ({ system: `${HOUSE} Turn a brand brief into a campaign plan with these headings: Objective; Content pillars (3–4); Deliverable plan (formats and counts); Timeline (by week); Suggested creator profile (niche, tier, city, language).`, user: `Brand: ${i.brand ?? 'not given'}\n\nBrief:\n${i.brief}` }),
  script: i => ({ system: `${HOUSE} Write for short video. Give exactly: "HOOK OPTIONS" (3 numbered hooks, each under 12 words), then "SCRIPT" for a ${i.format ?? 'Reel'} with timestamps, on-screen text and voiceover. Language: ${i.language ?? 'Hinglish'} (Hinglish = Hindi in Roman script mixed with English). Follow the brand's do's and don'ts strictly.`, user: J(i) }),
  caption: i => ({ system: `${HOUSE} Write 3 caption options in the brand's tone (${i.tone ?? 'warm, confident'}), each under 60 words with a call to action, then one line of 8–12 relevant hashtags. Language: ${i.language ?? 'English'}.`, user: J(i) }),
  creator_reasons: i => ({ system: `${HOUSE} For each creator, write ONE short sentence (under 22 words) saying why they suit this campaign, using only the facts given. Do not change the order or the scores. Reply as a JSON object mapping creator_id to the sentence.`, user: J(i), json: true }),
  report_summary: i => ({ system: `${HOUSE} Write one client-friendly paragraph (80–120 words) summarising this campaign's results for a PDF report. Use only the numbers given; lead with the strongest result; no hype words.`, user: J(i) }),
  notes_to_tasks: i => ({ system: `${HOUSE} Turn rough meeting or call notes into tasks. Reply as a JSON array of objects: {"title": string (starts with a verb), "assignee": one of the team names given or null, "due_date": "YYYY-MM-DD" or null}. Today is ${i.today}. Only include real action items.`, user: `Team: ${J(i.team)}\n\nNotes:\n${i.notes}`, json: true }),
  payment_reminder: i => ({ system: `${HOUSE} Draft a polite, firm payment reminder ${i.channel === 'whatsapp' ? 'WhatsApp message (under 70 words)' : 'email with a subject line'}. Mention the invoice number, amount and due date. Offer to resend the invoice. No threats.`, user: J(i) }),
  creator_outreach: i => ({ system: `${HOUSE} Draft a friendly creator outreach DM (under 90 words): who we are, the brand and campaign in one line, what we need, and a clear ask to share rates and availability.`, user: J(i) }),
  client_update: i => ({ system: `${HOUSE} Draft a short client update email with a subject line: what is done, what is in progress, what we need from them, next date.`, user: J(i) }),
  weekly_insight: i => ({ system: `${HOUSE} You are given last week's numbers and the week before. Write exactly "5 points" (plain-language observations, each naming its number) and "3 suggestions" (specific actions for this week). Do not calculate new figures beyond simple differences.`, user: J(i) }),
  ask_plan: i => ({ system: `You translate a question into ONE read-only query on these views (name: columns as name:type):\n${J(i.schema)}\nToday is ${i.today}. Reply with JSON only: {"view": string, "select": [{"column": string, "agg"?: "sum"|"avg"|"count"|"min"|"max"}], "filters"?: [{"column": string, "op": "="|"!="|">"|">="|"<"|"<="|"ilike", "value": string}], "group_by"?: [string], "order_by"?: {"column": string, "dir": "asc"|"desc"}, "limit"?: number}. A calculated column is named agg_column (e.g. sum_total). Use count with column "*". If the question cannot be answered from these views reply {"view": null}.`, user: String(i.question), json: true }),
  ask_explain: i => ({ system: `${HOUSE} Answer the question in 1–3 sentences using only the rows given. If the rows are empty, say no matching records were found.`, user: `Question: ${i.question}\n\nRows:\n${J(i.rows)}` }),
}
const STAFF_ONLY = new Set(['weekly_insight', 'payment_reminder', 'creator_reasons', 'report_summary'])

const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('')

interface Provider { name: string; base_url: string; model: string; secret_name: string; daily_limit: number }
interface Result { output: string; provider: string; cached: boolean }

async function generate(admin: SupabaseClient, memberId: string | null, task: string, p: Prompt, regenerate: boolean): Promise<Result> {
  const messages = [{ role: 'system', content: p.system }, { role: 'user', content: scrub(p.user) }]   // privacy filter
  const hash = await sha(task + '\n' + JSON.stringify(messages))
  const log = (row: Record<string, unknown>) => admin.from('ai_logs').insert({ task, created_by: memberId, ...row })
  if (!regenerate) {
    const { data: hit } = await admin.from('ai_cache').select('output, provider').eq('hash', hash).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (hit) { await log({ provider: hit.provider, model: 'cache', status: 'succeeded', cached: true }); return { output: hit.output, provider: hit.provider, cached: true } }
  }
  const [{ data: providers }, { data: usage }] = await Promise.all([
    admin.from('ai_providers').select('name, base_url, model, secret_name, daily_limit').eq('is_enabled', true).order('priority'),
    admin.rpc('ai_usage')])
  const left = new Map(((usage ?? []) as { provider: string; remaining: number }[]).map(u => [u.provider, u.remaining]))
  const problems: string[] = []
  for (const pr of (providers ?? []) as Provider[]) {
    const key = Deno.env.get(pr.secret_name)
    if (!key) { problems.push(`${pr.name}: no key set`); continue }
    if ((left.get(pr.name) ?? 1) <= 0) { problems.push(`${pr.name}: daily free quota used`); continue }
    const t0 = Date.now()
    try {
      const r = await fetch(pr.base_url.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({ model: pr.model, messages, temperature: p.json ? 0.1 : 0.7, ...(p.json ? { response_format: { type: 'json_object' } } : {}) }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 160)}`)       // 429 and 5xx land here → next provider
      const body = await r.json()
      const output = String(body.choices?.[0]?.message?.content ?? '').trim()
      if (!output) throw new Error('empty reply')
      await log({ provider: pr.name, model: pr.model, status: 'succeeded', tokens_in: body.usage?.prompt_tokens ?? null, tokens_out: body.usage?.completion_tokens ?? null, latency_ms: Date.now() - t0 })
      await admin.from('ai_cache').upsert({ hash, task, provider: pr.name, output, expires_at: new Date(Date.now() + 24 * 3600e3).toISOString() }, { onConflict: 'hash' })
      return { output, provider: pr.name, cached: false }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      problems.push(`${pr.name}: ${msg.slice(0, 80)}`)
      await log({ provider: pr.name, model: pr.model, status: 'failed', error: msg.slice(0, 300), latency_ms: Date.now() - t0 })
    }
  }
  throw new Error(`No AI provider could answer. ${problems.join(' · ') || 'No providers are enabled.'}`)
}

/** Models sometimes wrap JSON in a code fence. */
const parseJson = (s: string) => JSON.parse(s.replace(/^```(?:json)?\s*|\s*```$/g, ''))

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  let body: { task?: string; input?: Input; regenerate?: boolean }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const task = String(body.task ?? ''), input = scrubDeep(body.input ?? {}), admin = service()

  try {
    // the scheduler: Monday's insight is stored as a draft for a founder to accept
    if (isCron(req)) {
      if (task !== 'weekly_insight') return json({ error: 'Scheduler may only run weekly_insight' }, 400)
      const { data: numbers, error } = await admin.rpc('weekly_numbers_system')
      if (error) return json({ error: error.message }, 500)
      const r = await generate(admin, null, task, TASKS.weekly_insight(numbers), false)
      await admin.from('ai_insights').upsert({ week_start: numbers.week_start, numbers, body: r.output, status: 'draft' }, { onConflict: 'week_start', ignoreDuplicates: true })
      return json({ ok: true, provider: r.provider })
    }

    // a person: check who they are with their own token, so RLS applies to everything they read
    const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const [{ data: role }, { data: memberId }] = await Promise.all([asCaller.rpc('current_app_role'), asCaller.rpc('current_member_id')])
    if (!role || role === 'freelancer') return json({ error: 'AI tools are for the Social Mog team' }, 403)
    const staff = role === 'founder' || role === 'manager'

    if (task === 'ask') {
      const question = String(input.question ?? '').slice(0, 500)
      if (!question.trim()) return json({ error: 'Ask a question' }, 400)
      const { data: schema } = await asCaller.rpc('ask_schema')
      const plan = await generate(admin, memberId, 'ask', TASKS.ask_plan({ question, schema, today: new Date().toISOString().slice(0, 10) }), !!body.regenerate)
      let spec: Record<string, unknown>
      try { spec = parseJson(plan.output) } catch { return json({ error: 'I couldn’t turn that into a query. Try rephrasing.' }, 422) }
      if (!spec.view) return json({ output: 'I can’t answer that from the data I’m allowed to read (brands, campaigns, creators, invoices, payments, expenses, payouts, production, tasks).', provider: plan.provider, cached: plan.cached, rows: [], query: null })
      // the database validates the plan and runs it read-only, as the person asking
      const { data: rows, error } = await asCaller.rpc('ask_query', { p_spec: spec })
      if (error) return json({ error: `That query wasn’t allowed: ${error.message}` }, 422)
      const answer = await generate(admin, memberId, 'ask', TASKS.ask_explain({ question, rows }), !!body.regenerate)
      return json({ output: answer.output, provider: answer.provider, cached: answer.cached, rows, query: spec })
    }

    if (!TASKS[task] || task.startsWith('ask_')) return json({ error: `Unknown task “${task}”` }, 400)
    if (STAFF_ONLY.has(task) && !staff) return json({ error: 'That tool is for founders and managers' }, 403)
    let data = input
    if (task === 'weekly_insight') {                       // numbers always come from the database
      const { data: numbers, error } = await asCaller.rpc('weekly_numbers')
      if (error) return json({ error: error.message }, 403)
      data = numbers
    }
    const r = await generate(admin, memberId, task, TASKS[task](data), !!body.regenerate)
    return json(task === 'weekly_insight' ? { ...r, numbers: data } : r)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502)
  }
})
