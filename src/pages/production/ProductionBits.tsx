import type { ProductionItem } from '../../data/production'
import { brandColor, onBrandColor } from '../../lib/production'
import { Andon } from '../../components/art/Ink'

/** Brand colour chip — always with the name, so colour is never the only cue. */
export function BrandChip({ color, name, small = false }: { color: number | null; name: string; small?: boolean }) {
  const c = brandColor(color)
  return <span className={`inline-flex items-center gap-1.5 min-w-0 ${small ? 'text-[11px]' : 'text-xs'} text-muted`}>
    <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-line/40" style={{ background: c }} aria-hidden /><span className="truncate">{name}</span>
  </span>
}
export function brandStyle(color: number | null) { const c = brandColor(color); return { background: c, color: onBrandColor(c) } }

/** Stuck / past target date / over revision limit — red lantern pills with words. */
export function Flags({ i, compact = false }: { i: ProductionItem; compact?: boolean }) {
  const f: string[] = []
  if (i.is_overdue) f.push(compact ? 'Past post date' : `Past target post date (${i.target_date})`)
  if (i.is_stuck) f.push(`${i.days_in_stage}d in this stage`)
  if (i.over_revision_limit) f.push(`${i.revision_count}/${i.revision_limit} revisions`)
  if (!f.length) return null
  return <span className="flex flex-wrap gap-1">{f.map(x => <span key={x} className="pill bg-alert text-kinari text-[11px]"><Andon size={11} />{x}</span>)}</span>
}
