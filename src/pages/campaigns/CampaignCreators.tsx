// Creators tab: inline status + fee editing, planned deliverables per creator,
// add creators (search or from a shortlist).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { campaignsApi, type CampaignCreator } from '../../data/campaigns'
import { creatorsApi } from '../../data/creators'
import { useAsync } from '../../hooks/useAsync'
import { CREATOR_STATUSES, CREATOR_STATUS_LABEL, deliverableSummary, isConfirmed, type CreatorStatus } from '../../lib/campaigns'
import { formatCount, parseCount, PLATFORM_LABEL, RATE_LABEL, RATE_TYPES, type DeliverableType } from '../../lib/creators'
import { formatINR } from '../../lib/format'
import { EmptyState, MoreMenu, Pill } from '../../components/ui/kit'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { Avatar } from '../../components/ui/Avatar'
import { EnsoSpinner } from '../../components/art/Ink'
import { TierPill } from '../../components/creators/CreatorBits'
import { FormError, FormNote } from '../auth/AuthLayout'

export function CampaignCreators({ campaignId, staff, onChange }: { campaignId: string; staff: boolean; onChange: () => Promise<void> }) {
  const list = useAsync(() => campaignsApi.creators(campaignId), [campaignId])
  const dels = useAsync(() => campaignsApi.deliverables(campaignId), [campaignId])
  const [adding, setAdding] = useState(false)
  const [planning, setPlanning] = useState<CampaignCreator | null>(null)
  const [showDropped, setShowDropped] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const refresh = async () => { await Promise.all([list.reload(), dels.reload()]); await onChange() }
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') } }

  const plan = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    for (const d of dels.data ?? []) if (d.campaign_creator_id && d.stage !== 'cancelled') { m[d.campaign_creator_id] ??= {}; m[d.campaign_creator_id][d.deliverable_type] = (m[d.campaign_creator_id][d.deliverable_type] ?? 0) + 1 }
    return m
  }, [dels.data])
  const rows = (list.data ?? []).filter(x => showDropped || x.status !== 'dropped')
  const dropped = (list.data ?? []).filter(x => x.status === 'dropped').length
  const confirmedTotal = (list.data ?? []).filter(x => isConfirmed(x.status)).reduce((s, x) => s + Number(x.agreed_fee ?? 0), 0)

  if (list.loading && !list.data) return <EnsoSpinner />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted num">{rows.length} creator{rows.length === 1 ? '' : 's'}{staff && <> · confirmed fees <span className="text-ink">{formatINR(confirmedTotal)}</span> (actual creator spend)</>}</p>
        <div className="flex items-center gap-2">
          {dropped > 0 && <label className="text-sm text-muted flex items-center gap-2"><input type="checkbox" className="accent-[#E3793A]" checked={showDropped} onChange={e => setShowDropped(e.target.checked)} /> Show dropped ({dropped})</label>}
          {staff && <button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> Add creators</button>}
        </div>
      </div>
      {error && <FormError>{error}</FormError>}
      {note && <FormNote>{note}</FormNote>}
      {rows.length === 0 ? <div className="shoji"><EmptyState sketch="koi" line="No creators on this campaign yet." action={staff && <button className="btn-primary" onClick={() => setAdding(true)}>Add creators</button>} /></div> : (
        <div className="shoji overflow-x-auto">
          <table className="w-full text-sm min-w-[52rem]">
            <thead><tr className="text-left text-xs text-muted border-b border-line/25">
              <th className="px-5 py-3 font-normal">Creator</th><th className="px-3 py-3 font-normal">Status</th>
              <th className="px-3 py-3 font-normal">Deliverables</th>{staff && <th className="px-3 py-3 font-normal text-right">Agreed fee</th>}
              <th className="pr-4 py-3 w-10"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-line/15">
              {rows.map(x => {
                const p = plan[x.id] ?? {}
                const rateCard = Object.entries(p).reduce((s, [t, n]) => s + Number((x.creator as unknown as Record<string, number | null>)?.[`rate_${t}`] ?? 0) * n, 0)
                return (
                  <tr key={x.id} className={x.status === 'dropped' ? 'opacity-60' : ''}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={x.creator?.name ?? '?'} path={x.creator?.photo_path} size={36} />
                        <div className="min-w-0">
                          {staff ? <Link to={`/creators/${x.creator_id}`} className="text-ink hover:underline underline-offset-4">{x.creator?.name}</Link> : <span className="text-ink">{x.creator?.name}</span>}
                          <p className="text-xs text-muted flex items-center gap-2 mt-0.5"><TierPill tier={x.creator?.tier ?? null} />
                            {x.creator?.top_platform && <span className="num">{PLATFORM_LABEL[x.creator.top_platform]} {formatCount(x.creator.max_followers)}</span>}</p>
                          {x.notes && <p className="text-xs text-muted mt-1">{x.notes}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {staff ? <>
                        <label className="sr-only" htmlFor={`st-${x.id}`}>Status for {x.creator?.name}</label>
                        <select id={`st-${x.id}`} className="field h-9 w-44" value={x.status} onChange={e => run(() => campaignsApi.setCreatorStatus(x.id, e.target.value as CreatorStatus))}>
                          {CREATOR_STATUSES.map(st => <option key={st} value={st}>{CREATOR_STATUS_LABEL[st]}</option>)}
                        </select>
                      </> : <Pill>{CREATOR_STATUS_LABEL[x.status]}</Pill>}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-ink">{deliverableSummary(p)}</span>
                      {staff && <button className="block text-xs text-muted hover:text-ink underline underline-offset-4 mt-0.5" onClick={() => setPlanning(x)}>Change</button>}
                    </td>
                    {staff && (
                      <td className="px-3 py-3 text-right">
                        <FeeInput value={x.agreed_fee} label={`Agreed fee for ${x.creator?.name}`} onSave={v => run(() => campaignsApi.setFee(x.id, v))} />
                        {rateCard > 0 && <span className="block text-[11px] text-muted mt-1 num">rate card {formatINR(rateCard)}</span>}
                        {!isConfirmed(x.status) && x.agreed_fee != null && x.status !== 'dropped' && <span className="block text-[11px] text-muted">not yet counted</span>}
                      </td>
                    )}
                    <td className="pr-4 py-3">
                      {staff && <MoreMenu label={`Actions for ${x.creator?.name}`} items={[
                        { label: 'Plan deliverables', onSelect: () => setPlanning(x) },
                        x.status === 'dropped' ? { label: 'Bring back (shortlisted)', onSelect: () => run(() => campaignsApi.setCreatorStatus(x.id, 'shortlisted')) }
                          : { label: 'Drop from campaign', danger: true, onSelect: () => run(() => campaignsApi.setCreatorStatus(x.id, 'dropped')) },
                      ]} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {staff && <p className="text-xs text-muted">Actual creator spend counts fees of creators who are Confirmed or further along (Content submitted, Approved, Posted, Paid).</p>}
      {adding && <AddCreators campaignId={campaignId} existing={(list.data ?? []).map(x => x.creator_id)} onClose={() => setAdding(false)}
        onDone={async msg => { setAdding(false); setNote(msg); await refresh() }} />}
      {planning && <PlanDeliverables cc={planning} current={plan[planning.id] ?? {}} onClose={() => setPlanning(null)}
        onDone={async () => { setPlanning(null); await refresh() }} />}
    </div>
  )
}

function FeeInput({ value, label, onSave }: { value: number | null; label: string; onSave: (v: number | null) => void }) {
  const fmt = (v: number | null) => v == null ? '' : new Intl.NumberFormat('en-IN').format(v)
  const [v, setV] = useState(fmt(value))
  const [bad, setBad] = useState(false)
  const commit = () => {
    const n = v.trim() ? parseCount(v) : null
    if (v.trim() && n == null) { setBad(true); return }
    setBad(false); if (n !== value) onSave(n); setV(fmt(n))
  }
  return (
    <span className="relative inline-block">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted text-xs" aria-hidden>₹</span>
      <input aria-label={label} aria-invalid={bad} className={`field h-9 w-32 pl-6 text-right num ${bad ? 'border-akane ring-1 ring-akane' : ''}`} inputMode="numeric" placeholder="—"
        value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </span>
  )
}

function PlanDeliverables({ cc, current, onClose, onDone }: { cc: CampaignCreator; current: Record<string, number>; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState<Record<string, number>>(() => Object.fromEntries(RATE_TYPES.map(t => [t, current[t] ?? 0])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rate = (t: DeliverableType) => (cc.creator as unknown as Record<string, number | null>)?.[`rate_${t}`] ?? null
  const total = RATE_TYPES.reduce((s, t) => s + (rate(t) ?? 0) * q[t], 0)
  async function save() {
    setBusy(true); setError(null)
    try { for (const t of RATE_TYPES) if ((current[t] ?? 0) !== q[t]) await campaignsApi.setQuantity(cc.id, t, q[t]); onDone() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); setBusy(false) }
  }
  return (
    <Modal title={`Deliverables — ${cc.creator?.name}`} onClose={onClose}>
      <div className="space-y-4">
        {error && <FormError>{error}</FormError>}
        <p className="text-sm text-muted">Each one becomes a row in the Deliverables tracker. Lowering a number cancels the newest unposted ones; posted ones are never removed.</p>
        <ul className="divide-y divide-line/15">
          {RATE_TYPES.map(t => (
            <li key={t} className="py-2.5 flex items-center gap-3">
              <span className="flex-1 text-sm text-ink">{RATE_LABEL[t]}{rate(t) != null && <span className="block text-xs text-muted num">rate card {formatINR(rate(t))}</span>}</span>
              <button type="button" className="icon-btn w-9 h-9" aria-label={`One fewer ${RATE_LABEL[t]}`} onClick={() => setQ({ ...q, [t]: Math.max(0, q[t] - 1) })}>−</button>
              <output className="w-8 text-center num text-ink" aria-live="polite" aria-label={`${RATE_LABEL[t]} quantity`}>{q[t]}</output>
              <button type="button" className="icon-btn w-9 h-9" aria-label={`One more ${RATE_LABEL[t]}`} onClick={() => setQ({ ...q, [t]: Math.min(50, q[t] + 1) })}><Icon name="plus" /></button>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink">{deliverableSummary(q)}{total > 0 && <span className="text-muted num"> · rate card {formatINR(total)}</span>}</p>
        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </div>
    </Modal>
  )
}

function AddCreators({ campaignId, existing, onClose, onDone }: { campaignId: string; existing: string[]; onClose: () => void; onDone: (msg: string) => void }) {
  const people = useAsync(() => creatorsApi.list(false), [])
  const lists = useAsync(() => creatorsApi.shortlists(), [])
  const [tab, setTab] = useState<'search' | 'shortlist'>('search')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shown = (people.data ?? []).filter(c => !existing.includes(c.id))
    .filter(c => !q.trim() || [c.name, c.city, ...c.niches, ...(c.handles ?? [])].some(x => x?.toLowerCase().includes(q.trim().toLowerCase().replace(/^@/, '')))).slice(0, 60)
  async function addPicked() {
    setBusy(true); setError(null)
    try { await campaignsApi.addCreators(campaignId, [...picked]); onDone(`Added ${picked.size} creator${picked.size === 1 ? '' : 's'} as Shortlisted.`) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); setBusy(false) }
  }
  return (
    <Modal title="Add creators" onClose={onClose} wide>
      <div role="tablist" aria-label="Add from" className="inline-flex rounded-shoji border border-line/30 p-0.5 mb-4">
        {(['search', 'shortlist'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
          className={`px-3 h-9 rounded-[5px] text-sm ${tab === t ? 'bg-card text-ink' : 'text-muted'}`}>{t === 'search' ? 'Search creators' : 'From a shortlist'}</button>)}
      </div>
      {error && <div className="mb-3"><FormError>{error}</FormError></div>}
      {tab === 'search' ? (
        <div className="space-y-3">
          <label className="relative block"><span className="sr-only">Search creators</span><Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="field pl-9" autoFocus placeholder="Name, @handle, city or niche" value={q} onChange={e => setQ(e.target.value)} /></label>
          {people.loading ? <EnsoSpinner /> : (
            <ul className="max-h-[45vh] overflow-y-auto divide-y divide-line/15 border border-line/20 rounded-shoji">
              {shown.map(c => (
                <li key={c.id}><label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-card">
                  <input type="checkbox" className="accent-[#E3793A]" checked={picked.has(c.id)} onChange={() => setPicked(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} />
                  <Avatar name={c.name} path={c.photo_path} size={30} />
                  <span className="flex-1 min-w-0"><span className="block text-sm text-ink truncate">{c.name}{c.is_blacklisted ? ' · blacklisted' : ''}</span><span className="block text-xs text-muted truncate">{[c.city, c.niches.join(', ')].filter(Boolean).join(' · ')}</span></span>
                  <TierPill tier={c.tier} /><span className="text-xs text-muted num w-20 text-right">{c.rate_reel != null ? `${formatINR(c.rate_reel)} reel` : ''}</span>
                </label></li>
              ))}
              {shown.length === 0 && <li className="p-4 text-sm text-muted">Nobody matches (creators already on the campaign are hidden).</li>}
            </ul>
          )}
          <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy || picked.size === 0} onClick={addPicked}>{busy ? 'Adding…' : `Add ${picked.size || ''} as Shortlisted`}</button></div>
        </div>
      ) : (
        <div className="space-y-3">
          {lists.loading ? <EnsoSpinner /> : !(lists.data ?? []).length ? <p className="text-sm text-muted">No shortlists yet — make one from the Creators list.</p> : (
            <ul className="divide-y divide-line/15 border border-line/20 rounded-shoji">
              {lists.data!.map(l => (
                <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="flex-1 text-sm text-ink">{l.name}<span className="block text-xs text-muted num">{l.count} creators{l.campaign_id ? ' · linked to a campaign' : ''}</span></span>
                  <button className="btn-ghost h-9" disabled={busy} onClick={async () => {
                    setBusy(true); setError(null)
                    try { const n = await campaignsApi.addShortlist(l.id, campaignId); onDone(`Linked “${l.name}” and added ${n} new creator${n === 1 ? '' : 's'} as Shortlisted.`) }
                    catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); setBusy(false) }
                  }}>Add all</button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">Rejected shortlist entries and creators already on the campaign are skipped.</p>
        </div>
      )}
    </Modal>
  )
}
