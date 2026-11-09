import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { NAV } from './nav'
import { DateRangePicker } from './DateRangePicker'
import { Icon } from '../components/ui/Icon'
import { usePrefs } from '../lib/prefs'
import { F1 } from '../demo/data'

function Brandmark() {
  return (
    <div className="flex items-center gap-3 px-2">
      <span className="grid place-items-center w-9 h-9 rounded-full bg-akane text-kinari font-mincho text-[13px] font-bold tracking-tight leading-none -rotate-6" aria-hidden>SM</span>
      <div className="leading-tight">
        <p className="font-mincho text-[15px] text-ink">Social Mog</p>
        <p className="text-[11px] tracking-[0.2em] text-muted">OS</p>
      </div>
    </div>
  )
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(n => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={onNavigate}
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded-shoji px-3 h-10 text-sm transition-colors duration-calm ease-calm ${
              isActive ? 'bg-raised text-ink' : 'text-muted hover:text-ink hover:bg-raised/60'}`}>
          {({ isActive }) => <>
            <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full ${isActive ? 'bg-accent' : 'bg-transparent'}`} aria-hidden />
            <span className={`w-5 text-center font-mincho text-[15px] ${isActive ? 'text-accent-ink' : 'text-muted group-hover:text-ink'}`} aria-hidden>{n.kanji}</span>
            <span>{n.label}</span>
          </>}
        </NavLink>
      ))}
    </nav>
  )
}

function GlobalSearch() {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus() } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])
  return (
    <label className="relative flex-1 max-w-xl min-w-0">
      <span className="sr-only">Search everything</span>
      <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input ref={ref} type="search" placeholder="Search brands, creators, campaigns, invoices…" className="field pl-9 pr-14 bg-card" />
      <kbd className="hidden md:block absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted border border-line/40 rounded px-1.5 py-0.5">Ctrl K</kbd>
    </label>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false)
  const { theme, setTheme } = usePrefs()
  const loc = useLocation()
  useEffect(() => setDrawer(false), [loc.pathname])

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <div className="fixed inset-x-0 top-0 h-[3px] bg-sunset z-50" aria-hidden />

      {/* desktop sidebar */}
      <aside className="hidden lg:flex flex-col gap-8 sticky top-0 h-screen px-4 pt-7 pb-5 border-r border-line/20">
        <Brandmark />
        <SideNav />
        <div className="mt-auto flex items-center gap-3 px-2">
          <span className="grid place-items-center w-8 h-8 rounded-full bg-raised text-ink text-xs font-medium" aria-hidden>F1</span>
          <div className="min-w-0 leading-tight">
            <p className="text-sm text-ink truncate">{F1}</p>
            <p className="text-xs text-muted">Founder</p>
          </div>
        </div>
      </aside>

      {/* mobile drawer */}
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-sumi/70" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-bg border-r border-line/30 px-4 pt-6 pb-5 flex flex-col gap-7 rise">
            <div className="flex items-center justify-between"><Brandmark />
              <button className="icon-btn" aria-label="Close menu" onClick={() => setDrawer(false)}><Icon name="close" className="text-lg" /></button>
            </div>
            <SideNav onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="min-w-0 flex flex-col">
        <header className="sticky top-[3px] z-30 bg-bg/90 backdrop-blur border-b border-line/20">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-8 h-16">
            <button className="icon-btn lg:hidden -ml-2" aria-label="Open menu" onClick={() => setDrawer(true)}><Icon name="menu" className="text-xl" /></button>
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <div className="hidden sm:block"><DateRangePicker /></div>
              <button className="icon-btn" aria-label={theme === 'dark' ? 'Switch to washi (light) mode' : 'Switch to sumi (dark) mode'}
                onClick={() => setTheme(theme === 'dark' ? 'washi' : 'dark')}>
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="text-lg" />
              </button>
              <button className="icon-btn relative" aria-label="Notifications, 3 unread">
                <Icon name="bell" className="text-lg" />
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-akane" aria-hidden />
              </button>
            </div>
          </div>
          <div className="sm:hidden px-4 pb-3 -mt-1"><DateRangePicker /></div>
        </header>
        <main className="flex-1 px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px] w-full mx-auto">{children}</main>
      </div>
    </div>
  )
}
