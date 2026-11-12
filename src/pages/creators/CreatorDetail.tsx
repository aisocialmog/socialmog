import { useMemo, useState, type FormEvent } from 'react'
import { useReauth } from '../../lib/reauth'
import { AiRecordTools } from '../../components/work/Ai'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { creatorsApi, type CreatorOverview, type PaymentDetails, type PlatformRow } from '../../data/creators'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { isStaff } from '../../lib/access'
import { CREATOR_STATUS_LABEL, FOLLOWER_WORD, formatCount, GENDERS, parseCount, parsePercent, PLATFORMS, PLATFORM_LABEL, profileUrl,
  RATE_LABEL, RATE_TYPES, TIER_LABEL, TIER_RANGE, cleanHandle, type DeliverableType } from '../../lib/creators'
import { describeActivity, type ActivityKind } from '../../lib/activity'
import { formatDate, formatDateTime, formatINR, istToday } from '../../lib/format'
import { downloadCSV } from '../../lib/csv'
import { Card, EmptyState, MoreMenu, Pill, SectionTitle } from '../../components/ui/kit'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { Avatar } from '../../components/ui/Avatar'
import { Andon, EnsoSpinner, Hanko } from '../../components/art/Ink'
import { Sparkline, Stars, TierPill } from '../../components/creators/CreatorBits'
import { AddToShortlist } from '../../components/creators/AddToShortlist'
import { FormError, FormNote } from '../auth/AuthLayout'

const TABS = [
  { key: 'profile', label: 'Profile' }, { key: 'platforms', label: 'Platforms & stats' }, { key: 'rates', label: 'Rate card' },
  { key: 'history', label: 'Campaign history' }, { key: 'payments', label: 'Payments', staffOnly: true }, { key: 'activity', label: 'Activity' },
] as const
type TabKey = (typeof TABS)[number]['key']
const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, '').replace(/^0+/, '').replace(/^(?!91)(\d{10})$/, '91$1')}`

export function CreatorDetail() {
  const { id = '' } = useParams()
  const { role } = useAuth()
  const staff = isStaff(role)
  const [params, setParams] = useSearchParams()
  const tabs = TABS.filter(t => !('staffOnly' in t) || staff)
  const tab = (tabs.find(t => t.key === params.get('tab'))?.key ?? 'profile') as TabKey
  const setTab = (t: TabKey) => { params.set('tab', t); setParams(params, { replace: true }) }
  const creator = useAsync(() => creatorsApi.get(id), [id])
  const [shortlisting, setShortlisting] = useState(false)
  const [note, setNote] = useState<React.ReactNode>(null)
  const [error, setError] = useState<string | null>(null)

  const c = creator.data
  if (creator.loading && !c) return <div className="py-16 grid place-items-center"><EnsoSpinner size={44} label="Loading creator" /></div>
  if (!c) return <div className="shoji"><EmptyState sketch="koi" line="This creator isn’t here — archived, or not yours to see." action={<Link to="/creators" className="btn-ghost">Back to creators</Link>} /></div>
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await creator.reload() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') } }

  return (
    <div className="space-y-6 sm:space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5">
        <Link to="/creators" className="hover:text-ink">Creators</Link><Icon name="chevronRight" className="text-xs" /><span className="text-ink truncate">{c.name}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar name={c.name} path={c.photo_path} size={64} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="font-mincho text-3xl text-ink break-words">{c.name}</h1>
              <TierPill tier={c.tier} />
              {c.is_archived && <Pill tone="ink">Archived</Pill>}
            </div>
            <p className="text-sm text-muted mt-1">{[c.city, c.state, c.languages.join(', '), CREATOR_STATUS_LABEL[c.status]].filter(Boolean).join(' · ')}</p>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <Stars value={c.rating} label="Internal rating" />
              {c.would_work_again != null && <span className="text-xs text-muted">{c.would_work_again ? 'Would work again' : 'Would not work again'}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link to={`/creators/${c.id}/edit`} className="btn-primary"><Icon name="edit" /> Edit creator</Link>
          <AiRecordTools kind="creator" id={id} />
          <MoreMenu items={[
            { label: 'Add to shortlist', onSelect: () => setShortlisting(true) },
            c.is_archived ? { label: 'Restore creator', onSelect: () => act(() => creatorsApi.setArchived(c.id, false)) }
              : { label: 'Archive creator', danger: true, onSelect: () => { if (confirm(`Archive ${c.name}? Nothing is deleted; restore any time from “Show archived creators”.`)) act(() => creatorsApi.setArchived(c.id, true)) } },
          ]} />
        </div>
      </header>

      {c.is_blacklisted && <p role="alert" className="flex items-start gap-2 rounded-shoji bg-alert text-kinari text-sm px-3 py-2.5"><Andon size={18} /><span><strong className="font-medium">Blacklisted.</strong> {c.blacklist_reason}</span></p>}
      {error && <FormError>{error}</FormError>}
      {note && <FormNote>{note}</FormNote>}

      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-shoji overflow-hidden border border-line/30 bg-line/20">
        <Stat label={c.top_platform ? `${PLATFORM_LABEL[c.top_platform]} ${FOLLOWER_WORD[c.top_platform] ?? 'followers'}` : 'Followers'} value={formatCount(c.max_followers)} hint={c.tier ? `${TIER_LABEL[c.tier]} · ${TIER_RANGE[c.tier]}` : 'Add platform stats'} />
        <Stat label="Avg views" value={formatCount(c.top_avg_views)} hint={c.top_engagement_rate != null ? `${c.top_engagement_rate}% engagement` : undefined} />
        <Stat label="Reel rate" value={c.rate_reel != null ? formatINR(c.rate_reel) : '—'} hint={c.rate_reel && c.top_avg_views ? `${formatINR(Math.round(c.rate_reel / c.top_avg_views * 1000))} per 1K views` : undefined} />
        <Stat label="Campaigns" value={String(c.campaigns_count)} hint={staff ? `${formatINR(c.total_paid)} paid` : undefined} />
      </dl>

      <div role="tablist" aria-label="Creator sections" className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 border-b border-line/25">
        {tabs.map(t => (
          <button key={t.key} role="tab" id={`ctab-${t.key}`} aria-selected={tab === t.key} aria-controls="creator-panel" onClick={() => setTab(t.key)}
            className={`relative px-4 h-11 text-sm whitespace-nowrap transition-colors duration-calm ${tab === t.key ? 'text-ink' : 'text-muted hover:text-ink'}`}>
            {t.label}{tab === t.key && <span className="absolute left-3 right-3 -bottom-px h-[2px] bg-accent rounded-full" />}
          </button>
        ))}
      </div>

      <div id="creator-panel" role="tabpanel" aria-labelledby={`ctab-${tab}`}>
        {tab === 'profile' && <Profile c={c} />}
        {tab === 'platforms' && <Platforms c={c} onChange={creator.reload} />}
        {tab === 'rates' && <Rates c={c} onChange={creator.reload} />}
        {tab === 'history' && <History creatorId={c.id} staff={staff} />}
        {tab === 'payments' && staff && <Payments creatorId={c.id} />}
        {tab === 'activity' && <Activity c={c} />}
      </div>

      {shortlisting && <AddToShortlist creatorIds={[c.id]} onClose={() => setShortlisting(false)}
        onDone={(sid, name) => { setShortlisting(false); setNote(<>Added to <Link className="underline underline-offset-4" to={`/creators/shortlists/${sid}`}>{name}</Link>.</>) }} />}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="bg-card px-5 py-4"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1.5 text-xl text-ink num">{value}</dd>{hint && <dd className="text-xs text-muted mt-1">{hint}</dd>}</div>
}
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[8.5rem_1fr] gap-3"><dt className="text-muted">{k}</dt><dd className="text-ink break-words">{children ?? <span className="text-muted">—</span>}</dd></div>
)

// ─── Profile ─────────────────────────────────────────────────
function Profile({ c }: { c: CreatorOverview }) {
  return (
    <div className="grid lg:grid-cols-12 gap-4 sm:gap-6">
      <Card className="lg:col-span-7 shoji-pad">
        <SectionTitle kanji="話">Contact</SectionTitle>
        <dl className="space-y-3 text-sm">
          <Row k="Phone">{c.phone && <a className="hover:underline underline-offset-4 num" href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a>}</Row>
          <Row k="WhatsApp">{c.whatsapp && <a className="hover:underline underline-offset-4 num" href={waLink(c.whatsapp)} target="_blank" rel="noreferrer">{c.whatsapp}</a>}</Row>
          <Row k="Email">{c.email && <a className="hover:underline underline-offset-4 break-all" href={`mailto:${c.email}`}>{c.email}</a>}</Row>
          <Row k="City">{[c.city, c.state].filter(Boolean).join(', ') || null}</Row>
          <Row k="Gender">{GENDERS.find(g => g.value === c.gender)?.label ?? null}</Row>
          <Row k="Languages">{c.languages.join(', ') || null}</Row>
          <Row k="Niches">{c.niches.length ? <span className="flex flex-wrap gap-1.5">{c.niches.map(n => <span key={n} className="pill border border-line/40 text-ink">{n}</span>)}</span> : null}</Row>
        </dl>
        {(c.manager_name || c.manager_agency) && <>
          <div className="my-5 h-px bg-line/20" />
          <SectionTitle kanji="仲">Manager / agency</SectionTitle>
          <dl className="space-y-3 text-sm">
            <Row k="Agency">{c.manager_agency}</Row><Row k="Manager">{c.manager_name}</Row>
            <Row k="Phone">{c.manager_phone && <a className="hover:underline underline-offset-4 num" href={`tel:${c.manager_phone.replace(/\s/g, '')}`}>{c.manager_phone}</a>}</Row>
            <Row k="Email">{c.manager_email && <a className="hover:underline underline-offset-4" href={`mailto:${c.manager_email}`}>{c.manager_email}</a>}</Row>
          </dl>
        </>}
      </Card>
      <Card className="lg:col-span-5 shoji-pad">
        <SectionTitle kanji="評">Internal</SectionTitle>
        <dl className="space-y-3 text-sm">
          <Row k="Rating"><Stars value={c.rating} /></Row>
          <Row k="Work again?">{c.would_work_again == null ? 'Not decided' : c.would_work_again ? 'Yes' : 'No'}</Row>
          <Row k="Status">{CREATOR_STATUS_LABEL[c.status]}</Row>
          <Row k="Blacklisted">{c.is_blacklisted ? <Pill tone="alert">Yes</Pill> : 'No'}</Row>
          <Row k="Added">{formatDate(c.created_at)}</Row>
        </dl>
        <div className="my-5 h-px bg-line/20" />
        <p className="text-xs text-muted mb-1">Notes</p>
        {c.notes ? <p className="text-sm text-ink whitespace-pre-line">{c.notes}</p> : <p className="text-sm text-muted">Nothing noted yet.</p>}
      </Card>
    </div>
  )
}

// ─── Platforms & stats ───────────────────────────────────────
function Platforms({ c, onChange }: { c: CreatorOverview; onChange: () => Promise<void> }) {
  const { data, loading, reload } = useAsync(() => creatorsApi.platforms(c.id), [c.id])
  const snaps = useAsync(() => creatorsApi.snapshots((data ?? []).map(p => p.id)), [data])
  const [editing, setEditing] = useState<PlatformRow | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = istToday()
  const stale = (d: string | null) => !d || (Date.parse(today) - Date.parse(d)) / 864e5 > 90
  if (loading) return <EnsoSpinner />
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <p className="text-sm text-muted">Tier comes from the biggest platform{c.tier ? <> — currently <span className="text-ink">{TIER_LABEL[c.tier]}</span></> : ''}.</p>
        <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" /> Add platform</button>
      </div>
      {error && <FormError>{error}</FormError>}
      {!data?.length ? <div className="shoji"><EmptyState sketch="branch" line="No platforms yet." /></div> : (
        <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {data.map((p, i) => {
            const series = (snaps.data ?? []).filter(s => s.creator_platform_id === p.id && s.followers != null).map(s => s.followers!)
            const url = p.url || profileUrl(p.platform, p.handle)
            return (
              <li key={p.id} className="shoji p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted">{PLATFORM_LABEL[p.platform] ?? p.platform}{i === 0 && p.followers != null ? ' · biggest' : ''}</p>
                    {url ? <a href={url} target="_blank" rel="noreferrer" className="text-ink hover:underline underline-offset-4 break-all">@{p.handle}</a> : <p className="text-ink">@{p.handle}</p>}
                  </div>
                  <MoreMenu label={`Actions for ${p.handle}`} items={[
                    { label: 'Update stats', onSelect: () => setEditing(p) },
                    { label: 'Remove platform', danger: true, onSelect: async () => { if (confirm(`Remove ${PLATFORM_LABEL[p.platform]} @${p.handle}?`)) { try { await creatorsApi.archivePlatform(p.id); await reload(); await onChange() } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove') } } } },
                  ]} />
                </div>
                <dl className="grid grid-cols-3 gap-2 mt-4">
                  <div><dt className="text-[11px] text-muted capitalize">{FOLLOWER_WORD[p.platform] ?? 'followers'}</dt><dd className="text-lg text-ink num">{formatCount(p.followers)}</dd></div>
                  <div><dt className="text-[11px] text-muted">Avg views</dt><dd className="text-lg text-ink num">{formatCount(p.avg_views)}</dd></div>
                  <div><dt className="text-[11px] text-muted">Engagement</dt><dd className="text-lg text-ink num">{p.engagement_rate != null ? `${p.engagement_rate}%` : '—'}</dd></div>
                </dl>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <p className={`text-xs ${stale(p.metrics_updated_on) ? 'text-ink' : 'text-muted'}`}>
                    {stale(p.metrics_updated_on) && <span className="inline-block w-1.5 h-1.5 rounded-full bg-akane mr-1.5 align-middle" />}
                    Updated {p.metrics_updated_on ? formatDate(p.metrics_updated_on) : 'never'}{stale(p.metrics_updated_on) ? ' — over 90 days old' : ''}
                  </p>
                  <Sparkline points={series} label={`${PLATFORM_LABEL[p.platform]} follower growth`} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {editing && <PlatformForm creatorId={c.id} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await reload(); await onChange() }} />}
    </div>
  )
}

function PlatformForm({ creatorId, row, onClose, onSaved }: { creatorId: string; row: PlatformRow | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ platform: row?.platform ?? 'instagram', handle: row?.handle ?? '', url: row?.url ?? '',
    followers: row?.followers?.toString() ?? '', avg_views: row?.avg_views?.toString() ?? '', engagement_rate: row?.engagement_rate?.toString() ?? '', date: istToday() })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  async function save(e: FormEvent) {
    e.preventDefault()
    const handle = cleanHandle(f.handle)
    if (!handle) { setError('Add the handle.'); return }
    const followers = parseCount(f.followers), avg_views = parseCount(f.avg_views), engagement_rate = parsePercent(f.engagement_rate)
    if (f.followers && followers == null) { setError('Followers should be a number like 48200, 48.2K or 1.5L.'); return }
    if (f.engagement_rate && engagement_rate == null) { setError('Engagement should be a percentage between 0 and 100.'); return }
    setBusy(true); setError(null)
    try {
      await creatorsApi.savePlatform(creatorId, { platform: f.platform, handle, url: f.url.trim() || null, followers, avg_views, engagement_rate,
        metrics_updated_on: f.date !== istToday() ? f.date : undefined }, row?.id)
      onSaved()
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Could not save'
      setError(m.includes('handle_key') || m.includes('already belongs') ? `@${handle} on ${PLATFORM_LABEL[f.platform]} already belongs to another creator.` : m); setBusy(false)
    }
  }
  return (
    <Modal title={row ? `Update ${PLATFORM_LABEL[row.platform]} @${row.handle}` : 'Add a platform'} onClose={onClose}>
      <form onSubmit={save} className="grid sm:grid-cols-2 gap-4">
        {error && <div className="sm:col-span-2"><FormError>{error}</FormError></div>}
        <label className="text-sm text-muted">Platform<select className="field mt-1.5" value={f.platform} onChange={set('platform')} disabled={Boolean(row)}>{PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select></label>
        <label className="text-sm text-muted">Handle or profile URL<input className="field mt-1.5" value={f.handle} onChange={set('handle')} placeholder="@handle" /></label>
        <label className="text-sm text-muted">{FOLLOWER_WORD[f.platform] ? 'Subscribers' : 'Followers'}<input className="field mt-1.5 num" value={f.followers} onChange={set('followers')} placeholder="48.2K" /></label>
        <label className="text-sm text-muted">Average views<input className="field mt-1.5 num" value={f.avg_views} onChange={set('avg_views')} placeholder="31K" /></label>
        <label className="text-sm text-muted">Engagement rate %<input className="field mt-1.5 num" value={f.engagement_rate} onChange={set('engagement_rate')} placeholder="6.2" /></label>
        <label className="text-sm text-muted">Stats as of<input className="field mt-1.5 num" type="date" max={istToday()} value={f.date} onChange={set('date')} /></label>
        <label className="text-sm text-muted sm:col-span-2">Profile URL (optional)<input className="field mt-1.5" value={f.url} onChange={set('url')} placeholder="Filled from the handle if left blank" /></label>
        <p className="sm:col-span-2 text-xs text-muted">Each update is kept, so the growth line on the card fills in over time.</p>
        <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  )
}

// ─── Rate card ───────────────────────────────────────────────
function Rates({ c, onChange }: { c: CreatorOverview; onChange: () => Promise<void> }) {
  const { data, loading, reload } = useAsync(() => creatorsApi.rates(c.id), [c.id])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = (t: DeliverableType) => data?.find(r => r.deliverable_type === t && !r.valid_to)
  const dirty = Object.entries(draft).filter(([t, v]) => (parseCount(v) ?? null) !== (current(t as DeliverableType)?.rate ?? null))
  async function save() {
    for (const [t, v] of dirty) if (v.trim() && parseCount(v) == null) { setError(`${RATE_LABEL[t as DeliverableType]}: “${v}” isn’t an amount.`); return }
    setBusy(true); setError(null)
    try { for (const [t, v] of dirty) await creatorsApi.setRate(c.id, t as DeliverableType, v.trim() ? parseCount(v) : null); setDraft({}); await reload(); await onChange() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  if (loading) return <EnsoSpinner />
  const history = (data ?? []).filter(r => r.valid_to)
  return (
    <div className="grid lg:grid-cols-12 gap-4 sm:gap-6">
      <Card className="lg:col-span-7 shoji-pad">
        <SectionTitle kanji="価" aside={dirty.length > 0 && <button className="btn-primary h-9" onClick={save} disabled={busy}>{busy ? 'Saving…' : `Save ${dirty.length} change${dirty.length > 1 ? 's' : ''}`}</button>}>Current rates</SectionTitle>
        {error && <div className="mb-3"><FormError>{error}</FormError></div>}
        <ul className="divide-y divide-line/15">
          {RATE_TYPES.map(t => {
            const cur = current(t)
            const perK = t === 'reel' && cur && c.top_avg_views ? Math.round(cur.rate / c.top_avg_views * 1000) : null
            return (
              <li key={t} className="py-3 grid grid-cols-[1fr_9rem] sm:grid-cols-[1fr_9rem_8rem] gap-3 items-center">
                <label htmlFor={`rate-${t}`} className="text-sm text-ink">{RATE_LABEL[t]}{perK && <span className="block text-xs text-muted num">{formatINR(perK)} per 1K views</span>}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm" aria-hidden>₹</span>
                  <input id={`rate-${t}`} className="field pl-7 num text-right" inputMode="numeric" placeholder="—"
                    value={draft[t] ?? (cur ? new Intl.NumberFormat('en-IN').format(cur.rate) : '')} onChange={e => setDraft({ ...draft, [t]: e.target.value })} />
                </div>
                <span className="hidden sm:block text-xs text-muted text-right num">{cur ? `Updated ${formatDate(cur.valid_from)}` : 'Not set'}</span>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted mt-3">Changing a price keeps the old one in the history below. Clear a box to remove that price.</p>
      </Card>
      <Card className="lg:col-span-5 shoji-pad">
        <SectionTitle kanji="歴">Price history</SectionTitle>
        {history.length === 0 ? <p className="text-sm text-muted">No earlier prices.</p> : (
          <ul className="divide-y divide-line/15 text-sm">
            {history.map(r => <li key={r.id} className="py-2.5 flex justify-between gap-3"><span className="text-ink">{RATE_LABEL[r.deliverable_type]}<span className="block text-xs text-muted num">{formatDate(r.valid_from)} – {formatDate(r.valid_to)}</span></span><span className="num text-ink">{formatINR(r.rate)}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ─── Campaign history ────────────────────────────────────────
function History({ creatorId, staff }: { creatorId: string; staff: boolean }) {
  const { data, loading } = useAsync(() => creatorsApi.history(creatorId), [creatorId])
  if (loading) return <EnsoSpinner />
  if (!data?.length) return <div className="shoji"><EmptyState sketch="fuji" line="No campaigns with this creator yet." action={<p className="text-xs text-muted -mt-2">Every campaign they’re on will show here with fee, payments and views (feature 4).</p>} /></div>
  return (
    <div className="shoji overflow-x-auto">
      <table className="w-full text-sm min-w-[40rem]">
        <thead><tr className="text-left text-xs text-muted border-b border-line/25">
          <th className="px-5 py-3 font-normal">Campaign</th><th className="px-3 py-3 font-normal">Status</th>
          {staff && <th className="px-3 py-3 font-normal text-right">Fee</th>}{staff && <th className="px-3 py-3 font-normal text-right">Paid</th>}
          <th className="px-3 py-3 font-normal text-right">Live</th><th className="px-5 py-3 font-normal text-right">Views</th>
        </tr></thead>
        <tbody className="divide-y divide-line/15">
          {data.map(h => (
            <tr key={h.campaign_creator_id}>
              <td className="px-5 py-3"><span className="text-ink">{h.campaign_name}{h.is_historical && <> <Pill tone="quiet">History</Pill></>}</span><span className="block text-xs text-muted">{h.brand_name}{h.start_date ? ` · ${formatDate(h.start_date)}` : ''}</span></td>
              <td className="px-3 py-3">{h.campaign_status === 'completed' ? <Hanko kind="completed" size={34} animate={false} /> : <Pill>{h.creator_status.replace(/_/g, ' ')}</Pill>}</td>
              {staff && <td className="px-3 py-3 text-right num text-ink">{h.agreed_fee != null ? formatINR(h.agreed_fee) : '—'}{h.is_historical && <span className="block text-xs text-muted">historical fee</span>}</td>}
              {staff && <td className="px-3 py-3 text-right num text-ink">{formatINR(h.paid)}</td>}
              <td className="px-3 py-3 text-right num text-muted">{h.live} / {h.deliverables}</td>
              <td className="px-5 py-3 text-right num text-ink">{formatCount(h.total_views)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Payments (payouts for staff; bank details for founders only) ──
const MASK = (v: string | null) => v ? `•••• ${v.slice(-4)}` : '—'
function Payments({ creatorId }: { creatorId: string }) {
  const { role } = useAuth()
  const founder = role === 'founder'
  const payouts = useAsync(() => creatorsApi.payouts(creatorId), [creatorId])
  const reauth = useReauth()
  const details = useAsync(async () => founder && await reauth('Bank and UPI details are protected.') ? creatorsApi.payment(creatorId) : null, [creatorId, founder])
  const [reveal, setReveal] = useState(false)
  const [editing, setEditing] = useState(false)
  const d = details.data
  return (
    <div className="grid lg:grid-cols-12 gap-4 sm:gap-6">
      <Card className="lg:col-span-7 shoji-pad">
        <SectionTitle kanji="払">Payouts</SectionTitle>
        {payouts.loading ? <EnsoSpinner /> : !payouts.data?.length ? <EmptyState line="Nothing paid yet — ₹0." action={<p className="text-xs text-muted -mt-2">Creator payouts arrive with Money (feature 6).</p>} /> : (
          <ul className="divide-y divide-line/15">
            {payouts.data.map(p => (
              <li key={p.payout_id} className="py-3 flex items-center gap-4 text-sm">
                <span className="flex-1"><span className="text-ink num">{p.paid_on ? `Paid ${formatDate(p.paid_on)}` : p.due_date ? `Due ${formatDate(p.due_date)}` : 'No date'}</span>
                  <span className="block text-xs text-muted num">Gross {formatINR(p.gross)} · TDS {formatINR(p.tds)}</span></span>
                <span className="num text-ink">{formatINR(p.net_payable)}</span>
                {p.status === 'paid' ? <Hanko kind="paid" size={34} animate={false} /> : <Pill>{p.status}</Pill>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="lg:col-span-5 shoji-pad">
        <SectionTitle kanji="秘" aside={founder && d && <button className="text-sm text-muted hover:text-ink" onClick={() => setReveal(r => !r)}>{reveal ? 'Hide' : 'Show'}</button>}>
          Payment details <span className="pill bg-alert text-kinari ml-2 align-middle text-[10px] font-sans">Sensitive</span>
        </SectionTitle>
        {!founder ? (
          <p className="text-sm text-muted flex items-start gap-2"><Andon size={16} />Bank, UPI and PAN details are visible only to founders.</p>
        ) : details.loading ? <EnsoSpinner /> : (
          <>
            {d ? (
              <dl className="space-y-2.5 text-sm">
                {([['UPI ID', d.upi_id], ['Bank', d.bank_name], ['Account holder', d.bank_account_name], ['Account no.', d.bank_account_number], ['IFSC', d.ifsc], ['PAN', d.pan], ['Legal name', d.legal_name], ['TDS', d.tds_section ? `${d.tds_section}${d.tds_rate != null ? ` @ ${d.tds_rate}%` : ''}` : null]] as [string, string | null][])
                  .map(([k, v]) => <Row key={k} k={k}><span className="num">{v == null ? null : reveal || k === 'Bank' || k === 'TDS' ? v : MASK(v)}</span></Row>)}
              </dl>
            ) : <p className="text-sm text-muted">Not added yet.</p>}
            <button className="btn-ghost h-9 mt-4" onClick={() => setEditing(true)}>{d ? 'Edit payment details' : 'Add payment details'}</button>
            <p className="text-xs text-muted mt-3">Stored with founders-only access. The activity history records that these changed, never the full numbers.</p>
          </>
        )}
      </Card>
      {editing && <PaymentForm creatorId={creatorId} current={d ?? null} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await details.reload() }} />}
    </div>
  )
}

function PaymentForm({ creatorId, current, onClose, onSaved }: { creatorId: string; current: PaymentDetails | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ legal_name: '', pan: '', upi_id: '', bank_name: '', bank_account_name: '', bank_account_number: '', ifsc: '', gstin: '', tds_section: '194J', tds_rate: '10',
    ...Object.fromEntries(Object.entries(current ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)])) })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  async function save(e: FormEvent) {
    e.preventDefault()
    const pan = f.pan.trim().toUpperCase(), ifsc = f.ifsc.trim().toUpperCase(), upi = f.upi_id.trim()
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) { setError('PAN looks wrong — it’s 5 letters, 4 digits, 1 letter (e.g. ABCPS1234K).'); return }
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) { setError('IFSC looks wrong — 11 characters, the 5th is 0 (e.g. HDFC0001234).'); return }
    if (upi && !/^[\w.-]+@[\w.-]+$/.test(upi)) { setError('UPI ID should look like name@bank.'); return }
    const n = (v: string) => v.trim() || null
    setBusy(true); setError(null)
    try {
      await creatorsApi.savePayment(creatorId, { legal_name: n(f.legal_name), pan: pan || null, upi_id: upi || null, bank_name: n(f.bank_name), bank_account_name: n(f.bank_account_name),
        bank_account_number: n(f.bank_account_number.replace(/\s/g, '')), ifsc: ifsc || null, gstin: n(f.gstin.toUpperCase()), tds_section: n(f.tds_section), tds_rate: f.tds_rate ? Number(f.tds_rate) : null })
      onSaved()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); setBusy(false) }
  }
  return (
    <Modal title="Payment details" onClose={onClose}>
      <form onSubmit={save} className="grid sm:grid-cols-2 gap-4" autoComplete="off">
        <p className="sm:col-span-2 text-xs text-muted flex items-center gap-2"><span className="pill bg-alert text-kinari text-[10px]">Sensitive</span> Visible only to founders.</p>
        {error && <div className="sm:col-span-2"><FormError>{error}</FormError></div>}
        <label className="text-sm text-muted">UPI ID<input className="field mt-1.5" value={f.upi_id} onChange={set('upi_id')} placeholder="name@okhdfc" /></label>
        <label className="text-sm text-muted">PAN<input className="field mt-1.5 uppercase num" maxLength={10} value={f.pan} onChange={set('pan')} /></label>
        <label className="text-sm text-muted">Bank name<input className="field mt-1.5" value={f.bank_name} onChange={set('bank_name')} /></label>
        <label className="text-sm text-muted">Account holder name<input className="field mt-1.5" value={f.bank_account_name} onChange={set('bank_account_name')} /></label>
        <label className="text-sm text-muted">Account number<input className="field mt-1.5 num" inputMode="numeric" value={f.bank_account_number} onChange={set('bank_account_number')} /></label>
        <label className="text-sm text-muted">IFSC<input className="field mt-1.5 uppercase num" maxLength={11} value={f.ifsc} onChange={set('ifsc')} /></label>
        <label className="text-sm text-muted">Legal name (for TDS)<input className="field mt-1.5" value={f.legal_name} onChange={set('legal_name')} /></label>
        <label className="text-sm text-muted">GSTIN (if registered)<input className="field mt-1.5 uppercase num" maxLength={15} value={f.gstin} onChange={set('gstin')} /></label>
        <label className="text-sm text-muted">TDS section<select className="field mt-1.5" value={f.tds_section} onChange={set('tds_section')}><option value="">None</option><option>194J</option><option>194C</option><option>194R</option><option>194O</option></select></label>
        <label className="text-sm text-muted">TDS rate %<input className="field mt-1.5 num" inputMode="decimal" value={f.tds_rate} onChange={set('tds_rate')} /></label>
        <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  )
}

// ─── Activity ────────────────────────────────────────────────
const DOT: Record<ActivityKind, string> = { create: 'bg-hai', status: 'bg-kaki', money: 'bg-yamabuki', archive: 'bg-akane', update: 'bg-hai' }
function Activity({ c }: { c: CreatorOverview }) {
  const { data, loading } = useAsync(() => creatorsApi.activity(c.id), [c.id, c.updated_at])
  const niches = useAsync(() => creatorsApi.niches(), [])
  const plats = useAsync(() => creatorsApi.platforms(c.id), [c.id])
  const lists = useAsync(() => creatorsApi.shortlists(), [])
  const names = useMemo(() => Object.fromEntries([
    ...(niches.data ?? []).map(n => [n.id, n.name]), ...(plats.data ?? []).map(p => [p.id, `${PLATFORM_LABEL[p.platform]} @${p.handle}`]),
    ...(lists.data ?? []).map(l => [l.id, l.name]),
  ]), [niches.data, plats.data, lists.data])
  const rows = (data ?? []).map(e => ({ e, d: describeActivity(e, names) })).filter(r => r.d.text)
  if (loading) return <EnsoSpinner />
  if (!rows.length) return <div className="shoji"><EmptyState line="No history yet." /></div>
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="歴" aside={<button className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5" onClick={() => downloadCSV(`${c.name.replace(/\W+/g, '-')}-activity-${istToday()}.csv`, rows, [
        { header: 'When (IST)', value: r => formatDateTime(r.e.created_at) }, { header: 'Who', value: r => r.e.actor_name }, { header: 'What', value: r => r.d.text },
        { header: 'Record', value: r => r.e.table_name }, { header: 'Source', value: r => r.e.source },
      ])}><Icon name="download" /> CSV</button>}>History</SectionTitle>
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
