// Lead pipeline: one column per status, drag a card to change its status.
// Mouse: drag the card. Touch: drag by the grip (so the page still scrolls).
// Keyboard / screen readers: the "…" menu on each card has "Move to …".
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { BrandOverview } from '../../data/brands'
import { BRAND_STATUSES, ENGAGEMENT_SHORT, STATUS_LABEL, type BrandStatus } from '../../lib/brands'
import { formatINRShort } from '../../lib/format'
import { Avatar } from '../../components/ui/Avatar'
import { MoreMenu } from '../../components/ui/kit'
import { BrandLogo, RenewalWarning } from '../../components/brands/BrandBits'
import { FormError } from '../auth/AuthLayout'

interface Drag { id: string; from: BrandStatus; x: number; y: number; dx: number; dy: number; w: number; active: boolean; over: BrandStatus | null; sx: number; sy: number }

const COLUMN_KANJI: Record<BrandStatus, string> = { lead: '芽', pitching: '話', active: '動', paused: '休', ended: '終' }

export function BrandPipeline({ brands, money, onMove }: {
  brands: BrandOverview[]; money: boolean; onMove: (id: string, to: BrandStatus) => Promise<void>
}) {
  const nav = useNavigate()
  const board = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const justDragged = useRef(false)
  const [announce, setAnnounce] = useState('')
  const [error, setError] = useState<string | null>(null)

  const move = async (b: BrandOverview, to: BrandStatus) => {
    if (b.status === to) return
    setError(null)
    try { await onMove(b.id, to); setAnnounce(`${b.name} moved to ${STATUS_LABEL[to]}`) }
    catch (e) { setError(`Couldn’t move ${b.name}: ${e instanceof Error ? e.message : 'try again'}`) }
  }

  useEffect(() => {
    if (!drag) return
    const onMoveEv = (e: PointerEvent) => {
      const d = dragRef.current; if (!d) return
      const active = d.active || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6
      if (active) e.preventDefault()
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-status]')
      const over = (el?.dataset.status as BrandStatus | undefined) ?? null
      // gentle auto-scroll near the board edges (phones show one column at a time)
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
        const b = brands.find(x => x.id === d.id)
        if (b && d.over && d.over !== d.from) move(b, d.over)
      }
    }
    window.addEventListener('pointermove', onMoveEv, { passive: false })
    window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp)
    return () => { window.removeEventListener('pointermove', onMoveEv); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null])

  const start = (e: React.PointerEvent, b: BrandOverview, viaHandle: boolean) => {
    if (e.button !== 0) return
    if (!viaHandle && e.pointerType !== 'mouse') return          // touch: only the grip starts a drag
    if (!viaHandle && (e.target as HTMLElement).closest('a,button,select,input')) return
    const card = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-card]')!
    const r = card.getBoundingClientRect()
    dragRef.current = { id: b.id, from: b.status, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, active: viaHandle, over: b.status }
    setDrag(dragRef.current)
  }

  const dragged = drag?.active ? brands.find(b => b.id === drag.id) : null

  return (
    <div className="space-y-3">
      {error && <FormError>{error}</FormError>}
      <p className="sr-only" aria-live="polite">{announce}</p>
      <p className="text-xs text-muted">Drag a card to another column to change its status — on a phone, drag by the grip. Every move is saved in the brand’s activity.</p>
      <div ref={board} className={`flex gap-3 sm:gap-4 overflow-x-auto pb-3 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory lg:snap-none ${drag?.active ? 'select-none' : ''}`}>
        {BRAND_STATUSES.map(status => {
          const col = brands.filter(b => b.status === status)
          const isOver = drag?.active && drag.over === status && drag.from !== status
          const fees = col.reduce((s, b) => s + (Number(b.monthly_fee) || 0), 0)
          return (
            <section key={status} data-status={status} aria-label={`${STATUS_LABEL[status]}, ${col.length} brands`}
              className={`snap-start shrink-0 w-[82vw] sm:w-72 lg:w-auto lg:flex-1 lg:min-w-[12.5rem] rounded-shoji border transition-colors duration-calm flex flex-col
                ${isOver ? 'border-accent bg-raised/70' : 'border-line/20 bg-card/50'}`}>
              <header className="px-4 pt-4 pb-3 flex items-baseline justify-between gap-2">
                <h2 className="font-mincho text-ink flex items-baseline gap-2"><span className="text-accent-ink text-sm" aria-hidden lang="ja">{COLUMN_KANJI[status]}</span>{STATUS_LABEL[status]}</h2>
                <span className="text-xs text-muted num">{col.length}{money && fees > 0 ? ` · ${formatINRShort(fees)}/mo` : ''}</span>
              </header>
              <ul className="px-2.5 pb-2.5 space-y-2.5 min-h-[7rem] flex-1">
                {col.map(b => {
                  const ghosting = drag?.active && drag.id === b.id
                  return (
                    <li key={b.id} data-card
                      onPointerDown={e => start(e, b, false)}
                      onClick={() => { if (!justDragged.current) nav(`/brands/${b.id}`) }}
                      className={`shoji bg-card p-3.5 cursor-pointer lg:cursor-grab hover:border-line/50 transition-opacity duration-calm ${ghosting ? 'opacity-30' : ''}`}>
                      <CardBody b={b} onGrip={e => start(e, b, true)}
                        menu={<MoreMenu label={`Actions for ${b.name}`} items={BRAND_STATUSES.filter(s => s !== b.status).map(s => ({ label: `Move to ${STATUS_LABEL[s]}`, onSelect: () => move(b, s) }))} />} />
                    </li>
                  )
                })}
                {col.length === 0 && <li className="text-xs text-muted text-center py-6 border border-dashed border-line/25 rounded-shoji">Drop a brand here</li>}
              </ul>
            </section>
          )
        })}
      </div>

      {dragged && drag && (
        <div className="fixed z-50 pointer-events-none shoji bg-raised p-3.5 shadow-2xl shadow-black/40 rotate-[1.5deg]"
             style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }} aria-hidden>
          <CardBody b={dragged} />
        </div>
      )}
    </div>
  )
}

function CardBody({ b, onGrip, menu }: { b: BrandOverview; onGrip?: (e: React.PointerEvent) => void; menu?: React.ReactNode }) {
  return <>
    <div className="flex items-start gap-2.5">
      <BrandLogo name={b.name} path={b.logo_path} size={32} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink font-medium leading-snug break-words">{b.name}</p>
        <p className="text-xs text-muted truncate">{[ENGAGEMENT_SHORT[b.engagement_type], b.industry].filter(Boolean).join(' · ')}</p>
      </div>
      {menu && <div className="-mr-2 -mt-2" onClick={e => e.stopPropagation()}>{menu}</div>}
    </div>
    {b.renewal_warning && <div className="mt-2.5"><RenewalWarning compact renewalDate={b.renewal_date} days={b.days_to_renewal} /></div>}
    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
      {b.owner_name ? <span className="flex items-center gap-1.5 min-w-0"><Avatar name={b.owner_name} path={b.owner_photo_path} size={20} /><span className="truncate">{b.owner_name}</span></span> : <span>No owner</span>}
      <span className="flex items-center gap-2">
        {b.active_campaigns > 0 && <span className="num">{b.active_campaigns} live</span>}
        {onGrip && (
          <button type="button" aria-label={`Drag ${b.name}`} onPointerDown={e => { e.stopPropagation(); onGrip(e) }} onClick={e => e.stopPropagation()}
            className="lg:hidden grid place-items-center w-9 h-9 -m-2 rounded-shoji text-muted touch-none">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="currentColor">{[3, 7, 11].flatMap(y => [4, 10].map(x => <circle key={`${x}${y}`} cx={x} cy={y} r="1.3" />))}</svg>
          </button>
        )}
      </span>
    </div>
  </>
}
