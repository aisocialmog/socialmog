import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { campaignsApi } from '../../data/campaigns'
import { brandsApi } from '../../data/brands'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { CAMPAIGN_KINDS, CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABEL, KIND_LABEL, OBJECTIVES, OBJECTIVE_LABEL, type CampaignKind, type CampaignStatus, type Objective } from '../../lib/campaigns'
import { parseCount, PLATFORMS, PLATFORM_LABEL } from '../../lib/creators'
import { formatINR } from '../../lib/format'
import { Icon } from '../../components/ui/Icon'
import { EnsoSpinner } from '../../components/art/Ink'
import { ChipSelect } from '../../components/creators/CreatorBits'
import { FormError } from '../auth/AuthLayout'

export function CampaignForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const editing = Boolean(id)
  const nav = useNavigate()
  const { member } = useAuth()
  const brands = useAsync(() => brandsApi.list(false), [])
  const owners = useAsync(() => brandsApi.owners(), [])
  const existing = useAsync(() => id ? campaignsApi.record(id) : Promise.resolve(null), [id])
  const [f, setF] = useState({
    name: '', brand_id: params.get('brand') ?? '', kind: 'influencer' as CampaignKind, objective: '' as Objective | '', platforms: ['instagram'],
    start_date: '', end_date: '', owner_id: member?.id ?? '', status: 'planning' as CampaignStatus, code: '',
    contract_value: '', creator_budget: '', production_budget: '', po_number: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const e = existing.data
    if (!e) return
    const c = e.campaign, fin = e.finances
    setF({ name: c.name, brand_id: c.brand_id, kind: c.kind, objective: c.objective ?? '', platforms: c.platforms, start_date: c.start_date ?? '', end_date: c.end_date ?? '',
      owner_id: c.owner_id ?? '', status: c.status, code: c.code ?? '', contract_value: fin?.contract_value?.toString() ?? '', creator_budget: fin?.creator_budget?.toString() ?? '',
      production_budget: fin?.production_budget?.toString() ?? '', po_number: fin?.po_number ?? '' })
  }, [existing.data])

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const n = (v: string) => v.trim() ? parseCount(v) : null
  const budget = n(f.contract_value), creators = n(f.creator_budget), production = n(f.production_budget)
  const margin = budget != null ? budget - (creators ?? 0) - (production ?? 0) : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.name.trim()) { setError('Name the campaign.'); return }
    if (!f.brand_id) { setError('Pick the brand.'); return }
    if (f.start_date && f.end_date && f.end_date < f.start_date) { setError('The end date is before the start date.'); return }
    for (const [k, l] of [['contract_value', 'Client budget'], ['creator_budget', 'Planned creator spend'], ['production_budget', 'Planned production spend']] as const)
      if (f[k].trim() && parseCount(f[k]) == null) { setError(`${l} should be an amount like 3,00,000 or 3L.`); return }
    setBusy(true); setError(null)
    try {
      const cid = await campaignsApi.save({
        name: f.name.trim(), brand_id: f.brand_id, kind: f.kind, objective: f.objective || null, platforms: f.platforms,
        start_date: f.start_date || null, end_date: f.end_date || null, owner_id: f.owner_id || null, status: f.status, code: f.code.trim().toUpperCase() || null,
      }, { contract_value: budget, creator_budget: creators, production_budget: production, po_number: f.po_number.trim() || null }, id)
      nav(`/campaigns/${cid}`, { replace: true })
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Could not save'
      setError(m.includes('campaigns_code_key') ? 'That campaign code is already used.' : m); setBusy(false)
    }
  }
  if (editing && existing.loading) return <div className="py-16 grid place-items-center"><EnsoSpinner size={44} /></div>

  return (
    <form onSubmit={submit} noValidate className="space-y-6 max-w-3xl">
      <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5">
        <Link to="/campaigns" className="hover:text-ink">Campaigns</Link><Icon name="chevronRight" className="text-xs" />
        {editing ? <><Link to={`/campaigns/${id}`} className="hover:text-ink">{existing.data?.campaign.name}</Link><Icon name="chevronRight" className="text-xs" /><span className="text-ink">Edit</span></> : <span className="text-ink">New campaign</span>}
      </nav>
      <h1 className="font-mincho text-3xl text-ink">{editing ? 'Edit campaign' : 'New campaign'}</h1>
      {error && <FormError>{error}</FormError>}

      <Section title="Campaign" kanji="陣">
        <label className="text-sm text-muted sm:col-span-2">Name *<input className="field mt-1.5" value={f.name} onChange={set('name')} autoFocus={!editing} placeholder="e.g. Diwali Chai Reels" /></label>
        <label className="text-sm text-muted">Brand *
          <select className="field mt-1.5" value={f.brand_id} onChange={set('brand_id')}><option value="">Choose…</option>{brands.data?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </label>
        <label className="text-sm text-muted">Short code (optional)<input className="field mt-1.5 uppercase" value={f.code} onChange={set('code')} placeholder="CHAI-DIWALI-26" /></label>
        <label className="text-sm text-muted">Type<select className="field mt-1.5" value={f.kind} onChange={set('kind')}>{CAMPAIGN_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
        <label className="text-sm text-muted">Objective<select className="field mt-1.5" value={f.objective} onChange={set('objective')}><option value="">—</option>{OBJECTIVES.map(o => <option key={o} value={o}>{OBJECTIVE_LABEL[o]}</option>)}</select></label>
        <div className="sm:col-span-2"><p className="text-sm text-muted mb-2">Platforms</p>
          <ChipSelect label="Platforms" options={PLATFORMS} value={f.platforms} onChange={platforms => setF({ ...f, platforms })} getLabel={p => PLATFORM_LABEL[p]} /></div>
        <label className="text-sm text-muted">Start date<input className="field mt-1.5 num" type="date" value={f.start_date} onChange={set('start_date')} /></label>
        <label className="text-sm text-muted">End date<input className="field mt-1.5 num" type="date" min={f.start_date} value={f.end_date} onChange={set('end_date')} /></label>
        <label className="text-sm text-muted">Owner<select className="field mt-1.5" value={f.owner_id} onChange={set('owner_id')}><option value="">—</option>{owners.data?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="text-sm text-muted">Status<select className="field mt-1.5" value={f.status} onChange={set('status')}>{CAMPAIGN_STATUSES.map(s => <option key={s} value={s}>{CAMPAIGN_STATUS_LABEL[s]}</option>)}</select></label>
      </Section>

      <Section title="Budget" kanji="金">
        <label className="text-sm text-muted">Client budget (what the brand pays us, before GST)<input className="field mt-1.5 num" inputMode="numeric" value={f.contract_value} onChange={set('contract_value')} placeholder="3,00,000" /></label>
        <label className="text-sm text-muted">PO number<input className="field mt-1.5" value={f.po_number} onChange={set('po_number')} /></label>
        <label className="text-sm text-muted">Planned creator spend<input className="field mt-1.5 num" inputMode="numeric" value={f.creator_budget} onChange={set('creator_budget')} /></label>
        <label className="text-sm text-muted">Planned production spend<input className="field mt-1.5 num" inputMode="numeric" value={f.production_budget} onChange={set('production_budget')} /></label>
        <div className="sm:col-span-2 rounded-shoji bg-bg/60 px-4 py-3 flex items-baseline justify-between gap-3" aria-live="polite">
          <span className="text-sm text-muted">Expected margin <span className="text-xs">(client budget − planned spends)</span></span>
          <span className={`font-mincho text-2xl num ${margin != null && margin < 0 ? 'text-ink underline decoration-akane decoration-2' : 'text-accent-ink'}`}>{margin != null ? formatINR(margin) : '—'}
            {margin != null && budget ? <span className="text-sm text-muted ml-2">{Math.round(margin / budget * 100)}%</span> : null}</span>
        </div>
      </Section>
      <p className="text-sm text-muted">The brief, creators and deliverables are added on the campaign page after saving.</p>

      <div className="sticky bottom-20 lg:bottom-4 z-10 flex justify-end gap-2 bg-bg/90 backdrop-blur rounded-shoji p-2 -mx-2">
        <button type="button" className="btn-ghost" onClick={() => nav(editing ? `/campaigns/${id}` : '/campaigns')}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create campaign'}</button>
      </div>
    </form>
  )
}

function Section({ title, kanji, children }: { title: string; kanji: string; children: ReactNode }) {
  return (
    <fieldset className="shoji shoji-pad"><legend className="sr-only">{title}</legend>
      <h2 className="font-mincho text-lg text-ink flex items-baseline gap-2 mb-4" aria-hidden><span className="text-accent-ink text-base" lang="ja">{kanji}</span>{title}</h2>
      <div className="grid sm:grid-cols-2 gap-4">{children}</div>
    </fieldset>
  )
}
