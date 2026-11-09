import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui/Icon'
import { Andon, EnsoSpinner } from '../components/art/Ink'
import { useDismiss } from '../hooks/useDismiss'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDateTime } from '../lib/format'

interface Note { id: string; title: string; body: string | null; kind: string; table_name: string | null; record_id: string | null; read_at: string | null; created_at: string }

const PATH: Record<string, string> = { brands: '/brands', creators: '/creators', campaigns: '/campaigns', deliverables: '/production', tasks: '/tasks', invoices: '/money/invoices' }

export function Notifications() {
  const { member } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Note[] | null>(null)
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)

  const load = useCallback(async () => {
    if (!supabase || !member) { setItems([]); return }
    const { data } = await supabase.from('notifications')
      .select('id, title, body, kind, table_name, record_id, read_at, created_at')
      .eq('recipient_id', member.id).eq('is_archived', false)
      .order('created_at', { ascending: false }).limit(20)
    setItems((data as Note[]) ?? [])
    setUnread((data as Note[] | null)?.filter(n => !n.read_at).length ?? 0)
  }, [member])

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  async function markAll() {
    if (!supabase || !member) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('recipient_id', member.id).is('read_at', null)
    load()
  }

  return (
    <div className="relative" ref={ref}>
      <button className="icon-btn relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setOpen(o => !o); if (!open) load() }}>
        <Icon name="bell" className="text-lg" />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 rounded-full bg-akane text-kinari text-[10px] leading-4 text-center num" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 top-[4.5rem] sm:top-auto sm:mt-2 z-40 sm:w-96 shoji bg-raised shadow-2xl shadow-black/30 rise">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line/20">
            <p className="font-mincho text-ink">Notifications</p>
            {unread > 0 && <button className="text-xs text-muted hover:text-ink underline underline-offset-4" onClick={markAll}>Mark all read</button>}
          </div>
          {items === null ? <div className="p-5"><EnsoSpinner size={24} /></div>
            : items.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <span className="inline-block text-muted"><Andon size={28} /></span>
                <p className="font-mincho text-ink mt-3">All quiet.</p>
                <p className="text-xs text-muted mt-1">Reminders and mentions will appear here.</p>
              </div>
            ) : (
              <ul className="max-h-[60vh] overflow-y-auto divide-y divide-line/15">
                {items.map(n => (
                  <li key={n.id}>
                    <button className="w-full text-left px-4 py-3 hover:bg-card flex gap-3" onClick={async () => {
                      if (!n.read_at && supabase) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
                      if (n.table_name && n.record_id && PATH[n.table_name]) nav(`${PATH[n.table_name]}/${n.record_id}`)
                      setOpen(false); load()
                    }}>
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-akane'}`} aria-label={n.read_at ? undefined : 'Unread'} />
                      <span className="min-w-0">
                        <span className="block text-sm text-ink">{n.title}</span>
                        {n.body && <span className="block text-xs text-muted mt-0.5">{n.body}</span>}
                        <span className="block text-[11px] text-muted mt-1 num">{formatDateTime(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  )
}
