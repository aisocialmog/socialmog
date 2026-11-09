import { useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import { creatorsApi, type CreatorOverview, type SavedView } from '../../data/creators'
import { useAsync } from '../../hooks/useAsync'
import { activeFilterCount, applyCreatorFilters, EMPTY_FILTERS, formatCount, PLATFORMS, PLATFORM_LABEL, RATE_LABEL, RATE_TYPES,
  TIERS, TIER_LABEL, TIER_RANGE, type CreatorFilters, type DeliverableType, type Tier } from '../../lib/creators'
import { formatDate, formatINR, istToday } from '../../lib/format'
import { downloadCSV, type CsvColumn } from '../../lib/csv'
import { Icon } from '../../components/ui/Icon'
import { EmptyState, MoreMenu, Pill } from '../../components/ui/kit'
import { Avatar } from '../../components/ui/Avatar'
import { Modal } from '../../components/ui/Modal'
import { Andon, EnsoSpinner } from '../../components/art/Ink'
import { ChipSelect, Stars, TierPill } from '../../components/creators/CreatorBits'
import { AddToShortlist } from '../../components/creators/AddToShortlist'
import { NicheEditor } from './NicheEditor'
import { FormError, FormNote } from '../auth/AuthLayout'

type View = 'table' | 'cards'
type SortKey = 'name' | 'max_followers' | 'rating' | 'rate' | 'campaigns_count' | 'updated_at'
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d } catch { return d } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

export function CreatorsTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => `relative px-4 h-11 inline-flex items-center text-sm ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`
  return (
    <nav aria-label="Creators sections" className="flex gap-1 border-b border-line/25">
      <NavLink to="/creators" end className={cls}>{({ isActive }) => <>All creators{isActive && <span className="absolute left-3 right-3 -bottom-px h-[2px] bg-accent rounded-full" />}</>}</NavLink>
      <NavLink to="/creators/shortlists" className={cls}>{({ isActive }) => <>Shortlists{isActive && <span className="absolute left-3 right-3 -bottom-px h-[2px] bg-accent rounded-full" />}</>}</NavLink>
    </nav>
  )
}

export function CreatorsHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow mb-2"><span lang="ja" className="font-mincho text-accent-ink normal-case tracking-normal text-sm mr-2">人</span>Creator database</p>
        <h1 className="font-mincho text-3xl text-ink">{title}</h1>
      </div>
      {children}
    </header>
  )
}

export function CreatorsPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const archived = params.get('archived') === '1'
  const batch = params.get('batch')
  const { data, loading, error } = useAsync(() => creatorsApi.list(archived), [archived])
  const views = useAsync(() => creatorsApi.views(), [])
  const nicheList = useAsync(() => creatorsApi.niches(), [])

  const [f, setF] = useState<CreatorFilters>(() => ({ ...EMPTY_FILTERS, ...read('smog.creators.filters', {}) }))
  const [activeView, setActiveView] = useState<string | null>(null)
  const [view, setViewS] = useState<View>(() => read('smog.creators.view', 'table'))
  const [showFilters, setShowFilters] = useState(() => read('smog.creators.panel', true))
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'max_followers', dir: -1 })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<'shortlist' | 'saveView' | 'niches' | null>(null)
  const [note, setNote] = useState<ReactNode>(null)

  const setFilters = (next: CreatorFilters) => { setF(next); write('smog.creators.filters', next); setActiveView(null) }
  const patch = (p: Partial<CreatorFilters>) => setFilters({ ...f, ...p })
  const setView = (v: View) => { setViewS(v); write('smog.creators.view', v) }

  const all = useMemo(() => (data ?? []).filter(c => !batch || c.import_batch_id === batch), [data, batch])
  const rateKey = `rate_${f.rateType}` as const
  const rows = useMemo(() => applyCreatorFilters(all, f).sort((a, b) => {
    const pick = (c: CreatorOverview) => sort.key === 'rate' ? c[rateKey] : c[sort.key]
    const x = pick(a), y = pick(b)
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return (typeof x === 'number' ? (x as number) - (y as number) : String(x).localeCompare(String(y))) * sort.dir
  }), [all, f, sort, rateKey])

  const cities = useMemo(() => [...new Set((data ?? []).map(c => c.city).filter(Boolean) as string[])].sort(), [data])
  const languages = useMemo(() => [...new Set((data ?? []).flatMap(c => c.languages))].sort(), [data])
  const nicheNames = (nicheList.data ?? []).map(n => n.name)
  const hiddenBlacklisted = all.filter(c => c.is_blacklisted).length
  const nFilters = activeFilterCount(f)

  const columns: CsvColumn<CreatorOverview>[] = [
    { header: 'Name', value: c => c.name }, { header: 'City', value: c => c.city }, { header: 'State', value: c => c.state },
    { header: 'Languages', value: c => c.languages.join('; ') }, { header: 'Niches', value: c => c.niches.join('; ') },
    { header: 'Tier', value: c => c.tier ? TIER_LABEL[c.tier] : '' }, { header: 'Biggest platform', value: c => c.top_platform ? PLATFORM_LABEL[c.top_platform] : '' },
    { header: 'Handle', value: c => c.top_handle }, { header: 'Followers', value: c => c.max_followers }, { header: 'Avg views', value: c => c.top_avg_views },
    { header: 'Engagement %', value: c => c.top_engagement_rate }, { header: 'Phone', value: c => c.phone }, { header: 'Email', value: c => c.email },
    { header: 'Agency', value: c => c.manager_agency },
    ...RATE_TYPES.map(t => ({ header: `${RATE_LABEL[t]} rate (INR)`, value: (c: CreatorOverview) => c[`rate_${t}`] })),
    { header: 'Rating', value: c => c.rating }, { header: 'Would work again', value: c => c.would_work_again == null ? '' : c.would_work_again ? 'Yes' : 'No' },
    { header: 'Blacklisted', value: c => c.is_blacklisted ? `Yes — ${c.blacklist_reason}` : '' }, { header: 'Campaigns', value: c => c.campaigns_count },
  ]
  const exportRows = (list: CreatorOverview[]) => downloadCSV(`creators-${istToday()}.csv`, list, columns)
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allShownSelected = rows.length > 0 && rows.every(r => selected.has(r.id))

  const applyView = (v: SavedView) => { setF({ ...EMPTY_FILTERS, ...v.query }); write('smog.creators.filters', { ...EMPTY_FILTERS, ...v.query }); setActiveView(v.id); setShowFilters(true) }

  const SortBtn = ({ k, children, right }: { k: SortKey; children: ReactNode; right?: boolean }) => (
    <button onClick={() => setSort(s => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === 'name' ? 1 : -1 }))}
      className={`inline-flex items-center gap-1 hover:text-ink ${right ? 'flex-row-reverse' : ''} ${sort.key === k ? 'text-ink' : ''}`}>
      {children}{sort.key === k && <Icon name={sort.dir === 1 ? 'arrowUp' : 'arrowDown'} className="text-xs" />}
    </button>
  )

  return (
    <div className="space-y-6">
      <CreatorsHeader title={archived ? 'Archived creators' : 'Creators'}>
        <div className="flex items-center gap-1">
          <button className="btn-primary" onClick={() => nav('/creators/new')}><Icon name="plus" /> Add creator</button>
          <MoreMenu items={[
            { label: 'Import from CSV', onSelect: () => nav('/creators/import') },
            { label: 'Edit niche list', onSelect: () => setModal('niches') },
            { label: 'Export shown creators (CSV)', onSelect: () => exportRows(rows) },
            archived ? { label: 'Show active creators', onSelect: () => { params.delete('archived'); setParams(params) } }
                     : { label: 'Show archived creators', onSelect: () => { params.set('archived', '1'); setParams(params) } },
          ]} />
        </div>
      </CreatorsHeader>
      <CreatorsTabs />

      {batch && <FormNote>Showing the creators from one import. <button className="underline underline-offset-4" onClick={() => { params.delete('batch'); setParams(params) }}>Show everyone</button></FormNote>}
      {note && <FormNote>{note}</FormNote>}

      {/* saved views */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted mr-1">Saved views</span>
        {(views.data ?? []).map(v => (
          <span key={v.id} className={`pill pr-1 py-1 text-xs ${activeView === v.id ? 'bg-accent text-sumi' : 'border border-line/40 text-ink'}`}>
            <button onClick={() => applyView(v)} className="pl-1.5">{v.name}{v.is_shared ? '' : ' · just me'}</button>
            <button aria-label={`Delete view ${v.name}`} className="w-5 h-5 grid place-items-center rounded-full hover:bg-raised/60"
              onClick={async () => { if (confirm(`Delete the saved view “${v.name}”?`)) { await creatorsApi.deleteView(v.id); views.reload() } }}><Icon name="close" className="text-[10px]" /></button>
          </span>
        ))}
        {(views.data ?? []).length === 0 && <span className="text-xs text-muted">None yet.</span>}
        <button className="text-xs text-muted hover:text-ink underline underline-offset-4 disabled:opacity-40 disabled:no-underline" disabled={nFilters === 0 && !f.q}
          onClick={() => setModal('saveView')}>Save current filters as a view</button>
      </div>

      {/* search + filters */}
      <div className="shoji p-3 sm:p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <label className="relative flex-1 min-w-0">
            <span className="sr-only">Search creators</span>
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input className="field pl-9" placeholder="Search name, @handle, city, agency" value={f.q} onChange={e => patch({ q: e.target.value })} />
          </label>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1 sm:flex-none justify-center" aria-expanded={showFilters} aria-controls="creator-filters"
              onClick={() => { setShowFilters(!showFilters); write('smog.creators.panel', !showFilters) }}>
              <Icon name="filter" /> Filters{nFilters ? ` · ${nFilters}` : ''}
            </button>
            <div role="tablist" aria-label="View" className="inline-flex rounded-shoji border border-line/30 p-0.5">
              {(['table', 'cards'] as View[]).map(v => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                  className={`px-3 h-9 rounded-[5px] text-sm ${view === v ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>{v === 'table' ? 'Table' : 'Cards'}</button>
              ))}
            </div>
          </div>
        </div>

        {showFilters && (
          <div id="creator-filters" className="grid gap-4 lg:grid-cols-12 pt-1">
            <div className="lg:col-span-12">
              <p className="text-xs text-muted mb-2">Niche (all selected must match)</p>
              <ChipSelect label="Niches" options={nicheNames} value={f.niches} onChange={niches => patch({ niches })} />
            </div>
            <div className="lg:col-span-5">
              <p className="text-xs text-muted mb-2">Tier (biggest platform)</p>
              <ChipSelect label="Tiers" options={TIERS} value={f.tiers} onChange={tiers => patch({ tiers: tiers as Tier[] })} getLabel={t => `${TIER_LABEL[t as Tier]} · ${TIER_RANGE[t as Tier]}`} />
            </div>
            <label className="lg:col-span-2 text-xs text-muted">City
              <select className="field mt-1.5" value={f.city} onChange={e => patch({ city: e.target.value })}><option value="">Any</option>{cities.map(c => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="lg:col-span-2 text-xs text-muted">Language
              <select className="field mt-1.5" value={f.language} onChange={e => patch({ language: e.target.value })}><option value="">Any</option>{languages.map(c => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="lg:col-span-3 text-xs text-muted">Platform
              <select className="field mt-1.5" value={f.platform} onChange={e => patch({ platform: e.target.value })}><option value="">Any</option>{PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select>
            </label>
            <fieldset className="lg:col-span-4">
              <legend className="text-xs text-muted">Followers (biggest platform) — e.g. 10K, 1.5L, 1M</legend>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <input className="field num" aria-label="Minimum followers" placeholder="From" value={f.followersMin} onChange={e => patch({ followersMin: e.target.value })} />
                <input className="field num" aria-label="Maximum followers" placeholder="To" value={f.followersMax} onChange={e => patch({ followersMax: e.target.value })} />
              </div>
            </fieldset>
            <fieldset className="lg:col-span-5">
              <legend className="text-xs text-muted">Rate (₹)</legend>
              <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-2 mt-1.5">
                <select className="field" aria-label="Rate for" value={f.rateType} onChange={e => patch({ rateType: e.target.value as DeliverableType })}>
                  {RATE_TYPES.map(t => <option key={t} value={t}>{RATE_LABEL[t]}</option>)}
                </select>
                <input className="field num" aria-label="Minimum rate" placeholder="From" value={f.rateMin} onChange={e => patch({ rateMin: e.target.value })} />
                <input className="field num" aria-label="Maximum rate" placeholder="To" value={f.rateMax} onChange={e => patch({ rateMax: e.target.value })} />
              </div>
            </fieldset>
            <div className="lg:col-span-3">
              <p className="text-xs text-muted mb-1.5">Minimum rating</p>
              <Stars value={f.minRating || null} onChange={v => patch({ minRating: v ?? 0 })} size={20} label="Minimum rating" />
            </div>
            <div className="lg:col-span-12 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="accent-[#E3793A]" checked={f.showBlacklisted} onChange={e => patch({ showBlacklisted: e.target.checked })} />
                Include blacklisted{hiddenBlacklisted ? ` (${hiddenBlacklisted})` : ''}</label>
              {(nFilters > 0 || f.q) && <button className="text-sm text-muted hover:text-ink underline underline-offset-4" onClick={() => setFilters(EMPTY_FILTERS)}>Clear all filters</button>}
            </div>
          </div>
        )}
      </div>

      {/* selection bar */}
      {selected.size > 0 && (
        <div className="sticky top-[4.5rem] z-20 shoji bg-raised px-4 py-2.5 flex flex-wrap items-center gap-2 shadow-lg shadow-black/20" role="region" aria-label="Selected creators">
          <span className="text-sm text-ink mr-auto">{selected.size} selected</span>
          <button className="btn-primary h-9" onClick={() => setModal('shortlist')}><Icon name="plus" /> Add to shortlist</button>
          <button className="btn-ghost h-9" onClick={() => exportRows(all.filter(c => selected.has(c.id)))}><Icon name="download" /> Export</button>
          <button className="btn-ghost h-9" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <p className="text-sm text-muted num" aria-live="polite">{rows.length} of {all.length} creator{all.length === 1 ? '' : 's'}</p>
      {error && <FormError>{error}</FormError>}
      {loading && !data ? <div className="py-16 grid place-items-center"><EnsoSpinner size={44} label="Loading creators" /></div>
      : all.length === 0 ? (
        <div className="shoji"><EmptyState sketch="koi" line={archived ? 'Nothing archived.' : 'Still water. Add your first creator.'}
          action={!archived && <div className="flex gap-2"><button className="btn-primary" onClick={() => nav('/creators/new')}><Icon name="plus" /> Add creator</button><Link className="btn-ghost" to="/creators/import">Import CSV</Link></div>} /></div>
      ) : rows.length === 0 ? (
        <div className="shoji"><EmptyState sketch="koi" line="Nobody matches — try a wider net." /></div>
      ) : view === 'table' ? (
        <div className="shoji overflow-x-auto">
          <table className="w-full text-sm min-w-[56rem]">
            <caption className="sr-only">Creators. Column headers sort the list.</caption>
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line/25">
                <th scope="col" className="pl-4 pr-1 py-3.5 w-8"><input type="checkbox" aria-label="Select all shown" className="accent-[#E3793A]" checked={allShownSelected}
                  onChange={() => setSelected(s => { const n = new Set(s); rows.forEach(r => allShownSelected ? n.delete(r.id) : n.add(r.id)); return n })} /></th>
                <th scope="col" className="px-3 py-3.5 font-normal"><SortBtn k="name">Creator</SortBtn></th>
                <th scope="col" className="px-3 py-3.5 font-normal">Tier</th>
                <th scope="col" className="px-3 py-3.5 font-normal text-right"><SortBtn k="max_followers" right>Biggest platform</SortBtn></th>
                <th scope="col" className="px-3 py-3.5 font-normal text-right">Avg views · ER</th>
                <th scope="col" className="px-3 py-3.5 font-normal text-right"><SortBtn k="rate" right>{`${RATE_LABEL[f.rateType]} rate`}</SortBtn></th>
                <th scope="col" className="px-3 py-3.5 font-normal"><SortBtn k="rating">Rating</SortBtn></th>
                <th scope="col" className="pr-5 pl-3 py-3.5 font-normal text-right"><SortBtn k="campaigns_count" right>Campaigns</SortBtn></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/15">
              {rows.map(c => (
                <tr key={c.id} className={`group hover:bg-raised/60 transition-colors duration-calm ${selected.has(c.id) ? 'bg-raised/40' : ''}`}>
                  <td className="pl-4 pr-1 py-3"><input type="checkbox" aria-label={`Select ${c.name}`} className="accent-[#E3793A]" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.name} path={c.photo_path} size={36} />
                      <div className="min-w-0">
                        <Link to={`/creators/${c.id}`} className="text-ink font-medium hover:underline underline-offset-4 decoration-kaki">{c.name}</Link>
                        <p className="text-xs text-muted mt-0.5">{[c.city, c.languages.join(', ')].filter(Boolean).join(' · ')}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.is_blacklisted && <Pill tone="alert"><Andon size={12} /> Blacklisted</Pill>}
                          {c.niches.slice(0, 3).map(n => <span key={n} className="text-[11px] text-muted border border-line/30 rounded-full px-2 py-px">{n}</span>)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3"><TierPill tier={c.tier} /></td>
                  <td className="px-3 py-3 text-right num">
                    {c.top_platform ? <><span className="text-ink">{formatCount(c.max_followers)}</span><span className="block text-xs text-muted">{PLATFORM_LABEL[c.top_platform]} @{c.top_handle}</span></> : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right num text-muted">{formatCount(c.top_avg_views)}{c.top_engagement_rate != null && <span className="block text-xs">{c.top_engagement_rate}% ER</span>}</td>
                  <td className="px-3 py-3 text-right num">{c[rateKey] != null ? <span className="text-ink">{formatINR(c[rateKey])}</span> : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-3"><Stars value={c.rating} size={13} />{c.would_work_again === false && <span className="block text-[11px] text-muted mt-0.5">Wouldn’t rehire</span>}</td>
                  <td className="pr-5 pl-3 py-3 text-right num text-muted">{c.campaigns_count}{c.last_campaign_on && <span className="block text-[11px]">last {formatDate(c.last_campaign_on)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(c => (
            <li key={c.id} className={`shoji p-5 relative ${selected.has(c.id) ? 'border-accent' : ''}`}>
              <input type="checkbox" aria-label={`Select ${c.name}`} className="accent-[#E3793A] absolute top-4 right-4 w-4 h-4" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
              <Link to={`/creators/${c.id}`} className="flex items-start gap-3 pr-6 group">
                <Avatar name={c.name} path={c.photo_path} size={48} />
                <div className="min-w-0">
                  <p className="text-ink font-medium group-hover:underline underline-offset-4">{c.name}</p>
                  <p className="text-xs text-muted mt-0.5">{[c.city, c.languages.join(', ')].filter(Boolean).join(' · ')}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2"><TierPill tier={c.tier} />{c.is_blacklisted && <Pill tone="alert">Blacklisted</Pill>}</div>
                </div>
              </Link>
              <div className="flex flex-wrap gap-1 mt-3">{c.niches.map(n => <span key={n} className="text-[11px] text-muted border border-line/30 rounded-full px-2 py-px">{n}</span>)}</div>
              <dl className="grid grid-cols-3 gap-2 mt-4 text-xs">
                <div><dt className="text-muted">{c.top_platform ? PLATFORM_LABEL[c.top_platform] : 'Followers'}</dt><dd className="text-ink num text-sm mt-0.5">{formatCount(c.max_followers)}</dd></div>
                <div><dt className="text-muted">Avg views</dt><dd className="text-ink num text-sm mt-0.5">{formatCount(c.top_avg_views)}</dd></div>
                <div className="text-right"><dt className="text-muted">{RATE_LABEL[f.rateType]}</dt><dd className="text-ink num text-sm mt-0.5">{c[rateKey] != null ? formatINR(c[rateKey]) : '—'}</dd></div>
              </dl>
              <div className="mt-3"><Stars value={c.rating} size={13} /></div>
            </li>
          ))}
        </ul>
      )}

      {modal === 'shortlist' && <AddToShortlist creatorIds={[...selected]} onClose={() => setModal(null)}
        onDone={(id, name) => { setModal(null); setSelected(new Set()); setNote(<>Added to <Link className="underline underline-offset-4" to={`/creators/shortlists/${id}`}>{name}</Link>.</>) }} />}
      {modal === 'saveView' && <SaveViewModal filters={f} onClose={() => setModal(null)} onSaved={id => { setModal(null); views.reload().then(() => setActiveView(id)) }} />}
      {modal === 'niches' && <NicheEditor onClose={() => { setModal(null); nicheList.reload() }} />}
    </div>
  )
}

function SaveViewModal({ filters, onClose, onSaved }: { filters: CreatorFilters; onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = useState('')
  const [shared, setShared] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const parts = [filters.city, filters.niches.join(' + '), filters.tiers.map(t => TIER_LABEL[t]).join('/')].filter(Boolean)
  return (
    <Modal title="Save this view" onClose={onClose}>
      <form className="space-y-4" onSubmit={async e => {
        e.preventDefault(); if (!name.trim()) { setError('Give the view a name.'); return }
        try { onSaved(await creatorsApi.saveView(name, filters, shared)) } catch (err) { setError(err instanceof Error ? err.message : 'Could not save') }
      }}>
        {error && <FormError>{error}</FormError>}
        <label className="block text-sm text-muted">Name<input className="field mt-1.5" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder={parts.length ? `${parts.join(' ')} creators` : 'e.g. Ranchi food micro creators'} /></label>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="accent-[#E3793A]" checked={shared} onChange={e => setShared(e.target.checked)} /> Share with the team</label>
        <p className="text-xs text-muted">Saves the search, every filter and the rate type. Opening the view later re-applies them.</p>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary">Save view</button></div>
      </form>
    </Modal>
  )
}
