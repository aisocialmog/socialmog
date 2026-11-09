import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { creatorsApi } from '../../data/creators'
import { useAsync } from '../../hooks/useAsync'
import { formatCount, PLATFORM_LABEL, RATE_LABEL, TIER_LABEL } from '../../lib/creators'
import { formatDate, formatINR, istToday } from '../../lib/format'
import { downloadCSV } from '../../lib/csv'
import { EmptyState, MoreMenu } from '../../components/ui/kit'
import { Icon } from '../../components/ui/Icon'
import { Avatar } from '../../components/ui/Avatar'
import { EnsoSpinner } from '../../components/art/Ink'
import { TierPill } from '../../components/creators/CreatorBits'
import { CreatorsHeader, CreatorsTabs } from './CreatorsPage'
import { FormError } from '../auth/AuthLayout'

const ENTRY_STATUS: Record<string, string> = { shortlisted: 'Shortlisted', proposed: 'Proposed to client', client_approved: 'Client approved', rejected: 'Rejected' }

export function ShortlistsPage() {
  const nav = useNavigate()
  const { data, loading } = useAsync(() => creatorsApi.shortlists(), [])
  return (
    <div className="space-y-6">
      <CreatorsHeader title="Shortlists" />
      <CreatorsTabs />
      <p className="text-sm text-muted">Pick creators in the list (tick the boxes), then “Add to shortlist”. Shortlists link to campaigns once Campaigns (feature 4) is built.</p>
      {loading ? <EnsoSpinner /> : !data?.length ? (
        <div className="shoji"><EmptyState sketch="branch" line="No shortlists yet." action={<button className="btn-primary" onClick={() => nav('/creators')}>Choose creators</button>} /></div>
      ) : (
        <ul className="grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map(s => (
            <li key={s.id}><Link to={`/creators/shortlists/${s.id}`} className="block shoji p-5 hover:bg-raised/50 h-full">
              <p className="text-ink font-medium">{s.name}</p>
              {s.notes && <p className="text-xs text-muted mt-1 line-clamp-2">{s.notes}</p>}
              <p className="text-xs text-muted mt-3 num">{s.count} creator{s.count === 1 ? '' : 's'} · started {formatDate(s.created_at)}</p>
            </Link></li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ShortlistDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const lists = useAsync(() => creatorsApi.shortlists(), [])
  const entries = useAsync(() => creatorsApi.shortlistEntries(id), [id])
  const people = useAsync(() => creatorsApi.byIds((entries.data ?? []).map(e => e.creator_id)), [entries.data])
  const [error, setError] = useState<string | null>(null)
  const list = lists.data?.find(l => l.id === id)
  const rows = useMemo(() => (entries.data ?? []).map(e => ({ e, c: people.data?.find(p => p.id === e.creator_id) })).filter(r => r.c), [entries.data, people.data])
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await entries.reload() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') } }

  if (lists.loading || entries.loading) return <div className="py-16 grid place-items-center"><EnsoSpinner size={44} /></div>
  if (!list) return <div className="shoji"><EmptyState sketch="koi" line="This shortlist isn’t here." action={<Link className="btn-ghost" to="/creators/shortlists">All shortlists</Link>} /></div>

  const totals = rows.reduce((t, { c }) => ({ followers: t.followers + (c!.max_followers ?? 0), reels: t.reels + Number(c!.rate_reel ?? 0) }), { followers: 0, reels: 0 })
  const exportCsv = () => downloadCSV(`shortlist-${list.name.replace(/\W+/g, '-')}-${istToday()}.csv`, rows, [
    { header: 'Creator', value: r => r.c!.name }, { header: 'Status', value: r => ENTRY_STATUS[r.e.status] }, { header: 'City', value: r => r.c!.city },
    { header: 'Niches', value: r => r.c!.niches.join('; ') }, { header: 'Tier', value: r => r.c!.tier ? TIER_LABEL[r.c!.tier] : '' },
    { header: 'Platform', value: r => r.c!.top_platform ? PLATFORM_LABEL[r.c!.top_platform] : '' }, { header: 'Handle', value: r => r.c!.top_handle },
    { header: 'Followers', value: r => r.c!.max_followers }, { header: 'Avg views', value: r => r.c!.top_avg_views }, { header: 'Engagement %', value: r => r.c!.top_engagement_rate },
    { header: `${RATE_LABEL.reel} rate (INR)`, value: r => r.c!.rate_reel }, { header: 'Note', value: r => r.e.note },
  ])

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5">
        <Link to="/creators/shortlists" className="hover:text-ink">Shortlists</Link><Icon name="chevronRight" className="text-xs" /><span className="text-ink truncate">{list.name}</span>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-mincho text-3xl text-ink">{list.name}</h1>
          <p className="text-sm text-muted mt-1 num">{rows.length} creators · combined reach {formatCount(totals.followers)} · reels at rate card {formatINR(totals.reels)}</p>
          {list.notes && <p className="text-sm text-muted mt-2 max-w-2xl">{list.notes}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-primary" onClick={() => nav('/creators')}><Icon name="plus" /> Add creators</button>
          <MoreMenu items={[
            { label: 'Export for the client (CSV)', onSelect: exportCsv },
            { label: 'Archive shortlist', danger: true, onSelect: async () => { if (confirm(`Archive “${list.name}”?`)) { await creatorsApi.archiveShortlist(list.id); nav('/creators/shortlists') } } },
          ]} />
        </div>
      </header>
      {error && <FormError>{error}</FormError>}
      {rows.length === 0 ? <div className="shoji"><EmptyState line="Empty for now." action={<button className="btn-primary" onClick={() => nav('/creators')}>Choose creators</button>} /></div> : (
        <ul className="shoji divide-y divide-line/15">
          {rows.map(({ e, c }) => (
            <li key={e.id} className="p-4 sm:px-5 flex flex-wrap items-center gap-x-4 gap-y-3">
              <Avatar name={c!.name} path={c!.photo_path} size={40} />
              <div className="min-w-0 flex-1 basis-48">
                <Link to={`/creators/${c!.id}`} className="text-ink hover:underline underline-offset-4">{c!.name}</Link>
                <p className="text-xs text-muted">{[c!.city, c!.niches.join(', ')].filter(Boolean).join(' · ')}</p>
              </div>
              <TierPill tier={c!.tier} />
              <p className="text-sm num text-right w-28"><span className="text-ink">{formatCount(c!.max_followers)}</span><span className="block text-xs text-muted">{c!.top_platform ? PLATFORM_LABEL[c!.top_platform] : ''}</span></p>
              <p className="text-sm num text-right w-24 text-ink">{c!.rate_reel != null ? formatINR(c!.rate_reel) : '—'}<span className="block text-xs text-muted">reel</span></p>
              <label className="sr-only" htmlFor={`st-${e.id}`}>Status for {c!.name}</label>
              <select id={`st-${e.id}`} className="field h-9 w-full sm:w-48" value={e.status} onChange={ev => run(() => creatorsApi.updateEntry(e.id, { status: ev.target.value }))}>
                {Object.entries(ENTRY_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button className="icon-btn" aria-label={`Remove ${c!.name} from the shortlist`} onClick={() => run(() => creatorsApi.removeEntry(e.id))}><Icon name="close" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
