// Your status for the Ops Board: Working, Focus, In a shoot… Also keeps
// "last seen" fresh while the app is in use (30 quiet minutes → Away).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDismiss } from '../hooks/useDismiss'
import { useAuth } from '../lib/auth'
import { db } from '../data/db'

export const PRESENCE: Record<string, { label: string; dot: string }> = {
  working: { label: 'Working', dot: 'bg-kaki' }, focus: { label: 'Focus', dot: 'bg-yamabuki' }, in_shoot: { label: 'In a shoot', dot: 'bg-yamabuki' },
  in_meeting: { label: 'In a meeting', dot: 'bg-yamabuki' }, on_break: { label: 'On break', dot: 'bg-hai' }, off: { label: 'Off for the day', dot: 'bg-hai' },
  blocked: { label: 'Blocked', dot: 'bg-akane' }, away: { label: 'Away', dot: 'bg-hai' },
}
interface Row { status: string; message: string | null }

export function StatusPicker() {
  const { member } = useAuth()
  const [row, setRow] = useState<Row | null>(null)
  const [open, setOpen] = useState(false), [message, setMessage] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)
  const load = useCallback(async () => {
    if (!member) return
    const r = (await db.rows<Row>('presence', { member_id: member.id }).catch(() => []))[0] ?? null
    setRow(r); setMessage(r?.message ?? '')
  }, [member])
  useEffect(() => {
    let last = 0
    const ping = () => { if (Date.now() - last < 240_000 || document.hidden) return; last = Date.now(); db.rpc('presence_ping').then(load, () => null) }
    ping()
    const evs = ['pointerdown', 'keydown', 'visibilitychange'] as const
    evs.forEach(e => window.addEventListener(e, ping, { passive: true }))
    return () => evs.forEach(e => window.removeEventListener(e, ping))
  }, [load])
  if (!member || member.role === 'freelancer') return null
  const cur = PRESENCE[row?.status ?? 'working'] ?? PRESENCE.working
  const set = async (status: string) => { await db.rpc('set_presence', { p_status: status, p_message: message.trim() || null }); setOpen(false); load() }
  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost h-10 px-3 gap-2" aria-haspopup="dialog" aria-expanded={open} aria-label={`Your status: ${cur.label}. Change`} onClick={() => setOpen(o => !o)}>
        <span className={`w-2.5 h-2.5 rounded-full ${cur.dot}`} aria-hidden /><span className="hidden xl:inline">{cur.label}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Set your status" className="fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 top-[4.5rem] sm:top-auto sm:mt-2 z-40 sm:w-72 shoji bg-raised p-3 shadow-2xl shadow-black/30 rise">
          <label className="block text-xs text-muted mb-2">Status message (optional)
            <input className="field mt-1" maxLength={120} value={message} onChange={e => setMessage(e.target.value)} placeholder="e.g. Chai Sutra shoot till 2" /></label>
          <ul>{Object.entries(PRESENCE).filter(([k]) => k !== 'away' && k !== 'blocked').map(([k, v]) => (
            <li key={k}><button className={`w-full flex items-center gap-2.5 px-2 py-2 rounded text-sm text-left hover:bg-card ${row?.status === k ? 'text-ink font-medium' : 'text-ink'}`} onClick={() => set(k)}>
              <span className={`w-2.5 h-2.5 rounded-full ${v.dot}`} aria-hidden />{v.label}{row?.status === k && <span className="ml-auto text-xs text-muted">now</span>}</button></li>))}</ul>
          <p className="text-[11px] text-muted mt-2 px-2">Shown on the Ops Board. Focus mode and the andon button set it for you; 30 quiet minutes sets Away.</p>
        </div>
      )}
    </div>
  )
}
