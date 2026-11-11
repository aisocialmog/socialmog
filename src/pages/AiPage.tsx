// AI Tools 智 — nine tools, one engine. Drafts only: a person accepts every result.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, EmptyState, Pill, SectionTitle } from '../components/ui/kit'
import { AiDraft, aiGenerate, type AiResult } from '../components/work/Ai'
import { Loading, useAsyncAction } from './money/MoneyBits'
import { useAsync } from '../hooks/useAsync'
import { useAuth } from '../lib/auth'
import { formatDate, formatINR, istToday } from '../lib/format'
import { formatCount } from '../lib/creators'
import { db } from '../data/db'
import { workApi } from '../data/work'
import { campaignsApi } from '../data/campaigns'
import { productionApi } from '../data/production'
import { moneyApi } from '../data/money'
import { creatorsApi } from '../data/creators'

type Tool = 'plan' | 'script' | 'caption' | 'match' | 'summary' | 'notes' | 'followup' | 'insight' | 'ask'
const TOOLS: [Tool, string, string, boolean?][] = [
  ['plan', 'Brief to plan', 'Paste a brand’s brief; get objective, pillars, deliverables, timeline and creator profile.'],
  ['script', 'Script writer', '3 hooks and a Reel script in Hindi, English or Hinglish, following the brand’s do’s and don’ts.'],
  ['caption', 'Caption & hashtags', 'Captions in the brand’s tone for a post.'],
  ['match', 'Creator matcher', 'Ranks our creators for a campaign from our own numbers. The AI only writes the reasons.', true],
  ['summary', 'Campaign report summary', 'A client-friendly paragraph from the campaign’s performance numbers.', true],
  ['notes', 'Notes → tasks', 'Paste rough call notes; confirm the tasks before they are created.'],
  ['followup', 'Follow-up writer', 'Payment reminder, creator outreach DM or client update, from the record’s details.', true],
  ['insight', 'Weekly insight', 'Every Monday: last week in 5 points and 3 suggestions. Numbers come from the database.', true],
  ['ask', 'Ask Social Mog', 'Ask a question about our data. Read-only: it can never change anything.'],
]
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block text-sm text-ink">{label}<div className="mt-1">{children}</div></label>
const Pick = ({ label, value, onChange, options, empty }: { label: string; value: string; onChange: (v: string) => void; options: { id: string; name: string }[]; empty: string }) =>
  <Field label={label}><select className="field" value={value} onChange={e => onChange(e.target.value)}><option value="">{empty}</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>

function Quota() {
  const { data } = useAsync(() => db.rpc<{ provider: string; calls: number; daily_limit: number; remaining: number; is_enabled?: boolean }[]>('ai_usage'), [])
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="残">Free quota left today</SectionTitle>
      <ul className="grid sm:grid-cols-3 gap-4">{(data ?? []).map(p => (
        <li key={p.provider}><p className="text-sm text-ink flex justify-between"><span>{p.provider}{p.is_enabled === false && <span className="text-muted"> (off)</span>}</span><span className="num">{p.remaining} / {p.daily_limit}</span></p>
          <div className="h-1.5 rounded-full bg-line/25 mt-1.5 overflow-hidden" role="img" aria-label={`${p.remaining} of ${p.daily_limit} requests left`}><div className="h-full bg-accent rounded-full" style={{ width: `${p.daily_limit ? (p.remaining / p.daily_limit) * 100 : 0}%` }} /></div></li>))}</ul>
      <p className="text-xs text-muted mt-3">Providers are tried in order; if one is rate-limited or fails, the next is used. Identical requests are answered from a 24-hour cache.</p>
    </Card>
  )
}

function Plan() {
  const { data: brands } = useAsync(workApi.brands, [])
  const [brand, setBrand] = useState(''), [brief, setBrief] = useState(''), [go, setGo] = useState(0)
  return <div className="space-y-4">
    <Pick label="Brand" value={brand} onChange={setBrand} options={brands ?? []} empty="Choose a brand" />
    <Field label="The brand’s brief"><textarea className="field h-40 py-2" value={brief} onChange={e => setBrief(e.target.value)} placeholder="Paste the brief here" /></Field>
    <button className="btn-primary" disabled={!brief.trim()} onClick={() => setGo(n => n + 1)}>Draft the plan</button>
    {go > 0 && <AiDraft key={go} task="brief_to_plan" input={{ brand: brands?.find(b => b.id === brand)?.name ?? null, brief }} rows={18} onDiscard={() => setGo(0)}
      acceptLabel={brand ? 'Accept — save as a note on the brand' : 'Choose a brand to save'} onAccept={async text => { if (!brand) throw new Error('Choose a brand first'); await db.insert('comments', { brand_id: brand, body: `Campaign plan (AI draft, accepted):\n${text}` }) }} />}
  </div>
}

function ItemTool({ task }: { task: 'script' | 'caption' }) {
  const { data: items } = useAsync(productionApi.items, [])
  const [id, setId] = useState(''), [language, setLanguage] = useState(task === 'script' ? 'Hinglish' : 'English'), [go, setGo] = useState(0)
  const it = items?.find(i => i.id === id)
  return <div className="space-y-4">
    <Pick label="Production item" value={id} onChange={v => { setId(v); setGo(0) }} options={(items ?? []).map(i => ({ id: i.id, name: `${i.title} · ${i.brand_name}` }))} empty="Choose an item" />
    <Field label="Language"><select className="field" value={language} onChange={e => setLanguage(e.target.value)}>{['Hinglish', 'Hindi', 'English'].map(l => <option key={l}>{l}</option>)}</select></Field>
    <button className="btn-primary" disabled={!it} onClick={() => setGo(n => n + 1)}>{task === 'script' ? 'Write hooks and script' : 'Write captions'}</button>
    {go > 0 && it && <AiDraft key={go} task={task} rows={16} onDiscard={() => setGo(0)} input={{ item: { title: it.title, format: it.format, platform: it.platform, brief: it.brief, brand_name: it.brand_name, campaign_name: it.campaign_name }, language }}
      acceptLabel={task === 'script' ? 'Accept — save as a new script version' : 'Accept — save as a note'}
      onAccept={async text => task === 'script'
        ? productionApi.saveScript(it.id, text.split(/\n{2,}/).map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join(''), true, (await productionApi.scripts(it.id)).sort((a, b) => b.version - a.version)[0])
        : db.insert('comments', { deliverable_id: it.id, body: `Caption (AI draft, accepted):\n${text}` })} />}
    {it && <p className="text-xs text-muted">The brand’s do’s and don’ts are added from the campaign brief when you use the button on the <Link className="underline" to={`/production/${it.id}`}>item’s page</Link>.</p>}
  </div>
}

interface Match { creator_id: string; name: string; score: number; tier: string | null; city: string | null; niches: string[]; avg_views: number | null; engagement_rate: number | null; rate: number | null; past_campaigns: number; avg_cpv: number | null; facts?: string }
function Matcher({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const [sp] = useSearchParams()
  const [id, setId] = useState(sp.get('campaign') ?? '')
  const { data, loading, error } = useAsync(() => id ? db.rpc<Match[]>('creator_match', { p_campaign: id }) : Promise.resolve([]), [id])
  const [reasons, setReasons] = useState<Record<string, string>>({}), [added, setAdded] = useState<string[]>([])
  const act = useAsyncAction()
  const explain = () => act.run(async () => {
    const r = await aiGenerate('creator_reasons', { campaign: campaigns.find(c => c.id === id)?.name, creators: (data ?? []).map(m => ({ creator_id: m.creator_id, name: m.name, city: m.city, niches: m.niches, tier: m.tier, facts: m.facts })) })
    setReasons(JSON.parse(r.output.replace(/^```(?:json)?\s*|\s*```$/g, '')))
  })
  return <div className="space-y-4">
    <Pick label="Campaign" value={id} onChange={v => { setId(v); setReasons({}); setAdded([]) }} options={campaigns} empty="Choose a campaign" />
    {loading && id ? <Loading label="Ranking creators" /> : error ? <p role="alert" className="text-sm text-ink">{error}</p> : id && !data?.length ? <p className="text-sm text-muted">No creators to suggest — everyone suitable is already on this campaign.</p> : data && data.length > 0 && <>
      <div className="flex flex-wrap items-center gap-3"><button className="btn-primary" disabled={act.busy} onClick={explain}>{Object.keys(reasons).length ? 'Rewrite the reasons' : 'Write a reason for each'}</button>
        <span className="text-xs text-muted">Score: niche 30 · rate fit 25 · past performance 25 · platform 10 · city 10. The AI doesn’t change the order.</span></div>
      {act.error && <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{act.error}</p>}
      <ol className="divide-y divide-line/15">{data.map((m, i) => (
        <li key={m.creator_id} className="py-3 flex flex-wrap items-start gap-3">
          <span className="font-mincho text-xl text-muted num w-7">{i + 1}</span>
          <div className="flex-1 min-w-[14rem]">
            <p className="text-sm text-ink"><Link to={`/creators/${m.creator_id}`} className="hover:underline underline-offset-4">{m.name}</Link> <span className="text-muted">· {[m.tier, m.city, m.niches?.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</span></p>
            <p className="text-xs text-muted num mt-0.5">{[m.avg_views != null && `${formatCount(m.avg_views)} avg views`, m.engagement_rate != null && `${m.engagement_rate}% engagement`, m.rate != null && `from ${formatINR(m.rate)}`, m.past_campaigns > 0 && `${m.past_campaigns} past campaigns`, m.avg_cpv != null && `₹${m.avg_cpv} per view`].filter(Boolean).join(' · ')}</p>
            {reasons[m.creator_id] && <p className="text-sm text-ink mt-1.5 border-l-2 border-accent/60 pl-2">{reasons[m.creator_id]}</p>}
          </div>
          <Pill tone={m.score >= 70 ? 'accent' : 'quiet'}>{m.score} / 100</Pill>
          {added.includes(m.creator_id) ? <Pill tone="ink">Shortlisted</Pill> : <button className="btn-ghost" onClick={async () => { await campaignsApi.addCreators(id, [m.creator_id]); setAdded(a => [...a, m.creator_id]) }}>Add to campaign</button>}
        </li>))}</ol>
    </>}
  </div>
}

function Summary({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const [id, setId] = useState(''), [go, setGo] = useState(0)
  const { data: s } = useAsync(() => id ? campaignsApi.summary(id) : Promise.resolve(null), [id])
  return <div className="space-y-4">
    <Pick label="Campaign" value={id} onChange={v => { setId(v); setGo(0) }} options={campaigns} empty="Choose a campaign" />
    <button className="btn-primary" disabled={!s} onClick={() => setGo(n => n + 1)}>Write the summary</button>
    {go > 0 && s && <AiDraft key={go} task="report_summary" rows={7} onDiscard={() => setGo(0)} acceptLabel="Accept — use in the report" input={Object.fromEntries(Object.entries(s).filter(([k, v]) => v != null && /name|objective|date|posted|views|reach|engagement|deliverables|cost_per_view/.test(k)))}
      onAccept={text => db.update('campaigns', id, { report_summary: text })} />}
    {id && <p className="text-xs text-muted">The accepted paragraph appears in the <Link className="underline" to={`/campaigns/${id}/report`}>campaign’s PDF report</Link>.</p>}
  </div>
}

interface Proposed { title: string; assignee: string | null; due_date: string | null; on: boolean }
function Notes() {
  const { data: members } = useAsync(workApi.members, [])
  const [notes, setNotes] = useState(''), [list, setList] = useState<Proposed[] | null>(null), [made, setMade] = useState(0)
  const act = useAsyncAction()
  const run = (regen: boolean) => act.run(async () => {
    const r = await aiGenerate('notes_to_tasks', { notes, team: (members ?? []).map(m => m.name), today: istToday() }, regen)
    const parsed = JSON.parse(r.output.replace(/^```(?:json)?\s*|\s*```$/g, ''))
    setList((Array.isArray(parsed) ? parsed : parsed.tasks ?? []).map((t: Proposed) => ({ ...t, on: true }))); setMade(0)
  })
  const edit = (i: number, p: Partial<Proposed>) => setList(l => l!.map((t, j) => j === i ? { ...t, ...p } : t))
  const create = () => act.run(async () => {
    const chosen = list!.filter(t => t.on && t.title.trim())
    for (const t of chosen) await workApi.create({ title: t.title.trim(), due_date: t.due_date || null }, members?.filter(m => m.name === t.assignee).map(m => m.id) ?? [])
    setMade(chosen.length); setList(null); setNotes('')
  })
  return <div className="space-y-4">
    <Field label="Rough notes from the meeting or call"><textarea className="field h-40 py-2" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    <button className="btn-primary" disabled={!notes.trim() || act.busy} onClick={() => run(false)}>Find the tasks</button>
    {act.error && <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{act.error}</p>}
    {made > 0 && <p className="text-sm text-ink">{made} task{made === 1 ? '' : 's'} created. <Link className="underline" to="/tasks?view=all">See them</Link></p>}
    {list && (list.length === 0 ? <p className="text-sm text-muted">No action items found in those notes.</p> : <>
      <p className="text-sm text-muted">Check each task before it is created. Untick any you don’t want.</p>
      <ul className="space-y-2">{list.map((t, i) => (
        <li key={i} className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_11rem_10rem] gap-2 items-center">
          <input type="checkbox" className="w-4 h-4 accent-[#E3793A]" aria-label={`Create “${t.title}”`} checked={t.on} onChange={e => edit(i, { on: e.target.checked })} />
          <input className="field" aria-label="Task" value={t.title} onChange={e => edit(i, { title: e.target.value })} />
          <select className="field col-start-2 sm:col-start-auto" aria-label="Assignee" value={t.assignee ?? ''} onChange={e => edit(i, { assignee: e.target.value || null })}><option value="">Me</option>{(members ?? []).map(m => <option key={m.id}>{m.name}</option>)}</select>
          <input type="date" className="field num col-start-2 sm:col-start-auto" aria-label="Due date" value={t.due_date ?? ''} onChange={e => edit(i, { due_date: e.target.value || null })} /></li>))}</ul>
      <div className="flex gap-2"><button className="btn-primary" disabled={act.busy || !list.some(t => t.on)} onClick={create}>Create {list.filter(t => t.on).length} task{list.filter(t => t.on).length === 1 ? '' : 's'}</button>
        <button className="btn-ghost" disabled={act.busy} onClick={() => run(true)}>Regenerate</button><button className="btn-ghost" onClick={() => setList(null)}>Discard</button></div>
    </>)}
  </div>
}

function FollowUp() {
  const [kind, setKind] = useState<'payment_reminder' | 'creator_outreach' | 'client_update'>('payment_reminder')
  const { data: invoices } = useAsync(moneyApi.invoices, [])
  const { data: creators } = useAsync(() => creatorsApi.list(), [])
  const { data: brands } = useAsync(workApi.brands, [])
  const [id, setId] = useState(''), [go, setGo] = useState(0)
  const due = (invoices ?? []).filter(i => i.outstanding > 0)
  const inv = due.find(i => i.invoice_id === id), cr = creators?.find(c => c.id === id), br = brands?.find(b => b.id === id)
  const ready = kind === 'payment_reminder' ? inv : kind === 'creator_outreach' ? cr : br
  const input = kind === 'payment_reminder' ? { invoice_number: inv?.invoice_number, brand_name: inv?.brand_name, total: inv?.total, outstanding: inv?.outstanding, due_date: inv?.due_date && formatDate(inv.due_date), days_overdue: inv?.days_overdue }
    : kind === 'creator_outreach' ? { creator: { name: cr?.name, city: cr?.city, niches: cr?.niches, tier: cr?.tier } } : { brand: { name: br?.name } }
  return <div className="space-y-4">
    <Field label="What to write"><select className="field" value={kind} onChange={e => { setKind(e.target.value as typeof kind); setId(''); setGo(0) }}>
      <option value="payment_reminder">Payment reminder to a brand</option><option value="creator_outreach">Creator outreach DM</option><option value="client_update">Client update email</option></select></Field>
    {kind === 'payment_reminder' ? <Pick label="Unpaid invoice" value={id} onChange={setId} options={due.map(i => ({ id: i.invoice_id, name: `${i.invoice_number ?? 'Invoice'} · ${i.brand_name} · ${formatINR(i.outstanding)}` }))} empty="Choose an invoice" />
      : kind === 'creator_outreach' ? <Pick label="Creator" value={id} onChange={setId} options={(creators ?? []).map(c => ({ id: c.id, name: c.name }))} empty="Choose a creator" />
      : <Pick label="Brand" value={id} onChange={setId} options={brands ?? []} empty="Choose a brand" />}
    <button className="btn-primary" disabled={!ready} onClick={() => setGo(n => n + 1)}>Draft the message</button>
    {go > 0 && ready && <AiDraft key={go} task={kind} input={input} rows={10} onDiscard={() => setGo(0)} acceptLabel="Accept & copy"
      onAccept={async text => { await db.insert('message_drafts', { kind, to_name: inv?.brand_name ?? cr?.name ?? br?.name ?? 'Recipient', channel: kind === 'creator_outreach' ? 'dm' : 'email', body: text, status: 'approved',
        invoice_id: inv?.invoice_id ?? null, creator_id: cr?.id ?? null, brand_id: br?.id ?? inv?.brand_id ?? null }); await navigator.clipboard?.writeText(text).catch(() => null) }} />}
    <p className="text-xs text-muted">Nothing is sent from here. Accepting copies the message so you can send it yourself.</p>
  </div>
}

interface Insight { id: string; week_start: string; body: string; status: string }
function WeeklyInsight() {
  const { data, reload } = useAsync(() => db.rows<Insight>('ai_insights', {}, 'week_start', false), [])
  const act = useAsyncAction()
  const [edit, setEdit] = useState<Record<string, string>>({})
  const make = (existing?: Insight) => act.run(async () => {
    const r = await aiGenerate('weekly_insight', {}, !!existing)
    const week = (r.numbers as { week_start?: string } | undefined)?.week_start ?? istToday()
    if (existing) await db.update('ai_insights', existing.id, { body: r.output, status: 'draft' }); else await db.insert('ai_insights', { week_start: week, numbers: r.numbers ?? {}, body: r.output })
    setEdit({}); await reload()
  })
  const rows = (data ?? []).filter(i => i.status !== 'discarded')
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><button className="btn-primary" disabled={act.busy} onClick={() => make()}>{act.busy ? 'Reading last week…' : 'Generate for last week now'}</button><span className="text-xs text-muted">Runs by itself every Monday morning and waits here as a draft.</span></div>
    {act.error && <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{act.error}</p>}
    {!rows.length ? <EmptyState sketch="branch" line="No insights yet. The first arrives on Monday." /> : rows.map(i => (
      <article key={i.id} className="shoji p-4">
        <p className="text-xs text-muted mb-2 flex items-center gap-2"><span className="num">Week of {formatDate(i.week_start)}</span><Pill tone={i.status === 'accepted' ? 'ink' : 'warm'}>{i.status === 'accepted' ? 'Accepted' : 'Draft'}</Pill></p>
        {i.status === 'accepted' ? <p className="text-sm text-ink whitespace-pre-wrap">{i.body}</p> : <>
          <label className="sr-only" htmlFor={`ins-${i.id}`}>Insight draft</label>
          <textarea id={`ins-${i.id}`} className="field h-auto py-3" rows={12} value={edit[i.id] ?? i.body} onChange={e => setEdit({ ...edit, [i.id]: e.target.value })} />
          <div className="flex gap-2 mt-2"><button className="btn-primary" onClick={async () => { await db.update('ai_insights', i.id, { body: edit[i.id] ?? i.body, status: 'accepted' }); reload() }}>Accept</button>
            <button className="btn-ghost" disabled={act.busy} onClick={() => make(i)}>Regenerate</button><button className="btn-ghost" onClick={async () => { await db.update('ai_insights', i.id, { status: 'discarded' }); reload() }}>Discard</button></div></>}
      </article>))}
  </div>
}

function Ask() {
  const [q, setQ] = useState(''), [chat, setChat] = useState<{ q: string; a?: AiResult; error?: string }[]>([])
  const [busy, setBusy] = useState(false)
  const ask = async () => {
    const question = q.trim(); if (!question) return
    setQ(''); setBusy(true); setChat(c => [...c, { q: question }])
    const done = (p: { a?: AiResult; error?: string }) => setChat(c => c.map((m, i) => i === c.length - 1 ? { ...m, ...p } : m))
    try { done({ a: await aiGenerate('ask', { question }) }) } catch (e) { done({ error: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }
  return <div className="space-y-4">
    <ul className="space-y-4" aria-live="polite">{chat.map((m, i) => (
      <li key={i}><p className="text-sm text-muted">You asked</p><p className="text-ink">{m.q}</p>
        {m.error ? <p role="alert" className="text-sm text-ink mt-2 border-l-2 border-akane pl-2">{m.error}</p> : !m.a ? <p className="text-sm text-muted mt-2">Looking it up…</p> : <div className="mt-2 border-l-2 border-accent/60 pl-3">
          <p className="text-ink whitespace-pre-wrap">{m.a.output}</p>
          {m.a.rows && m.a.rows.length > 0 && <details className="mt-2"><summary className="text-xs text-muted cursor-pointer">The {m.a.rows.length} row{m.a.rows.length === 1 ? '' : 's'} behind this answer</summary>
            <div className="overflow-x-auto mt-2"><table className="text-xs w-full"><thead><tr className="text-left text-muted border-b border-line/30">{Object.keys(m.a.rows[0]).map(k => <th key={k} className="py-1 pr-3 font-normal">{k.replace(/_/g, ' ')}</th>)}</tr></thead>
              <tbody>{m.a.rows.slice(0, 20).map((r, j) => <tr key={j} className="border-b border-line/15">{Object.values(r).map((v, k) => <td key={k} className="py-1 pr-3 num text-ink">{String(v ?? '—')}</td>)}</tr>)}</tbody></table></div></details>}</div>}</li>))}</ul>
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); ask() }}>
      <label className="sr-only" htmlFor="ask-q">Your question</label>
      <input id="ask-q" className="field flex-1" value={q} onChange={e => setQ(e.target.value)} placeholder="Which brand was most profitable last month?" autoComplete="off" />
      <button className="btn-primary" disabled={busy || !q.trim()}>Ask</button>
    </form>
    <p className="text-xs text-muted">The AI proposes a query; the database checks it against a list of approved views, runs it read-only with your own access, and the AI explains the rows. It cannot write, and it sees only what you can see.</p>
  </div>
}

export function AiPage() {
  const { role } = useAuth()
  const [sp, setSp] = useSearchParams()
  const staff = role === 'founder' || role === 'manager'
  const tools = TOOLS.filter(t => !t[3] || staff)
  const tool = tools.find(t => t[0] === sp.get('tool'))?.[0] ?? null
  const { data: campaigns } = useAsync(async () => staff ? (await campaignsApi.list()).filter(c => !c.is_historical).map(c => ({ id: c.campaign_id, name: `${c.name} · ${c.brand_name}` })) : [], [staff])
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end gap-3"><h1 className="font-mincho text-3xl text-ink flex-1"><span className="text-accent-ink mr-2" aria-hidden lang="ja">智</span>AI Tools</h1>
        {tool && <button className="btn-ghost" onClick={() => setSp({})}>All tools</button>}</div>
      {!tool ? <>
        <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">{tools.map(([k, name, about], i) => (
          <li key={k}><button onClick={() => setSp({ tool: k })} className="shoji p-5 w-full h-full text-left hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <span className="text-xs text-muted num">{i + 1}</span><span className="block font-mincho text-lg text-ink mt-1">{name}</span><span className="block text-sm text-muted mt-1.5">{about}</span></button></li>))}</ul>
        <Quota />
        <p className="text-xs text-muted">Before anything is sent to an AI provider, phone numbers, emails, UPI IDs, bank details and PAN are removed. Every result is a draft until you accept it.</p>
      </> : (
        <Card className="shoji-pad max-w-4xl"><SectionTitle kanji="智">{tools.find(t => t[0] === tool)![1]}</SectionTitle>
          {tool === 'plan' ? <Plan /> : tool === 'script' ? <ItemTool key="s" task="script" /> : tool === 'caption' ? <ItemTool key="c" task="caption" /> : tool === 'match' ? <Matcher campaigns={campaigns ?? []} />
            : tool === 'summary' ? <Summary campaigns={campaigns ?? []} /> : tool === 'notes' ? <Notes /> : tool === 'followup' ? <FollowUp /> : tool === 'insight' ? <WeeklyInsight /> : <Ask />}</Card>
      )}
    </div>
  )
}
