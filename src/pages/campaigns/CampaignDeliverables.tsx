// Deliverables tracker (draft link, brand approval, live link, go-live date,
// posted) and Performance (manual numbers → engagement rate, cost per view).
import { useState, type FormEvent } from 'react'
import { campaignsApi, type CampaignSummary, type DeliverablePatch, type DeliverableRow, type MetricsInput } from '../../data/campaigns'
import { useAsync } from '../../hooks/useAsync'
import { APPROVALS, APPROVAL_LABEL, engagementRate, formatCPV, type Approval } from '../../lib/campaigns'
import { formatCount, parseCount, RATE_LABEL, type DeliverableType } from '../../lib/creators'
import { formatDate, formatINR, istToday } from '../../lib/format'
import { downloadCSV } from '../../lib/csv'
import { Card, EmptyState, Pill, SectionTitle } from '../../components/ui/kit'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { Avatar } from '../../components/ui/Avatar'
import { Andon, EnsoSpinner, Hanko } from '../../components/art/Ink'
import { FormError } from '../auth/AuthLayout'

const typeLabel = (t: string) => RATE_LABEL[t as DeliverableType] ?? t.replace(/_/g, ' ')
const isUrl = (v: string) => !v.trim() || /^https?:\/\/\S+$/i.test(v.trim())

// ─── Tracker ─────────────────────────────────────────────────
export function DeliverablesTracker({ campaignId, onChange }: { campaignId: string; onChange: () => Promise<void> }) {
  const { data, loading, reload } = useAsync(() => campaignsApi.deliverables(campaignId), [campaignId])
  const [showCancelled, setShowCancelled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stamped, setStamped] = useState<string | null>(null)
  const save = async (d: DeliverableRow, patch: DeliverablePatch) => {
    setError(null)
    try {
      await campaignsApi.updateDeliverable(d.deliverable_id, patch)
      if (patch.approval_status === 'approved') setStamped(d.deliverable_id)
      await reload(); await onChange()
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Could not save'
      setError(m.includes('live_needs_url') ? `Add the live post link for “${d.title}” before marking it posted.` : m)
    }
  }
  if (loading && !data) return <EnsoSpinner />
  const rows = (data ?? []).filter(d => showCancelled || d.stage !== 'cancelled')
  const cancelled = (data ?? []).filter(d => d.stage === 'cancelled').length
  const overdue = rows.filter(d => d.is_overdue)
  const groups = [...new Map(rows.map(d => [d.campaign_creator_id ?? 'none', d.creator_name ?? 'No creator'])).entries()]

  if (!(data ?? []).length) return <div className="shoji"><EmptyState sketch="branch" line="Nothing planned yet." action={<p className="text-xs text-muted -mt-2">Plan deliverables per creator on the Creators tab (e.g. 2 Reels + 3 Stories).</p>} /></div>
  return (
    <div className="space-y-4">
      {overdue.length > 0 && (
        <div role="alert" className="rounded-shoji bg-alert text-kinari text-sm px-3 py-2.5">
          <p className="flex items-center gap-2 font-medium"><Andon size={18} /> Past go-live, not posted</p>
          <ul className="mt-1 ml-7 list-disc">{overdue.map(d => <li key={d.deliverable_id}>{d.title} — due {formatDate(d.go_live_date)} ({d.days_overdue} day{d.days_overdue === 1 ? '' : 's'} late)</li>)}</ul>
        </div>
      )}
      {error && <FormError>{error}</FormError>}
      <div className="flex justify-between items-center gap-3 text-sm text-muted">
        <p className="num">{rows.filter(d => d.is_posted).length} of {rows.filter(d => d.stage !== 'cancelled').length} posted</p>
        {cancelled > 0 && <label className="flex items-center gap-2"><input type="checkbox" className="accent-[#E3793A]" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} /> Show cancelled ({cancelled})</label>}
      </div>
      {groups.map(([ccId, name]) => (
        <section key={ccId} className="shoji">
          <h3 className="px-5 pt-4 pb-2 flex items-center gap-2 text-ink"><Avatar name={name} path={rows.find(d => (d.campaign_creator_id ?? 'none') === ccId)?.creator_photo_path} size={28} />{name}</h3>
          <ul className="divide-y divide-line/15">
            {rows.filter(d => (d.campaign_creator_id ?? 'none') === ccId).map(d => <TrackerRow key={d.deliverable_id} d={d} onSave={p => save(d, p)} stamp={stamped === d.deliverable_id} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}

function LinkField({ label, value, onSave, placeholder }: { label: string; value: string | null; onSave: (v: string | null) => void; placeholder: string }) {
  const [v, setV] = useState(value ?? '')
  const bad = !isUrl(v)
  return (
    <span className="flex items-center gap-1.5">
      <input aria-label={label} aria-invalid={bad} className={`field h-9 text-xs ${bad ? 'border-akane ring-1 ring-akane' : ''}`} placeholder={placeholder} value={v}
        onChange={e => setV(e.target.value)} onBlur={() => { if (!bad && v.trim() !== (value ?? '')) onSave(v.trim() || null) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      {value && <a href={value} target="_blank" rel="noreferrer" className="icon-btn w-9 h-9 shrink-0" aria-label={`Open ${label.toLowerCase()}`}><Icon name="link" /></a>}
    </span>
  )
}

function TrackerRow({ d, onSave, stamp }: { d: DeliverableRow; onSave: (p: DeliverablePatch) => void; stamp: boolean }) {
  const cancelled = d.stage === 'cancelled'
  return (
    <li className={`px-5 py-4 grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_9.5rem_minmax(0,1fr)_10rem_minmax(0,1fr)_8.5rem] lg:items-center ${cancelled ? 'opacity-50' : ''}`}>
      <div className="min-w-0">
        <p className="text-sm text-ink">{d.title}</p>
        <p className="text-xs text-muted">{typeLabel(d.deliverable_type)}{d.platform ? ` · ${d.platform}` : ''}{cancelled ? ' · cancelled' : ''}</p>
        {d.is_overdue && <span className="mt-1 inline-flex"><Pill tone="alert"><Andon size={12} /> {d.days_overdue}d past go-live</Pill></span>}
      </div>
      <label className="text-xs text-muted lg:text-[0px]">Go-live
        <input type="date" className={`field h-9 text-xs num mt-1 lg:mt-0 ${d.is_overdue ? 'border-akane' : ''}`} aria-label={`Go-live date for ${d.title}`} disabled={cancelled}
          value={d.go_live_date ?? ''} onChange={e => onSave({ go_live_date: e.target.value || null })} />
      </label>
      <div className="text-xs text-muted"><span className="lg:sr-only">Draft link</span><LinkField label="Draft link" value={d.draft_url} placeholder="Draft link (Drive, Frame.io…)" onSave={v => onSave({ draft_url: v })} /></div>
      <label className="text-xs text-muted lg:text-[0px]">Brand approval
        <span className="flex items-center gap-2 mt-1 lg:mt-0">
          <select className="field h-9 text-xs" aria-label={`Brand approval for ${d.title}`} value={d.approval_status} disabled={cancelled}
            onChange={e => onSave({ approval_status: e.target.value as Approval })}>
            {APPROVALS.map(a => <option key={a} value={a}>{APPROVAL_LABEL[a]}</option>)}
          </select>
          {d.approval_status === 'approved' && <Hanko kind="approved" size={30} animate={stamp} />}
        </span>
      </label>
      <div className="text-xs text-muted"><span className="lg:sr-only">Live post link</span><LinkField label="Live post link" value={d.live_url} placeholder="Live post URL" onSave={v => onSave({ live_url: v })} /></div>
      <div className="lg:text-right">
        {d.is_posted ? <span className="inline-flex flex-col items-start lg:items-end"><Pill tone="accent">Posted</Pill>{d.went_live_at && <span className="text-[11px] text-muted mt-1 num">{formatDate(d.went_live_at)}</span>}
          <button className="text-[11px] text-muted underline underline-offset-4 mt-0.5" onClick={() => onSave({ stage: 'approved' })}>Undo</button></span>
          : !cancelled && <button className="btn-ghost h-9 text-xs" onClick={() => onSave({ stage: 'live' })} title={d.live_url ? undefined : 'Add the live post link first'}>Mark posted</button>}
      </div>
    </li>
  )
}

// ─── Performance ─────────────────────────────────────────────
const FIELDS: { key: keyof MetricsInput; label: string }[] = [
  { key: 'views', label: 'Views' }, { key: 'reach', label: 'Reach' }, { key: 'likes', label: 'Likes' }, { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' }, { key: 'saves', label: 'Saves' }, { key: 'link_clicks', label: 'Link clicks' }, { key: 'conversions', label: 'Sales / code uses' },
]

export function Performance({ campaignId, s, staff, onChange }: { campaignId: string; s: CampaignSummary; staff: boolean; onChange: () => Promise<void> }) {
  const { data, loading, reload } = useAsync(() => campaignsApi.deliverables(campaignId), [campaignId])
  const [entering, setEntering] = useState<DeliverableRow | null>(null)
  if (loading && !data) return <EnsoSpinner />
  const rows = (data ?? []).filter(d => d.stage !== 'cancelled' && (d.is_posted || d.views != null))
  const top = [...rows].filter(d => d.views).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 3)
  const exportCsv = () => downloadCSV(`${s.name.replace(/\W+/g, '-')}-performance-${istToday()}.csv`, rows, [
    { header: 'Post', value: d => d.title }, { header: 'Creator', value: d => d.creator_name }, { header: 'Type', value: d => typeLabel(d.deliverable_type) },
    { header: 'Live link', value: d => d.live_url }, { header: 'Numbers as of', value: d => d.metrics_on ? formatDate(d.metrics_on) : '' },
    ...FIELDS.map(f => ({ header: f.label, value: (d: DeliverableRow) => d[f.key as keyof DeliverableRow] as number | null })),
    { header: 'Engagement %', value: d => d.engagement_rate }, ...(staff ? [{ header: 'Cost (INR)', value: (d: DeliverableRow) => d.cost == null ? null : Math.round(d.cost) }, { header: 'Cost per view (INR)', value: (d: DeliverableRow) => d.cost_per_view }] : []),
  ])
  return (
    <div className="space-y-4 sm:space-y-6">
      <dl className="grid grid-cols-2 lg:grid-cols-5 gap-px rounded-shoji overflow-hidden border border-line/30 bg-line/20">
        {[['Views', formatCount(s.views)], ['Reach', formatCount(s.reach)], ['Engagements', formatCount(s.engagements)], ['Engagement rate', s.engagement_rate != null ? `${s.engagement_rate}%` : '—'],
          [staff ? 'Cost per view' : 'Link clicks', staff ? formatCPV(s.cost_per_view) : formatCount(s.link_clicks)]].map(([k, v]) => (
          <div key={k} className="bg-card px-5 py-4"><dt className="text-xs text-muted">{k}</dt><dd className="mt-1.5 text-xl text-ink num">{v}</dd></div>
        ))}
      </dl>
      <Card className="shoji-pad">
        <SectionTitle kanji="数" aside={rows.length > 0 && <button className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5" onClick={exportCsv}><Icon name="download" /> CSV</button>}>Per post</SectionTitle>
        <p className="text-xs text-muted -mt-2 mb-4">Numbers are typed in for now (1.2L, 48K and 1,20,000 all work); automatic fetching comes with AI tools. Engagement rate = (likes + comments + shares + saves) ÷ views.</p>
        {rows.length === 0 ? <EmptyState sketch="koi" line="Nothing posted yet." action={<p className="text-xs text-muted -mt-2">Mark posts as posted in the Deliverables tab, then enter their numbers here.</p>} /> : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-[56rem]">
              <thead><tr className="text-left text-xs text-muted border-b border-line/25">
                <th className="px-2 py-2.5 font-normal">Post</th>{['Views', 'Likes', 'Comments', 'Shares', 'Saves', 'Clicks', 'Sales'].map(h => <th key={h} className="px-2 py-2.5 font-normal text-right">{h}</th>)}
                <th className="px-2 py-2.5 font-normal text-right">ER</th>{staff && <th className="px-2 py-2.5 font-normal text-right">Cost</th>}{staff && <th className="px-2 py-2.5 font-normal text-right">CPV</th>}<th className="px-2 py-2.5" />
              </tr></thead>
              <tbody className="divide-y divide-line/15">
                {rows.map(d => (
                  <tr key={d.deliverable_id}>
                    <td className="px-2 py-2.5"><span className="text-ink">{d.title}</span><span className="block text-xs text-muted">{d.creator_name}{d.metrics_on ? ` · as of ${formatDate(d.metrics_on)}` : ' · no numbers yet'}</span></td>
                    {(['views', 'likes', 'comments', 'shares', 'saves', 'link_clicks', 'conversions'] as const).map(k => <td key={k} className="px-2 py-2.5 text-right num text-ink">{formatCount(d[k])}</td>)}
                    <td className="px-2 py-2.5 text-right num text-ink">{d.engagement_rate != null ? `${d.engagement_rate}%` : '—'}</td>
                    {staff && <td className="px-2 py-2.5 text-right num text-muted">{d.cost != null ? formatINR(Math.round(d.cost)) : '—'}</td>}
                    {staff && <td className="px-2 py-2.5 text-right num text-ink">{formatCPV(d.cost_per_view)}</td>}
                    <td className="px-2 py-2.5 text-right"><button className="btn-ghost h-8 px-3 text-xs" onClick={() => setEntering(d)}>{d.metrics_on ? 'Update' : 'Enter numbers'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {top.length > 0 && (
        <Card className="shoji-pad">
          <SectionTitle kanji="優">Top posts</SectionTitle>
          <ol className="grid sm:grid-cols-3 gap-3">
            {top.map((d, i) => (
              <li key={d.deliverable_id} className="rounded-shoji border border-line/25 p-4">
                <p className="font-mincho text-accent-ink text-lg num">#{i + 1}</p>
                <p className="text-sm text-ink mt-1">{d.title}</p><p className="text-xs text-muted">{d.creator_name}</p>
                <p className="mt-3 text-sm num"><span className="text-ink">{formatCount(d.views)}</span> <span className="text-muted">views · {d.engagement_rate ?? 0}% ER</span></p>
                {d.live_url && <a href={d.live_url} target="_blank" rel="noreferrer" className="text-xs text-muted hover:text-ink underline underline-offset-4 mt-1 inline-block">Open post</a>}
              </li>
            ))}
          </ol>
        </Card>
      )}
      {entering && <MetricsForm d={entering} onClose={() => setEntering(null)} onSaved={async () => { setEntering(null); await reload(); await onChange() }} />}
    </div>
  )
}

function MetricsForm({ d, onClose, onSaved }: { d: DeliverableRow; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>(() => ({ captured_on: istToday(), ...Object.fromEntries(FIELDS.map(x => [x.key, d[x.key as keyof DeliverableRow] != null ? String(d[x.key as keyof DeliverableRow]) : ''])) }))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const parsed = Object.fromEntries(FIELDS.map(x => [x.key, f[x.key].trim() ? parseCount(f[x.key]) : null])) as Record<string, number | null>
  const er = engagementRate(parsed)
  async function save(e: FormEvent) {
    e.preventDefault()
    const bad = FIELDS.find(x => f[x.key].trim() && parsed[x.key] == null)
    if (bad) { setError(`${bad.label}: “${f[bad.key]}” isn’t a number.`); return }
    if (parsed.reach != null && parsed.views != null && parsed.reach > parsed.views * 3) { if (!confirm('Reach is much higher than views — save anyway?')) return }
    setBusy(true); setError(null)
    try { await campaignsApi.saveMetrics(d.deliverable_id, { captured_on: f.captured_on, ...parsed } as MetricsInput); onSaved() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); setBusy(false) }
  }
  return (
    <Modal title={`Numbers — ${d.title}`} onClose={onClose}>
      <form onSubmit={save} className="grid grid-cols-2 gap-3">
        {error && <div className="col-span-2"><FormError>{error}</FormError></div>}
        <label className="col-span-2 text-sm text-muted">As of<input type="date" className="field mt-1.5 num" max={istToday()} value={f.captured_on} onChange={e => setF({ ...f, captured_on: e.target.value })} /></label>
        {FIELDS.map(x => <label key={x.key} className="text-sm text-muted">{x.label}<input className="field mt-1.5 num" inputMode="numeric" value={f[x.key]} onChange={e => setF({ ...f, [x.key]: e.target.value })} /></label>)}
        <p className="col-span-2 text-sm text-muted" aria-live="polite">Engagement rate: <span className="text-ink num">{er != null ? `${er}%` : '—'}</span>{d.cost != null && parsed.views ? <> · cost per view <span className="text-ink num">{formatCPV(d.cost / parsed.views)}</span></> : null}</p>
        <p className="col-span-2 text-xs text-muted">Saving again on the same date replaces that day’s numbers; a new date keeps the earlier ones as history.</p>
        <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save numbers'}</button></div>
      </form>
    </Modal>
  )
}
