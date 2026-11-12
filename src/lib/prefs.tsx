// Per-user display preferences. Saved in the browser for now; feature 13
// (Settings) moves them to the user_preferences table.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { periodRange, type PeriodKey, type Range } from './format'

export type Theme = 'dark' | 'washi' | 'auto'   // auto = Washi by day, Sumi by night (IST)
interface Prefs {
  theme: Theme; effectiveTheme: 'dark' | 'washi'; setTheme: (t: Theme) => void
  fuji: boolean; setFuji: (b: boolean) => void
  hydrate: (p: Partial<{ theme: Theme; seasonal: boolean; fuji: boolean }>) => void
  seasonal: boolean; setSeasonal: (b: boolean) => void
  period: PeriodKey; range: Range; setPeriod: (p: PeriodKey, custom?: Range) => void
}
const Ctx = createContext<Prefs | null>(null)

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeS] = useState<Theme>(() => read('smog.theme', 'dark'))
  const [fuji, setFujiS] = useState<boolean>(() => read('smog.fuji', true))
  const [hour, setHour] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setHour(new Date()), 60_000); return () => clearInterval(t) }, [])
  const [seasonal, setSeasonalS] = useState<boolean>(() => read('smog.seasonal', true))
  const [period, setPeriodS] = useState<PeriodKey>(() => read('smog.period', 'this_month'))
  const [range, setRange] = useState<Range>(() => {
    const p = read<PeriodKey>('smog.period', 'this_month')
    return p === 'custom' ? read('smog.range', periodRange('this_month')) : periodRange(p)
  })

  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(hour))
  const effectiveTheme: 'dark' | 'washi' = theme === 'auto' ? (h >= 6 && h < 18 ? 'washi' : 'dark') : theme
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', effectiveTheme === 'dark' ? '#1E1C1A' : '#F7F1E6')
  }, [effectiveTheme])

  const value: Prefs = {
    theme, effectiveTheme, setTheme: t => { setThemeS(t); write('smog.theme', t) },
    fuji, setFuji: b => { setFujiS(b); write('smog.fuji', b) },
    hydrate: p => {
      if (p.theme) { setThemeS(p.theme); write('smog.theme', p.theme) }
      if (p.seasonal !== undefined) { setSeasonalS(p.seasonal); write('smog.seasonal', p.seasonal) }
      if (p.fuji !== undefined) { setFujiS(p.fuji); write('smog.fuji', p.fuji) }
    },
    seasonal, setSeasonal: b => { setSeasonalS(b); write('smog.seasonal', b) },
    period, range,
    setPeriod: (p, custom) => {
      const r = periodRange(p, undefined, custom)
      setPeriodS(p); setRange(r); write('smog.period', p); write('smog.range', r)
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePrefs() {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePrefs outside PrefsProvider')
  return c
}

/** The global date range from the top bar. Every page reads this. */
export function usePeriod() {
  const { period, range, setPeriod } = usePrefs()
  return { period, range, setPeriod }
}
