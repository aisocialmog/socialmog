// Original line-art Mount Fuji with a sky that follows the real time in IST.
// dawn 5–9 · day 9–16 · sunset 16–19 · night 19–5
import { useId } from 'react'
import type { Season, SkyPhase } from '../../lib/time'

// Sky stops use the palette only. Night uses one illustration-only colour,
// ai 藍 (indigo), because the brief asks for an indigo night sky.
const AI = '#26304A'
const SKY: Record<SkyPhase, { stops: [string, string, number][]; sun?: { cx: number; cy: number; r: number; fill: string; op: number } }> = {
  dawn: {
    stops: [['#34302C', '#34302C', 1], ['#B7282E', '#B7282E', 0.35], ['#F2A93B', '#F2A93B', 0.55], ['#F2E8D5', '#F2E8D5', 0.7]],
    sun: { cx: 440, cy: 170, r: 30, fill: '#F2A93B', op: 0.9 },
  },
  day: {
    stops: [['#8F877F', '#8F877F', 0.35], ['#F2E8D5', '#F2E8D5', 0.4], ['#F2E8D5', '#F2E8D5', 0.6], ['#F2A93B', '#F2A93B', 0.25]],
    sun: { cx: 610, cy: 48, r: 22, fill: '#F2E8D5', op: 0.95 },
  },
  sunset: {
    stops: [['#2A2724', '#2A2724', 1], ['#B7282E', '#B7282E', 0.85], ['#E3793A', '#E3793A', 0.95], ['#F2A93B', '#F2A93B', 1]],
    sun: { cx: 790, cy: 158, r: 42, fill: '#F2A93B', op: 1 },
  },
  night: { stops: [[AI, AI, 1], [AI, AI, 0.9], ['#2A2724', '#2A2724', 1], ['#34302C', '#34302C', 1]] },
}

const STARS = [[90, 30], [160, 70], [250, 22], [330, 58], [420, 18], [700, 34], [780, 76], [860, 26], [940, 60], [1020, 20], [1110, 48], [560, 26]]

export function Fuji({ phase, season, showSeason = true, className = '' }: {
  phase: SkyPhase; season: Season; showSeason?: boolean; className?: string
}) {
  const id = useId().replace(/:/g, '')
  const sky = SKY[phase]
  const light = phase === 'day' || phase === 'dawn'
  const line = light ? '#1E1C1A' : '#F2E8D5'
  const snowy = season === 'fuyu' && showSeason

  return (
    <svg viewBox="0 0 1200 240" preserveAspectRatio="xMidYMax slice" className={className} role="img"
         aria-label={`Mount Fuji, ${phase === 'night' ? 'night sky with a crescent moon' : phase + ' sky'}`}>
      <defs>
        <linearGradient id={`sky${id}`} x1="0" y1="0" x2="0" y2="1">
          {sky.stops.map(([c, , o], i) => <stop key={i} offset={`${(i / (sky.stops.length - 1)) * 100}%`} stopColor={c} stopOpacity={o} />)}
        </linearGradient>
        <radialGradient id={`halo${id}`}>
          <stop offset="0%" stopColor="#F2A93B" stopOpacity={phase === 'sunset' ? 0.55 : 0.3} />
          <stop offset="100%" stopColor="#F2A93B" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`fade${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" /><stop offset=".28" stopColor="#fff" /><stop offset="1" stopColor="#fff" />
        </linearGradient>
        <mask id={`m${id}`}><rect width="1200" height="240" fill={`url(#fade${id})`} /></mask>
      </defs>

      <g mask={`url(#m${id})`}>
        <rect width="1200" height="240" fill={`url(#sky${id})`} />

        {sky.sun && <>
          <circle cx={sky.sun.cx} cy={sky.sun.cy} r={sky.sun.r * 3.2} fill={`url(#halo${id})`} />
          <circle cx={sky.sun.cx} cy={sky.sun.cy} r={sky.sun.r} fill={sky.sun.fill} opacity={sky.sun.op} />
        </>}

        {phase === 'night' && <>
          {STARS.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 3 ? 1.1 : 1.7} fill="#F2E8D5"
                    style={{ animation: `twinkle ${4 + (i % 4)}s ease-in-out ${i * 0.7}s infinite` }} />
          ))}
          {/* crescent moon: a disc with a disc taken out */}
          <mask id={`moon${id}`}><rect width="1200" height="240" fill="#fff" /><circle cx="868" cy="54" r="19" fill="#000" /></mask>
          <circle cx="856" cy="60" r="20" fill="#F2E8D5" mask={`url(#moon${id})`} />
        </>}

        {/* soft cloud bands (kasumi) */}
        <g stroke={line} strokeOpacity=".22" strokeWidth="1.2" fill="none" strokeLinecap="round">
          <path d="M330 120 h120 M360 128 h60" />
          <path d="M760 100 h150 M800 108 h80" />
        </g>

        {/* distant ridge */}
        <path d="M0 210 C120 190 210 196 300 184 S470 192 520 200 L1200 196 V240 H0Z" fill={light ? '#8F877F' : '#1E1C1A'} fillOpacity={light ? 0.25 : 0.55} />

        {/* Fuji: gentle concave slopes, flat crater top */}
        <path d="M330 232 C430 214 500 168 560 104 C574 88 586 76 596 70 L636 70 C646 76 658 88 672 104 C732 168 802 214 902 232 Z"
              fill={light ? '#34302C' : '#1E1C1A'} />
        <path d="M330 232 C430 214 500 168 560 104 C574 88 586 76 596 70 L636 70 C646 76 658 88 672 104 C732 168 802 214 902 232"
              fill="none" stroke={line} strokeOpacity=".75" strokeWidth="1.4" strokeLinejoin="round" />

        {/* snow cap with a ragged hem; fuller in winter */}
        <path d={snowy
          ? 'M543 122 C560 102 580 80 596 70 L636 70 C652 80 672 102 689 122 L676 128 L664 120 L652 134 L638 122 L626 138 L614 124 L600 136 L588 122 L574 132 L560 120 Z'
          : 'M560 104 C574 88 586 76 596 70 L636 70 C646 76 658 88 672 104 L660 110 L650 102 L640 114 L628 104 L616 118 L604 104 L592 112 L582 104 L570 110 Z'}
          fill="#F2E8D5" fillOpacity={light ? 0.95 : 0.88} />
        {snowy && [0, 1, 2, 3, 4, 5, 6].map(i => (
          <circle key={i} cx={560 + i * 18} cy={60 + (i % 3) * 10} r="1.6" fill="#F2E8D5"
                  style={{ animation: `drift ${9 + i}s linear ${i * 1.3}s infinite`, ['--dx' as string]: '12px' }} className="seasonal-layer" />
        ))}

        {/* foreground ink hills */}
        <path d="M0 226 C160 214 260 230 380 222 S640 236 760 226 S1040 214 1200 224 V240 H0Z" fill={light ? '#1E1C1A' : '#2A2724'} fillOpacity={light ? 0.2 : 1} />
        <path d="M0 226 C160 214 260 230 380 222 S640 236 760 226 S1040 214 1200 224" fill="none" stroke={line} strokeOpacity=".3" strokeWidth="1" />
      </g>
    </svg>
  )
}
