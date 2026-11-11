// Reports: nine reports from one database function, each exportable as CSV and PDF.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/ui/Icon'
import { GoSee, type Behind } from '../components/work/WorkBits'
import { Loading } from './money/MoneyBits'
import { useAsync } from '../hooks/useAsync'
import { useAuth } from '../lib/auth'
import { usePeriod } from '../lib/prefs'
import { downloadCSV } from '../lib/csv'
import { formatDate, formatINR, formatRange, PERIOD_LABELS } from '../lib/format'
import { db } from '../data/db'

type Row = Record<string, string | number | boolean | null>
interface Column { key: string; label: string; type: string }
interface Section { title: string; columns: Column[]; rows: Row[]; note?: string }
const REPORTS: [string, string, string, boolean?][] = [
  ['pnl', 'Profit & Loss', '損益'], ['brands', 'Brand report', '商'], ['campaigns', 'Campaign performance', '陣'], ['creators', 'Creator report', '人'],
  ['production', 'Production efficiency', '作'], ['cashflow', 'Cash flow', '流'], ['ageing', 'Receivables & payables', '掛'], ['capital', 'Capital statement', '資', true], ['team', 'Team productivity', '務']]

const isNum = (t: string) => t !== 'text' && t !== 'date'
function show(v: Row[string], type: string): string {
  if (v === null || v === undefined || v === '') return '—'
  switch (type) {
    case 'money': return formatINR(Number(v))
    case 'money2': return `₹${Number(v).toFixed(2)}`
    case 'percent': return `${Number(v)}%`
    case 'number': return new Intl.NumberFormat('en-IN').format(Number(v))
    case 'days': return Number(v).toFixed(1)
    case 'date': return formatDate(String(v))
    default: return String(v)
  }
}
const SUMMABLE = new Set(['money', 'number'])

function SectionTable({ s, name, onSee }: { s: Section; name: string; onSee: (b: Behind) => void }) {
  const totals = s.rows.length > 1 && !s.rows.some(r => r.bold) && s.columns.some(c => SUMMABLE.has(c.type))
  return (
    <section className="break-inside-avoid">
      <div className="flex items-center gap-3 mb-2">
        <h2 className="font-mincho text-lg text-ink flex-1">{s.title}</h2>
        <button className="no-print text-sm text-muted hover:text-ink inline-flex items-center gap-1.5" onClick={() => downloadCSV(`${name}-${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`, s.rows, s.columns.map(c => ({ header: c.label, value: (r: Row) => r[c.key] as string | number | null })))}><Icon name="download" /> CSV</button>
      </div>
      {!s.rows.length ? <p className="text-sm text-muted py-4">Nothing to report for this period.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-xs text-muted border-b border-line/40">{s.columns.map(c => <th key={c.key} scope="col" className={`py-2 px-2 first:pl-0 font-normal ${isNum(c.type) ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr></thead>
          <tbody>
            {s.rows.map((r, i) => (
              <tr key={i} className={`border-b border-line/15 ${r.bold ? 'font-bold' : ''}`}>
                {s.columns.map((c, j) => {
                  const text = show(r[c.key], c.type)
                  const neg = isNum(c.type) && Number(r[c.key]) < 0
                  const cell = j === 0 && typeof r.link === 'string' ? <Link to={r.link} className="underline decoration-line/50 underline-offset-4 hover:decoration-accent">{text}</Link>
                    : typeof r.metric === 'string' && c.type !== 'text' && j === 1
                      ? <button className="underline decoration-line/50 underline-offset-4 hover:decoration-accent" onClick={() => onSee({ metric: r.metric as string, id: (r.id as string) ?? null, key: (r.key as string) ?? undefined, title: String(r[s.columns[0].key]) })}>{text}</button> : text
                  return <td key={c.key} className={`py-2 px-2 first:pl-0 ${isNum(c.type) ? 'text-right num whitespace-nowrap' : 'text-ink'} ${neg ? 'text-ink' : ''}`}>{cell}</td>
                })}
              </tr>
            ))}
          </tbody>
          {totals && <tfoot><tr className="font-bold border-t border-line/40">{s.columns.map((c, j) => <td key={c.key} className={`py-2 px-2 first:pl-0 ${isNum(c.type) ? 'text-right num' : ''}`}>
            {j === 0 ? 'Total' : SUMMABLE.has(c.type) && c.key !== 'revision_limit' ? show(s.rows.reduce((t, r) => t + Number(r[c.key] ?? 0), 0), c.type) : ''}</td>)}</tr></tfoot>}
        </table></div>
      )}
      {s.note && <p className="text-xs text-muted mt-2">{s.note}</p>}
    </section>
  )
}

export function ReportsPage() {
  const { role } = useAuth()
  const { period, range } = usePeriod()
  const [sp, setSp] = useSearchParams()
  const list = REPORTS.filter(r => !r[3] || role === 'founder')
  const name = list.some(r => r[0] === sp.get('r')) ? sp.get('r')! : 'pnl'
  const meta = list.find(r => r[0] === name)!
  const { data, loading, error } = useAsync(() => db.rpc<{ sections: Section[] }>('report', { p_name: name, p_from: range.from, p_to: range.to }), [name, range.from, range.to])
  const [see, setSee] = useState<Behind | null>(null)
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end gap-3 no-print">
        <h1 className="font-mincho text-3xl text-ink flex-1"><span className="text-accent-ink mr-2" aria-hidden lang="ja">報</span>Reports</h1>
        <button className="btn-ghost" onClick={() => window.print()} disabled={!data}><Icon name="download" /> PDF</button>
      </div>
      <div className="grid lg:grid-cols-[15rem_1fr] gap-4 sm:gap-6 items-start">
        <nav aria-label="Reports" className="no-print flex lg:flex-col gap-1 overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0">
          {list.map(([k, label, kanji], i) => (
            <button key={k} onClick={() => setSp(k === 'pnl' ? {} : { r: k })} aria-current={name === k ? 'page' : undefined}
              className={`flex items-center gap-2.5 px-3 h-10 rounded-shoji text-sm whitespace-nowrap text-left ${name === k ? 'bg-raised text-ink' : 'text-muted hover:text-ink hover:bg-raised/60'}`}>
              <span className="font-mincho text-accent-ink w-6 text-center" aria-hidden lang="ja">{kanji}</span><span className="num text-xs text-muted">{i + 1}.</span>{label}</button>
          ))}
        </nav>
        <article className="report-paper shoji shoji-pad space-y-8 min-w-0">
          <header>
            <p className="eyebrow">Social Mog · {PERIOD_LABELS[period]}</p>
            <p className="font-mincho text-2xl text-ink mt-1">{meta[1]}</p>
            <p className="text-sm text-muted num">{formatRange(range)}</p>
          </header>
          {error ? <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{error}</p> : loading && !data ? <Loading label="Building the report" />
            : data?.sections.map(s => <SectionTable key={s.title} s={s} name={name} onSee={setSee} />)}
          <p className="text-xs text-muted no-print">Underlined numbers open the records behind them. “PDF” opens the print dialog — choose “Save as PDF”.</p>
        </article>
      </div>
      {see && <GoSee what={see} range={range} onClose={() => setSee(null)} />}
    </div>
  )
}
