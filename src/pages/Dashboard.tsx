// Dashboard: everything is read from one database call for the global period.
// Every number opens the records behind it (genchi genbutsu).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Fuji } from '../components/art/Fuji'
import { Andon, SeasonalLayer } from '../components/art/Ink'
import { Card, EmptyState, SectionTitle } from '../components/ui/kit'
import { PairedBars, RankBars, TimeBars } from '../components/work/Charts'
import { GoSee, type AndonRow, type Behind } from '../components/work/WorkBits'
import { Loading } from './money/MoneyBits'
import { useAsync } from '../hooks/useAsync'
import { useAuth } from '../lib/auth'
import { formatDate, formatINR, formatRange, istToday, PERIOD_LABELS } from '../lib/format'
import { usePeriod, usePrefs } from '../lib/prefs'
import { addDaysISO, STAGE_LABEL, type Stage } from '../lib/production'
import { greeting, season, SEASON_NAMES, skyPhase } from '../lib/time'
import { db } from '../data/db'
import type { WorkSummary } from '../data/work'

interface Kpi { value: number | null; prev: number | null }
interface Item { id?: string; title: string; sub?: string | null; amount?: number | null; link: string }
interface Dash {
  previous?: { from: string; to: string }
  money: Record<string, Kpi> | null; work: Record<string, Kpi>
  charts: { months: { month: string; revenue: number; expenses: number }[]; brands: { id: string; name: string; profit: number }[]; weeks: { week: string; posted: number }[]; funnel: { stage: string; n: number }[] }
  lists: Record<'shoots' | 'due_today' | 'overdue_invoices' | 'renewals' | 'stuck', Item[]>
  team: WorkSummary[]; andons: AndonRow[]
}
interface Brief { shoots: Item[]; tasks: Item[]; payments_expected: Item[]; payouts_due: Item[]; ichiban: Item | null }

const MONEY: [string, string][] = [['revenue', 'Revenue'], ['cash_received', 'Cash received'], ['expenses', 'Expenses'], ['net_profit', 'Net profit'], ['outstanding', 'Outstanding receivables'], ['payouts_pending', 'Payouts pending'], ['total_capital', 'Total capital']]
const WORK: [string, string][] = [['active_brands', 'Active brands'], ['live_campaigns', 'Live campaigns'], ['content_posted', 'Content pieces posted'], ['in_production', 'Items in production'], ['overdue_tasks', 'Overdue tasks'], ['shoots_this_week', 'Shoots this week']]
const andonLink = (a: AndonRow) => a.record_table === 'tasks' ? `/tasks/${a.record_id}` : a.record_table === 'deliverables' ? `/production/${a.record_id}` : a.record_table === 'campaigns' ? `/campaigns/${a.record_id}` : null

function useMinute() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])
  return now
}
const istHour = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(now))

function Hero({ name, children }: { name: string; children?: React.ReactNode }) {
  const now = useMinute()
  const { seasonal, fuji } = usePrefs()
  const g = greeting(now), ph = skyPhase(now), se = season(now)
  const weekday = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(now)
  return (
    <section className="shoji relative overflow-hidden">
      <div className={`relative ${fuji ? 'sm:min-h-[15rem]' : ''}`}>
        {fuji && <div className="relative h-32 sm:absolute sm:inset-0 sm:h-auto">
          <Fuji phase={ph} season={se} showSeason={seasonal} className="absolute inset-0 w-full h-full" />
          {seasonal && <SeasonalLayer season={se} />}
        </div>}
        <div className={`relative px-6 pb-6 pt-4 sm:p-8 flex flex-col justify-end ${fuji ? 'sm:max-w-[24rem] sm:bg-gradient-to-r from-card via-card to-card/0 sm:pr-16 sm:min-h-[15rem]' : ''}`}>
          <p className="eyebrow mb-3"><span lang="ja">{g.kana}</span> · <span lang="ja">{SEASON_NAMES[se].kanji}</span> {SEASON_NAMES[se].en}</p>
          <h1 className="font-mincho text-3xl sm:text-4xl text-ink leading-tight">{g.romaji},<br /><span className="text-accent-ink">{name}</span></h1>
          <p className="mt-3 text-sm text-muted">{weekday}, {formatDate(now)}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function Rows({ items, empty }: { items: Item[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>
  return <ul className="divide-y divide-line/15 -my-1">{items.map((i, n) => (
    <li key={i.id ?? n}><Link to={i.link} className="flex items-center gap-3 py-2.5 hover:bg-raised/60 -mx-2 px-2 rounded">
      <span className="min-w-0 flex-1"><span className="block text-sm text-ink truncate">{i.title}</span>{i.sub && <span className="block text-xs text-muted truncate">{i.sub}</span>}</span>
      {i.amount != null && <span className="text-sm text-ink num whitespace-nowrap">{formatINR(i.amount)}</span>}</Link></li>))}</ul>
}

/** Asa — the morning brief. Shown to founders before noon until they start the day. */
function MorningBrief({ onStart }: { onStart: () => void }) {
  const { data, loading } = useAsync(() => db.rpc<Brief>('morning_brief'), [])
  if (loading && !data) return <div className="border-t border-line/20 p-6"><Loading label="Preparing the morning brief" /></div>
  if (!data) return null
  const parts: [string, string, Item[], string][] = [['撮', 'Today’s shoots', data.shoots, 'No shoots today.'], ['務', 'Tasks due', data.tasks, 'Nothing due.'],
    ['入', 'Payments expected', data.payments_expected, 'None due.'], ['出', 'Payouts due', data.payouts_due, 'None due.']]
  return (
    <div className="border-t border-line/20 px-6 py-6 sm:px-8 rise" role="region" aria-label="Morning brief">
      <div className="flex flex-wrap items-end gap-4 mb-5">
        <div className="flex-1 min-w-[16rem]">
          <p className="eyebrow"><span lang="ja">一番</span> · Ichiban — the one most important thing</p>
          {data.ichiban ? <Link to={data.ichiban.link} className="block mt-1.5 group"><span className="font-mincho text-xl sm:text-2xl text-ink group-hover:underline underline-offset-4">{data.ichiban.title}</span>
            {data.ichiban.sub && <span className="block text-sm text-muted mt-0.5">{data.ichiban.sub}</span>}</Link>
            : <p className="font-mincho text-xl text-ink mt-1.5">A clear day. Choose your own most important thing.</p>}
        </div>
        <button className="btn-primary" onClick={onStart}><span lang="ja" aria-hidden>朝</span> Start the day</button>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-5">
        {parts.map(([k, label, items, empty]) => (
          <div key={label}><h2 className="text-sm text-ink mb-2 flex items-baseline gap-2"><span className="font-mincho text-accent-ink" aria-hidden lang="ja">{k}</span>{label}<span className="text-xs text-muted num">{items.length || ''}</span></h2>
            <Rows items={items.slice(0, 4)} empty={empty} />{items.length > 4 && <p className="text-xs text-muted mt-1">+{items.length - 4} more</p>}</div>
        ))}
      </div>
    </div>
  )
}

function KpiCard({ label, k, money, onOpen }: { label: string; k: Kpi | undefined; money: boolean; onOpen: () => void }) {
  if (!k) return null
  const v = Number(k.value ?? 0), p = k.prev == null ? null : Number(k.prev)
  const pct = p == null || p === 0 ? null : Math.round(((v - p) / Math.abs(p)) * 100)
  const was = p == null ? '' : money ? formatINR(p) : String(p)
  return (
    <button onClick={onOpen} className="shoji p-4 text-left hover:bg-raised/60 transition-colors duration-calm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`${label}: ${money ? formatINR(v) : v}. Show the records`}>
      <span className="eyebrow block">{label}</span>
      <span className="font-mincho text-2xl text-ink num block mt-1.5">{money ? formatINR(v) : v}</span>
      <span className="text-xs text-muted block mt-1 num" title={p == null ? undefined : `Previous period: ${was}`}>
        {pct == null ? (p === 0 && v !== 0 ? 'New this period' : p == null ? ' ' : 'No change') : pct === 0 ? '→ same as before' : <><span className="text-ink">{pct > 0 ? '↑' : '↓'} {Math.abs(pct)}%</span> vs previous</>}
      </span>
    </button>
  )
}

export function Dashboard() {
  const { member, role } = useAuth()
  const { period, range } = usePeriod()
  const now = useMinute()
  const today = istToday()
  const { data, loading, error, reload } = useAsync(() => db.rpc<Dash>('dashboard', { p_from: range.from, p_to: range.to }), [range.from, range.to])
  const { data: hansei } = useAsync(() => db.rpc<{ due: boolean }>('hansei_due'), [])
  const [see, setSee] = useState<Behind | null>(null)
  const briefKey = `smog.brief.${member?.id}`
  const [briefDone, setBriefDone] = useState(() => { try { return localStorage.getItem(briefKey) === today } catch { return false } })
  if (!member) return null
  const firstName = member.name.startsWith('[') ? member.name : member.name.split(' ')[0]
  const showBrief = role === 'founder' && istHour(now) < 12 && !briefDone
  const startDay = async () => {
    try { localStorage.setItem(briefKey, today) } catch { /* private mode */ }
    setBriefDone(true)
    await db.rpc('set_presence', { p_status: 'working' }).catch(() => null)
  }
  const monthLabel = (iso: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'))
  const monthEnd = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10) }

  return (
    <div className="space-y-6 sm:space-y-8">
      <Hero name={firstName}>{showBrief && <MorningBrief onStart={startDay} />}</Hero>

      {hansei?.due && <Link to="/kaizen?tab=hansei" className="shoji p-4 flex items-center gap-3 hover:bg-raised/60"><span className="font-mincho text-2xl text-accent-ink" lang="ja" aria-hidden>反省</span>
        <span className="flex-1"><span className="block text-ink">Hansei — Friday reflection</span><span className="block text-sm text-muted">Three questions about the week. Takes five minutes.</span></span><span className="btn-primary">Reflect</span></Link>}

      {(data?.andons.length ?? 0) > 0 && (
        <section aria-label="Blocked — andon" className="shoji border-akane/70 p-4 sm:p-5">
          <h2 className="font-mincho text-ink flex items-center gap-2 mb-3"><span className="andon-glow text-akane"><Andon size={20} lit /></span> Andon — {data!.andons.length} blocked</h2>
          <ul className="divide-y divide-line/15">
            {data!.andons.map(a => { const to = andonLink(a); const body = <><span className="block text-sm text-ink">{a.title}</span>
              <span className="block text-xs text-muted">“{a.reason}” · {a.raised_by_name ?? 'Automation'}{a.unblocker_name && <> · waiting on {a.unblocker_name}</>}</span></>
              return <li key={a.id} className="py-2.5 flex items-center gap-3">{to ? <Link to={to} className="flex-1 min-w-0 hover:underline underline-offset-4">{body}</Link> : <span className="flex-1 min-w-0">{body}</span>}
                {!to && <button className="btn-ghost" onClick={async () => { await db.rpc('andon_resolve', { p_id: a.id, p_note: null }); reload() }}>Resolved</button>}</li> })}
          </ul>
        </section>
      )}

      <p className="text-sm text-muted"><span className="text-ink">{PERIOD_LABELS[period]}</span> · <span className="num">{formatRange(range)}</span>
        {data?.previous && <> · compared with <span className="num">{formatRange(data.previous)}</span></>}</p>
      {error && <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{error}</p>}
      {loading && !data ? <Loading label="Loading the dashboard" /> : data && <>
        {data.money && <section aria-label="Money"><h2 className="sr-only">Money</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 sm:gap-4">
            {MONEY.map(([k, label]) => <KpiCard key={k} label={label} k={data.money![k]} money onOpen={() => setSee({ metric: k, title: label })} />)}</div></section>}
        <section aria-label="Work"><h2 className="sr-only">Work</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
            {WORK.map(([k, label]) => <KpiCard key={k} label={label} k={data.work[k]} money={false} onOpen={() => setSee({ metric: k, title: label })} />)}</div></section>

        <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
          {data.money && <Card className="shoji-pad"><PairedBars title="Revenue vs expenses — last 12 months" labels={['Revenue', 'Expenses']}
            data={data.charts.months.map(m => ({ key: m.month, label: monthLabel(m.month), a: Number(m.revenue), b: Number(m.expenses) }))}
            onPick={(m, s) => setSee({ metric: s === 'a' ? 'revenue' : 'expenses', title: `${s === 'a' ? 'Revenue' : 'Expenses'} — ${monthLabel(m)} ${m.slice(0, 4)}`, from: m, to: monthEnd(m) })} /></Card>}
          {data.money && <Card className="shoji-pad"><RankBars title="Profit by brand — top 10" money empty="No billing in this period."
            data={data.charts.brands.map(b => ({ key: b.id, label: b.name, value: Number(b.profit) }))}
            onPick={id => setSee({ metric: 'profit', id, title: `Profit — ${data.charts.brands.find(b => b.id === id)?.name}` })} /></Card>}
          <Card className="shoji-pad"><TimeBars title="Content posted per week" unit="Posted"
            data={data.charts.weeks.map(w => ({ key: w.week, label: formatDate(w.week).slice(0, 6), value: w.posted }))}
            onPick={w => setSee({ metric: 'content_posted', title: `Posted — week of ${formatDate(w)}`, from: w, to: addDaysISO(w, 6) })} /></Card>
          <Card className="shoji-pad"><RankBars title="Production stage funnel" empty="Nothing in production."
            data={data.charts.funnel.map(f => ({ key: f.stage, label: STAGE_LABEL[f.stage as Stage] ?? f.stage, value: f.n }))}
            onPick={st => setSee({ metric: 'stage', key: st, title: `In ${STAGE_LABEL[st as Stage] ?? st}` })} /></Card>
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
          <Card className="shoji-pad"><SectionTitle kanji="撮">Today’s shoots</SectionTitle><Rows items={data.lists.shoots} empty="No shoots today." /></Card>
          <Card className="shoji-pad"><SectionTitle kanji="今">Due today</SectionTitle><Rows items={data.lists.due_today} empty="Nothing is due today." /></Card>
          <Card className="shoji-pad"><SectionTitle kanji="滞">Items stuck in a stage</SectionTitle><Rows items={data.lists.stuck} empty="Everything is moving." /></Card>
          {data.money && <Card className="shoji-pad"><SectionTitle kanji="遅">Overdue invoices</SectionTitle><Rows items={data.lists.overdue_invoices} empty="No invoice is overdue." /></Card>}
          {data.money && <Card className="shoji-pad"><SectionTitle kanji="更">Retainers renewing in 15 days</SectionTitle><Rows items={data.lists.renewals} empty="No renewals coming up." /></Card>}
        </div>

        <Card className="shoji-pad">
          <SectionTitle kanji="人" aside={<Link to="/kaizen?tab=load" className="text-sm text-muted hover:text-ink underline underline-offset-4">Workload</Link>}>Team</SectionTitle>
          {!data.team.length ? <EmptyState line="No one here yet." /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted border-b border-line/30"><th className="py-2 font-normal">Person</th><th className="py-2 font-normal text-right">Tasks done</th><th className="py-2 font-normal text-right">Hours logged</th><th className="py-2 font-normal text-right">Records updated</th></tr></thead>
              <tbody>{data.team.map(t => (
                <tr key={t.member_id} className="border-b border-line/15"><td className="py-2.5 text-ink">{t.name}</td>
                  <td className="py-2.5 text-right"><button className="num underline decoration-line/50 underline-offset-4 hover:decoration-accent" onClick={() => setSee({ metric: 'tasks_done', id: t.member_id, title: `Tasks done — ${t.name}` })}>{t.tasks_done}</button></td>
                  <td className="py-2.5 text-right"><button className="num underline decoration-line/50 underline-offset-4 hover:decoration-accent" onClick={() => setSee({ metric: 'hours_logged', id: t.member_id, title: `Hours logged — ${t.name}` })}>{Number(t.hours_logged).toFixed(1)}</button></td>
                  <td className="py-2.5 text-right"><Link className="num underline decoration-line/50 underline-offset-4 hover:decoration-accent" to="/activity">{Number(t.records_created) + Number(t.records_updated)}</Link></td></tr>))}</tbody>
            </table></div>
          )}
        </Card>
      </>}
      {see && <GoSee what={see} range={range} onClose={() => setSee(null)} />}
    </div>
  )
}
