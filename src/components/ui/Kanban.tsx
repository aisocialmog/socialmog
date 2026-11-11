// Shared drag-and-drop board. Mouse: drag the card. Touch: drag by the grip
// (so the page still scrolls). Keyboard / screen readers: each card's "…" menu
// offers "Move to …". Used by the brand pipeline and the campaign board.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreMenu } from './kit'
import { FormError } from '../../pages/auth/AuthLayout'

export interface KanbanColumn<K extends string> { key: K; label: string; kanji?: string }
interface Drag<K> { id: string; from: K; x: number; y: number; dx: number; dy: number; w: number; active: boolean; over: K | null; sx: number; sy: number }

export function Kanban<T, K extends string>({ columns, items, getId, getColumn, getName, renderCard, onMove, onOpen, columnMeta, hint, limits }: {
  columns: KanbanColumn<K>[]; items: T[]; getId: (t: T) => string; getColumn: (t: T) => K; getName: (t: T) => string
  renderCard: (t: T, grip: ReactNode) => ReactNode; onMove: (t: T, to: K) => Promise<void>; onOpen: (t: T) => void
  columnMeta?: (key: K, items: T[]) => ReactNode; hint?: string
  /** WIP limits: a column over its limit turns akane red. */
  limits?: Partial<Record<K, number>>
}) {
  const board = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag<K> | null>(null)
  const dragRef = useRef<Drag<K> | null>(null)
  const justDragged = useRef(false)
  const [announce, setAnnounce] = useState('')
  const [error, setError] = useState<string | null>(null)
  const label = (k: K) => columns.find(c => c.key === k)?.label ?? k

  const move = async (t: T, to: K) => {
    if (getColumn(t) === to) return
    setError(null)
    try { await onMove(t, to); setAnnounce(`${getName(t)} moved to ${label(to)}`) }
    catch (e) { setError(`Couldn’t move ${getName(t)}: ${e instanceof Error ? e.message : 'try again'}`) }
  }

  useEffect(() => {
    if (!drag) return
    const onMoveEv = (e: PointerEvent) => {
      const d = dragRef.current; if (!d) return
      const active = d.active || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6
      if (active) e.preventDefault()
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-column]')
      const over = (el?.dataset.column as K | undefined) ?? null
      const r = board.current?.getBoundingClientRect()
      if (active && r && board.current) {
        if (e.clientX > r.right - 48) board.current.scrollLeft += 14
        else if (e.clientX < r.left + 48) board.current.scrollLeft -= 14
      }
      dragRef.current = { ...d, x: e.clientX, y: e.clientY, active, over }
      setDrag(dragRef.current)
    }
    const onUp = () => {
      const d = dragRef.current
      dragRef.current = null; setDrag(null)
      if (d?.active) {
        justDragged.current = true; setTimeout(() => { justDragged.current = false }, 0)
        const t = items.find(x => getId(x) === d.id)
        if (t && d.over && d.over !== d.from) move(t, d.over)
      }
    }
    window.addEventListener('pointermove', onMoveEv, { passive: false })
    window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp)
    return () => { window.removeEventListener('pointermove', onMoveEv); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null])

  const start = (e: React.PointerEvent, t: T, viaHandle: boolean) => {
    if (e.button !== 0) return
    if (!viaHandle && e.pointerType !== 'mouse') return
    if (!viaHandle && (e.target as HTMLElement).closest('a,button,select,input')) return
    const card = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-card]')!
    const r = card.getBoundingClientRect()
    dragRef.current = { id: getId(t), from: getColumn(t), x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, active: viaHandle, over: getColumn(t) }
    setDrag(dragRef.current)
  }
  const grip = (t: T) => (
    <button type="button" aria-label={`Drag ${getName(t)}`} onPointerDown={e => { e.stopPropagation(); start(e, t, true) }} onClick={e => e.stopPropagation()}
      className="lg:hidden grid place-items-center w-9 h-9 -m-2 rounded-shoji text-muted touch-none">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="currentColor">{[3, 7, 11].flatMap(y => [4, 10].map(x => <circle key={`${x}${y}`} cx={x} cy={y} r="1.3" />))}</svg>
    </button>
  )
  const dragged = drag?.active ? items.find(t => getId(t) === drag.id) : undefined

  return (
    <div className="space-y-3">
      {error && <FormError>{error}</FormError>}
      <p className="sr-only" aria-live="polite">{announce}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      <div ref={board} className={`flex gap-3 sm:gap-4 overflow-x-auto pb-3 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory lg:snap-none ${drag?.active ? 'select-none' : ''}`}>
        {columns.map(col => {
          const list = items.filter(t => getColumn(t) === col.key)
          const max = limits?.[col.key], overWip = max != null && list.length > max
          const isOver = drag?.active && drag.over === col.key && drag.from !== col.key
          return (
            <section key={col.key} data-column={col.key} aria-label={`${col.label}, ${list.length}`}
              className={`snap-start shrink-0 w-[82vw] sm:w-72 ${columns.length <= 5 ? 'lg:w-auto lg:flex-1 lg:min-w-[12.5rem]' : 'lg:w-64'} rounded-shoji border transition-colors duration-calm flex flex-col
                ${isOver ? 'border-accent bg-raised/70' : 'border-line/20 bg-card/50'}`}>
              <header className={`px-4 pt-4 pb-3 flex items-baseline justify-between gap-2 rounded-t-shoji ${overWip ? 'bg-akane text-kinari [&_*]:!text-kinari' : ''}`} data-over-wip={overWip || undefined}>
                <h2 className="font-mincho text-ink flex items-baseline gap-2">{col.kanji && <span className="text-accent-ink text-sm" aria-hidden lang="ja">{col.kanji}</span>}{col.label}</h2>
                <span className="text-xs text-muted num">{columnMeta ? columnMeta(col.key, list) : list.length}{max != null && <> / {max}{overWip && <span className="sr-only"> — over the limit</span>}</>}</span>
              </header>
              <ul className="px-2.5 pb-2.5 space-y-2.5 min-h-[7rem] flex-1">
                {list.map(t => (
                  <li key={getId(t)} data-card onPointerDown={e => start(e, t, false)} onClick={() => { if (!justDragged.current) onOpen(t) }}
                    className={`shoji bg-card p-3.5 cursor-pointer lg:cursor-grab hover:border-line/50 transition-opacity duration-calm ${drag?.active && drag.id === getId(t) ? 'opacity-30' : ''}`}>
                    <div className="relative">
                      <div className="absolute -right-2 -top-2" onClick={e => e.stopPropagation()}>
                        <MoreMenu label={`Actions for ${getName(t)}`} items={columns.filter(c => c.key !== getColumn(t)).map(c => ({ label: `Move to ${c.label}`, onSelect: () => move(t, c.key) }))} />
                      </div>
                      {renderCard(t, grip(t))}
                    </div>
                  </li>
                ))}
                {list.length === 0 && <li className="text-xs text-muted text-center py-6 border border-dashed border-line/25 rounded-shoji">Drop here</li>}
              </ul>
            </section>
          )
        })}
      </div>
      {dragged && drag && (
        <div className="fixed z-50 pointer-events-none shoji bg-raised p-3.5 shadow-2xl shadow-black/40 rotate-[1.5deg]" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }} aria-hidden>
          {renderCard(dragged, null)}
        </div>
      )}
    </div>
  )
}
