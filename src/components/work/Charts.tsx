// Small SVG/HTML charts for the dashboard. Every mark is a button: hover shows
// the value, click opens the records behind it. Each chart has a table view.
// Series colours were checked for colour-blind separation on both themes.
import { useState, type ReactNode } from 'react'
import { formatINR, formatINRShort } from '../../lib/format'

export const SERIES = { a: '#C96427', b: '#2F7FC9' }   // kaki (deep) · ai indigo
const fmt = (n: number, money: boolean) => money ? formatINR(n) : String(n)

function Frame({ title, legend, table, children }: { title: string; legend?: ReactNode; table: { head: string[]; rows: (string | number)[][] }; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <figure className="m-0">
      <figcaption className="flex items-center gap-3 mb-3">
        <span className="font-mincho text-ink flex-1">{title}</span>
        {legend}
        <button className="text-xs text-muted hover:text-ink underline underline-offset-4" onClick={() => setAsTable(t => !t)} aria-pressed={asTable}>{asTable ? 'Chart' : 'Table'}</button>
      </figcaption>
      {asTable ? (
        <div className="overflow-x-auto max-h-64"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted border-b border-line/30">{table.head.map((h, i) => <th key={h} className={`py-1.5 font-normal ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>{table.rows.map((r, i) => <tr key={i} className="border-b border-line/15">{r.map((c, j) => <td key={j} className={`py-1.5 ${j ? 'text-right num' : 'text-ink'}`}>{c}</td>)}</tr>)}</tbody>
        </table></div>
      ) : children}
    </figure>
  )
}

const Key = ({ color, label }: { color: string; label: string }) => <span className="inline-flex items-center gap-1.5 text-xs text-muted"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} aria-hidden />{label}</span>

/** Two series side by side per period (revenue vs expenses by month). One shared axis. */
export function PairedBars({ title, data, labels, onPick }: {
  title: string; labels: [string, string]; data: { key: string; label: string; a: number; b: number }[]; onPick: (key: string, series: 'a' | 'b') => void
}) {
  const [tip, setTip] = useState<{ i: number; s: 'a' | 'b' } | null>(null)
  const max = Math.max(1, ...data.flatMap(d => [d.a, d.b]))
  const ticks = [0, 0.5, 1].map(f => f * max)
  return (
    <Frame title={title} legend={<><Key color={SERIES.a} label={labels[0]} /><Key color={SERIES.b} label={labels[1]} /></>}
      table={{ head: ['Month', ...labels], rows: data.map(d => [d.label, formatINR(d.a), formatINR(d.b)]) }}>
      <div className="relative h-52 pl-12">
        {ticks.map(t => <div key={t} className="absolute left-12 right-0 border-t border-line/15" style={{ bottom: `calc(1.25rem + ${(t / max) * 100}% * 0.88)` }}>
          <span className="absolute -left-12 -top-2 w-10 text-right text-[10px] text-muted num">{formatINRShort(t)}</span></div>)}
        <div className="absolute left-12 right-0 top-0 bottom-0 flex items-end gap-1 sm:gap-2">
          {data.map((d, i) => (
            <div key={d.key} className="flex-1 min-w-0 h-full flex flex-col justify-end">
              <div className="flex items-end justify-center gap-[2px] flex-1" style={{ height: '88%' }}>
                {(['a', 'b'] as const).map(s => (
                  <button key={s} onClick={() => onPick(d.key, s)} onMouseEnter={() => setTip({ i, s })} onMouseLeave={() => setTip(null)} onFocus={() => setTip({ i, s })} onBlur={() => setTip(null)}
                    aria-label={`${d.label}, ${labels[s === 'a' ? 0 : 1]} ${formatINR(d[s])}. Show records`}
                    className="relative w-full max-w-[14px] h-full flex items-end focus-visible:outline-none group">
                    <span className="block w-full rounded-t-[4px] group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-accent" style={{ height: `${Math.max((d[s] / max) * 100, d[s] > 0 ? 1.5 : 0)}%`, background: SERIES[s] }} />
                  </button>
                ))}
              </div>
              <span className="h-5 text-[10px] text-muted text-center truncate leading-5">{d.label}</span>
              {tip?.i === i && <div role="status" className="absolute z-10 -top-1 left-1/2 -translate-x-1/2 shoji bg-raised px-3 py-2 text-xs shadow-xl whitespace-nowrap pointer-events-none">
                <p className="text-muted">{d.label}</p>
                <p className="text-ink"><Key color={SERIES.a} label={labels[0]} /> <span className="num ml-1">{formatINR(d.a)}</span></p>
                <p className="text-ink"><Key color={SERIES.b} label={labels[1]} /> <span className="num ml-1">{formatINR(d.b)}</span></p></div>}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  )
}

/** One series, horizontal, labelled directly (profit by brand, stage funnel). Negative values are marked as a loss. */
export function RankBars({ title, data, money = false, onPick, empty }: { title: string; data: { key: string; label: string; value: number }[]; money?: boolean; onPick: (key: string) => void; empty: string }) {
  const max = Math.max(1, ...data.map(d => Math.abs(d.value)))
  return (
    <Frame title={title} table={{ head: ['Name', money ? 'Amount' : 'Count'], rows: data.map(d => [d.label, fmt(d.value, money)]) }}>
      {!data.length ? <p className="text-sm text-muted py-6">{empty}</p> : (
        <ul className="space-y-1.5">
          {data.map(d => (
            <li key={d.key}>
              <button onClick={() => onPick(d.key)} title={`${d.label}: ${fmt(d.value, money)}`} className="w-full grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-left rounded px-1 py-0.5 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <span className="text-xs text-ink truncate">{d.label}</span>
                <span className="h-3.5 block"><span className="block h-full rounded-r-[4px]" style={{ width: `${Math.max((Math.abs(d.value) / max) * 100, 1)}%`, background: d.value < 0 ? `repeating-linear-gradient(45deg, ${SERIES.a}, ${SERIES.a} 3px, transparent 3px, transparent 6px)` : SERIES.a }} /></span>
                <span className="text-xs text-ink num whitespace-nowrap">{fmt(d.value, money)}{d.value < 0 && <span className="text-muted"> loss</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  )
}

/** One series over time (content posted per week). */
export function TimeBars({ title, data, unit, onPick }: { title: string; unit: string; data: { key: string; label: string; value: number }[]; onPick: (key: string) => void }) {
  const [tip, setTip] = useState<number | null>(null)
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <Frame title={title} table={{ head: ['Week starting', unit], rows: data.map(d => [d.label, d.value]) }}>
      <div className="relative h-40 flex items-end gap-[2px] sm:gap-1 border-b border-line/30">
        {data.map((d, i) => (
          <button key={d.key} onClick={() => onPick(d.key)} onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(i)} onBlur={() => setTip(null)}
            aria-label={`Week of ${d.label}: ${d.value} ${unit}. Show records`} className="relative flex-1 h-full flex flex-col justify-end items-center focus-visible:outline-none group">
            {(tip === i || data.length <= 12) && d.value > 0 && <span className="text-[10px] text-ink num mb-0.5">{d.value}</span>}
            <span className="block w-full max-w-[22px] rounded-t-[4px] group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-accent" style={{ height: `${(d.value / max) * 82}%`, background: SERIES.a }} />
            {tip === i && <span role="status" className="absolute z-10 bottom-full mb-1 shoji bg-raised px-2 py-1 text-xs text-ink whitespace-nowrap pointer-events-none">Week of {d.label}: <span className="num">{d.value}</span></span>}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted mt-1"><span>{data[0]?.label}</span><span>{data.at(-1)?.label}</span></div>
    </Frame>
  )
}
