import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Fuji } from '../components/art/Fuji'
import { Andon, BrushDivider, EnsoRing, SeasonalLayer } from '../components/art/Ink'
import { Card, MoreMenu, Pill, PreviewBadge, SectionTitle } from '../components/ui/kit'
import { Icon } from '../components/ui/Icon'
import { attention, F1, myTasks, pipeline, summary, upcoming } from '../demo/data'
import { formatDate, formatINR, formatINRShort, formatRange, PERIOD_LABELS } from '../lib/format'
import { usePrefs } from '../lib/prefs'
import { greeting, season, SEASON_NAMES, skyPhase } from '../lib/time'

function useMinute() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])
  return now
}

function Hero() {
  const now = useMinute()
  const { seasonal } = usePrefs()
  const g = greeting(now), ph = skyPhase(now), se = season(now)
  const weekday = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(now)
  return (
    <section className="shoji relative overflow-hidden min-h-[13rem] sm:min-h-[15rem]">
      <Fuji phase={ph} season={se} showSeason={seasonal} className="absolute inset-0 w-full h-full" />
      {seasonal && <SeasonalLayer season={se} />}
      {/* the text sits on solid card colour, so contrast never depends on the sky */}
      <div className="relative h-full p-6 sm:p-8 max-w-[22rem] bg-gradient-to-r from-card via-card to-card/0 sm:pr-16 flex flex-col justify-end min-h-[13rem] sm:min-h-[15rem]">
        <p className="eyebrow mb-3" lang="ja">{g.kana} · {SEASON_NAMES[se].kanji} {SEASON_NAMES[se].en}</p>
        <h1 className="font-mincho text-3xl sm:text-4xl text-ink leading-tight">{g.romaji},<br /><span className="text-accent-ink">{F1}</span></h1>
        <p className="mt-3 text-sm text-muted">{weekday}, {formatDate(now)}</p>
      </div>
    </section>
  )
}

function Delta({ now, prev }: { now: number; prev: number }) {
  const pct = prev ? ((now - prev) / prev) * 100 : 0
  const up = pct >= 0
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted num">
      <Icon name={up ? 'arrowUp' : 'arrowDown'} className={up ? 'text-yamabuki' : 'text-ink'} />
      {Math.abs(pct).toFixed(1)}% vs previous period
    </span>
  )
}

export function Dashboard() {
  const { period, range } = usePrefs()
  const s = summary
  const profit = s.revenue - s.creatorCost - s.expenses        // calculated, never typed
  const margin = (profit / s.revenue) * 100
  const targetPct = s.revenue / s.target
  const maxStage = Math.max(...pipeline.map(p => p.count))

  return (
    <div className="space-y-6 sm:space-y-8">
      <Hero />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted"><span className="text-ink">{PERIOD_LABELS[period]}</span> · <span className="num">{formatRange(range)}</span></p>
          <PreviewBadge />
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-primary"><Icon name="plus" /> Record</button>
          <MoreMenu items={[{ label: 'Export period summary (CSV)', onSelect: () => {} }, { label: 'Customise dashboard', onSelect: () => {} }]} />
        </div>
      </div>

      {/* Fukinsei: one large hero card, smaller companions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        <Card className="lg:col-span-8 shoji-pad rise">
          <p className="eyebrow">Revenue invoiced</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2">
            <p className="font-mincho text-5xl sm:text-6xl text-accent-ink num leading-none">{formatINR(s.revenue)}</p>
            <Delta now={s.revenue} prev={s.revenuePrev} />
          </div>
          <BrushDivider className="my-6" />
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-y-5 gap-x-6">
            {[
              ['Collected', s.collections], ['Creator cost', s.creatorCost], ['Expenses', s.expenses], ['Profit', profit],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className={`mt-1 text-xl num ${k === 'Profit' ? 'text-ink font-medium' : 'text-ink'}`}>{formatINR(v as number)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-xs text-muted">Profit = revenue − creator cost − expenses · margin <span className="num">{margin.toFixed(1)}%</span> · calculated from records</p>
        </Card>

        <Card className="lg:col-span-4 shoji-pad rise flex flex-col">
          <p className="eyebrow">Monthly target</p>
          <div className="flex-1 flex items-center gap-5 mt-4">
            <EnsoRing value={targetPct}>
              <span className="font-mincho text-2xl text-ink num">{Math.round(targetPct * 100)}%</span>
            </EnsoRing>
            <div className="space-y-1 text-sm">
              <p className="text-ink num">{formatINRShort(s.revenue)} <span className="text-muted">of {formatINRShort(s.target)}</span></p>
              <p className="text-muted num">{formatINR(s.target - s.revenue)} to go</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-shoji bg-bg/60 px-3 py-2.5"><p className="text-xs text-muted">Went live</p><p className="text-lg num text-ink">{s.liveThisPeriod}</p></div>
            <div className="rounded-shoji bg-bg/60 px-3 py-2.5"><p className="text-xs text-muted">Still due</p><p className="text-lg num text-ink">{s.dueThisPeriod}</p></div>
          </div>
        </Card>

        <Card className="lg:col-span-5 shoji-pad rise">
          <SectionTitle kanji="注" aside={<span className="text-xs text-muted">{attention.length} items</span>}>Needs attention</SectionTitle>
          <dl className="grid grid-cols-2 gap-4 mb-5">
            <div><dt className="text-xs text-muted">Outstanding</dt><dd className="text-xl num text-ink mt-1">{formatINR(s.outstanding)}</dd></div>
            <div><dt className="text-xs text-muted">Overdue</dt><dd className="mt-1"><Pill tone="alert"><span className="num text-sm">{formatINR(s.overdue)}</span></Pill></dd></div>
          </dl>
          <ul className="divide-y divide-line/20">
            {attention.map(a => (
              <li key={a.title} className="py-3 flex items-start gap-3">
                <span className={`mt-0.5 ${a.kind === 'blocked' ? 'text-akane' : 'text-muted'}`}>
                  {a.kind === 'blocked' ? <Andon lit /> : <span className={`block w-2 h-2 mt-1.5 rounded-full ${a.kind === 'overdue' ? 'bg-akane' : 'bg-yamabuki'}`} />}
                </span>
                <div className="min-w-0"><p className="text-sm text-ink truncate">{a.title}</p><p className="text-xs text-muted num">{a.meta}</p></div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-7 shoji-pad rise">
          <SectionTitle kanji="作" aside={<Link to="/production" className="text-sm text-muted hover:text-ink inline-flex items-center gap-1">Production <Icon name="chevronRight" /></Link>}>In production</SectionTitle>
          <ul className="space-y-3.5">
            {pipeline.map(p => (
              <li key={p.stage} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-3">
                <span className="text-sm text-muted">{p.stage}</span>
                <span className="h-2 rounded-full bg-bg/70 overflow-hidden" aria-hidden>
                  <span className="block h-full rounded-full bg-sunset" style={{ width: `${(p.count / maxStage) * 100}%`, transition: 'width 600ms var(--ease-calm)' }} />
                </span>
                <span className="text-sm text-ink num text-right">{p.count}</span>
              </li>
            ))}
          </ul>
          <BrushDivider className="my-6" />
          <SectionTitle kanji="暦">Going live soon</SectionTitle>
          <ul className="divide-y divide-line/20">
            {upcoming.map(u => (
              <li key={u.title} className="py-3 grid grid-cols-[4.5rem_1fr_auto] gap-3 items-center">
                <span className="font-mincho text-ink num leading-tight"><span className="text-2xl">{formatDate(u.date).slice(0, 2)}</span> <span className="text-xs text-muted">{formatDate(u.date).slice(3, 6)}</span></span>
                <div className="min-w-0"><p className="text-sm text-ink truncate">{u.title}</p><p className="text-xs text-muted truncate">{u.brand} · {u.creator}</p></div>
                <Pill>{u.stage}</Pill>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-12 shoji-pad rise">
          <SectionTitle kanji="務" aside={
            <button className="btn-ghost h-9 text-sm"><span className="text-akane"><Andon /></span> I’m blocked</button>
          }>My tasks today</SectionTitle>
          <ul className="grid sm:grid-cols-3 gap-3">
            {myTasks.map(t => (
              <li key={t.title} className="rounded-shoji border border-line/25 px-4 py-3 flex items-start gap-3">
                <span className={`mt-0.5 w-4 h-4 rounded-full border ${t.done ? 'bg-accent border-accent' : 'border-line'}`} aria-label={t.done ? 'Done' : 'Not done'} role="img" />
                <div><p className={`text-sm ${t.done ? 'text-muted line-through' : 'text-ink'}`}>{t.title}</p><p className="text-xs text-muted">Due {formatDate(t.due)}</p></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
