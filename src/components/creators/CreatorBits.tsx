import { useState } from 'react'
import { TIER_LABEL, TIER_RANGE, type Tier } from '../../lib/creators'

/** Read-only or editable 1–5 rating. */
export function Stars({ value, onChange, size = 16, label = 'Rating' }: { value: number | null; onChange?: (v: number | null) => void; size?: number; label?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value ?? 0
  const star = (filled: boolean) => (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <path d="M10 1.8l2.5 5.3 5.8.7-4.3 4 1.1 5.8L10 14.8l-5.1 2.8 1.1-5.8-4.3-4 5.8-.7z"
        fill={filled ? '#E3793A' : 'none'} stroke={filled ? '#E3793A' : 'currentColor'} strokeOpacity={filled ? 1 : 0.5} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
  if (!onChange) return <span className="inline-flex text-muted" role="img" aria-label={value ? `${label}: ${value} of 5` : `${label}: not rated`}>{[1, 2, 3, 4, 5].map(i => <span key={i}>{star(i <= shown)}</span>)}</span>
  return (
    <span className="inline-flex text-muted" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? 's' : ''}`}
          onMouseEnter={() => setHover(i)} onClick={() => onChange(value === i ? null : i)}
          className="p-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{star(i <= shown)}</button>
      ))}
    </span>
  )
}

const TIER_STYLE: Record<Tier, string> = {
  nano: 'border border-line/50 text-muted', micro: 'border border-accent/70 text-ink',
  mid: 'bg-yamabuki text-sumi', macro: 'bg-accent text-sumi', mega: 'bg-alert text-kinari',
}
export function TierPill({ tier }: { tier: Tier | null }) {
  if (!tier) return <span className="pill border border-dashed border-line/50 text-muted">No stats</span>
  return <span className={`pill ${TIER_STYLE[tier]}`} title={`${TIER_LABEL[tier]}: ${TIER_RANGE[tier]} followers on the biggest platform`}>{TIER_LABEL[tier]}</span>
}

/** Toggle chips for multi-select lists (niches, languages, tiers). */
export function ChipSelect<T extends string>({ options, value, onChange, label, getLabel = x => x }: {
  options: T[]; value: T[]; onChange: (v: T[]) => void; label: string; getLabel?: (v: T) => string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = value.includes(o)
        return (
          <button key={o} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter(x => x !== o) : [...value, o])}
            className={`pill py-1 px-3 text-xs transition-colors duration-calm ${on ? 'bg-accent text-sumi' : 'border border-line/40 text-muted hover:text-ink hover:border-line/70'}`}>
            {getLabel(o)}
          </button>
        )
      })}
    </div>
  )
}

/** Tiny follower-growth line (kaki on the card colour). */
export function Sparkline({ points, width = 120, height = 32, label }: { points: number[]; width?: number; height?: number; label: string }) {
  if (points.length < 2) return null
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1
  const xy = points.map((p, i) => [(i / (points.length - 1)) * (width - 4) + 2, height - 3 - ((p - min) / span) * (height - 6)])
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const change = ((points.at(-1)! - points[0]) / (points[0] || 1)) * 100
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(0)}% over the period shown`}>
      <path d={d} fill="none" stroke="#E3793A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xy.at(-1)![0]} cy={xy.at(-1)![1]} r="2.4" fill="#F2A93B" />
    </svg>
  )
}
