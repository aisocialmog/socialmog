import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { brandsApi, type BrandOverview } from '../../data/brands'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { isStaff } from '../../lib/access'
import { BRAND_STATUSES, ENGAGEMENTS, ENGAGEMENT_LABEL, ENGAGEMENT_SHORT, STATUS_LABEL, STATUS_TONE, type BrandStatus, type EngagementType } from '../../lib/brands'
import { formatDate, formatINR, istToday } from '../../lib/format'
import { downloadCSV, type CsvColumn } from '../../lib/csv'
import { Icon } from '../../components/ui/Icon'
import { EmptyState, MoreMenu, Pill } from '../../components/ui/kit'
import { Avatar } from '../../components/ui/Avatar'
import { BrushDivider, EnsoSpinner } from '../../components/art/Ink'
import { BrandLogo, RenewalWarning } from '../../components/brands/BrandBits'
import { FormError } from '../auth/AuthLayout'
import { BrandPipeline } from './BrandPipeline'

type View = 'table' | 'cards' | 'pipeline'
type SortKey = 'name' | 'lifetime_revenue' | 'outstanding' | 'active_campaigns' | 'updated_at'

const readView = (): View => { try { return (localStorage.getItem('smog.brands.view') as View) || 'table' } catch { return 'table' } }

export function BrandsPage() {
  const nav = useNavigate()
  const { role } = useAuth()
  const money = isStaff(role)
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) || readView()
  const archived = params.get('archived') === '1'
  const setView = (v: View) => { try { localStorage.setItem('smog.brands.view', v) } catch { /* ignore */ } params.set('view', v); setParams(params, { replace: true }) }

  const { data, error, loading, reload, setData } = useAsync(() => brandsApi.list(archived), [archived])
  const owners = useAsync(() => brandsApi.owners(), [])

  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | BrandStatus>('all')
  const [eng, setEng] = useState<'all' | EngagementType>('all')
  const [owner, setOwner] = useState('all')
  const [renewalsOnly, setRenewalsOnly] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data ?? [])
      .filter(b => view === 'pipeline' || status === 'all' || b.status === status)
      .filter(b => eng === 'all' || b.engagement_type === eng)
      .filter(b => owner === 'all' || (owner === 'none' ? !b.owner_id : b.owner_id === owner))
      .filter(b => !renewalsOnly || b.renewal_warning)
      .filter(b => !needle || [b.name, b.billing_name, b.industry, b.city, b.primary_contact_name, b.instagram_handle]
        .some(x => x?.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const x = a[sort.key], y = b[sort.key]
        return (typeof x === 'number' ? x - (y as number) : String(x ?? '').localeCompare(String(y ?? ''))) * sort.dir
      })
  }, [data, q, status, eng, owner, renewalsOnly, sort, view])

  const totals = rows.reduce((t, r) => ({ rev: t.rev + Number(r.lifetime_revenue), out: t.out + Number(r.outstanding) }), { rev: 0, out: 0 })
  const renewals = (data ?? []).filter(b => b.renewal_warning).length
  const filtersOn = (view !== 'pipeline' && status !== 'all') || eng !== 'all' || owner !== 'all' || renewalsOnly || q !== ''

  const columns: CsvColumn<BrandOverview>[] = [
    { header: 'Brand', value: r => r.name }, { header: 'Billing name', value: r => r.billing_name },
    { header: 'Status', value: r => STATUS_LABEL[r.status] }, { header: 'Engagement', value: r => ENGAGEMENT_LABEL[r.engagement_type] },
    { header: 'Owner', value: r => r.owner_name }, { header: 'Industry', value: r => r.industry }, { header: 'City', value: r => r.city },
    { header: 'Lead source', value: r => r.source }, { header: 'Primary contact', value: r => r.primary_contact_name },
    { header: 'Contact email', value: r => r.primary_contact_email }, { header: 'Contact phone', value: r => r.primary_contact_phone },
    { header: 'GSTIN', value: r => r.gstin }, { header: 'Website', value: r => r.website }, { header: 'Instagram', value: r => r.instagram_handle },
    { header: 'Active campaigns', value: r => r.active_campaigns },
    ...(money ? [
      { header: 'Lifetime revenue (INR)', value: (r: BrandOverview) => r.lifetime_revenue },
      { header: 'Outstanding (INR)', value: (r: BrandOverview) => r.outstanding },
      { header: 'Retainer / month (INR)', value: (r: BrandOverview) => r.monthly_fee },
      { header: 'Renewal date', value: (r: BrandOverview) => r.renewal_date ? formatDate(r.renewal_date) : '' },
    ] : []),
  ]
  const exportCsv = () => downloadCSV(`brands-${archived ? 'archived-' : ''}${istToday()}.csv`, rows, columns)

  const SortBtn = ({ k, children, right }: { k: SortKey; children: string; right?: boolean }) => (
    <button onClick={() => setSort(s => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === 'name' ? 1 : -1 }))}
      className={`inline-flex items-center gap-1 hover:text-ink ${right ? 'flex-row-reverse' : ''} ${sort.key === k ? 'text-ink' : ''}`}>
      {children}{sort.key === k && <Icon name={sort.dir === 1 ? 'arrowUp' : 'arrowDown'} className="text-xs" />}
    </button>
  )
  const ariaSort = (k: SortKey) => sort.key === k ? (sort.dir === 1 ? 'ascending' as const : 'descending' as const) : 'none' as const

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2"><span lang="ja" className="font-mincho text-accent-ink normal-case tracking-normal text-sm mr-2">商</span>Brands &amp; clients</p>
          <h1 className="font-mincho text-3xl text-ink">{archived ? 'Archived brands' : 'Brands'}</h1>
          <p className="text-sm text-muted mt-1 num">
            {rows.length} of {data?.length ?? 0}
            {money && <> · lifetime revenue {formatINR(totals.rev)} · outstanding {formatINR(totals.out)}</>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-primary" onClick={() => nav('/brands/new')}><Icon name="plus" /> Add brand</button>
          <MoreMenu items={[
            { label: 'Export to CSV', onSelect: exportCsv },
            archived ? { label: 'Show active brands', onSelect: () => { params.delete('archived'); setParams(params) } }
                     : { label: 'Show archived brands', onSelect: () => { params.set('archived', '1'); setParams(params) } },
          ]} />
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="View" className="inline-flex rounded-shoji border border-line/30 p-0.5 bg-card">
          {(['table', 'cards', 'pipeline'] as View[]).map(v => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`px-3.5 h-9 rounded-[5px] text-sm capitalize transition-colors duration-calm ${view === v ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>
              {v === 'pipeline' ? 'Pipeline' : v === 'cards' ? 'Cards' : 'Table'}
            </button>
          ))}
        </div>
        {renewals > 0 && (
          <button onClick={() => setRenewalsOnly(r => !r)} aria-pressed={renewalsOnly}
            className={`pill py-1.5 px-3 text-sm ${renewalsOnly ? 'bg-alert text-kinari' : 'border border-akane/70 text-ink'}`}>
            <span className={`w-2 h-2 rounded-full ${renewalsOnly ? 'bg-kinari' : 'bg-akane'}`} aria-hidden />
            {renewals} retainer renewal{renewals > 1 ? 's' : ''} within 15 days
          </button>
        )}
      </div>

      <div className="shoji p-3 sm:p-4 flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="flex gap-2 flex-1 min-w-0">
          <label className="relative flex-1 min-w-0">
            <span className="sr-only">Search brands</span>
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input className="field pl-9" placeholder="Search name, industry, city, contact" value={q} onChange={e => setQ(e.target.value)} />
          </label>
          <button className="btn-ghost lg:hidden shrink-0" aria-expanded={showFilters} aria-controls="brand-filters" onClick={() => setShowFilters(v => !v)}>
            <Icon name="filter" /> Filters{filtersOn ? ' ·' : ''}
          </button>
        </div>
        <div id="brand-filters" className={`${showFilters ? 'grid' : 'hidden'} lg:flex grid-cols-2 sm:grid-cols-3 gap-2`}>
          {view !== 'pipeline' && <>
            <label className="sr-only" htmlFor="f-status">Status</label>
            <select id="f-status" className="field lg:w-36" value={status} onChange={e => setStatus(e.target.value as typeof status)}>
              <option value="all">All statuses</option>{BRAND_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </>}
          <label className="sr-only" htmlFor="f-eng">Engagement type</label>
          <select id="f-eng" className="field lg:w-48" value={eng} onChange={e => setEng(e.target.value as typeof eng)}>
            <option value="all">Any engagement</option>{ENGAGEMENTS.map(x => <option key={x} value={x}>{ENGAGEMENT_LABEL[x]}</option>)}
          </select>
          <label className="sr-only" htmlFor="f-owner">Owner</label>
          <select id="f-owner" className="field lg:w-44 col-span-2 sm:col-span-1" value={owner} onChange={e => setOwner(e.target.value)}>
            <option value="all">Any owner</option><option value="none">No owner</option>
            {owners.data?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {view === 'cards' && <>
            <label className="sr-only" htmlFor="f-sort">Sort</label>
            <select id="f-sort" className="field lg:w-48 col-span-2 sm:col-span-1" value={`${sort.key}:${sort.dir}`}
              onChange={e => { const [k, d] = e.target.value.split(':'); setSort({ key: k as SortKey, dir: Number(d) as 1 | -1 }) }}>
              <option value="name:1">Name A–Z</option><option value="updated_at:-1">Recently updated</option>
              {money && <><option value="lifetime_revenue:-1">Highest revenue</option><option value="outstanding:-1">Most outstanding</option></>}
              <option value="active_campaigns:-1">Most active campaigns</option>
            </select>
          </>}
        </div>
        <button className="btn-ghost justify-center hidden lg:inline-flex" onClick={exportCsv}><Icon name="download" /> CSV</button>
      </div>
      {filtersOn && (
        <div className="flex items-center gap-3 text-sm text-muted -mt-2">
          <Icon name="filter" /> Filtered
          <button className="underline underline-offset-4 hover:text-ink" onClick={() => { setQ(''); setStatus('all'); setEng('all'); setOwner('all'); setRenewalsOnly(false) }}>Clear</button>
        </div>
      )}

      {error && <FormError>{error}</FormError>}
      {loading && !data ? <div className="py-16 grid place-items-center"><EnsoSpinner size={44} label="Loading brands" /></div>
      : (data ?? []).length === 0 ? (
        <div className="shoji"><EmptyState line={archived ? 'Nothing archived.' : 'Still water. Add your first brand.'}
          action={!archived && <button className="btn-primary" onClick={() => nav('/brands/new')}><Icon name="plus" /> Add brand</button>} /></div>
      ) : view === 'pipeline' ? (
        <BrandPipeline brands={rows} money={money}
          onMove={async (id, to) => {
            const prev = data
            setData(d => d && d.map(b => b.id === id ? { ...b, status: to } : b))
            try { await brandsApi.setStatus(id, to) } catch (e) { setData(prev); throw e }
            reload()
          }} />
      ) : rows.length === 0 ? (
        <div className="shoji"><EmptyState sketch="koi" line="Nothing matches — try a wider net." /></div>
      ) : <>
        {view === 'table' && (
          <div className="hidden md:block shoji overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Brands. Column headers sort the list.</caption>
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line/25">
                  <th scope="col" aria-sort={ariaSort('name')} className="px-5 py-3.5 font-normal"><SortBtn k="name">Brand</SortBtn></th>
                  <th scope="col" className="px-3 py-3.5 font-normal">Status</th>
                  <th scope="col" className="px-3 py-3.5 font-normal hidden xl:table-cell">Owner</th>
                  {money && <th scope="col" aria-sort={ariaSort('lifetime_revenue')} className="px-3 py-3.5 font-normal text-right"><SortBtn k="lifetime_revenue" right>Lifetime revenue</SortBtn></th>}
                  {money && <th scope="col" aria-sort={ariaSort('outstanding')} className="px-3 py-3.5 font-normal text-right"><SortBtn k="outstanding" right>Outstanding</SortBtn></th>}
                  <th scope="col" aria-sort={ariaSort('active_campaigns')} className="px-5 py-3.5 font-normal text-right"><SortBtn k="active_campaigns" right>Active campaigns</SortBtn></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/15">
                {rows.map(b => (
                  <tr key={b.id} className="group hover:bg-raised/60 transition-colors duration-calm cursor-pointer" onClick={() => nav(`/brands/${b.id}`)}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <BrandLogo name={b.name} path={b.logo_path} size={36} />
                        <div className="min-w-0">
                          <Link to={`/brands/${b.id}`} onClick={e => e.stopPropagation()} className="text-ink font-medium group-hover:underline underline-offset-4 decoration-kaki">{b.name}</Link>
                          <p className="text-xs text-muted mt-0.5">{[ENGAGEMENT_SHORT[b.engagement_type], b.industry, b.city].filter(Boolean).join(' · ')}</p>
                          {b.renewal_warning && <div className="mt-1.5"><RenewalWarning compact renewalDate={b.renewal_date} days={b.days_to_renewal} /></div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5"><Pill tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Pill></td>
                    <td className="px-3 py-3.5 hidden xl:table-cell">
                      {b.owner_name ? <span className="flex items-center gap-2 text-muted"><Avatar name={b.owner_name} path={b.owner_photo_path} size={24} />{b.owner_name}</span> : <span className="text-muted">—</span>}
                    </td>
                    {money && <td className="px-3 py-3.5 text-right num text-ink">{formatINR(b.lifetime_revenue)}</td>}
                    {money && <td className="px-3 py-3.5 text-right num">
                      {Number(b.outstanding) ? <span className="text-ink">{formatINR(b.outstanding)}</span> : <span className="text-muted">{formatINR(0)}</span>}
                      {Number(b.overdue) > 0 && <span className="block mt-1"><Pill tone="alert">{formatINR(b.overdue)} overdue</Pill></span>}
                    </td>}
                    <td className="px-5 py-3.5 text-right num">{b.active_campaigns > 0 ? <span className="text-ink">{b.active_campaigns}</span> : <span className="text-muted">0</span>}<span className="text-muted"> / {b.total_campaigns}</span></td>
                  </tr>
                ))}
              </tbody>
              {money && (
                <tfoot>
                  <tr className="border-t border-line/25">
                    <td className="px-5 py-3.5 text-muted" colSpan={2}>Total · {rows.length} brand{rows.length === 1 ? '' : 's'}</td>
                    <td className="hidden xl:table-cell" />
                    <td className="px-3 py-3.5 text-right num text-ink">{formatINR(totals.rev)}</td>
                    <td className="px-3 py-3.5 text-right num text-ink">{formatINR(totals.out)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        <ul className={`${view === 'table' ? 'md:hidden' : ''} grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-3`}>
          {rows.map(b => <li key={b.id}><BrandCard b={b} money={money} /></li>)}
        </ul>
      </>}
    </div>
  )
}

function BrandCard({ b, money }: { b: BrandOverview; money: boolean }) {
  return (
    <Link to={`/brands/${b.id}`} className="block shoji p-5 h-full hover:bg-raised/50 transition-colors duration-calm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <div className="flex items-start gap-3">
        <BrandLogo name={b.name} path={b.logo_path} size={44} />
        <div className="min-w-0 flex-1">
          <p className="text-ink font-medium truncate">{b.name}</p>
          <p className="text-xs text-muted mt-0.5 truncate">{[ENGAGEMENT_SHORT[b.engagement_type], b.industry, b.city].filter(Boolean).join(' · ')}</p>
        </div>
        <Pill tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Pill>
      </div>
      {b.renewal_warning && <div className="mt-3"><RenewalWarning compact renewalDate={b.renewal_date} days={b.days_to_renewal} /></div>}
      <BrushDivider className="my-4 opacity-70" />
      <dl className={`grid ${money ? 'grid-cols-3' : 'grid-cols-1'} gap-2 text-xs`}>
        {money && <div><dt className="text-muted">Revenue</dt><dd className="text-ink num text-sm mt-0.5">{formatINR(b.lifetime_revenue)}</dd></div>}
        {money && <div><dt className="text-muted">Outstanding</dt><dd className="text-ink num text-sm mt-0.5">{formatINR(b.outstanding)}</dd></div>}
        <div className={money ? 'text-right' : ''}><dt className="text-muted">Active campaigns</dt><dd className="text-ink num text-sm mt-0.5">{b.active_campaigns}</dd></div>
      </dl>
      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        {b.owner_name ? <span className="flex items-center gap-2"><Avatar name={b.owner_name} path={b.owner_photo_path} size={22} />{b.owner_name}</span> : <span>No owner</span>}
        {b.primary_contact_name && <span className="truncate ml-3">{b.primary_contact_name}</span>}
      </div>
    </Link>
  )
}
