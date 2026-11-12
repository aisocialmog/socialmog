// Settings → Automations, Integrations (Ops Board API) and AI.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Pill, SectionTitle } from '../components/ui/kit'
import { Icon } from '../components/ui/Icon'
import { Andon } from '../components/art/Ink'
import { Loading, useAsyncAction } from './money/MoneyBits'
import { useAsync } from '../hooks/useAsync'
import { useAuth } from '../lib/auth'
import { formatDateTime } from '../lib/format'
import { supabase } from '../lib/supabase'
import { db } from '../data/db'
import { useReauth } from '../lib/reauth'

const Back = ({ title, kanji }: { title: string; kanji: string }) => <>
  <Link to="/settings" className="text-sm text-muted hover:text-ink inline-flex items-center gap-1"><Icon name="chevronLeft" /> Settings</Link>
  <h1 className="font-mincho text-3xl text-ink"><span className="text-accent-ink mr-2" aria-hidden lang="ja">{kanji}</span>{title}</h1></>
const Err = ({ children }: { children: React.ReactNode }) => children ? <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{children}</p> : null
const Toggle = ({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
    className={`relative w-11 h-6 rounded-full shrink-0 transition-colors duration-calm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50 ${on ? 'bg-accent' : 'bg-line/50'}`}>
    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-kinari shadow transition-transform duration-calm ${on ? 'translate-x-5' : ''}`} /></button>)

// ─── Automations ────────────────────────────────────────────
interface Auto { key: string; name: string; description: string; schedule_label: string; is_enabled: boolean; last_run_at: string | null; last_result: string | null; last_error: string | null; runs_by_hand?: boolean }
interface Template { id: string; title: string; anchor: 'start' | 'end'; offset_days: number; is_active: boolean }
interface Draft { id: string; kind: string; to_name: string; channel: string; body: string; status: string; created_at: string }

function Templates() {
  const { data, reload } = useAsync(() => db.rows<Template>('task_templates', { is_archived: false }, 'offset_days'), [])
  const [f, setF] = useState({ title: '', anchor: 'start' as Template['anchor'], offset_days: '0' })
  const patch = async (id: string, p: Partial<Template> & { is_archived?: boolean }) => { await db.update('task_templates', id, p); reload() }
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="型">Campaign task templates</SectionTitle>
      <p className="text-sm text-muted mb-3">Created for every new campaign, assigned to its owner. Days count from the campaign’s start or end date; a negative number means before.</p>
      <ul className="space-y-2">{(data ?? []).map(t => (
        <li key={t.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_5.5rem_9rem_auto_auto] gap-2 items-center">
          <input className="field" aria-label="Task title" defaultValue={t.title} onBlur={e => e.target.value.trim() && e.target.value !== t.title && patch(t.id, { title: e.target.value.trim() })} />
          <input type="number" className="field num" aria-label="Days" defaultValue={t.offset_days} onBlur={e => Number(e.target.value) !== t.offset_days && patch(t.id, { offset_days: Number(e.target.value) || 0 })} />
          <select className="field" aria-label="Counted from" value={t.anchor} onChange={e => patch(t.id, { anchor: e.target.value as Template['anchor'] })}><option value="start">days from start</option><option value="end">days from end</option></select>
          <Toggle on={t.is_active} label={`Use “${t.title}”`} onChange={v => patch(t.id, { is_active: v })} />
          <button className="icon-btn" aria-label={`Remove “${t.title}”`} onClick={() => patch(t.id, { is_archived: true })}><Icon name="close" /></button></li>))}</ul>
      <form className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_5.5rem_9rem_auto] gap-2 mt-3" onSubmit={async e => { e.preventDefault(); await db.insert('task_templates', { title: f.title.trim(), anchor: f.anchor, offset_days: Number(f.offset_days) || 0 }); setF({ ...f, title: '' }); reload() }}>
        <input className="field" aria-label="New template title" placeholder="New task, e.g. Confirm shoot dates" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
        <input type="number" className="field num" aria-label="Days" value={f.offset_days} onChange={e => setF({ ...f, offset_days: e.target.value })} />
        <select className="field" aria-label="Counted from" value={f.anchor} onChange={e => setF({ ...f, anchor: e.target.value as Template['anchor'] })}><option value="start">days from start</option><option value="end">days from end</option></select>
        <button className="btn-ghost" disabled={!f.title.trim()}>Add</button>
      </form>
    </Card>
  )
}

function Drafts() {
  const { data, reload } = useAsync(() => db.rows<Draft>('message_drafts', {}, 'created_at', false), [])
  const [edit, setEdit] = useState<Record<string, string>>({})
  const rows = (data ?? []).filter(d => d.status === 'draft')
  const set = async (d: Draft, status: string) => { await db.update('message_drafts', d.id, { status, body: edit[d.id] ?? d.body }); if (status === 'approved') await navigator.clipboard?.writeText(edit[d.id] ?? d.body).catch(() => null); reload() }
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="文" aside={<span className="text-xs text-muted num">{rows.length} waiting</span>}>Messages to approve</SectionTitle>
      <p className="text-sm text-muted mb-3">Reminders drafted for brands and creators. Nothing is ever sent automatically: approving copies the message for you to send.</p>
      {!rows.length ? <p className="text-sm text-muted">No drafts are waiting.</p> : <ul className="space-y-4">{rows.map(d => (
        <li key={d.id}><p className="text-sm text-ink mb-1">{d.kind.replace(/_/g, ' ')} → <span className="font-medium">{d.to_name}</span> <span className="text-muted">· {d.channel} · {formatDateTime(d.created_at)}</span></p>
          <label className="sr-only" htmlFor={`d-${d.id}`}>Message to {d.to_name}</label>
          <textarea id={`d-${d.id}`} className="field h-auto py-2" rows={5} value={edit[d.id] ?? d.body} onChange={e => setEdit({ ...edit, [d.id]: e.target.value })} />
          <div className="flex gap-2 mt-2"><button className="btn-primary" onClick={() => set(d, 'approved')}>Approve & copy</button><button className="btn-ghost" onClick={() => set(d, 'discarded')}>Discard</button></div></li>))}</ul>}
    </Card>
  )
}

export function AutomationsPage() {
  const { role } = useAuth()
  const founder = role === 'founder'
  const { data, loading, error, reload } = useAsync(() => db.rpc<Auto[]>('automations_list'), [])
  const [ran, setRan] = useState<Record<string, string>>({})
  const act = useAsyncAction()
  const run = (a: Auto) => act.run(async () => { const r = await db.rpc<string>('run_automation', { p_key: a.key }); setRan(x => ({ ...x, [a.key]: r })); await reload() })
  const toggle = async (a: Auto, v: boolean) => { const id = (await db.rows<{ id: string }>('automations', { key: a.key }))[0]?.id; if (id) await db.update('automations', id, { is_enabled: v }); reload() }
  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl">
      <Back title="Automations" kanji="自" />
      <p className="text-sm text-muted">Jidoka: when the data looks wrong, an automation stops and lights the andon on the dashboard instead of carrying on. Times are IST.</p>
      <Err>{error ?? act.error}</Err>
      {loading && !data ? <Loading label="Loading automations" /> : (
        <ul className="space-y-3">{(data ?? []).map(a => (
          <li key={a.key} className={`shoji p-4 sm:p-5 ${a.last_error ? 'border-akane/70' : ''}`}>
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-ink font-medium flex flex-wrap items-center gap-2">{a.name}{!a.is_enabled && <Pill>Off</Pill>}</p>
                <p className="text-sm text-muted mt-0.5">{a.description}</p>
                <p className="text-xs text-muted mt-2"><span className="text-ink">{a.schedule_label}</span>{a.last_run_at && <> · last ran <span className="num">{formatDateTime(a.last_run_at)}</span></>}</p>
                {(ran[a.key] ?? a.last_result) && <p className="text-sm text-ink mt-1.5 flex gap-2">{(a.last_error || /^Stopped/.test(ran[a.key] ?? a.last_result ?? '')) && <Andon size={16} lit />}<span>{ran[a.key] ?? a.last_result}</span></p>}
                {a.last_error && <p className="text-sm text-ink mt-1 border-l-2 border-akane pl-2">Error: {a.last_error}</p>}
              </div>
              {founder && <div className="flex flex-col items-end gap-3">
                <Toggle on={a.is_enabled} label={`${a.name} on`} onChange={v => toggle(a, v)} />
                {a.runs_by_hand !== false && <button className="btn-ghost" disabled={act.busy} onClick={() => run(a)}>Run now</button>}
              </div>}
            </div>
          </li>))}</ul>
      )}
      <Drafts />
      <Templates />
    </div>
  )
}

// ─── Integrations: the Ops Board ────────────────────────────
interface ApiKey { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null; rate_limit_per_min?: number }
const BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined ?? 'https://YOUR-PROJECT.supabase.co') + '/functions/v1/ops'
const Code = ({ children }: { children: string }) => <pre className="bg-bg border border-line/30 rounded-shoji p-3 text-xs text-ink overflow-x-auto whitespace-pre"><code>{children}</code></pre>

const DOCS: [string, string, string, string][] = [
  ['GET /presence', 'Current status of each founder.', `curl ${BASE}/presence -H "x-api-key: $OPS_KEY"`,
    `[{ "member_id": "…", "name": "Asha", "status": "focus", "message": "Edit Diwali reel", "since": "2026-11-11T09:02:11Z", "expected_back": "2026-11-11T09:52:11Z" }]`],
  ['GET /today', 'Today’s tasks, shoots, deadlines and open andon alerts.', `curl ${BASE}/today -H "x-api-key: $OPS_KEY"`,
    `{ "date": "2026-11-11",\n  "tasks": [{ "title": "Call Rohan", "status": "todo", "priority": "high", "due_time": "16:00:00", "overdue": false, "assignees": ["Asha"] }],\n  "shoots": [{ "title": "Winter menu", "brand": "Chai Sutra", "call_time": "10:00:00", "location": "Studio 4", "status": "confirmed" }],\n  "deadlines": [{ "title": "Diwali Reel", "brand": "Chai Sutra", "stage": "client_review", "kind": "go_live" }],\n  "andons": [{ "title": "Edit Diwali reel v2", "reason": "Footage link is dead", "raised_by": "Farid", "waiting_on": "Asha", "raised_at": "…", "minutes_open": 42 }] }`],
  ['GET /summary?range=this_week', 'Totals for a period. range = this_week · last_week · this_month · last_month · custom (with from= and to= as YYYY-MM-DD). Money is totals only.', `curl "${BASE}/summary?range=custom&from=2026-11-01&to=2026-11-10" -H "x-api-key: $OPS_KEY"`,
    `{ "range": "custom", "from": "2026-11-01", "to": "2026-11-10",\n  "revenue": 482000, "profit": 214000, "cash_received": 356000, "expenses": 244000,\n  "content_posted": 14, "campaigns_live": 3,\n  "founders": [{ "member_id": "…", "name": "Asha", "tasks_done": 9, "hours_worked": 31.5, "break_hours": 4.0 }] }`],
  ['GET /activity?limit=20', 'The latest activity in plain language (limit 1–100). Payouts, capital and payment details never appear.', `curl "${BASE}/activity?limit=5" -H "x-api-key: $OPS_KEY"`,
    `[{ "at": "2026-11-11T08:44:00Z", "who": "Asha", "text": "Asha moved “Diwali Reel” to Client Review", "record_type": "deliverables" },\n { "at": "2026-11-11T08:30:00Z", "who": "Dev", "text": "Dev recorded ₹15,000 payment from Chai Sutra", "record_type": "receipts" }]`],
  ['POST /status', 'The only write. Sets one founder’s own status and message. status = working · focus · in_shoot · in_meeting · on_break · off · blocked. founder = their email or member_id.', `curl -X POST ${BASE}/status -H "x-api-key: $OPS_KEY" -H "Content-Type: application/json" \\\n  -d '{ "founder": "asha@socialmog.in", "status": "in_meeting", "message": "Client call", "expected_back": "2026-11-11T11:30:00Z" }'`,
    `{ "member_id": "…", "name": "Asha", "status": "in_meeting", "message": "Client call", "since": "…", "expected_back": "2026-11-11T11:30:00Z" }`],
]

export function IntegrationsPage() {
  const { role } = useAuth()
  const { data: keys, reload } = useAsync(() => db.rows<ApiKey>('api_clients', {}, 'created_at', false), [])
  const { data: org, reload: reloadOrg } = useAsync(async () => (await db.rows<{ id: string; ops_webhook_url: string | null; ops_allowed_origin: string | null }>('org_settings'))[0], [])
  const [fresh, setFresh] = useState<string | null>(null)
  const act = useAsyncAction()
  if (role !== 'founder') return <div className="space-y-5"><Back title="Integrations" kanji="繋" /><p className="text-sm text-muted">API keys are for founders only.</p></div>
  const saveOrg = (p: Record<string, string | null>) => act.run(async () => { await db.update('org_settings', org!.id, p); await reloadOrg() })
  const reauth = useReauth()
  const live = (keys ?? []).filter(k => !k.revoked_at)
  return (
    <div className="space-y-5 sm:space-y-6 max-w-4xl">
      <Back title="Integrations" kanji="繋" />
      <Err>{act.error}</Err>
      <Card className="shoji-pad">
        <SectionTitle kanji="鍵">Ops Board API key</SectionTitle>
        <p className="text-sm text-muted mb-4">A separate key for the Ops Board website. It can read the five endpoints below and set a founder’s status — nothing else. The key is shown once; we keep only a fingerprint of it.</p>
        {fresh && <div className="shoji border-accent p-4 mb-4" role="status"><p className="text-sm text-ink mb-2">Copy this key now — it won’t be shown again.</p>
          <div className="flex gap-2"><code className="field h-auto py-2 flex-1 break-all num" id="new-key">{fresh}</code><button className="btn-primary" onClick={() => navigator.clipboard?.writeText(fresh)}>Copy</button><button className="btn-ghost" onClick={() => setFresh(null)}>Done</button></div></div>}
        <ul className="divide-y divide-line/15 mb-4">{(keys ?? []).map(k => (
          <li key={k.id} className="py-3 flex flex-wrap items-center gap-3"><span className="flex-1 min-w-[12rem]"><span className="block text-sm text-ink">{k.name} <code className="text-muted num">{k.key_prefix}…</code></span>
            <span className="block text-xs text-muted">Created {formatDateTime(k.created_at)} · {k.last_used_at ? `last used ${formatDateTime(k.last_used_at)}` : 'never used'}{k.rate_limit_per_min && ` · ${k.rate_limit_per_min} requests a minute`}</span></span>
            {k.revoked_at ? <Pill>Revoked</Pill> : <>
              <button className="btn-ghost" disabled={act.busy} onClick={() => window.confirm('Rotate this key? The current key stops working immediately.') && act.run(async () => { if (!(await reauth('Rotating an API key is sensitive.'))) return; setFresh(await db.rpc<string>('ops_key_rotate', { p_id: k.id })); await reload() })}>Rotate</button>
              <button className="btn-ghost" disabled={act.busy} onClick={() => window.confirm('Revoke this key? The Ops Board will lose access immediately.') && act.run(async () => { await db.rpc('ops_key_revoke', { p_id: k.id }); await reload() })}>Revoke</button></>}</li>))}
          {keys?.length === 0 && <li className="py-3 text-sm text-muted">No key yet.</li>}</ul>
        {live.length === 0 && <button className="btn-primary" disabled={act.busy} onClick={() => act.run(async () => { if (!(await reauth('Creating an API key is sensitive.'))) return; setFresh(await db.rpc<string>('ops_key_create', { p_name: 'Ops Board' })); await reload() })}>Create the Ops Board key</button>}
      </Card>
      <Card className="shoji-pad">
        <SectionTitle kanji="域">Ops Board address</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block text-sm text-ink">Allowed website (origin)<input className="field mt-1" key={org?.ops_allowed_origin ?? 'o'} placeholder="https://ops.yourdomain.com" defaultValue={org?.ops_allowed_origin ?? ''} onBlur={e => org && e.target.value.trim() !== (org.ops_allowed_origin ?? '') && saveOrg({ ops_allowed_origin: e.target.value.trim().replace(/\/$/, '') || null })} />
            <span className="text-xs text-muted">Only this site’s pages may call the API from a browser.</span></label>
          <label className="block text-sm text-ink">Webhook URL<input className="field mt-1" key={org?.ops_webhook_url ?? 'w'} placeholder="https://ops.yourdomain.com/api/hooks/social-mog" defaultValue={org?.ops_webhook_url ?? ''} onBlur={e => org && e.target.value.trim() !== (org.ops_webhook_url ?? '') && saveOrg({ ops_webhook_url: e.target.value.trim() || null })} />
            <span className="text-xs text-muted">Must start with https://. Leave blank for no webhooks.</span></label>
        </div>
      </Card>
      <Card className="shoji-pad space-y-6">
        <SectionTitle kanji="書">API document — give this to the Ops Board project</SectionTitle>
        <div className="text-sm text-ink space-y-2">
          <p><span className="text-muted">Base URL</span> <code className="num break-all">{BASE}</code></p>
          <p><span className="text-muted">Auth</span> send the key in an <code>x-api-key</code> header (or <code>Authorization: Bearer …</code>). Keep it on the Ops Board’s server — never in browser code.</p>
          <p><span className="text-muted">Limits</span> 60 requests a minute per key; over that you get <code>429</code> with <code>Retry-After: 60</code>. Responses carry <code>X-RateLimit-Remaining</code>.</p>
          <p><span className="text-muted">Errors</span> JSON <code>{'{ "error": "…" }'}</code> with status 400 (bad input), 401 (bad or revoked key), 403 (origin not allowed), 404, 429.</p>
          <p><span className="text-muted">Times</span> are UTC ISO-8601; dates and “today” are India time (IST). Money is in rupees, totals only.</p>
        </div>
        {DOCS.map(([name, about, request, response]) => (
          <section key={name} className="space-y-2"><h3 className="font-mincho text-lg text-ink num">{name}</h3><p className="text-sm text-muted">{about}</p><Code>{request}</Code><Code>{response}</Code></section>))}
        <section className="space-y-2"><h3 className="font-mincho text-lg text-ink">Webhooks</h3>
          <p className="text-sm text-muted">We POST JSON to the webhook URL for: <code>status.changed</code>, <code>andon.raised</code>, <code>andon.resolved</code>, <code>invoice.paid</code>, <code>campaign.completed</code>. Verify <code>X-SocialMog-Signature</code>: it is the hex HMAC-SHA256 of the raw body using the shared webhook secret.</p>
          <Code>{`POST <your webhook URL>\nX-SocialMog-Event: andon.raised\nX-SocialMog-Signature: 9f2c…\n\n{ "event": "andon.raised", "sent_at": "2026-11-11T08:51:03Z",\n  "data": { "id": "…", "title": "Edit Diwali reel v2", "reason": "Footage link is dead", "raised_by": "Farid" } }`}</Code></section>
        <section className="space-y-2"><h3 className="font-mincho text-lg text-ink">Realtime</h3>
          <p className="text-sm text-muted">For instant updates without polling, subscribe to the public Realtime channel <code>ops-board</code> with the project’s anon key. It broadcasts a <code>changed</code> message (no data) whenever presence, an andon or the activity feed changes — then re-fetch the endpoint you show.</p>
          <Code>{`const supabase = createClient("${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://YOUR-PROJECT.supabase.co'}", ANON_KEY)\nsupabase.channel("ops-board")\n  .on("broadcast", { event: "changed" }, ({ payload }) => refresh(payload.event))  // "status.changed" | "andon.raised" | "activity" …\n  .subscribe()`}</Code></section>
      </Card>
    </div>
  )
}

// ─── AI settings ────────────────────────────────────────────
interface Provider { id: string; name: string; base_url: string; model: string; secret_name: string; priority: number; is_enabled: boolean; daily_limit: number }
interface UsageDay { day: string; provider: string; task: string; calls: number; cached: number; failures: number; tokens: number }
export function AiSettingsPage() {
  const { role } = useAuth()
  const founder = role === 'founder'
  const { data, reload } = useAsync(() => db.rows<Provider>('ai_providers', {}, 'priority'), [])
  const { data: keyStatus } = useAsync(() => db.invoke<{ keys: Record<string, boolean> }>('admin', { action: 'ai_status' }).then(r => r.keys, () => null), [])
  const { data: usage } = useAsync(() => supabase ? db.rpc<UsageDay[]>('ai_usage_daily', { p_days: 14 }) : Promise.resolve([] as UsageDay[]), [])
  const act = useAsyncAction()
  const patch = (id: string, p: Partial<Provider>) => act.run(async () => { await db.update('ai_providers', id, p); await reload() })
  const days = [...new Set((usage ?? []).map(u => u.day))]
  return (
    <div className="space-y-5 sm:space-y-6 max-w-4xl">
      <Back title="AI providers" kanji="智" />
      <Err>{act.error}</Err>
      <Card className="shoji-pad">
        <SectionTitle kanji="順">Providers, in priority order</SectionTitle>
        <p className="text-sm text-muted mb-4">Any OpenAI-compatible chat API. The lowest number is tried first; on a rate limit or error the next one is used. Keys are never stored here: each provider names the Supabase secret that holds its key.</p>
        <ul className="space-y-5">{(data ?? []).map(p => (
          <li key={p.id} className="grid sm:grid-cols-[4.5rem_1fr_1fr_6.5rem_auto] gap-3 items-end">
            <label className="text-xs text-muted">Priority<input type="number" min={1} className="field mt-1 num" disabled={!founder} defaultValue={p.priority} onBlur={e => Number(e.target.value) !== p.priority && patch(p.id, { priority: Number(e.target.value) || p.priority })} /></label>
            <label className="text-xs text-muted">{p.name} · base URL<input className="field mt-1" disabled={!founder} defaultValue={p.base_url} onBlur={e => e.target.value !== p.base_url && patch(p.id, { base_url: e.target.value.trim() })} /></label>
            <label className="text-xs text-muted">Model<input className="field mt-1" disabled={!founder} defaultValue={p.model} onBlur={e => e.target.value !== p.model && patch(p.id, { model: e.target.value.trim() })} /></label>
            <label className="text-xs text-muted">Free calls / day<input type="number" min={0} className="field mt-1 num" disabled={!founder} defaultValue={p.daily_limit} onBlur={e => Number(e.target.value) !== p.daily_limit && patch(p.id, { daily_limit: Number(e.target.value) || 0 })} /></label>
            <span className="flex items-center gap-2 pb-2"><Toggle on={p.is_enabled} label={`${p.name} enabled`} disabled={!founder} onChange={v => patch(p.id, { is_enabled: v })} /></span>
            <p className="text-xs text-muted sm:col-span-5 -mt-1 flex flex-wrap items-center gap-2">Key: <Pill tone={keyStatus?.[p.secret_name] ? 'ink' : 'alert'}>{keyStatus == null ? 'Status unavailable' : keyStatus[p.secret_name] ? '✓ Set' : '✗ Not set'}</Pill> Supabase secret <code className="text-ink">{p.secret_name}</code> — never shown here. Set it with <code className="text-ink">supabase secrets set {p.secret_name}=…</code></p></li>))}</ul>
      </Card>
      <Card className="shoji-pad">
        <SectionTitle kanji="量">Daily usage — last 14 days</SectionTitle>
        {!days.length ? <p className="text-sm text-muted">No AI calls logged yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted border-b border-line/30"><th className="py-2 font-normal">Day</th><th className="py-2 font-normal">Provider</th><th className="py-2 font-normal">Task</th><th className="py-2 font-normal text-right">Calls</th><th className="py-2 font-normal text-right">From cache</th><th className="py-2 font-normal text-right">Failed</th><th className="py-2 font-normal text-right">Tokens</th></tr></thead>
            <tbody>{(usage ?? []).map((u, i) => <tr key={i} className="border-b border-line/15"><td className="py-2 num">{u.day}</td><td className="py-2 text-ink">{u.provider}</td><td className="py-2">{u.task.replace(/_/g, ' ')}</td>
              <td className="py-2 text-right num">{u.calls}</td><td className="py-2 text-right num">{u.cached}</td><td className="py-2 text-right num">{u.failures}</td><td className="py-2 text-right num">{new Intl.NumberFormat('en-IN').format(u.tokens)}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  )
}
