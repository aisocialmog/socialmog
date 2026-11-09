// Original ink-and-paper artwork: seasons, ensō, hanko, brush stroke,
// andon lantern, seigaiha / asanoha / torii patterns, empty-state sketches.
import { useEffect, useId, useState, type CSSProperties } from 'react'
import type { Season } from '../../lib/time'

// ─── Seasons (shiki) ─────────────────────────────────────────
const PETAL = 'M0 -6 C4 -6 6 -2 4 2 C3 4 1 6 0 6 C-1 6 -3 4 -4 2 C-6 -2 -4 -6 0 -6 Z M0 -6 L0 -3'
const MOMIJI = 'M0 -7 L1.4 -2.6 L5.8 -4.6 L3.4 -0.8 L7 1 L2.6 1.8 L3.6 6 L0 3.2 L-3.6 6 L-2.6 1.8 L-7 1 L-3.4 -0.8 L-5.8 -4.6 L-1.4 -2.6 Z'

/** Slow, sparse seasonal motion layered over the header. Hidden for reduced motion. */
export function SeasonalLayer({ season, count = 9 }: { season: Season; count?: number }) {
  const items = Array.from({ length: count }, (_, i) => i)
  if (season === 'fuyu') return null // winter = snow on Fuji's peak (drawn in <Fuji/>)
  return (
    <div className="seasonal-layer pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {items.map(i => {
        const left = (i * 37 + 11) % 100
        if (season === 'natsu') {
          return <span key={i} className="absolute rounded-full bg-yamabuki"
            style={{ left: `${left}%`, top: `${30 + (i * 23) % 60}%`, width: 3, height: 3,
                     boxShadow: '0 0 8px 2px rgba(242,169,59,.55)',
                     animation: `glow ${3 + (i % 3)}s ease-in-out ${i * 0.9}s infinite` }} />
        }
        const style: CSSProperties & Record<string, string> = {
          left: `${left}%`, top: '-12px',
          animation: `drift ${16 + (i % 5) * 3}s linear ${i * 2.1}s infinite`,
          '--dx': `${i % 2 ? 60 : -40}px`, '--rot': `${180 + i * 40}deg`,
        }
        return (
          <svg key={i} className="absolute" width="14" height="14" viewBox="-8 -8 16 16" style={style}>
            {season === 'haru'
              ? <path d={PETAL} fill="#F2E8D5" stroke="#B7282E" strokeOpacity=".5" strokeWidth=".8" fillOpacity=".85" />
              : <path d={MOMIJI} fill={i % 3 ? '#B7282E' : '#E3793A'} fillOpacity=".85" />}
          </svg>
        )
      })}
    </div>
  )
}

// ─── Ensō ────────────────────────────────────────────────────
// Brush circle: thick start, thinning tail, small open gap at the top right.
const ENSO = 'M62 14 C38 6 12 22 10 48 C8 74 30 92 54 90 C80 88 94 66 90 42 C88 30 82 22 74 17'

export function EnsoSpinner({ size = 40, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-3 text-muted">
      <svg width={size} height={size} viewBox="0 0 100 100" className="enso-spin text-accent">
        <path d={ENSO} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Progress as an ensō that closes as the value approaches 100%. */
export function EnsoRing({ value, size = 132, children }: { value: number; size?: number; children?: React.ReactNode }) {
  const v = Math.max(0, Math.min(1, value))
  const r = 40, c = 2 * Math.PI * r
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-[100deg]" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--line))" strokeOpacity=".25" strokeWidth="2" />
        {/* the brush: a wide stroke and a narrower, longer echo give a dry-brush edge */}
        <circle cx="50" cy="50" r={r} fill="none" stroke="#E3793A" strokeWidth="7.5" strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`} style={{ transition: 'stroke-dasharray 900ms var(--ease-calm)' }} />
        <circle cx="50" cy="50" r={r + 2.6} fill="none" stroke="#F2A93B" strokeOpacity=".55" strokeWidth="1.2" strokeLinecap="round"
          strokeDasharray={`${c * v * 0.92} ${c * 2}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}

// ─── Hanko seal ──────────────────────────────────────────────
export type SealKind = 'paid' | 'approved' | 'completed'
const SEAL: Record<SealKind, { kanji: string; label: string }> = {
  paid: { kanji: '済', label: 'Paid' }, approved: { kanji: '承', label: 'Approved' }, completed: { kanji: '完', label: 'Completed' },
}

export function Hanko({ kind, size = 56, animate = true }: { kind: SealKind; size?: number; animate?: boolean }) {
  const s = SEAL[kind]
  return (
    <span className={`inline-grid place-items-center ${animate ? 'hanko-in' : ''}`} style={{ width: size, height: size, transform: 'rotate(-8deg)' }}
          role="img" aria-label={`${s.label} seal`}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="absolute">
        {/* slightly uneven rim, like a real stamp */}
        <path d="M50 4 C76 3 97 23 96 50 C96 77 75 97 49 96 C23 96 4 76 4 50 C5 24 25 4 50 4 Z" fill="#B7282E" fillOpacity=".92" />
        <path d="M50 12 C72 12 88 28 88 50 C88 72 72 88 50 88 C28 88 12 72 12 50 C12 28 28 12 50 12 Z" fill="none" stroke="#F2E8D5" strokeOpacity=".9" strokeWidth="2.4" />
      </svg>
      <span className="relative font-mincho text-kinari font-bold leading-none" style={{ fontSize: size * 0.46 }} aria-hidden>{s.kanji}</span>
    </span>
  )
}

/** Plays the stamp once when `when` flips to true. */
export function useStamp(when: boolean) {
  const [show, setShow] = useState(false)
  useEffect(() => { if (when) setShow(true) }, [when])
  return show
}

// ─── Sumi-e brush divider ────────────────────────────────────
export function BrushDivider({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 14" preserveAspectRatio="none" className={`w-full h-3 text-line ${className}`} aria-hidden>
      <path d="M2 8 C40 5 90 4 160 5.5 C260 7.5 340 4 430 5 C500 6 560 7.5 598 9 C560 10 500 9 430 9.4 C340 10 260 11 160 9.6 C90 9 40 10 2 8 Z"
            fill="currentColor" fillOpacity=".45" />
    </svg>
  )
}

// ─── Andon (paper lantern) icon ──────────────────────────────
export function Andon({ size = 18, lit = false }: { size?: number; lit?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 2.5h6M12 2.5V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 4h8l.8 1.8H7.2z" fill="currentColor" />
      <path d="M7.2 5.8C5 8 5 16 7.2 18.2h9.6C19 16 19 8 16.8 5.8z" fill={lit ? '#B7282E' : 'none'} stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.3 9.5h11.4M6 12h12M6.3 14.5h11.4" stroke={lit ? '#F2E8D5' : 'currentColor'} strokeOpacity=".7" strokeWidth="1" />
      <path d="M8 18.2h8l-.8 1.8H8.8z" fill="currentColor" />
      <path d="M12 20v1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ─── Patterns (quiet backgrounds, 3–5% opacity) ──────────────
export function Seigaiha({ opacity = 0.05 }: { opacity?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden style={{ opacity }}>
      <defs>
        <pattern id={id} width="48" height="24" patternUnits="userSpaceOnUse">
          {[22, 16, 10, 4].map(r => (
            <g key={r} fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d={`M${24 - r} 24 a${r} ${r} 0 0 1 ${2 * r} 0`} />
              <path d={`M${-r} 12 a${r} ${r} 0 0 1 ${2 * r} 0`} />
              <path d={`M${48 - r} 12 a${r} ${r} 0 0 1 ${2 * r} 0`} />
            </g>
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} className="text-ink" />
    </svg>
  )
}

export function Asanoha({ opacity = 0.04 }: { opacity?: number }) {
  const id = useId().replace(/:/g, '')
  // hexagonal hemp-leaf star: six spokes from the centre plus the six-point outline
  const h = 34.64
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden style={{ opacity }}>
      <defs>
        <pattern id={id} width="40" height={h * 2} patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth=".9">
            {[[20, h], [0, 0], [40, 0], [0, 2 * h], [40, 2 * h]].map(([cx, cy], k) => (
              <g key={k}>
                {[0, 60, 120, 180, 240, 300].map(a => {
                  const rad = (a * Math.PI) / 180
                  return <line key={a} x1={cx} y1={cy} x2={cx + 20 * Math.cos(rad)} y2={cy + 20 * Math.sin(rad)} />
                })}
                {[30, 90, 150, 210, 270, 330].map(a => {
                  const rad = (a * Math.PI) / 180, r2 = 11.5
                  const x = cx + r2 * Math.cos(rad), y = cy + r2 * Math.sin(rad)
                  return <g key={a}>
                    <line x1={x} y1={y} x2={cx + 20 * Math.cos(rad - Math.PI / 6)} y2={cy + 20 * Math.sin(rad - Math.PI / 6)} />
                    <line x1={x} y1={y} x2={cx + 20 * Math.cos(rad + Math.PI / 6)} y2={cy + 20 * Math.sin(rad + Math.PI / 6)} />
                    <line x1={x} y1={y} x2={cx} y2={cy} />
                  </g>
                })}
              </g>
            ))}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} className="text-ink" />
    </svg>
  )
}

export function Torii({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" className={className} fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden>
      <path d="M14 26 C60 18 140 18 186 26" strokeWidth="5" />
      <path d="M30 44 H170" strokeWidth="3" />
      <path d="M100 26 V44" strokeWidth="3" />
      <path d="M56 30 L50 156 M144 30 L150 156" strokeWidth="4" />
    </svg>
  )
}

// ─── Empty-state ink sketches ────────────────────────────────
export function InkSketch({ kind, className = 'w-28 h-20' }: { kind: 'fuji' | 'koi' | 'branch'; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 140 90" className={`${className} text-muted`} aria-hidden>
      {kind === 'fuji' && <>
        <circle cx="92" cy="34" r="11" fill="#E3793A" fillOpacity=".8" />
        <path {...common} strokeWidth="1.6" d="M14 78 C34 72 46 58 58 40 L64 32 H76 L82 40 C94 58 106 72 126 78" />
        <path {...common} strokeWidth="1.2" d="M58 40 L64 44 L70 38 L76 44 L82 40" />
        <path {...common} strokeWidth="1" strokeOpacity=".6" d="M6 84 H134" />
      </>}
      {kind === 'koi' && <>
        <path {...common} strokeWidth="1" strokeOpacity=".5" d="M20 70 C40 64 60 76 80 70 S120 64 130 70" />
        <path {...common} strokeWidth="1.6" d="M40 44 C52 30 82 28 96 40 C102 45 104 50 98 53 C84 60 54 60 40 44 Z" />
        <path {...common} strokeWidth="1.6" d="M40 44 L26 34 L30 46 L24 58 Z" />
        <path d="M62 38 C70 34 80 36 84 42 C76 46 66 46 62 38 Z" fill="#B7282E" fillOpacity=".85" />
        <circle cx="90" cy="44" r="1.4" fill="currentColor" />
      </>}
      {kind === 'branch' && <>
        <path {...common} strokeWidth="2" d="M10 70 C40 60 70 44 128 22" />
        <path {...common} strokeWidth="1.3" d="M58 52 C62 42 70 38 78 36 M92 38 C94 30 100 26 108 24" />
        {[[78, 35], [108, 23], [46, 58], [122, 25]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 2 ? 4 : 3.2} fill={i % 2 ? '#B7282E' : '#E3793A'} fillOpacity=".8" />
        ))}
      </>}
    </svg>
  )
}
