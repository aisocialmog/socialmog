import { useEffect, useRef, useState } from 'react'
import { PERIOD_LABELS, formatRange, fyLabel, istToday, type PeriodKey } from '../lib/format'
import { usePrefs } from '../lib/prefs'
import { Icon } from '../components/ui/Icon'

const PRESETS: PeriodKey[] = ['this_week', 'last_week', 'this_month', 'last_month', 'this_fy']

export function DateRangePicker() {
  const { period, range, setPeriod } = usePrefs()
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(range.from), [to, setTo] = useState(range.to)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', h) }
  }, [open])
  const label = period === 'this_fy' || period === 'last_fy' ? fyLabel(range.from) : PERIOD_LABELS[period]

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open}
        className="btn-ghost h-10 px-3 gap-2 max-w-[12rem] sm:max-w-none">
        <Icon name="calendar" className="text-base text-muted shrink-0" />
        <span className="truncate">{label}</span>
        <span className="hidden lg:inline text-muted num">· {formatRange(range)}</span>
        <Icon name="chevronDown" className="text-muted shrink-0" />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a period" className="absolute left-0 md:left-auto md:right-0 z-40 mt-2 w-[19rem] max-w-[calc(100vw-2rem)] shoji bg-raised p-4 shadow-2xl shadow-black/30 rise">
          <p className="eyebrow mb-2">Period</p>
          <div className="grid grid-cols-2 gap-1.5 [&>*:last-child:nth-child(odd)]:col-span-2">
            {PRESETS.map(p => (
              <button key={p} onClick={() => { setPeriod(p); setOpen(false) }}
                className={`text-left text-sm rounded-shoji px-3 py-2 transition-colors duration-calm ${period === p ? 'bg-accent text-sumi' : 'hover:bg-card text-ink'}`}>
                {p === 'this_fy' ? `This FY (${fyLabel(istToday()).slice(3)})` : PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="my-4 h-px bg-line/30" />
          <p className="eyebrow mb-2">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">From<input type="date" className="field mt-1 num" value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label className="text-xs text-muted">To<input type="date" className="field mt-1 num" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
          </div>
          <button className="btn-primary w-full justify-center mt-3" disabled={!from || !to || to < from}
            onClick={() => { setPeriod('custom', { from, to }); setOpen(false) }}>Apply range</button>
          <p className="text-xs text-muted mt-3">Dates are in IST. Financial year runs 1 April – 31 March.</p>
        </div>
      )}
    </div>
  )
}
