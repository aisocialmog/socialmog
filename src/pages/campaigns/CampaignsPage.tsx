import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { campaignsApi, type CampaignSummary } from '../../data/campaigns'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { isStaff } from '../../lib/access'
import { CAMPAIGN_KINDS, CAMPAIGN_STATUSES, CAMPAIGN_STATUS_KANJI, CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE, KIND_LABEL, type CampaignKind, type CampaignStatus } from '../../lib/campaigns'
import { formatCount } from '../../lib/creators'
import { formatDate, formatINR, formatINRShort, istToday } from '../../lib/format'
import { downloadCSV } from '../../lib/csv'
import { Icon } from '../../components/ui/Icon'
import { EmptyState, MoreMenu, Pill } from '../../components/ui/kit'
import { Kanban } from '../../components/ui/Kanban'
import { Andon, EnsoSpinner } from '../../components/art/Ink'
import { BrandLogo } from '../../components/brands/BrandBits'
import { FormError } from '../auth/AuthLayout'

type View = 'table' | 'board'
const readView = (): View => { try { return (localStorage.getItem('smog.campaigns.view') as View) || 'table' } catch { return 'table' } }
const dates = (c: CampaignSummary) => c.start_date ? `${formatDate(c.start_date)}${c.end_date ? ` – ${formatDate(c.end_date)}` : ''}` : 'No dates yet'

export function CampaignsPage() {
  const nav = useNavigate()
  const { role } = useAuth()
  const money = isStaff(role)
  const [params, setParams] = useSearchParams()
  const archived = params.get('archived') === '1'
  const view = (params.get('view') as View) || readView()
  const setView = (v: View) => { try { localStorage.setItem('smog.campaigns.view', v) } catch { /* ignore */ } params.set('view', v); setParams(params, { replace: true }) }
  const { data, loading, error, setData, reload } = useAsync(() => campaignsApi.list(archived), [archived])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'open' | 'all' | CampaignStatus>('open')
  const [kind, setKind] = useState<'all' | CampaignKind>('all')
  const [brand, setBrand] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const brands = useMemo(() => [...new Map((data ?? []).map(c => [c.brand_id, c.brand_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data])
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (data ?? [])
      .filter(c => view === 'board' || status === 'all' || (status === 'open' ? !['completed', 'cancelled'].includes(c.status) : c.status === status))
      .filter(c => kind === 'all' || c.kind === kind).filter(c => brand === 'all' || c.brand_id === brand).filter(c => !overdueOnly || c.overdue > 0)
      .filter(c => !n || [c.name, c.brand_name, c.code, c.owner_name].some(x => x?.toLowerCase().includes(n)))
  }, [data, q, status, kind, brand, overdueOnly, view])
  const overdueTotal = (data ?? []).reduce((s, c) => s + c.overdue, 0)

  const exportCsv = () => downloadCSV(`campaigns-${istToday()}.csv`, rows, [
    { header: 'Campaign', value: c => c.name }, { header: 'Code', value: c => c.code }, { header: 'Brand', value: c => c.brand_name },
    { header: 'Type', value: c => KIND_LABEL[c.kind] }, { header: 'Status', value: c => CAMPAIGN_STATUS_LABEL[c.status] }, { header: 'Owner', value: c => c.owner_name },
    { header: 'Start', value: c => c.start_date ? formatDate(c.start_date) : '' }, { header: 'End', value: c => c.end_date ? formatDate(c.end_date) : '' },
    { header: 'Creators confirmed', value: c => c.confirmed_creators }, { header: 'Deliverables', value: c => c.deliverables }, { header: 'Posted', value: c => c.posted },
    { header: 'Overdue', value: c => c.overdue }, { header: 'Views', value: c => c.views }, { header: 'Engagement %', value: c => c.engagement_rate },
    ...(money ? [
      { header: 'Client budget (INR)', value: (c: CampaignSummary) => c.client_budget }, { header: 'Expected margin (INR)', value: (c: CampaignSummary) => c.expected_margin },
      { header: 'Actual creator spend (INR)', value: (c: CampaignSummary) => c.actual_creator_spend }, { header: 'Profit (INR)', value: (c: CampaignSummary) => c.profit },
    ] : []),
  ])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2"><span lang="ja" className="font-mincho text-accent-ink normal-case tracking-normal text-sm mr-2">陣</span>Campaigns</p>
          <h1 className="font-mincho text-3xl text-ink">{archived ? 'Archived campaigns' : 'Campaigns'}</h1>
          <p className="text-sm text-muted mt-1 num">{rows.length} shown{money && <> · client budgets {formatINR(rows.reduce((s, c) => s + Number(c.client_budget ?? 0), 0))}</>}</p>
        </div>
        <div className="flex items-center gap-1">
          {money && <button className="btn-primary" onClick={() => nav('/campaigns/new')}><Icon name="plus" /> New campaign</button>}
          <MoreMenu items={[{ label: 'Export to CSV', onSelect: exportCsv },
            archived ? { label: 'Show active campaigns', onSelect: () => { params.delete('archived'); setParams(params) } } : { label: 'Show archived campaigns', onSelect: () => { params.set('archived', '1'); setParams(params) } }]} />
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="View" className="inline-flex rounded-shoji border border-line/30 p-0.5 bg-card">
          {(['table', 'board'] as View[]).map(v => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`px-3.5 h-9 rounded-[5px] text-sm ${view === v ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>{v === 'table' ? 'List' : 'Board'}</button>)}
        </div>
        {overdueTotal > 0 && (
          <button onClick={() => setOverdueOnly(o => !o)} aria-pressed={overdueOnly}
            className={`pill py-1.5 px-3 text-sm ${overdueOnly ? 'bg-alert text-kinari' : 'border border-akane/70 text-ink'}`}>
            <Andon size={14} /> {overdueTotal} post{overdueTotal > 1 ? 's' : ''} past go-live, not posted
          </button>
        )}
      </div>

      <div className="shoji p-3 sm:p-4 flex flex-col lg:flex-row gap-3 lg:items-center">
        <label className="relative flex-1 min-w-0"><span className="sr-only">Search campaigns</span>
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input className="field pl-9" placeholder="Search campaign, brand, code, owner" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex gap-2">
          {view === 'table' && <><label className="sr-only" htmlFor="cf-status">Status</label>
            <select id="cf-status" className="field lg:w-44" value={status} onChange={e => setStatus(e.target.value as typeof status)}>
              <option value="open">Open campaigns</option><option value="all">All statuses</option>{CAMPAIGN_STATUSES.map(s => <option key={s} value={s}>{CAMPAIGN_STATUS_LABEL[s]}</option>)}
            </select></>}
          <label className="sr-only" htmlFor="cf-kind">Type</label>
          <select id="cf-kind" className="field lg:w-48" value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
            <option value="all">Any type</option>{CAMPAIGN_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <label className="sr-only" htmlFor="cf-brand">Brand</label>
          <select id="cf-brand" className="field lg:w-48 col-span-2 sm:col-span-1" value={brand} onChange={e => setBrand(e.target.value)}>
            <option value="all">Any brand</option>{brands.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      </div>

      {error && <FormError>{error}</FormError>}
      {loading && !data ? <div className="py-16 grid place-items-center"><EnsoSpinner size={44} label="Loading campaigns" /></div>
      : (data ?? []).length === 0 ? <div className="shoji"><EmptyState sketch="fuji" line={archived ? 'Nothing archived.' : 'A clear horizon. Start your first campaign.'}
          action={money && !archived && <button className="btn-primary" onClick={() => nav('/campaigns/new')}><Icon name="plus" /> New campaign</button>} /></div>
      : view === 'board' ? (
        <Kanban columns={CAMPAIGN_STATUSES.map(s => ({ key: s, label: CAMPAIGN_STATUS_LABEL[s], kanji: CAMPAIGN_STATUS_KANJI[s] }))}
          items={rows} getId={c => c.campaign_id} getColumn={c => c.status} getName={c => c.name}
          onOpen={c => nav(`/campaigns/${c.campaign_id}`)} hint="Drag a campaign to change its status — on a phone, drag by the grip."
          onMove={async (c, to) => {
            if (!money) throw new Error('only founders and managers can change campaign status')
            const prev = data; setData(d => d && d.map(x => x.campaign_id === c.campaign_id ? { ...x, status: to } : x))
            try { await campaignsApi.setStatus(c.campaign_id, to) } catch (e) { setData(prev); throw e }
            reload()
          }}
          columnMeta={(_, list) => `${list.length}${money && list.length ? ` · ${formatINRShort(list.reduce((s, c) => s + Number(c.client_budget ?? 0), 0))}` : ''}`}
          renderCard={(c, grip) => <>
            <div className="flex items-start gap-2.5 pr-6">
              <BrandLogo name={c.brand_name} path={c.brand_logo_path} size={30} />
              <div className="min-w-0"><p className="text-sm text-ink font-medium leading-snug break-words">{c.name}</p><p className="text-xs text-muted truncate">{c.brand_name}</p></div>
            </div>
            {c.overdue > 0 && <div className="mt-2.5"><Pill tone="alert"><Andon size={12} /> {c.overdue} overdue</Pill></div>}
            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted num">
              <span>{c.posted}/{c.deliverables} posted{c.views ? ` · ${formatCount(c.views)} views` : ''}</span>{grip}
            </div>
          </>} />
      ) : rows.length === 0 ? <div className="shoji"><EmptyState sketch="koi" line="Nothing matches — try a wider net." /></div> : (
        <ul className="shoji divide-y divide-line/15">
          {rows.map(c => (
            <li key={c.campaign_id}>
              <Link to={`/campaigns/${c.campaign_id}`} className="p-4 sm:px-5 grid grid-cols-[auto_1fr] md:grid-cols-[auto_1fr_9rem_8rem_8rem] gap-x-4 gap-y-2 items-center hover:bg-raised/50 transition-colors duration-calm">
                <BrandLogo name={c.brand_name} path={c.brand_logo_path} size={40} />
                <div className="min-w-0">
                  <p className="text-ink font-medium">{c.name}</p>
                  <p className="text-xs text-muted">{c.brand_name} · {KIND_LABEL[c.kind]} · {dates(c)}{c.owner_name ? ` · ${c.owner_name}` : ''}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5 md:hidden"><Pill tone={CAMPAIGN_STATUS_TONE[c.status]}>{CAMPAIGN_STATUS_LABEL[c.status]}</Pill>{c.overdue > 0 && <Pill tone="alert">{c.overdue} overdue</Pill>}</div>
                </div>
                <div className="hidden md:flex flex-col items-start gap-1.5"><Pill tone={CAMPAIGN_STATUS_TONE[c.status]}>{CAMPAIGN_STATUS_LABEL[c.status]}</Pill>{c.overdue > 0 && <Pill tone="alert"><Andon size={12} />{c.overdue} overdue</Pill>}</div>
                <p className="hidden md:block text-sm text-right num"><span className="text-ink">{c.posted}/{c.deliverables}</span><span className="block text-xs text-muted">posted · {c.confirmed_creators} creators</span></p>
                <p className="hidden md:block text-sm text-right num">
                  {money ? <><span className="text-ink">{c.client_budget != null ? formatINR(c.client_budget) : '—'}</span><span className="block text-xs text-muted">{c.views ? `${formatCount(c.views)} views` : 'client budget'}</span></>
                    : <><span className="text-ink">{formatCount(c.views)}</span><span className="block text-xs text-muted">views</span></>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
