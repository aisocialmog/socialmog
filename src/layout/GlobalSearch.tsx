// Top-bar search across brands, creators, campaigns and invoices.
// Calls the global_search() database function, which runs under the user's
// own permissions — so each role only ever finds what it may open.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui/Icon'
import { EnsoSpinner } from '../components/art/Ink'
import { useDismiss } from '../hooks/useDismiss'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Kind = 'brand' | 'creator' | 'campaign' | 'invoice'
interface Hit { kind: Kind; id: string; title: string; subtitle: string | null }
const KIND: Record<Kind, { kanji: string; label: string; path: string }> = {
  brand: { kanji: '商', label: 'Brand', path: '/brands' },
  creator: { kanji: '人', label: 'Creator', path: '/creators' },
  campaign: { kanji: '陣', label: 'Campaign', path: '/campaigns' },
  invoice: { kanji: '金', label: 'Invoice', path: '/money/invoices' },
}

export function GlobalSearch({ autoFocus = false, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const nav = useNavigate()
  const { isPreview } = useAuth()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, box, close)

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); setOpen(true) }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setHits([]); setBusy(false); return }
    setBusy(true)
    const t = setTimeout(async () => {
      if (!supabase) { setHits([]); setBusy(false); return }
      const { data, error } = await supabase.rpc('global_search', { q: term, max_results: 12 })
      setHits(error ? [] : (data as Hit[])); setActive(0); setBusy(false)
    }, 220)
    return () => clearTimeout(t)
  }, [q])

  const go = (h: Hit) => { nav(`${KIND[h.kind].path}/${h.id}`); setOpen(false); setQ(''); onDone?.() }
  const showList = open && q.trim().length >= 2

  return (
    <div ref={box} className="relative flex-1 max-w-xl min-w-0">
      <label className="relative block">
        <span className="sr-only">Search brands, creators, campaigns and invoices</span>
        <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input ref={input} type="search" autoFocus={autoFocus} value={q} placeholder="Search brands, creators, campaigns, invoices…"
          className="field pl-9 pr-14 bg-card" role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
          onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
            if (e.key === 'Enter' && hits[active]) { e.preventDefault(); go(hits[active]) }
          }} />
        <kbd className="hidden md:block absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted border border-line/40 rounded px-1.5 py-0.5">Ctrl K</kbd>
      </label>
      {showList && (
        <div className="absolute left-0 right-0 mt-2 z-40 shoji bg-raised shadow-2xl shadow-black/30 rise overflow-hidden">
          {busy ? <div className="p-4"><EnsoSpinner size={24} label="Searching" /></div>
            : hits.length === 0 ? (
              <p className="p-4 text-sm text-muted">{isPreview ? 'Search runs against the database — connect Supabase to try it.' : `Nothing found for “${q.trim()}”.`}</p>
            ) : (
              <ul id={listId} role="listbox" className="max-h-[60vh] overflow-y-auto py-1.5">
                {hits.map((h, i) => (
                  <li key={h.kind + h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                    onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); go(h) }}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${i === active ? 'bg-card' : ''}`}>
                    <span className="w-6 text-center font-mincho text-accent-ink" aria-hidden>{KIND[h.kind].kanji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink truncate">{h.title}</span>
                      {h.subtitle && <span className="block text-xs text-muted truncate">{h.subtitle}</span>}
                    </span>
                    <span className="text-[11px] text-muted">{KIND[h.kind].label}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  )
}
