import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../components/ui/Avatar'
import { Icon } from '../components/ui/Icon'
import { useDismiss } from '../hooks/useDismiss'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL } from '../lib/access'
import { usePrefs } from '../lib/prefs'

export function UserMenu() {
  const { member, signOut, isPreview } = useAuth()
  const { theme, setTheme, seasonal, setSeasonal } = usePrefs()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)
  if (!member) return null
  return (
    <div className="relative" ref={ref}>
      <button className="flex items-center gap-2 rounded-full p-1 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`Account menu for ${member.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Avatar name={member.name} path={member.photo_path} size={32} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 z-40 w-64 shoji bg-raised shadow-2xl shadow-black/30 rise py-2">
          <div className="px-4 py-2.5 flex items-center gap-3">
            <Avatar name={member.name} path={member.photo_path} size={40} />
            <div className="min-w-0">
              <p className="text-sm text-ink truncate">{member.name}</p>
              <p className="text-xs text-muted truncate">{ROLE_LABEL[member.role]}{isPreview ? ' · preview' : ''}</p>
            </div>
          </div>
          <div className="my-1.5 h-px bg-line/20" />
          <Link role="menuitem" to="/settings" onClick={close} className="block px-4 py-2.5 text-sm text-ink hover:bg-card">My profile</Link>
          <button role="menuitemcheckbox" aria-checked={theme === 'washi'} onClick={() => setTheme(theme === 'dark' ? 'washi' : 'dark')}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-ink hover:bg-card">
            {theme === 'dark' ? 'Washi (light) mode' : 'Sumi (dark) mode'} <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="text-muted" />
          </button>
          <button role="menuitemcheckbox" aria-checked={seasonal} onClick={() => setSeasonal(!seasonal)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-ink hover:bg-card">
            Seasonal effects <span className={`text-xs ${seasonal ? 'text-accent-ink' : 'text-muted'}`}>{seasonal ? 'On' : 'Off'}</span>
          </button>
          <div className="my-1.5 h-px bg-line/20" />
          <button role="menuitem" onClick={signOut} className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-card">Sign out</button>
        </div>
      )}
    </div>
  )
}
