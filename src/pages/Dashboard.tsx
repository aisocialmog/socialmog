// Dashboard shell. The cards are in place and read the global period;
// their numbers arrive with the features that own them (see each card).
import { useEffect, useState } from 'react'
import { Fuji } from '../components/art/Fuji'
import { BrushDivider, EnsoRing, SeasonalLayer } from '../components/art/Ink'
import { Card, EmptyState, SectionTitle } from '../components/ui/kit'
import { useAuth } from '../lib/auth'
import { formatDate, formatRange, PERIOD_LABELS } from '../lib/format'
import { usePeriod, usePrefs } from '../lib/prefs'
import { greeting, season, SEASON_NAMES, skyPhase } from '../lib/time'
import { isStaff } from '../lib/access'

function useMinute() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])
  return now
}

function Hero({ name }: { name: string }) {
  const now = useMinute()
  const { seasonal } = usePrefs()
  const g = greeting(now), ph = skyPhase(now), se = season(now)
  const weekday = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(now)
  return (
    <section className="shoji relative overflow-hidden sm:min-h-[15rem]">
      {/* phone: the art is a strip above the greeting; wider screens: behind it */}
      <div className="relative h-32 sm:absolute sm:inset-0 sm:h-auto">
        <Fuji phase={ph} season={se} showSeason={seasonal} className="absolute inset-0 w-full h-full" />
        {seasonal && <SeasonalLayer season={se} />}
      </div>
      <div className="relative px-6 pb-6 pt-4 sm:p-8 sm:max-w-[24rem] sm:bg-gradient-to-r from-card via-card to-card/0 sm:pr-16 flex flex-col justify-end sm:min-h-[15rem]">
        <p className="eyebrow mb-3"><span lang="ja">{g.kana}</span> · <span lang="ja">{SEASON_NAMES[se].kanji}</span> {SEASON_NAMES[se].en}</p>
        <h1 className="font-mincho text-3xl sm:text-4xl text-ink leading-tight">{g.romaji},<br /><span className="text-accent-ink">{name}</span></h1>
        <p className="mt-3 text-sm text-muted">{weekday}, {formatDate(now)}</p>
      </div>
    </section>
  )
}

function Waiting({ line, feature }: { line: string; feature: string }) {
  return <EmptyState sketch="branch" line={line} action={<p className="text-xs text-muted -mt-2">Arrives with {feature}</p>} />
}

export function Dashboard() {
  const { member, role } = useAuth()
  const { period, range } = usePeriod()
  if (!member) return null
  const staff = isStaff(role)
  const firstName = member.name.startsWith('[') ? member.name : member.name.split(' ')[0]

  return (
    <div className="space-y-6 sm:space-y-8">
      <Hero name={firstName} />

      <p className="text-sm text-muted"><span className="text-ink">{PERIOD_LABELS[period]}</span> · <span className="num">{formatRange(range)}</span></p>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {staff ? <>
          <Card className="lg:col-span-8 shoji-pad">
            <p className="eyebrow">Revenue invoiced</p>
            <p className="mt-2 font-mincho text-5xl text-muted num leading-none" aria-label="No revenue recorded yet">₹0</p>
            <BrushDivider className="my-6" />
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-y-5 gap-x-6">
              {['Collected', 'Creator cost', 'Expenses', 'Profit'].map(k => (
                <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="mt-1 text-xl num text-muted">—</dd></div>
              ))}
            </dl>
            <p className="mt-5 text-xs text-muted">Filled from invoices, receipts, payouts and expenses once Money (feature 6) is built.</p>
          </Card>
          <Card className="lg:col-span-4 shoji-pad flex flex-col">
            <p className="eyebrow">Monthly target</p>
            <div className="flex-1 flex items-center gap-5 mt-4">
              <EnsoRing value={0}><span className="font-mincho text-xl text-muted">—</span></EnsoRing>
              <p className="text-sm text-muted">Set a target in Money to see the ensō close.</p>
            </div>
          </Card>
        </> : (
          <Card className="lg:col-span-12 shoji-pad">
            <SectionTitle kanji="務">My work</SectionTitle>
            <Waiting line="Still water. Nothing assigned to you yet." feature="Tasks & Production" />
          </Card>
        )}

        <Card className="lg:col-span-5 shoji-pad">
          <SectionTitle kanji="注">Needs attention</SectionTitle>
          <Waiting line="Nothing is waiting on you." feature="Automations (feature 11)" />
        </Card>
        <Card className="lg:col-span-7 shoji-pad">
          <SectionTitle kanji="作">In production</SectionTitle>
          <Waiting line="The studio is quiet." feature="Production (feature 5)" />
        </Card>
        <Card className="lg:col-span-12 shoji-pad">
          <SectionTitle kanji="暦">Going live soon</SectionTitle>
          <EmptyState sketch="fuji" line="A clear horizon." action={<p className="text-xs text-muted -mt-2">Arrives with the content calendar (feature 5)</p>} />
        </Card>
      </div>
    </div>
  )
}
