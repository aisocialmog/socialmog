import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BrushDivider } from '../components/art/Ink'
import { EmptyState, MoreMenu, Pill, PreviewBadge, type Tone } from '../components/ui/kit'
import { Icon } from '../components/ui/Icon'
import { brands, F1, F2, type BrandRow, type BrandStatus } from '../demo/data'
import { downloadCSV, type CsvColumn } from '../lib/csv'
import { formatDate, formatINR, istToday } from '../lib/format'

export const STATUS_TONE: Record<BrandStatus, Tone> = { active: 'accent', pitching: 'warm', lead: 'quiet', paused: 'quiet', churned: 'quiet' }
const STATUS_LABEL: Record<BrandStatus, string> = { active: 'Active', pitching: 'Pitching', lead: 'Lead', paused: 'Paused', churned: 'Churned' }

type SortKey = 'name' | 'billed' | 'outstanding' | 'lastActivity'
const COLUMNS: CsvColumn<BrandRow>[] = [
  { header: 'Brand', value: r => r.name }, { header: 'Industry', value: r => r.industry },
  { header: 'Relationship', value: r => r.relationship }, { header: 'Status', value: r => r.status },
  { header: 'Owner', value: r => r.owner }, { header: 'City', value: r => r.city },
  { header: 'Billed (INR)', value: r => r.billed }, { header: 'Received (INR)', value: r => r.received },
  { header: 'Outstanding (INR)', value: r => r.outstanding }, { header: 'Overdue (INR)', value: r => r.overdue },
  { header: 'Campaigns', value: r => r.campaigns }, { header: 'Last activity', value: r => formatDate(r.lastActivity) },
]

export function BrandsList() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | BrandStatus>('all')
  const [rel, setRel] = useState<'all' | BrandRow['relationship']>('all')
  const [owner, setOwner] = useState<'all' | string>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'lastActivity', dir: -1 })

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return brands
      .filter(b => status === 'all' || b.status === status)
      .filter(b => rel === 'all' || b.relationship === rel || (rel !== 'both' && b.relationship === 'both'))
      .filter(b => owner === 'all' || b.owner === owner)
      .filter(b => !needle || [b.name, b.industry, b.city].some(x => x.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const x = a[sort.key], y = b[sort.key]
        return (typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y))) * sort.dir
      })
  }, [q, status, rel, owner, sort])

  const totals = rows.reduce((t, r) => ({ billed: t.billed + r.billed, outstanding: t.outstanding + r.outstanding, overdue: t.overdue + r.overdue }), { billed: 0, outstanding: 0, overdue: 0 })
  const active = (status !== 'all' ? 1 : 0) + (rel !== 'all' ? 1 : 0) + (owner !== 'all' ? 1 : 0)

  const SortBtn = ({ k, children, right }: { k: SortKey; children: string; right?: boolean }) => (
    <button onClick={() => setSort(s => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === 'name' ? 1 : -1 }))}
      className={`inline-flex items-center gap-1 hover:text-ink ${right ? 'flex-row-reverse' : ''} ${sort.key === k ? 'text-ink' : ''}`}
      aria-label={`Sort by ${children}`}>
      {children}{sort.key === k && <Icon name={sort.dir === 1 ? 'arrowUp' : 'arrowDown'} className="text-xs" />}
    </button>
  )
  const ariaSort = (k: SortKey) => sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2"><span lang="ja" className="font-mincho text-accent-ink normal-case tracking-normal text-sm mr-2">商</span>Brands &amp; clients</p>
          <h1 className="font-mincho text-3xl text-ink">Brands</h1>
          <p className="text-sm text-muted mt-1 num">{rows.length} of {brands.length} · billed {formatINR(totals.billed)} · outstanding {formatINR(totals.outstanding)}</p>
        </div>
        <div className="flex items-center gap-1">
          <PreviewBadge />
          <button className="btn-primary ml-2"><Icon name="plus" /> Add brand</button>
          <MoreMenu items={[
            { label: 'Export to CSV', onSelect: () => downloadCSV(`brands-${istToday()}.csv`, rows, COLUMNS) },
            { label: 'Import from file', onSelect: () => {} },
            { label: 'Show archived', onSelect: () => {} },
          ]} />
        </div>
      </header>

      <div className="shoji p-3 sm:p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <label className="relative flex-1 min-w-0">
          <span className="sr-only">Search brands</span>
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field pl-9" placeholder="Search by name, industry or city" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 md:flex gap-2">
          <label className="sr-only" htmlFor="f-status">Status</label>
          <select id="f-status" className="field md:w-36" value={status} onChange={e => setStatus(e.target.value as typeof status)}>
            <option value="all">All statuses</option>{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="sr-only" htmlFor="f-rel">Relationship</label>
          <select id="f-rel" className="field md:w-36" value={rel} onChange={e => setRel(e.target.value as typeof rel)}>
            <option value="all">All work</option><option value="project">Project</option><option value="retainer">Retainer</option><option value="both">Both</option>
          </select>
          <label className="sr-only" htmlFor="f-owner">Owner</label>
          <select id="f-owner" className="field col-span-2 md:col-span-1 md:w-44" value={owner} onChange={e => setOwner(e.target.value)}>
            <option value="all">Any owner</option><option value={F1}>{F1}</option><option value={F2}>{F2}</option>
          </select>
        </div>
        <button className="btn-ghost justify-center md:w-auto" onClick={() => downloadCSV(`brands-${istToday()}.csv`, rows, COLUMNS)}>
          <Icon name="download" /> CSV
        </button>
      </div>
      {active > 0 && (
        <div className="flex items-center gap-3 text-sm text-muted -mt-2">
          <Icon name="filter" /> {active} filter{active > 1 ? 's' : ''} on
          <button className="underline underline-offset-4 hover:text-ink" onClick={() => { setStatus('all'); setRel('all'); setOwner('all') }}>Clear</button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="shoji"><EmptyState sketch="koi" line="Still water. Nothing matches — try a wider net." /></div>
      ) : <>
        {/* desktop table */}
        <div className="hidden md:block shoji overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Brands, sortable by column</caption>
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line/25">
                <th scope="col" aria-sort={ariaSort('name')} className="px-5 py-3.5 font-normal"><SortBtn k="name">Brand</SortBtn></th>
                <th scope="col" className="px-3 py-3.5 font-normal">Status</th>
                <th scope="col" className="px-3 py-3.5 font-normal hidden xl:table-cell">Owner</th>
                <th scope="col" aria-sort={ariaSort('billed')} className="px-3 py-3.5 font-normal text-right"><SortBtn k="billed" right>Billed</SortBtn></th>
                <th scope="col" aria-sort={ariaSort('outstanding')} className="px-3 py-3.5 font-normal text-right"><SortBtn k="outstanding" right>Outstanding</SortBtn></th>
                <th scope="col" className="px-3 py-3.5 font-normal text-right">Campaigns</th>
                <th scope="col" aria-sort={ariaSort('lastActivity')} className="px-5 py-3.5 font-normal text-right"><SortBtn k="lastActivity" right>Last activity</SortBtn></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/15">
              {rows.map(b => (
                <tr key={b.id} className="group hover:bg-raised/60 transition-colors duration-calm cursor-pointer" onClick={() => nav(`/brands/${b.id}`)}>
                  <td className="px-5 py-4">
                    <Link to={`/brands/${b.id}`} className="text-ink font-medium group-hover:underline underline-offset-4 decoration-kaki" onClick={e => e.stopPropagation()}>{b.name}</Link>
                    <p className="text-xs text-muted mt-0.5">{b.industry} · {b.city} · {b.relationship === 'both' ? 'Project + retainer' : b.relationship === 'retainer' ? 'Retainer' : 'Project'}</p>
                  </td>
                  <td className="px-3 py-4"><Pill tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Pill></td>
                  <td className="px-3 py-4 text-muted hidden xl:table-cell">{b.owner}</td>
                  <td className="px-3 py-4 text-right num text-ink">{formatINR(b.billed)}</td>
                  <td className="px-3 py-4 text-right num">
                    {b.outstanding ? <span className="text-ink">{formatINR(b.outstanding)}</span> : <span className="text-muted">—</span>}
                    {b.overdue > 0 && <span className="block mt-1"><Pill tone="alert">{formatINR(b.overdue)} overdue</Pill></span>}
                  </td>
                  <td className="px-3 py-4 text-right num text-muted">{b.activeCampaigns > 0 ? <span className="text-ink">{b.activeCampaigns}</span> : '0'} / {b.campaigns}</td>
                  <td className="px-5 py-4 text-right text-muted num">{formatDate(b.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line/25 text-sm">
                <td className="px-5 py-3.5 text-muted" colSpan={2}>Total · {rows.length} brands</td>
                <td className="hidden xl:table-cell" />
                <td className="px-3 py-3.5 text-right num text-ink">{formatINR(totals.billed)}</td>
                <td className="px-3 py-3.5 text-right num text-ink">{formatINR(totals.outstanding)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* phone cards */}
        <ul className="md:hidden space-y-3">
          {rows.map(b => (
            <li key={b.id}>
              <Link to={`/brands/${b.id}`} className="block shoji p-4 active:bg-raised">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-ink font-medium">{b.name}</p><p className="text-xs text-muted mt-0.5">{b.industry} · {b.city}</p></div>
                  <Pill tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Pill>
                </div>
                <BrushDivider className="my-3 opacity-60" />
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><p className="text-muted">Billed</p><p className="text-ink num text-sm mt-0.5">{formatINR(b.billed)}</p></div>
                  <div><p className="text-muted">Outstanding</p><p className="text-ink num text-sm mt-0.5">{b.outstanding ? formatINR(b.outstanding) : '—'}</p></div>
                  <div className="text-right"><p className="text-muted">Updated</p><p className="text-ink num text-sm mt-0.5">{formatDate(b.lastActivity).slice(0, 6)}</p></div>
                </div>
                {b.overdue > 0 && <div className="mt-3"><Pill tone="alert">{formatINR(b.overdue)} overdue</Pill></div>}
              </Link>
            </li>
          ))}
        </ul>
      </>}
    </div>
  )
}
