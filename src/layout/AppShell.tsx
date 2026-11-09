import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { DateRangePicker } from './DateRangePicker'
import { GlobalSearch } from './GlobalSearch'
import { Notifications } from './Notifications'
import { UserMenu } from './UserMenu'
import { Icon } from '../components/ui/Icon'
import { Avatar } from '../components/ui/Avatar'
import { useAuth } from '../lib/auth'
import { moreFor, navFor, ROLE_LABEL, tabsFor, type NavItem } from '../lib/access'
import { usePrefs } from '../lib/prefs'

function Brandmark() {
  return (
    <Link to="/" className="flex items-center gap-3 px-2 rounded-shoji focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <span className="grid place-items-center w-9 h-9 rounded-full bg-akane text-kinari font-mincho text-[13px] font-bold tracking-tight leading-none -rotate-6" aria-hidden>SM</span>
      <span className="leading-tight">
        <span className="block font-mincho text-[15px] text-ink">Social Mog</span>
        <span className="block text-[11px] tracking-[0.2em] text-muted">OS</span>
      </span>
    </Link>
  )
}

const isActive = (to: string, path: string) => to === '/' ? path === '/' : path === to || path.startsWith(to + '/')

function SideNav({ items }: { items: NavItem[] }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map(n => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'}
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

/** Phone: five most-used pages for this role + "More". */
function BottomTabs({ tabs, more, onMore, moreOpen }: { tabs: NavItem[]; more: NavItem[]; onMore: () => void; moreOpen: boolean }) {
  const { pathname } = useLocation()
  const moreActive = more.some(m => isActive(m.to, pathname))
  const cell = 'flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-full text-[10.5px] transition-colors duration-calm'
  return (
    <nav aria-label="Main" className="lg:hidden fixed inset-x-0 bottom-0 z-40 bg-bg/95 backdrop-blur border-t border-line/25"
         style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex h-16 px-1">
        {tabs.map(t => {
          const on = isActive(t.to, pathname)
          return (
            <NavLink key={t.to} to={t.to} end={t.to === '/'} className={`${cell} ${on ? 'text-ink' : 'text-muted'}`} aria-current={on ? 'page' : undefined}>
              <span className={`font-mincho text-xl leading-none ${on ? 'text-accent-ink' : ''}`} aria-hidden>{t.kanji}</span>
              <span className="truncate max-w-full">{t.label}</span>
              <span className={`h-[3px] w-5 rounded-full ${on ? 'bg-accent' : 'bg-transparent'}`} aria-hidden />
            </NavLink>
          )
        })}
        <button className={`${cell} ${moreActive || moreOpen ? 'text-ink' : 'text-muted'}`} onClick={onMore} aria-haspopup="dialog" aria-expanded={moreOpen}>
          <Icon name="more" className={`text-2xl leading-none ${moreActive ? 'text-accent-ink' : ''}`} />
          <span>More</span>
          <span className={`h-[3px] w-5 rounded-full ${moreActive ? 'bg-accent' : 'bg-transparent'}`} aria-hidden />
        </button>
      </div>
    </nav>
  )
}

function MoreSheet({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const { member, signOut } = useAuth()
  const { theme, setTheme } = usePrefs()
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  if (!member) return null
  return (
    <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="More">
      <button className="absolute inset-0 bg-sumi/70" aria-label="Close" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 bg-bg rounded-t-[14px] border-t border-line/30 px-4 pt-3 rise"
           style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <span className="block mx-auto w-10 h-1 rounded-full bg-line/40 mb-4" aria-hidden />
        <div className="flex items-center gap-3 px-1 pb-4">
          <Avatar name={member.name} path={member.photo_path} size={40} />
          <div className="min-w-0"><p className="text-ink truncate">{member.name}</p><p className="text-xs text-muted">{ROLE_LABEL[member.role]}</p></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {items.map(n => (
            <NavLink key={n.to} to={n.to} onClick={onClose}
              className={({ isActive }) => `shoji flex flex-col items-center gap-1.5 py-4 text-sm ${isActive ? 'text-ink border-accent/60' : 'text-muted'}`}>
              <span className="font-mincho text-2xl text-accent-ink leading-none" aria-hidden>{n.kanji}</span>{n.label}
            </NavLink>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="btn-ghost justify-center" onClick={() => setTheme(theme === 'dark' ? 'washi' : 'dark')}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} /> {theme === 'dark' ? 'Washi mode' : 'Sumi mode'}
          </button>
          <button className="btn-ghost justify-center" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { member, isPreview } = useAuth()
  const { pathname } = useLocation()
  const [more, setMore] = useState(false)
  const [mobileSearch, setMobileSearch] = useState(false)
  useEffect(() => { setMore(false); setMobileSearch(false) }, [pathname])
  if (!member) return null
  const nav = navFor(member.role), tabs = tabsFor(member.role), extra = moreFor(member.role)

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <div className="fixed inset-x-0 top-0 h-[3px] bg-sunset z-50" aria-hidden />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] btn-primary">Skip to content</a>

      <aside className="hidden lg:flex flex-col gap-8 sticky top-0 h-screen px-4 pt-7 pb-5 border-r border-line/20">
        <Brandmark />
        <SideNav items={nav} />
        <div className="mt-auto flex items-center gap-3 px-2">
          <Avatar name={member.name} path={member.photo_path} size={32} />
          <div className="min-w-0 leading-tight">
            <p className="text-sm text-ink truncate">{member.name}</p>
            <p className="text-xs text-muted">{ROLE_LABEL[member.role]}</p>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex flex-col">
        <header className="sticky top-[3px] z-30 bg-bg/90 backdrop-blur border-b border-line/20">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-8 h-16">
            <span className="lg:hidden"><Link to="/" aria-label="Dashboard" className="grid place-items-center w-9 h-9 rounded-full bg-akane text-kinari font-mincho text-[12px] font-bold -rotate-6">SM</Link></span>
            <div className="hidden sm:flex flex-1 min-w-0"><GlobalSearch /></div>
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <button className="icon-btn sm:hidden" aria-label="Search" onClick={() => setMobileSearch(true)}><Icon name="search" className="text-lg" /></button>
              <div className="hidden md:block"><DateRangePicker /></div>
              <Notifications />
              <UserMenu />
            </div>
          </div>
          <div className="md:hidden px-4 pb-3 -mt-1 flex items-center gap-2">
            <DateRangePicker />
            {isPreview && <span className="pill border border-dashed border-line/60 text-muted">Preview</span>}
          </div>
          {mobileSearch && (
            <div className="sm:hidden absolute inset-x-0 top-0 h-16 bg-bg flex items-center gap-2 px-4 z-10">
              <GlobalSearch autoFocus onDone={() => setMobileSearch(false)} />
              <button className="icon-btn" aria-label="Close search" onClick={() => setMobileSearch(false)}><Icon name="close" className="text-lg" /></button>
            </div>
          )}
        </header>
        <main id="main" className="flex-1 px-4 sm:px-8 py-6 sm:py-8 pb-28 lg:pb-8 max-w-[1400px] w-full mx-auto">{children}</main>
      </div>

      <BottomTabs tabs={tabs} more={extra} moreOpen={more} onMore={() => setMore(true)} />
      {more && <MoreSheet items={extra} onClose={() => setMore(false)} />}
    </div>
  )
}
