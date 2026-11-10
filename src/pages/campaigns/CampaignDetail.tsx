import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { campaignsApi, type CampaignRecord, type CampaignSummary } from '../../data/campaigns'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { isStaff } from '../../lib/access'
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE, CREATOR_STATUSES, CREATOR_STATUS_LABEL, formatCPV, KIND_LABEL, OBJECTIVE_LABEL } from '../../lib/campaigns'
import { formatCount, PLATFORM_LABEL } from '../../lib/creators'
import { describeActivity, type ActivityKind } from '../../lib/activity'
import { formatDate, formatDateTime, formatINR, istToday } from '../../lib/format'
import { downloadCSV } from '../../lib/csv'
import { Card, EmptyState, MoreMenu, Pill, SectionTitle } from '../../components/ui/kit'
import { Icon } from '../../components/ui/Icon'
import { Andon, BrushDivider, EnsoRing, EnsoSpinner, Hanko } from '../../components/art/Ink'
import { BrandLogo } from '../../components/brands/BrandBits'
import { RecordFiles } from '../../components/files/RecordFiles'
import { CampaignCreators } from './CampaignCreators'
import { DeliverablesTracker, Performance } from './CampaignDeliverables'
import { FormError } from '../auth/AuthLayout'

const TABS = [
  { key: 'overview', label: 'Overview' }, { key: 'brief', label: 'Brief' }, { key: 'creators', label: 'Creators' },
  { key: 'deliverables', label: 'Deliverables' }, { key: 'performance', label: 'Performance' },
  { key: 'money', label: 'Money', staffOnly: true }, { key: 'files', label: 'Files' }, { key: 'activity', label: 'Activity' },
] as const
type TabKey = (typeof TABS)[number]['key']
const FILE_KINDS = [{ value: 'brief', label: 'Brief / deck' }, { value: 'contract', label: 'Contract' }, { value: 'media_kit', label: 'Creator media kit' },
  { value: 'edit', label: 'Final edit' }, { value: 'screenshot', label: 'Screenshot / proof' }, { value: 'other', label: 'Other' }]

export function CampaignDetail() {
  const { id = '' } = useParams()
  const { role } = useAuth()
  const staff = isStaff(role)
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const tabs = TABS.filter(t => !('staffOnly' in t) || staff)
  const tab = (tabs.find(t => t.key === params.get('tab'))?.key ?? 'overview') as TabKey
  const setTab = (t: TabKey) => { params.set('tab', t); setParams(params, { replace: true }) }
  const sum = useAsync(() => campaignsApi.summary(id), [id])
  const rec = useAsync(() => campaignsApi.record(id), [id])
  const [error, setError] = useState<string | null>(null)
  const refresh = async () => { await Promise.all([sum.reload(), rec.reload()]) }

  const s = sum.data, c = rec.data?.campaign
  if ((sum.loading || rec.loading) && !s) return <div className="py-16 grid place-items-center"><EnsoSpinner size={44} label="Loading campaign" /></div>
  if (!s || !c) return <div className="shoji"><EmptyState sketch="koi" line="This campaign isn’t here — archived, or not one of yours." action={<Link to="/campaigns" className="btn-ghost">All campaigns</Link>} /></div>
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') } }

  return (
    <div className="space-y-6 sm:space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5 flex-wrap">
        <Link to="/campaigns" className="hover:text-ink">Campaigns</Link><Icon name="chevronRight" className="text-xs" />
        {staff ? <Link to={`/brands/${s.brand_id}`} className="hover:text-ink">{s.brand_name}</Link> : <span>{s.brand_name}</span>}<Icon name="chevronRight" className="text-xs" />
        <span className="text-ink truncate">{s.name}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <BrandLogo name={s.brand_name} path={s.brand_logo_path} size={56} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="font-mincho text-3xl text-ink break-words">{s.name}</h1>
              {s.status === 'completed' ? <Hanko kind="completed" size={44} animate={false} /> : <Pill tone={CAMPAIGN_STATUS_TONE[s.status]}>{CAMPAIGN_STATUS_LABEL[s.status]}</Pill>}
              {s.is_archived && <Pill tone="ink">Archived</Pill>}
              {s.is_historical && <Pill tone="quiet">History</Pill>}
            </div>
            <p className="text-sm text-muted mt-1">{[s.brand_name, KIND_LABEL[s.kind], s.objective && OBJECTIVE_LABEL[s.objective], s.start_date && `${formatDate(s.start_date)}${s.end_date ? ` – ${formatDate(s.end_date)}` : ''}`].filter(Boolean).join(' · ')}</p>
            {s.is_historical && <p className="text-sm text-muted mt-1">Imported history from before go-live — its money figures are for the record and aren't in any money report.</p>}
            {s.owner_name && <p className="text-sm text-muted mt-0.5">Owner: <span className="text-ink">{s.owner_name}</span></p>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link to={`/campaigns/${s.campaign_id}/report`} className="btn-primary"><Icon name="download" /> Report</Link>
          {staff && <MoreMenu items={[
            { label: 'Edit campaign & budget', onSelect: () => nav(`/campaigns/${s.campaign_id}/edit`) },
            ...CAMPAIGN_STATUSES.filter(x => x !== s.status).map(x => ({ label: `Move to ${CAMPAIGN_STATUS_LABEL[x]}`, onSelect: () => act(() => campaignsApi.setStatus(s.campaign_id, x)) })),
            s.is_archived ? { label: 'Restore campaign', onSelect: () => act(() => campaignsApi.setArchived(s.campaign_id, false)) }
              : { label: 'Archive campaign', danger: true, onSelect: () => { if (confirm(`Archive ${s.name}? Nothing is deleted.`)) act(() => campaignsApi.setArchived(s.campaign_id, true)) } },
          ]} />}
        </div>
      </header>

      {error && <FormError>{error}</FormError>}
      {s.overdue > 0 && (
        <button onClick={() => setTab('deliverables')} className="w-full text-left flex items-center gap-2 rounded-shoji bg-alert text-kinari text-sm px-3 py-2.5">
          <Andon size={18} /> {s.overdue} post{s.overdue > 1 ? 's are' : ' is'} past the go-live date and not marked posted. <span className="underline underline-offset-4 ml-auto shrink-0">Open the tracker</span>
        </button>
      )}

      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-shoji overflow-hidden border border-line/30 bg-line/20">
        {staff ? <>
          <Stat label="Client budget" value={s.client_budget != null ? formatINR(s.client_budget) : '—'} hint={s.expected_margin != null ? `Expected margin ${formatINR(s.expected_margin)}` : 'Add the budget'} />
          <Stat label="Actual creator spend" value={formatINR(s.actual_creator_spend ?? 0)} hint={`${s.confirmed_creators} confirmed creator${s.confirmed_creators === 1 ? '' : 's'}`} />
          <Stat label="Profit so far" value={formatINR(s.profit ?? 0)} hint="Billing − payouts − production" />
        </> : <Stat label="Creators" value={String(s.creators)} hint={`${s.confirmed_creators} confirmed`} />}
        <Stat label="Posted" value={`${s.posted} / ${s.deliverables}`} hint={s.views ? `${formatCount(s.views)} views · ${s.engagement_rate ?? 0}% ER` : 'No numbers yet'} />
      </dl>

      <div role="tablist" aria-label="Campaign sections" className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 border-b border-line/25">
        {tabs.map(t => (
          <button key={t.key} role="tab" id={`ktab-${t.key}`} aria-selected={tab === t.key} aria-controls="campaign-panel" onClick={() => setTab(t.key)}
            className={`relative px-4 h-11 text-sm whitespace-nowrap ${tab === t.key ? 'text-ink' : 'text-muted hover:text-ink'}`}>
            {t.label}{t.key === 'deliverables' && s.overdue > 0 && <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-akane align-middle" aria-label={`${s.overdue} overdue`} />}
            {tab === t.key && <span className="absolute left-3 right-3 -bottom-px h-[2px] bg-accent rounded-full" />}
          </button>
        ))}
      </div>

      <div id="campaign-panel" role="tabpanel" aria-labelledby={`ktab-${tab}`}>
        {tab === 'overview' && <Overview s={s} c={c} goTo={setTab} />}
        {tab === 'brief' && <Brief c={c} staff={staff} onSaved={refresh} />}
        {tab === 'creators' && <CampaignCreators campaignId={s.campaign_id} staff={staff} onChange={refresh} />}
        {tab === 'deliverables' && <DeliverablesTracker campaignId={s.campaign_id} onChange={refresh} />}
        {tab === 'performance' && <Performance campaignId={s.campaign_id} s={s} staff={staff} onChange={refresh} />}
        {tab === 'money' && staff && <Money s={s} />}
        {tab === 'files' && <RecordFiles load={() => campaignsApi.files(s.campaign_id)} upload={(f, k) => campaignsApi.uploadFile(s.campaign_id, f, k)}
          archive={campaignsApi.archiveFile} signedUrl={campaignsApi.signedUrl} kinds={FILE_KINDS} defaultKind="brief"
          hint="Brief decks, contracts, media kits, final edits, proof screenshots · up to 50 MB each · private" />}
        {tab === 'activity' && <Activity s={s} />}
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="bg-card px-5 py-4"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1.5 text-xl text-ink num">{value}</dd>{hint && <dd className="text-xs text-muted mt-1">{hint}</dd>}</div>
}
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[8rem_1fr] gap-3"><dt className="text-muted">{k}</dt><dd className="text-ink break-words">{children || <span className="text-muted">—</span>}</dd></div>
)

// ─── Overview ────────────────────────────────────────────────
function Overview({ s, c, goTo }: { s: CampaignSummary; c: CampaignRecord; goTo: (t: TabKey) => void }) {
  const creators = useAsync(() => campaignsApi.creators(s.campaign_id), [s.campaign_id, s.updated_at])
  const dels = useAsync(() => campaignsApi.deliverables(s.campaign_id), [s.campaign_id, s.updated_at])
  const today = istToday()
  const upcoming = (dels.data ?? []).filter(d => !d.is_posted && d.stage !== 'cancelled').sort((a, b) => (a.go_live_date ?? '9').localeCompare(b.go_live_date ?? '9')).slice(0, 6)
  const counts = CREATOR_STATUSES.map(st => [st, (creators.data ?? []).filter(x => x.status === st).length] as const).filter(([, n]) => n > 0)
  return (
    <div className="grid lg:grid-cols-12 gap-4 sm:gap-6">
      <Card className="lg:col-span-5 shoji-pad">
        <SectionTitle kanji="記">Details</SectionTitle>
        <dl className="space-y-3 text-sm">
          <Row k="Brand">{s.brand_name}</Row><Row k="Type">{KIND_LABEL[s.kind]}</Row>
          <Row k="Objective">{s.objective ? OBJECTIVE_LABEL[s.objective] : null}</Row>
          <Row k="Platforms">{s.platforms.map(p => PLATFORM_LABEL[p] ?? p).join(', ')}</Row>
          <Row k="Dates">{s.start_date ? `${formatDate(s.start_date)}${s.end_date ? ` – ${formatDate(s.end_date)}` : ''}` : null}</Row>
          <Row k="Code">{s.code}</Row><Row k="Owner">{s.owner_name}</Row>
          {c.hashtags.length > 0 && <Row k="Hashtags">{c.hashtags.join(' ')}</Row>}
        </dl>
      </Card>
      <Card className="lg:col-span-7 shoji-pad">
        <SectionTitle kanji="進" aside={<button className="text-sm text-muted hover:text-ink" onClick={() => goTo('creators')}>Creators</button>}>Progress</SectionTitle>
        <div className="flex flex-wrap items-center gap-6">
          <EnsoRing value={s.deliverables ? s.posted / s.deliverables : 0} size={112}>
            <span className="font-mincho text-xl text-ink num">{s.posted}/{s.deliverables}</span><span className="block text-[11px] text-muted">posted</span>
          </EnsoRing>
          <dl className="flex-1 min-w-[12rem] grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-muted">Brand approved</dt><dd className="text-ink num text-lg">{s.approved}</dd></div>
            <div><dt className="text-xs text-muted">Overdue</dt><dd className="num text-lg">{s.overdue ? <Pill tone="alert">{s.overdue}</Pill> : <span className="text-ink">0</span>}</dd></div>
            <div><dt className="text-xs text-muted">Views</dt><dd className="text-ink num text-lg">{formatCount(s.views)}</dd></div>
            <div><dt className="text-xs text-muted">Engagement</dt><dd className="text-ink num text-lg">{s.engagement_rate != null ? `${s.engagement_rate}%` : '—'}</dd></div>
          </dl>
        </div>
        {counts.length > 0 && <><BrushDivider className="my-5" />
          <p className="text-xs text-muted mb-2">Creators by status</p>
          <div className="flex flex-wrap gap-1.5">{counts.map(([st, n]) => <span key={st} className="pill border border-line/40 text-ink">{CREATOR_STATUS_LABEL[st]} · {n}</span>)}</div></>}
      </Card>
      <Card className="lg:col-span-12 shoji-pad">
        <SectionTitle kanji="暦" aside={<button className="text-sm text-muted hover:text-ink" onClick={() => goTo('deliverables')}>Tracker</button>}>Going live next</SectionTitle>
        {upcoming.length === 0 ? <EmptyState sketch="fuji" line={s.deliverables ? 'Everything planned is posted.' : 'No deliverables planned yet.'} /> : (
          <ul className="divide-y divide-line/15">
            {upcoming.map(d => (
              <li key={d.deliverable_id} className="py-3 grid grid-cols-[5rem_1fr_auto] gap-3 items-center">
                <span className={`num text-sm ${d.is_overdue ? 'text-ink' : 'text-muted'}`}>{d.go_live_date ? formatDate(d.go_live_date).slice(0, 6) : 'No date'}</span>
                <span className="min-w-0"><span className="block text-sm text-ink truncate">{d.title}</span><span className="block text-xs text-muted">{d.creator_name}</span></span>
                {d.is_overdue ? <Pill tone="alert"><Andon size={12} /> {d.days_overdue}d late</Pill> : <Pill>{d.go_live_date && d.go_live_date === today ? 'Today' : d.approval_status === 'approved' ? 'Approved' : d.stage.replace(/_/g, ' ')}</Pill>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ─── Brief ───────────────────────────────────────────────────
function Brief({ c, staff, onSaved }: { c: CampaignRecord; staff: boolean; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const promos = useAsync(() => campaignsApi.promoCodes(c.id), [c.id])
  const creators = useAsync(() => campaignsApi.creators(c.id), [c.id])
  const [f, setF] = useState({ brief: c.brief ?? '', key_messages: c.key_messages ?? '', dos: c.dos ?? '', donts: c.donts ?? '', hashtags: c.hashtags.join(' '), links: c.links.join('\n') })
  const [code, setCode] = useState({ code: '', offer: '', cc: '' })
  const [error, setError] = useState<string | null>(null)
  const lines = (v: string | null) => (v ?? '').split('\n').map(x => x.trim()).filter(Boolean)
  async function save(e: FormEvent) {
    e.preventDefault(); setError(null)
    const hashtags = f.hashtags.split(/[\s,]+/).map(h => h.trim()).filter(Boolean).map(h => h.startsWith('#') ? h : `#${h}`)
    const links = lines(f.links)
    if (links.some(l => !/^https?:\/\//i.test(l))) { setError('Links should start with http:// or https://'); return }
    try { await campaignsApi.saveBrief(c.id, { brief: f.brief.trim() || null, key_messages: f.key_messages.trim() || null, dos: f.dos.trim() || null, donts: f.donts.trim() || null, hashtags, links }); setEditing(false); await onSaved() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save') }
  }
  const List = ({ title, kanji, items, empty }: { title: string; kanji: string; items: string[]; empty: string }) => (
    <Card className="shoji-pad"><SectionTitle kanji={kanji}>{title}</SectionTitle>
      {items.length ? <ul className="space-y-1.5 text-sm text-ink">{items.map((x, i) => <li key={i} className="flex gap-2"><span className="text-accent-ink" aria-hidden>・</span>{x}</li>)}</ul> : <p className="text-sm text-muted">{empty}</p>}
    </Card>
  )
  if (editing) return (
    <form onSubmit={save} className="shoji shoji-pad space-y-4 max-w-3xl">
      {error && <FormError>{error}</FormError>}
      <label className="block text-sm text-muted">Brief<textarea className="field mt-1.5 h-36 py-2" value={f.brief} onChange={e => setF({ ...f, brief: e.target.value })} placeholder="What the content is, the story, the audience, timing…" /></label>
      <label className="block text-sm text-muted">Key messages (one per line)<textarea className="field mt-1.5 h-24 py-2" value={f.key_messages} onChange={e => setF({ ...f, key_messages: e.target.value })} /></label>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block text-sm text-muted">Do’s (one per line)<textarea className="field mt-1.5 h-28 py-2" value={f.dos} onChange={e => setF({ ...f, dos: e.target.value })} /></label>
        <label className="block text-sm text-muted">Don’ts (one per line)<textarea className="field mt-1.5 h-28 py-2" value={f.donts} onChange={e => setF({ ...f, donts: e.target.value })} /></label>
      </div>
      <label className="block text-sm text-muted">Hashtags<input className="field mt-1.5" value={f.hashtags} onChange={e => setF({ ...f, hashtags: e.target.value })} placeholder="#ChaiSutraDiwali #ad" /></label>
      <label className="block text-sm text-muted">Links (one per line)<textarea className="field mt-1.5 h-20 py-2" value={f.links} onChange={e => setF({ ...f, links: e.target.value })} placeholder="https://brand.com/landing-page" /></label>
      <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button><button className="btn-primary">Save brief</button></div>
    </form>
  )
  return (
    <div className="grid lg:grid-cols-12 gap-4 sm:gap-6">
      <Card className="lg:col-span-8 shoji-pad">
        <SectionTitle kanji="旨" aside={staff && <button className="text-sm text-muted hover:text-ink" onClick={() => setEditing(true)}>Edit brief</button>}>Brief</SectionTitle>
        {c.brief ? <p className="text-sm text-ink whitespace-pre-line leading-relaxed">{c.brief}</p> : <p className="text-sm text-muted">No brief written yet.{staff ? ' Add one with “Edit brief”.' : ''}</p>}
        <p className="text-xs text-muted mt-4">Decks and reference files go in the Files tab (type “Brief / deck”).</p>
      </Card>
      <div className="lg:col-span-4 space-y-4 sm:space-y-6">
        <Card className="shoji-pad"><SectionTitle kanji="#">Hashtags & links</SectionTitle>
          <p className="text-sm text-ink break-words">{c.hashtags.length ? c.hashtags.join(' ') : <span className="text-muted">No hashtags.</span>}</p>
          <ul className="mt-3 space-y-1 text-sm">{c.links.map(l => <li key={l}><a href={l} target="_blank" rel="noreferrer" className="text-ink hover:underline underline-offset-4 break-all">{l.replace(/^https?:\/\//, '')}</a></li>)}</ul>
        </Card>
      </div>
      <div className="lg:col-span-4"><List title="Key messages" kanji="要" items={lines(c.key_messages)} empty="None yet." /></div>
      <div className="lg:col-span-4"><List title="Do’s" kanji="可" items={lines(c.dos)} empty="None yet." /></div>
      <div className="lg:col-span-4"><List title="Don’ts" kanji="否" items={lines(c.donts)} empty="None yet." /></div>
      <Card className="lg:col-span-12 shoji-pad">
        <SectionTitle kanji="券">Promo codes</SectionTitle>
        {error && <div className="mb-3"><FormError>{error}</FormError></div>}
        {(promos.data ?? []).length === 0 ? <p className="text-sm text-muted mb-3">No codes yet.</p> : (
          <ul className="divide-y divide-line/15 mb-4">
            {promos.data!.map(p => (
              <li key={p.id} className="py-2.5 flex items-center gap-3 text-sm">
                <span className="font-mono text-ink tracking-wide">{p.code}</span><span className="text-muted flex-1">{[p.offer, creators.data?.find(x => x.id === p.campaign_creator_id)?.creator?.name].filter(Boolean).join(' · ')}</span>
                {staff && <button className="icon-btn w-9 h-9" aria-label={`Remove code ${p.code}`} onClick={async () => { await campaignsApi.archivePromo(p.id); promos.reload() }}><Icon name="close" /></button>}
              </li>
            ))}
          </ul>
        )}
        {staff && (
          <form className="grid sm:grid-cols-[10rem_1fr_14rem_auto] gap-2" onSubmit={async e => {
            e.preventDefault(); setError(null); if (!code.code.trim()) return
            try { await campaignsApi.addPromo(c.id, code.code, code.offer.trim() || null, code.cc || null); setCode({ code: '', offer: '', cc: '' }); promos.reload() }
            catch (err) { setError(err instanceof Error && err.message.includes('duplicate') ? 'That code is already on this campaign.' : err instanceof Error ? err.message : 'Could not add') }
          }}>
            <label className="sr-only" htmlFor="pc-code">Code</label><input id="pc-code" className="field uppercase font-mono" placeholder="CODE15" value={code.code} onChange={e => setCode({ ...code, code: e.target.value })} />
            <label className="sr-only" htmlFor="pc-offer">Offer</label><input id="pc-offer" className="field" placeholder="15% off first order" value={code.offer} onChange={e => setCode({ ...code, offer: e.target.value })} />
            <label className="sr-only" htmlFor="pc-cc">Creator</label>
            <select id="pc-cc" className="field" value={code.cc} onChange={e => setCode({ ...code, cc: e.target.value })}><option value="">Whole campaign</option>{(creators.data ?? []).filter(x => x.status !== 'dropped').map(x => <option key={x.id} value={x.id}>{x.creator?.name}</option>)}</select>
            <button className="btn-ghost" disabled={!code.code.trim()}><Icon name="plus" /> Add code</button>
          </form>
        )}
      </Card>
    </div>
  )
}

// ─── Money: budget vs actual ─────────────────────────────────
function Money({ s }: { s: CampaignSummary }) {
  const rows: { label: string; plan: number | null; actual: number; actualLabel: string; note: string }[] = [
    { label: 'Client billing', plan: s.client_budget, actual: s.client_billing, actualLabel: 'Invoiced', note: `${formatINR(s.received)} received` },
    { label: 'Creators', plan: s.planned_creator_spend, actual: s.actual_creator_spend ?? 0, actualLabel: 'Confirmed fees', note: `${formatINR(s.creator_payouts)} paid out` },
    { label: 'Production', plan: s.planned_production_spend, actual: s.production_expenses, actualLabel: 'Expenses', note: 'Expenses linked to this campaign' },
  ]
  const max = Math.max(1, ...rows.flatMap(r => [r.plan ?? 0, r.actual]))
  return (
    <div className="grid lg:grid-cols-12 gap-4 sm:gap-6">
      <Card className="lg:col-span-8 shoji-pad">
        <SectionTitle kanji="金">Budget vs actual</SectionTitle>
        <ul className="space-y-6">
          {rows.map(r => {
            const over = r.plan != null && r.label !== 'Client billing' && r.actual > r.plan
            return (
              <li key={r.label}>
                <div className="flex items-baseline justify-between gap-3 text-sm"><span className="text-ink">{r.label}</span>
                  <span className="num text-muted">{r.actualLabel} <span className="text-ink">{formatINR(r.actual)}</span> of {r.plan != null ? formatINR(r.plan) : 'no plan'}</span></div>
                <div className="mt-2 space-y-1.5" aria-hidden>
                  <div className="h-2 rounded-full bg-bg/70"><div className="h-2 rounded-full bg-line/50" style={{ width: `${((r.plan ?? 0) / max) * 100}%` }} /></div>
                  <div className="h-2 rounded-full bg-bg/70"><div className={`h-2 rounded-full ${over ? 'bg-alert' : 'bg-accent'}`} style={{ width: `${(r.actual / max) * 100}%` }} /></div>
                </div>
                <p className="text-xs text-muted mt-1.5">{r.note}{over && <span className="text-ink"> · <span className="inline-block w-1.5 h-1.5 rounded-full bg-akane mr-1 align-middle" />over plan by {formatINR(r.actual - (r.plan ?? 0))}</span>}</p>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted mt-6">Grey = plan, colour = actual. Billing, payouts and expenses come from the Money module (feature 6); until then they read ₹0.</p>
      </Card>
      <Card className="lg:col-span-4 shoji-pad space-y-5">
        <div><p className="eyebrow">Expected margin</p><p className="font-mincho text-3xl text-ink num mt-1">{s.expected_margin != null ? formatINR(s.expected_margin) : '—'}</p><p className="text-xs text-muted">Client budget − planned creator − planned production</p></div>
        <div><p className="eyebrow">Profit so far</p><p className="font-mincho text-3xl text-accent-ink num mt-1">{formatINR(s.profit ?? 0)}</p><p className="text-xs text-muted">Client billing − creator payouts − production expenses</p></div>
        <div><p className="eyebrow">Our cost per view</p><p className="text-xl text-ink num mt-1">{formatCPV(s.cost_per_view)}</p><p className="text-xs text-muted">Actual creator spend ÷ views (internal)</p></div>
      </Card>
    </div>
  )
}

// ─── Activity ────────────────────────────────────────────────
const DOT: Record<ActivityKind, string> = { create: 'bg-hai', status: 'bg-kaki', money: 'bg-yamabuki', archive: 'bg-akane', update: 'bg-hai' }
function Activity({ s }: { s: CampaignSummary }) {
  const { data, loading } = useAsync(() => campaignsApi.activity(s.campaign_id), [s.campaign_id, s.updated_at])
  const creators = useAsync(() => campaignsApi.creators(s.campaign_id), [s.campaign_id])
  const dels = useAsync(() => campaignsApi.deliverables(s.campaign_id), [s.campaign_id])
  const names = useMemo(() => Object.fromEntries([
    ...(creators.data ?? []).flatMap(x => [[x.id, x.creator?.name ?? 'a creator'], [x.creator_id, x.creator?.name ?? 'a creator']]),
    ...(dels.data ?? []).map(d => [d.deliverable_id, d.title]),
  ]), [creators.data, dels.data])
  const rows = (data ?? []).map(e => ({ e, d: describeActivity(e, names) })).filter(r => r.d.text)
  if (loading) return <EnsoSpinner />
  if (!rows.length) return <div className="shoji"><EmptyState line="No history yet." /></div>
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="歴" aside={<button className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5" onClick={() => downloadCSV(`${s.name.replace(/\W+/g, '-')}-activity-${istToday()}.csv`, rows, [
        { header: 'When (IST)', value: r => formatDateTime(r.e.created_at) }, { header: 'Who', value: r => r.e.actor_name }, { header: 'What', value: r => r.d.text }, { header: 'Record', value: r => r.e.table_name }])}>
        <Icon name="download" /> CSV</button>}>History</SectionTitle>
      <ol className="relative ml-1.5 border-l border-line/30 space-y-5">
        {rows.map(({ e, d }) => (
          <li key={e.id} className="pl-5 relative">
            <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-card ${DOT[d.kind]}`} aria-hidden />
            <p className="text-sm text-ink"><span className="font-medium">{e.actor_name}</span> {d.text}</p>
            <p className="text-xs text-muted mt-0.5 num">{formatDateTime(e.created_at)}{e.source !== 'app' ? ` · ${e.source}` : ''}</p>
          </li>
        ))}
      </ol>
    </Card>
  )
}
