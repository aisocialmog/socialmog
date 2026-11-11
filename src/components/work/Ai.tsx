// AI drafts. Every result lands in an editable box with Accept / Regenerate /
// Discard — nothing is saved until a person presses Accept.
import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { EnsoSpinner } from '../art/Ink'
import { useAuth } from '../../lib/auth'
import { db } from '../../data/db'
import { productionApi } from '../../data/production'
import { formatDate } from '../../lib/format'

export interface AiResult { output: string; provider: string; cached: boolean; rows?: Record<string, unknown>[]; query?: unknown; numbers?: unknown }
export const aiGenerate = (task: string, input: Record<string, unknown>, regenerate = false) => db.invoke<AiResult>('ai_generate', { task, input, regenerate })
const errText = (e: unknown) => e instanceof Error ? e.message : String(e)

/** Runs a task, shows the draft for editing. `onAccept` gets the (edited) text. */
export function AiDraft({ task, input, acceptLabel = 'Accept', onAccept, onDiscard, rows = 12, auto = true }: {
  task: string; input: Record<string, unknown>; acceptLabel?: string; onAccept: (text: string) => Promise<unknown> | void; onDiscard: () => void; rows?: number; auto?: boolean
}) {
  const [text, setText] = useState(''), [meta, setMeta] = useState<AiResult | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false)
  const run = async (regenerate: boolean) => {
    setBusy(true); setError(null)
    try { const r = await aiGenerate(task, input, regenerate); setText(r.output); setMeta(r) } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (auto) run(false) }, [])
  const accept = async () => { setBusy(true); setError(null); try { await onAccept(text); setSaved(true) } catch (e) { setError(errText(e)) } finally { setBusy(false) } }
  return (
    <div className="space-y-3">
      {busy && !text ? <div className="py-8 grid place-items-center"><EnsoSpinner size={36} label="Drafting" /></div> : <>
        <label className="sr-only" htmlFor={`ai-${task}`}>Draft — edit before accepting</label>
        <textarea id={`ai-${task}`} className="field h-auto py-3 leading-relaxed" rows={rows} value={text} onChange={e => { setText(e.target.value); setSaved(false) }} placeholder={auto ? '' : 'Press Generate for a draft.'} />
      </>}
      {error && <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {text ? <>
          <button className="btn-primary" disabled={busy || saved || !text.trim()} onClick={accept}>{saved ? 'Saved ✓' : acceptLabel}</button>
          <button className="btn-ghost" disabled={busy} onClick={() => run(true)}>Regenerate</button>
          <button className="btn-ghost" disabled={busy} onClick={onDiscard}>Discard</button>
        </> : !busy && <button className="btn-primary" onClick={() => run(false)}>Generate</button>}
        {meta && <span className="text-xs text-muted ml-auto">Draft by {meta.provider}{meta.cached && ' · from cache'} · nothing is saved until you accept</span>}
      </div>
    </div>
  )
}

export function AiButton({ label, title, children }: { label: string; title: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return <>
    <button className="btn-ghost" onClick={() => setOpen(true)}><span className="font-mincho text-accent-ink" lang="ja" aria-hidden>智</span> {label}</button>
    {open && <Modal title={title} onClose={() => setOpen(false)} wide>{children(() => setOpen(false))}</Modal>}
  </>
}

type Row = Record<string, unknown>
const first = async (view: string, key: string, id: string): Promise<Row> => (await db.rows<Row>(view, { [key]: id }).catch(() => []))[0] ?? {}
const pick = (r: Row, keys: string[]) => Object.fromEntries(keys.filter(k => r[k] != null && r[k] !== '').map(k => [k, r[k]]))
const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => null)
const paragraphs = (t: string) => t.split(/\n{2,}/).map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('')

/** A follow-up message: accepted drafts are kept in the approval list and copied — never sent from here. */
function FollowUp({ kind, input, toName, link, close }: { kind: 'payment_reminder' | 'creator_outreach' | 'client_update'; input: Row; toName: string; link: Row; close: () => void }) {
  const [channel, setChannel] = useState(kind === 'creator_outreach' ? 'dm' : 'email')
  return <div className="space-y-3">
    {kind !== 'creator_outreach' && <label className="text-sm text-ink flex items-center gap-2">Send by
      <select className="field w-auto" value={channel} onChange={e => setChannel(e.target.value)}><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select></label>}
    <AiDraft key={channel} task={kind} input={{ ...input, channel }} acceptLabel="Accept & copy" onDiscard={close}
      onAccept={async text => { await db.insert('message_drafts', { kind, to_name: toName || 'Recipient', channel, body: text, status: 'approved', ...link }); await copy(text) }} />
    <p className="text-xs text-muted">Accepting saves the message under Settings → Automations and copies it. You send it yourself — the system never messages clients or creators.</p>
  </div>
}

/** AI buttons inside a record. Reads what it needs from the record's own view. */
export function AiRecordTools({ kind, id, onSaved }: { kind: 'invoice' | 'production' | 'campaign' | 'creator' | 'brand'; id: string; onSaved?: () => void }) {
  const { role } = useAuth()
  const [sp] = useSearchParams()
  const staff = role === 'founder' || role === 'manager'
  const [r, setR] = useState<Row | null>(null)
  const [brand, setBrand] = useState<Row>({})
  useEffect(() => {
    let live = true
    const [view, key] = ({ invoice: ['invoice_totals', 'invoice_id'], production: ['production_items', 'id'], campaign: ['campaign_summary', 'campaign_id'], creator: ['creator_overview', 'id'], brand: ['brand_overview', 'id'] } as const)[kind]
    first(view, key, id).then(async row => { if (!live) return; setR(row); if (kind === 'production' && row.campaign_id) setBrand(await first('campaigns', 'id', String(row.campaign_id))) })
    return () => { live = false }
  }, [kind, id])
  if (!r || role === 'freelancer' || !role) return null
  if (kind === 'invoice') return !staff ? null : (
    <AiButton label="Payment reminder" title="Draft a payment reminder">{close => <FollowUp kind="payment_reminder" close={close} toName={String(r.brand_name ?? '')} link={{ invoice_id: id, brand_id: r.brand_id ?? null }}
      input={{ ...pick(r, ['invoice_number', 'brand_name', 'total', 'outstanding', 'days_overdue']), due_date: r.due_date ? formatDate(String(r.due_date)) : null }} />}</AiButton>)
  if (kind === 'creator') return !staff ? null : (
    <AiButton label="Outreach DM" title="Draft an outreach message">{close => <FollowUp kind="creator_outreach" close={close} toName={String(r.name ?? '')} link={{ creator_id: id }}
      input={{ creator: pick(r, ['name', 'city', 'niches', 'tier', 'top_platform']), campaign: sp.get('campaign') ?? 'an upcoming campaign' }} />}</AiButton>)
  if (kind === 'brand') return !staff ? null : (
    <AiButton label="Client update" title="Draft a client update">{close => <FollowUp kind="client_update" close={close} toName={String(r.name ?? '')} link={{ brand_id: id }}
      input={{ brand: pick(r, ['name', 'industry', 'active_campaigns', 'open_deliverables', 'outstanding']) }} />}</AiButton>)
  if (kind === 'campaign') return !staff ? null : (
    <AiButton label="Report summary" title="Summary for the client report">{close => <AiDraft task="report_summary" rows={7} onDiscard={close} acceptLabel="Accept — use in the report"
      input={pick(r, ['name', 'brand_name', 'objective', 'start_date', 'end_date', 'deliverables_total', 'posted', 'total_views', 'total_reach', 'total_engagements', 'engagement_rate', 'cost_per_view'])}
      onAccept={async text => { await db.update('campaigns', id, { report_summary: text }); onSaved?.() }} />}</AiButton>)
  // production item: script + caption
  const base = { item: pick(r, ['title', 'format', 'platform', 'brief', 'brand_name', 'campaign_name']), brand_dos: brand.dos ?? null, brand_donts: brand.donts ?? null, key_messages: brand.key_messages ?? null, hashtags: brand.hashtags ?? null }
  return <>
    <AiButton label="Script" title="Hooks and script">{close => <ScriptTool base={base} id={id} close={close} onSaved={onSaved} />}</AiButton>
    <AiButton label="Caption" title="Caption and hashtags">{close => <AiDraft task="caption" input={base} rows={10} onDiscard={close} acceptLabel="Accept — save as a note"
      onAccept={async text => { await db.insert('comments', { deliverable_id: id, body: `Caption (AI draft, accepted):\n${text}` }); await copy(text) }} />}</AiButton>
  </>
}

function ScriptTool({ base, id, close, onSaved }: { base: Row; id: string; close: () => void; onSaved?: () => void }) {
  const [language, setLanguage] = useState('Hinglish')
  return <div className="space-y-3">
    <label className="text-sm text-ink flex items-center gap-2">Language
      <select className="field w-auto" value={language} onChange={e => setLanguage(e.target.value)}>{['Hinglish', 'Hindi', 'English'].map(l => <option key={l}>{l}</option>)}</select></label>
    <AiDraft key={language} task="script" input={{ ...base, language }} rows={16} onDiscard={close} acceptLabel="Accept — save as a new script version"
      onAccept={async text => { const cur = (await productionApi.scripts(id)).sort((a, b) => b.version - a.version)[0]; await productionApi.saveScript(id, paragraphs(text), true, cur); onSaved?.() }} />
  </div>
}

/** The accepted summary, shown in the campaign's PDF report. */
export function ReportSummary({ campaignId, className = '' }: { campaignId: string; className?: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => { first('campaigns', 'id', campaignId).then(c => setText((c.report_summary as string) ?? null)) }, [campaignId])
  return text ? <p className={className}>{text}</p> : null
}

/** "Inactive?" — set by the automation when a brand has had no work or invoice for 60 days. */
export function InactiveFlag({ brandId }: { brandId: string }) {
  const [since, setSince] = useState<string | null>(null)
  useEffect(() => { first('brands', 'id', brandId).then(b => setSince((b.maybe_inactive_since as string) ?? null)) }, [brandId])
  return since ? <span className="pill bg-yamabuki text-sumi" title={`No campaign, production or invoice since before ${formatDate(since)}`}>Inactive?</span> : null
}
