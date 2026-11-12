// Settings tabs: Appearance, Lists, Security, Data (backups, export, trash) and the Health check page.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, EmptyState, Pill, SectionTitle } from '../../components/ui/kit'
import { Icon } from '../../components/ui/Icon'
import { Loading, useAsyncAction } from '../money/MoneyBits'
import { Categories } from '../money/ReportsSettings'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { usePrefs, type Theme } from '../../lib/prefs'
import { applyLabels, LABEL_DEFAULTS, LABEL_TITLE, type LabelKind, type LabelRow } from '../../lib/labels'
import { useReauth } from '../../lib/reauth'
import { SESSION_DAYS } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { formatDateTime, formatINR, istToday } from '../../lib/format'
import { db } from '../../data/db'

const Err = ({ children }: { children: React.ReactNode }) => children ? <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{children}</p> : null
export const Switch = ({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) => (
  <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
    className={`relative w-11 h-6 rounded-full shrink-0 transition-colors duration-calm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${on ? 'bg-accent' : 'bg-line/50'}`}>
    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-kinari shadow transition-transform duration-calm ${on ? 'translate-x-5' : ''}`} /></button>)

// ─── Appearance ─────────────────────────────────────────────
export function AppearanceTab() {
  const { theme, setTheme, seasonal, setSeasonal, fuji, setFuji } = usePrefs()
  const opts: [Theme, string, string][] = [['dark', 'Sumi', 'Dark — ink-black'], ['washi', 'Washi', 'Light — paper'], ['auto', 'Follow the day', 'Washi from 6 am to 6 pm IST, Sumi at night']]
  return (
    <Card className="shoji-pad space-y-6 max-w-2xl">
      <div><SectionTitle kanji="色">Theme</SectionTitle>
        <div role="radiogroup" aria-label="Theme" className="grid sm:grid-cols-3 gap-3">{opts.map(([k, name, about]) => (
          <button key={k} role="radio" aria-checked={theme === k} onClick={() => setTheme(k)}
            className={`text-left rounded-shoji border p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${theme === k ? 'border-accent bg-raised' : 'border-line/30 hover:bg-raised/60'}`}>
            <span className="block text-ink font-medium">{name}{theme === k && <span className="text-accent-ink ml-1.5" aria-label="selected">✓</span>}</span><span className="block text-xs text-muted mt-1">{about}</span></button>))}</div></div>
      <div className="flex items-center gap-4"><span className="flex-1"><span className="block text-ink">Seasonal effects</span><span className="block text-sm text-muted">Falling petals, fireflies, leaves and snow, following the real season.</span></span>
        <Switch on={seasonal} label="Seasonal effects" onChange={setSeasonal} /></div>
      <div className="flex items-center gap-4"><span className="flex-1"><span className="block text-ink">Fuji header</span><span className="block text-sm text-muted">The mountain and sky above the dashboard greeting.</span></span>
        <Switch on={fuji} label="Fuji header" onChange={setFuji} /></div>
      <p className="text-xs text-muted">Saved with your login, so it follows you to every device.</p>
    </Card>
  )
}

// ─── Lists ──────────────────────────────────────────────────
interface Row { id: string; kind?: string; key?: string; label?: string; name: string; is_archived?: boolean }
function NameList({ title, kanji, table, match, hint }: { title: string; kanji: string; table: 'tags' | 'list_items'; match: Record<string, string>; hint: string }) {
  const { data, reload } = useAsync(() => db.rows<Row>(table, match, 'name'), [table])
  const [name, setName] = useState('')
  const act = useAsyncAction()
  const rows = (data ?? []).filter(r => !r.is_archived)
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji={kanji}>{title}</SectionTitle><p className="text-sm text-muted -mt-2 mb-3">{hint}</p>
      <ul className="grid sm:grid-cols-2 gap-x-6">{rows.map(r => (
        <li key={r.id} className="flex items-center gap-2 py-1.5"><label className="sr-only" htmlFor={`n-${r.id}`}>Name</label>
          <input id={`n-${r.id}`} className="field h-9" defaultValue={r.name} onBlur={e => e.target.value.trim() && e.target.value.trim() !== r.name && act.run(async () => { await db.update(table, r.id, { name: e.target.value.trim() }); await reload() })} />
          <button className="icon-btn" aria-label={`Remove ${r.name}`} onClick={() => act.run(async () => { await db.update(table, r.id, { is_archived: true }); await reload() })}><Icon name="close" /></button></li>))}</ul>
      <form className="flex gap-2 mt-3" onSubmit={e => { e.preventDefault(); act.run(async () => { await db.insert(table, { ...match, name: name.trim() }); setName(''); await reload() }) }}>
        <label className="sr-only" htmlFor={`add-${table}-${title}`}>New name</label><input id={`add-${table}-${title}`} className="field" placeholder="Add one" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn-ghost" disabled={!name.trim() || act.busy}><Icon name="plus" /> Add</button></form>
      <Err>{act.error}</Err>
    </Card>
  )
}

function Renames({ kind }: { kind: LabelKind }) {
  const { data, reload } = useAsync(() => db.rows<LabelRow & { id: string }>('list_labels', { kind }), [kind])
  const act = useAsyncAction()
  const save = (key: string, value: string) => act.run(async () => {
    const cur = data?.find(r => r.key === key), v = value.trim()
    if (!v || v === LABEL_DEFAULTS[kind][key]) { if (cur) await db.del('list_labels', { id: cur.id }) }
    else if (cur) { if (cur.label !== v) await db.update('list_labels', cur.id, { label: v }) }
    else await db.insert('list_labels', { kind, key, label: v })
    const all = await db.rows<LabelRow>('list_labels'); applyLabels(all); await reload()
  })
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="名">{LABEL_TITLE[kind]}</SectionTitle>
      <p className="text-sm text-muted -mt-2 mb-3">Rename how each appears. The set itself is fixed because reports and automations depend on it. Clear a box to go back to the original name.</p>
      <ul className="grid sm:grid-cols-2 gap-x-6">{Object.entries(LABEL_DEFAULTS[kind]).map(([key, def]) => (
        <li key={key} className="py-1.5"><label className="block text-xs text-muted" htmlFor={`${kind}-${key}`}>{def}</label>
          <input id={`${kind}-${key}`} className="field h-9 mt-0.5" defaultValue={data?.find(r => r.key === key)?.label ?? def} key={(data?.find(r => r.key === key)?.label ?? def)} onBlur={e => save(key, e.target.value)} /></li>))}</ul>
      <Err>{act.error}</Err>
    </Card>
  )
}

export function ListsTab() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <Categories />
      <NameList title="Niche tags" kanji="種" table="tags" match={{ kind: 'niche' }} hint="Used to describe creators and match them to campaigns." />
      <NameList title="Lead sources" kanji="源" table="list_items" match={{ kind: 'lead_source' }} hint="Offered when you add a brand." />
      <Renames kind="stage" /><Renames kind="campaign_kind" /><Renames kind="format" />
    </div>
  )
}

// ─── Security ───────────────────────────────────────────────
interface Sec { table_name: string; rls_enabled: boolean; policies: number; open_policies: number; anon_policies: number; issue: string | null }
export function SecurityTab() {
  const { role, isPreview, signOut } = useAuth()
  const founder = role === 'founder'
  const rep = useAsync(() => founder ? db.rpc<Sec[]>('security_report') : Promise.resolve([] as Sec[]), [founder])
  const mfa = useAsync(async () => { if (!supabase) return isPreview ? 'preview' : 'off'; const { data } = await supabase.auth.mfa.listFactors(); return data?.totp?.some(f => f.status === 'verified') ? 'on' : 'off' }, [])
  const act = useAsyncAction()
  const [all, setAll] = useState(false)
  const rows = rep.data ?? [], bad = rows.filter(r => r.issue)
  return (
    <div className="space-y-4 sm:space-y-6 max-w-4xl">
      <Card className="shoji-pad space-y-5">
        <SectionTitle kanji="守">Your login</SectionTitle>
        <div className="flex items-center gap-3 text-sm"><span className="flex-1"><span className="block text-ink">Two-factor (authenticator app)</span>
          <span className="block text-muted">{founder ? 'Required for founders: every sign-in asks for the 6-digit code.' : 'Required for founders. Not needed for your role.'}</span></span>
          {founder && <Pill tone={mfa.data === 'on' ? 'ink' : mfa.data === 'preview' ? 'quiet' : 'alert'}>{mfa.data === 'on' ? 'On' : mfa.data === 'preview' ? 'Not used in preview' : 'Not set up'}</Pill>}</div>
        <div className="flex items-center gap-3 text-sm"><span className="flex-1"><span className="block text-ink">Session length</span><span className="block text-muted">You’re signed out {SESSION_DAYS} days after signing in, on every device.</span></span></div>
        <div className="flex items-center gap-3 text-sm"><span className="flex-1"><span className="block text-ink">Log out all devices</span><span className="block text-muted">Ends every session, including this one. Use it if a phone or laptop is lost.</span></span>
          <button className="btn-ghost" disabled={act.busy} onClick={() => window.confirm('Sign out of every device?') && act.run(async () => { if (supabase) await supabase.auth.signOut({ scope: 'global' }); await signOut() })}>Log out everywhere</button></div>
        <Err>{act.error}</Err>
        <p className="text-xs text-muted">Sensitive actions ask for your password again: viewing creator bank details, editing a closed month, exporting everything and creating or rotating API keys. Five wrong tries lock that prompt for five minutes.</p>
      </Card>
      {founder && (
        <Card className="shoji-pad">
          <SectionTitle kanji="検" aside={<button className="btn-ghost" onClick={() => rep.reload()}>Check again</button>}>Row Level Security</SectionTitle>
          {rep.loading && !rep.data ? <Loading label="Checking every table" /> : <>
            <p className={`text-sm ${bad.length ? 'text-ink underline decoration-akane decoration-2 underline-offset-4' : 'text-ink'}`} role="status">
              {bad.length ? `${bad.length} table${bad.length === 1 ? ' needs' : 's need'} attention.` : `All ${rows.length} tables have Row Level Security on, a policy, and nothing open to signed-out visitors.`}</p>
            {bad.length > 0 && <ul className="mt-3 divide-y divide-line/15">{bad.map(r => <li key={r.table_name} className="py-2 text-sm"><span className="text-ink">{r.table_name}</span> <span className="text-muted">— {r.issue}</span></li>)}</ul>}
            <button className="mt-3 text-sm text-muted hover:text-ink underline underline-offset-4" onClick={() => setAll(a => !a)} aria-expanded={all}>{all ? 'Hide' : 'Show'} every table</button>
            {all && <div className="overflow-x-auto mt-2 max-h-80"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted border-b border-line/30"><th className="py-1.5 font-normal">Table</th><th className="py-1.5 font-normal">RLS</th><th className="py-1.5 font-normal text-right">Policies</th></tr></thead>
              <tbody>{rows.map(r => <tr key={r.table_name} className="border-b border-line/15"><td className="py-1.5 text-ink">{r.table_name}</td><td className="py-1.5">{r.rls_enabled ? 'On' : 'OFF'}</td><td className="py-1.5 text-right num">{r.policies}</td></tr>)}</tbody></table></div>}
          </>}
          <p className="text-xs text-muted mt-3">The database tests also try to read every money table as a team member, a freelancer and a signed-out visitor, and must fail (<code>npm run test:db</code>).</p>
        </Card>
      )}
    </div>
  )
}

// ─── Data: backups, export, trash ───────────────────────────
interface Backup { id: string; kind: string; trigger: string; status: string; size_bytes: number | null; error?: string | null; created_at: string; storage_path: string | null }
const mb = (n: number | null) => n == null ? '' : `${(n / 1048576).toFixed(1)} MB`
const saveBlob = (b: Blob, name: string) => { const url = URL.createObjectURL(b); const a = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }

function Backups() {
  const reauth = useReauth()
  const { data, reload } = useAsync(() => db.rows<Backup>('backups', { is_archived: false }, 'created_at', false), [])
  const act = useAsyncAction()
  const rows = (data ?? []).filter(b => b.kind === 'full')
  const exportAll = () => act.run(async () => {
    if (!(await reauth('Exporting everything is sensitive.'))) return
    saveBlob(await db.download('admin', { action: 'export' }), `social-mog-export-${istToday()}.zip`); await reload()
  })
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="蔵" aside={<button className="btn-primary" disabled={act.busy} onClick={() => act.run(async () => { await db.invoke('admin', { action: 'backup_now' }); await reload() })}>{act.busy ? 'Working…' : 'Back up now'}</button>}>Backups</SectionTitle>
      <p className="text-sm text-muted mb-3">Every night at 2:00 am IST all tables are saved as CSV and JSON into a private bucket; the last 30 days are kept. Both founders get a download link by email every Sunday.</p>
      <Err>{act.error}</Err>
      {!rows.length ? <p className="text-sm text-muted">No backup yet.</p> : (
        <ul className="divide-y divide-line/15">{rows.slice(0, 31).map(b => (
          <li key={b.id} className="py-2.5 flex flex-wrap items-center gap-3 text-sm"><span className="flex-1 min-w-[12rem] text-ink num">{formatDateTime(b.created_at)}<span className="text-muted"> · {b.trigger === 'scheduled' ? 'nightly' : 'manual'} {mb(b.size_bytes)}</span></span>
            {b.status === 'succeeded' ? <button className="btn-ghost" onClick={() => act.run(async () => { const r = await db.invoke<{ url: string }>('admin', { action: 'backup_link', id: b.id }); window.open(r.url, '_blank', 'noopener') })}><Icon name="download" /> Download</button>
              : <Pill tone="alert">{b.status === 'failed' ? `Failed${b.error ? ': ' + b.error : ''}` : 'Running'}</Pill>}</li>))}</ul>
      )}
      <div className="mt-5 pt-4 border-t border-line/20 flex flex-wrap items-center gap-3"><span className="flex-1 min-w-[14rem] text-sm"><span className="block text-ink">Export everything</span><span className="block text-muted">A ZIP of every table (CSV and JSON) and the list of uploaded files. Asks for your password.</span></span>
        <button className="btn-ghost" disabled={act.busy} onClick={exportAll}><Icon name="download" /> Export everything</button></div>
    </Card>
  )
}

interface Trash { table_name: string; record_id: string; noun: string; label: string; archived_at: string; days_left: number }
function TrashCard() {
  const { data, loading, reload } = useAsync(() => db.rpc<Trash[]>('trash_list'), [])
  const [why, setWhy] = useState<Trash | null>(null), [reason, setReason] = useState('')
  const act = useAsyncAction()
  const MONEY = new Set(['invoices', 'expenses', 'creator_payouts', 'money_accounts', 'recurring_expenses'])
  const restore = (t: Trash, r?: string) => act.run(async () => { await db.rpc('trash_restore', { p_table: t.table_name, p_id: t.record_id, p_reason: r ?? null }); setWhy(null); setReason(''); await reload() })
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="戻">Trash</SectionTitle>
      <p className="text-sm text-muted mb-3">Nothing is ever deleted — archived records wait here for 30 days and can be restored.</p>
      <Err>{act.error}</Err>
      {loading && !data ? <Loading label="Opening the trash" /> : !data?.length ? <EmptyState sketch="koi" line="The trash is empty." /> : (
        <ul className="divide-y divide-line/15">{data.map(t => (
          <li key={t.table_name + t.record_id} className="py-2.5 flex flex-wrap items-center gap-3 text-sm">
            <span className="flex-1 min-w-[12rem]"><span className="block text-ink">{t.label}</span><span className="block text-xs text-muted">{t.noun} · archived {formatDateTime(t.archived_at)} · <span className={t.days_left <= 5 ? 'text-ink underline decoration-akane decoration-2 underline-offset-4' : ''}>{t.days_left} days left</span></span></span>
            {why?.record_id === t.record_id ? (
              <form className="flex gap-2 w-full sm:w-auto" onSubmit={e => { e.preventDefault(); restore(t, reason.trim()) }}>
                <label className="sr-only" htmlFor="why">Reason</label><input id="why" className="field h-9" autoFocus required minLength={3} placeholder="Why bring it back?" value={reason} onChange={e => setReason(e.target.value)} />
                <button className="btn-primary h-9" disabled={act.busy}>Restore</button><button type="button" className="btn-ghost h-9" onClick={() => setWhy(null)}>Cancel</button></form>
            ) : <button className="btn-ghost" disabled={act.busy} onClick={() => MONEY.has(t.table_name) ? setWhy(t) : restore(t)}>Restore</button>}</li>))}</ul>
      )}
    </Card>
  )
}

export function DataTab() {
  const { role } = useAuth()
  return <div className="space-y-4 sm:space-y-6 max-w-4xl">{role === 'founder' && <Backups />}<TrashCard /></div>
}

// ─── Health check ───────────────────────────────────────────
interface Check { area: string; check_name: string; expected: number; actual: number; ok: boolean; detail: string }
export function HealthPage() {
  const { data, loading, error, reload } = useAsync(() => db.rpc<Check[]>('health_check'), [])
  const bad = (data ?? []).filter(c => !c.ok)
  return (
    <div className="space-y-5 sm:space-y-6 max-w-4xl">
      <Link to="/settings" className="text-sm text-muted hover:text-ink inline-flex items-center gap-1"><Icon name="chevronLeft" /> Settings</Link>
      <h1 className="font-mincho text-3xl text-ink"><span className="text-accent-ink mr-2" aria-hidden lang="ja">診</span>Health check</h1>
      <p className="text-sm text-muted">Every total is recalculated from the records behind it and compared. A difference means a record is missing or wrong — never a number to correct by hand.</p>
      {error && <Err>{error}</Err>}
      {loading && !data ? <Loading label="Checking the numbers" /> : <>
        <Card className="shoji-pad flex items-center gap-4"><span className="font-mincho text-2xl text-ink flex-1" role="status">{bad.length ? `${bad.length} of ${data!.length} checks don’t match` : `All ${data?.length ?? 0} checks match`}</span><button className="btn-ghost" onClick={reload}>Run again</button></Card>
        <ul className="space-y-2">{(data ?? []).map(c => (
          <li key={c.check_name} className={`shoji p-4 flex flex-wrap items-center gap-3 ${c.ok ? '' : 'border-akane/70'}`}>
            <span className="flex-1 min-w-[14rem]"><span className="block text-xs text-muted">{c.area}</span><span className="block text-ink">{c.check_name}</span>{c.detail && <span className="block text-xs text-muted">{c.detail}</span>}</span>
            <span className="text-sm num text-right">{c.area === 'Money' && /balance|Receivables|Revenue|Payouts/.test(c.check_name) || c.area !== 'Money' && !/Every|number/.test(c.check_name) ? <>{formatINR(c.expected)}<span className="text-muted"> expected</span><br />{formatINR(c.actual)}<span className="text-muted"> found</span></> : <>{c.expected}<span className="text-muted"> expected</span><br />{c.actual}<span className="text-muted"> found</span></>}</span>
            <Pill tone={c.ok ? 'ink' : 'alert'}>{c.ok ? '✓ Matches' : '✗ Doesn’t match'}</Pill></li>))}</ul></>}
    </div>
  )
}
