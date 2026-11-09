import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Asanoha, InkSketch } from '../art/Ink'
import { Icon } from './Icon'

/** Shoji-panel card. */
export function Card({ children, className = '', pattern = false, as: As = 'section' }: {
  children: ReactNode; className?: string; pattern?: boolean; as?: 'section' | 'div' | 'article'
}) {
  return <As className={`shoji relative overflow-hidden ${className}`}>{pattern && <Asanoha />}<div className="relative">{children}</div></As>
}

export function EmptyState({ sketch = 'fuji', line, action }: { sketch?: 'fuji' | 'koi' | 'branch'; line: string; action?: ReactNode }) {
  return (
    <div className="relative grid place-items-center text-center py-12 px-6 overflow-hidden rounded-shoji">
      <Asanoha opacity={0.05} />
      <div className="relative flex flex-col items-center gap-4">
        <InkSketch kind={sketch} />
        <p className="font-mincho text-lg text-ink">{line}</p>
        {action}
      </div>
    </div>
  )
}

const TONES = {
  accent: 'bg-accent text-sumi',
  alert: 'bg-alert text-kinari',
  warm: 'bg-yamabuki text-sumi',
  quiet: 'border border-line/50 text-muted',
  ink: 'bg-ink text-bg',
} as const
export type Tone = keyof typeof TONES
export function Pill({ tone = 'quiet', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${TONES[tone]}`}>{children}</span>
}

/** The "…" menu that holds every secondary action. */
export function MoreMenu({ items, label = 'More actions' }: { items: { label: string; onSelect: () => void; danger?: boolean }[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="more" className="text-xl" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-52 shoji bg-raised py-1.5 shadow-2xl shadow-black/30 rise">
          {items.map(it => (
            <button key={it.label} role="menuitem" onClick={() => { setOpen(false); it.onSelect() }}
              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-card focus:bg-card focus:outline-none ${it.danger ? 'text-ink underline decoration-akane decoration-2 underline-offset-4' : 'text-ink'}`}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function SectionTitle({ kanji, children, aside }: { kanji?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <h2 className="font-mincho text-lg text-ink flex items-baseline gap-2">
        {kanji && <span className="text-accent-ink text-base" aria-hidden>{kanji}</span>}{children}
      </h2>
      {aside}
    </div>
  )
}

/** "Preview data" marker — shown until Supabase is connected. */
export function PreviewBadge() {
  return <span className="pill border border-dashed border-line/60 text-muted" title="Sample records for the design preview — not real data">Preview data</span>
}
