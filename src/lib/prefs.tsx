// Per-user display preferences. Saved in the browser for now; feature 13
// (Settings) moves them to the user_preferences table.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { periodRange, type PeriodKey, type Range } from './format'

type Theme = 'dark' | 'washi'
interface Prefs {
  theme: Theme; setTheme: (t: Theme) => void
  seasonal: boolean; setSeasonal: (b: boolean) => void
  period: PeriodKey; range: Range; setPeriod: (p: PeriodKey, custom?: Range) => void
}
const Ctx = createContext<Prefs | null>(null)

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeS] = useState<Theme>(() => read('smog.theme', 'dark'))
  const [seasonal, setSeasonalS] = useState<boolean>(() => read('smog.seasonal', true))
  const [period, setPeriodS] = useState<PeriodKey>(() => read('smog.period', 'this_month'))
  const [range, setRange] = useState<Range>(() => {
    const p = read<PeriodKey>('smog.period', 'this_month')
    return p === 'custom' ? read('smog.range', periodRange('this_month')) : periodRange(p)
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1E1C1A' : '#F7F1E6')
  }, [theme])

  const value: Prefs = {
    theme, setTheme: t => { setThemeS(t); write('smog.theme', t) },
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
