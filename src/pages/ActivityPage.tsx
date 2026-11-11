// Activity feed: the activity log in plain language, plus the daily summary per person.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, EmptyState, SectionTitle } from '../components/ui/kit'
import { Icon } from '../components/ui/Icon'
import { Loading, Select } from './money/MoneyBits'
import { useAsync } from '../hooks/useAsync'
import { useAuth } from '../lib/auth'
import { usePeriod } from '../lib/prefs'
import { describeActivity } from '../lib/activity'
import { downloadCSV } from '../lib/csv'
import { formatDate, formatRange, istToday } from '../lib/format'
import { addDaysISO } from '../lib/production'
import { workApi, type FeedEntry } from '../data/work'

const TYPES: Record<string, { label: string; tables: string[]; path?: string }> = {
  brands: { label: 'Brands', tables: ['brands', 'brand_contacts', 'retainers', 'retainer_scope_items', 'brand_tags'], path: '/brands' },
  creators: { label: 'Creators', tables: ['creators', 'creator_platforms', 'creator_rate_cards', 'creator_tags', 'creator_payment_details', 'shortlists', 'shortlist_creators'], path: '/creators' },
  campaigns: { label: 'Campaigns', tables: ['campaigns', 'campaign_creators', 'campaign_finances', 'campaign_creator_fees', 'campaign_promo_codes', 'campaign_members'], path: '/campaigns' },
  production: { label: 'Production', tables: ['deliverables', 'scripts', 'script_comments', 'edit_versions', 'shoots', 'production_people', 'deliverable_metrics', 'deliverable_reviews'], path: '/production' },
  tasks: { label: 'Tasks', tables: ['tasks', 'task_checklist_items', 'task_assignees', 'comments', 'recurring_tasks'], path: '/tasks' },
  money: { label: 'Money', tables: ['invoices', 'invoice_items', 'receipts', 'receipt_allocations', 'expenses', 'creator_payouts', 'capital_entries', 'money_accounts', 'account_transfers', 'recurring_expenses'] },
}
const DIRECT: Record<string, string> = { brands: '/brands', creators: '/creators', campaigns: '/campaigns', deliverables: '/production', tasks: '/tasks', invoices: '/money/invoices', receipts: '/money/payments', expenses: '/money/expenses', creator_payouts: '/money/payouts' }
const timeIST = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
const dayIST = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso))

/** "Founder 1 moved “Diwali Reel” from Internal review to Client review" */
export function feedLine(e: FeedEntry): string {
  const d = describeActivity(e, e.record_name ? { [e.record_id]: e.record_name } : {})
  if (!d.text) return ''
  if (e.table_name === 'receipts' && e.action === 'create' && e.record_name) return `${d.text.replace(' received', '')} payment from ${e.record_name}`
  if (!e.record_name || d.text.includes(e.record_name)) return d.text
  const swapped = d.text.replace(/\bthe (task|brand|creator|campaign|invoice|expense|payout|payment|account|budget)\b/, `“${e.record_name}”`)
  return swapped !== d.text ? swapped : `${d.text} — ${e.record_name}`
}

function Feed() {
  const { range } = usePeriod()
  const { data: members } = useAsync(workApi.members, [])
  const [who, setWho] = useState('any'), [type, setType] = useState('any')
  const { data, loading, error } = useAsync(() => workApi.feed(range.from, range.to, who === 'any' ? null : who, type === 'any' ? null : TYPES[type].tables), [range.from, range.to, who, type])
  const rows = (data ?? []).map(e => ({ e, text: feedLine(e) })).filter(r => r.text)
  const days = [...new Set(rows.map(r => dayIST(r.e.created_at)))]
  return (
    <Card className="shoji-pad">
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <Select id="feed-who" label="Person" value={who} onChange={setWho} options={[['any', 'Everyone'], ...(members ?? []).map(m => [m.id, m.name] as [string, string])]} />
        <Select id="feed-type" label="Record type" value={type} onChange={setType} options={[['any', 'All records'], ...Object.entries(TYPES).map(([k, v]) => [k, v.label] as [string, string])]} />
        <span className="text-xs text-muted num flex-1">{formatRange(range)} · change the dates in the top bar</span>
        {rows.length > 0 && <button className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5" onClick={() => downloadCSV(`activity-${istToday()}.csv`, rows, [
          { header: 'When (IST)', value: r => `${dayIST(r.e.created_at)} ${timeIST(r.e.created_at)}` }, { header: 'Who', value: r => r.e.actor_name }, { header: 'What', value: r => r.text }, { header: 'Reason', value: r => r.e.reason }])}><Icon name="download" /> CSV</button>}
      </div>
      {loading && !data ? <Loading label="Loading activity" /> : error ? <p role="alert" className="text-sm text-ink">{error}</p>
        : !rows.length ? <EmptyState sketch="koi" line="Still water. Nothing happened in this period." /> : days.map(day => (
          <section key={day} className="mb-6 last:mb-0">
            <h2 className="eyebrow mb-3">{day === istToday() ? 'Today' : formatDate(day)}</h2>
            <ol className="relative ml-1.5 border-l border-line/30 space-y-4">
              {rows.filter(r => dayIST(r.e.created_at) === day).map(({ e, text }) => {
                const to = DIRECT[e.table_name] ? `${DIRECT[e.table_name]}/${e.record_id}` : null
                const line = <><span className="font-medium">{e.actor_name}</span> {text} <span className="text-muted">— <span className="num">{timeIST(e.created_at)}</span></span></>
                return (
                  <li key={e.id} className="pl-5 relative">
                    <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-card ${e.action === 'status_change' ? 'bg-kaki' : e.action === 'archive' || e.action === 'delete' ? 'bg-akane' : TYPES.money.tables.includes(e.table_name) ? 'bg-yamabuki' : 'bg-hai'}`} aria-hidden />
                    <p className="text-sm text-ink">{to ? <Link to={to} className="hover:underline underline-offset-4">{line}</Link> : line}</p>
                    {e.reason && <p className="text-sm text-ink mt-1 border-l-2 border-yamabuki/70 pl-2">“{e.reason}”</p>}
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      {data && data.length >= 200 && <p className="text-xs text-muted mt-4">Showing the latest 200 entries. Narrow the dates or filters to see older ones.</p>}
    </Card>
  )
}

function Daily() {
  const [day, setDay] = useState(istToday())
  const { data, loading } = useAsync(() => workApi.summary(day, day), [day])
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="日" aside={<span className="flex items-center gap-1">
        <button className="icon-btn" aria-label="Previous day" onClick={() => setDay(addDaysISO(day, -1))}><Icon name="chevronLeft" /></button>
        <label className="sr-only" htmlFor="sum-day">Day</label><input id="sum-day" type="date" className="field w-auto num" value={day} max={istToday()} onChange={e => e.target.value && setDay(e.target.value)} />
        <button className="icon-btn" aria-label="Next day" disabled={day >= istToday()} onClick={() => setDay(addDaysISO(day, 1))}><Icon name="chevronRight" /></button></span>}>Daily summary</SectionTitle>
      {loading && !data ? <Loading label="Loading summary" /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted border-b border-line/30"><th className="py-2 font-normal">Person</th><th className="py-2 font-normal text-right">Tasks completed</th><th className="py-2 font-normal text-right">Hours logged</th><th className="py-2 font-normal text-right">Records created</th><th className="py-2 font-normal text-right">Records updated</th></tr></thead>
          <tbody>{(data ?? []).map(r => (
            <tr key={r.member_id} className="border-b border-line/15"><td className="py-2.5 text-ink">{r.name}</td><td className="py-2.5 text-right num">{r.tasks_done}</td><td className="py-2.5 text-right num">{Number(r.hours_logged).toFixed(1)}</td><td className="py-2.5 text-right num">{r.records_created}</td><td className="py-2.5 text-right num">{r.records_updated}</td></tr>))}</tbody>
        </table></div>
      )}
    </Card>
  )
}

export function ActivityPage() {
  const { role } = useAuth()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'daily' ? 'daily' : 'feed'
  return (
    <div className="space-y-5 sm:space-y-6 max-w-4xl">
      <h1 className="font-mincho text-3xl text-ink"><span className="text-accent-ink mr-2" aria-hidden lang="ja">録</span>Activity</h1>
      <nav aria-label="Activity views" className="flex gap-1">
        {([['feed', 'Feed'], ['daily', role === 'founder' || role === 'manager' ? 'Daily summary' : 'My day']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setSp(k === 'feed' ? {} : { tab: k })} aria-current={tab === k ? 'page' : undefined}
            className={`px-3.5 h-10 text-sm border-b-2 ${tab === k ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>))}
      </nav>
      {tab === 'feed' ? <Feed /> : <Daily />}
    </div>
  )
}
