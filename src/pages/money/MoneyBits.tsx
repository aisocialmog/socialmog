// Shared pieces for the Money pages: section tabs, the list table
// (search, filters, sort, CSV), the "why are you changing this?" prompt,
// stat tiles and the history list.
import { useMemo, useState, type ReactNode } from 'react'
import { useReauth } from '../../lib/reauth'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { usePeriod } from '../../lib/prefs'
import { describeActivity } from '../../lib/activity'
import { formatDate, formatDateTime, formatINR, formatRange, istToday } from '../../lib/format'
import { downloadCSV, type CsvColumn } from '../../lib/csv'
import { BASIS_LABEL, type Basis } from '../../lib/money'
import { moneyApi } from '../../data/money'
import { useAsync } from '../../hooks/useAsync'
import { Icon } from '../../components/ui/Icon'
import { Card, EmptyState, SectionTitle } from '../../components/ui/kit'
import { Modal } from '../../components/ui/Modal'
import { EnsoSpinner } from '../../components/art/Ink'
import { FormError } from '../auth/AuthLayout'

export const useIsFounder = () => useAuth().role === 'founder'

export function MoneyTabs() {
  const founder = useIsFounder()
  const tabs: [string, string, boolean?][] = [['/money', 'Overview', true], ['/money/invoices', 'Invoices'], ['/money/payments', 'Payments'], ['/money/expenses', 'Expenses'],
    ['/money/payouts', 'Payouts'], ...(founder ? [['/money/capital', 'Capital'] as [string, string]] : []), ['/money/accounts', 'Accounts'], ['/money/reports', 'Reports'], ['/money/settings', 'Settings']]
  const cls = ({ isActive }: { isActive: boolean }) => `relative px-3.5 h-11 shrink-0 inline-flex items-center text-sm ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`
  return (
    <nav aria-label="Money sections" className="no-print -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-0.5 border-b border-line/25 overflow-x-auto">
      {tabs.map(([to, label, end]) => (
        <NavLink key={to} to={to} end={end} className={cls}>{({ isActive }) => <>{label}{isActive && <span className="absolute left-2.5 right-2.5 -bottom-px h-[2px] bg-accent rounded-full" />}</>}</NavLink>
      ))}
    </nav>
  )
}

export function MoneyHeader({ title, kanji = '金', sub, actions }: { title: string; kanji?: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="no-print flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="eyebrow mb-2"><span lang="ja" className="font-mincho text-accent-ink normal-case tracking-normal text-sm mr-2">{kanji}</span>Money</p>
        <h1 className="font-mincho text-3xl text-ink">{title}</h1>
        {sub && <p className="text-sm text-muted mt-1 num">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Invoice or payments basis — remembered per browser; invoice basis by default. */
export function useBasis(): [Basis, (b: Basis) => void] {
  const [b, setB] = useState<Basis>(() => { try { return (localStorage.getItem('smog.money.basis') as Basis) || 'invoice' } catch { return 'invoice' } })
  return [b, (v: Basis) => { setB(v); try { localStorage.setItem('smog.money.basis', v) } catch { /* private mode */ } }]
}
export function BasisToggle({ basis, onChange }: { basis: Basis; onChange: (b: Basis) => void }) {
  return (
    <div role="radiogroup" aria-label="Profit basis" className="inline-flex rounded-shoji border border-line/30 p-0.5 bg-card">
      {(['invoice', 'cash'] as Basis[]).map(b => (
        <button key={b} role="radio" aria-checked={basis === b} onClick={() => onChange(b)}
          className={`px-3 h-9 rounded-[5px] text-sm ${basis === b ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>{BASIS_LABEL[b]}</button>
      ))}
    </div>
  )
}

export function Stat({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'alert' | 'good'; to?: string }) {
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p className={`font-mincho text-2xl mt-1.5 num ${tone === 'alert' ? 'text-ink underline decoration-akane decoration-2 underline-offset-[6px]' : 'text-ink'}`}>{value}</p>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </>
  )
  return to ? <Link to={to} className="shoji p-4 block hover:bg-raised/60 transition-colors duration-calm">{body}</Link> : <div className="shoji p-4">{body}</div>
}

export const rupees = (n: number | null | undefined) => formatINR(n ?? 0)
export const money = (n: number | null | undefined) => <span className="num">{formatINR(n ?? 0)}</span>

/** "Why are you changing this?" — every money edit and archive goes through here. */
export function ReasonModal({ title, action = 'Save', note, onClose, onConfirm, danger }: {
  title: string; action?: string; note?: ReactNode; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reauth = useReauth()
  return (
    <Modal title={title} onClose={onClose}>
      <form className="space-y-4" onSubmit={async e => {
        e.preventDefault(); if (reason.trim().length < 3) { setError('Write a short reason — it goes into the history.'); return }
        setBusy(true); setError(null)
        const go = () => onConfirm(reason.trim())
        try {
          try { await go() }
          catch (er) {   // a closed month: confirm the password, then try once more
            if (!(er instanceof Error && /re-enter your password/i.test(er.message)) || !(await reauth('This record is in a closed month.'))) throw er
            await go()
          }
          onClose()
        } catch (er) { setError(er instanceof Error ? er.message : String(er)) } finally { setBusy(false) }
      }}>
        {note && <div className="text-sm text-muted">{note}</div>}
        <label className="block"><span className="text-sm text-ink">Reason</span>
          <textarea className="field h-24 py-2 mt-1.5" required minLength={3} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Client asked for a revised due date" /></label>
        <p className="text-xs text-muted">Money edits are kept in the record’s history with who, when and why.</p>
        {error && <FormError>{error}</FormError>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className={danger ? 'btn bg-alert text-kinari' : 'btn-primary'} disabled={busy}>{busy ? 'Saving…' : action}</button>
        </div>
      </form>
    </Modal>
  )
}

// ─── The list table ─────────────────────────────────────────
export interface Col<T> { key: string; header: string; cell: (r: T) => ReactNode; sort?: (r: T) => string | number | null; align?: 'right'; hideSm?: boolean; csv?: (r: T) => string | number | null | undefined }
export function DataTable<T>({ rows, cols, rowKey, rowLink, search, searchPlaceholder, filters, csvName, extraCsv = [], empty, dateOf, defaultSort, footer }: {
  rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; rowLink?: (r: T) => string; search: (r: T) => string; searchPlaceholder: string
  filters?: ReactNode; csvName: string; extraCsv?: CsvColumn<T>[]; empty: string; dateOf?: (r: T) => string | null; defaultSort?: { key: string; dir: 1 | -1 }
  footer?: (shown: T[]) => ReactNode
}) {
  const nav = useNavigate()
  const { range } = usePeriod()
  const [q, setQ] = useState('')
  const [allDates, setAllDates] = useState(false)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(defaultSort ?? null)
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    let out = rows.filter(r => !n || search(r).toLowerCase().includes(n))
    if (dateOf && !allDates) out = out.filter(r => { const d = dateOf(r); return !d || (d >= range.from && d <= range.to) })
    const col = sort && cols.find(c => c.key === sort.key)
    if (col?.sort) out = [...out].sort((a, b) => {
      const x = col.sort!(a), y = col.sort!(b)
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1
      return (x < y ? -1 : x > y ? 1 : 0) * sort!.dir
    })
    return out
  }, [rows, q, search, dateOf, allDates, range, sort, cols])
  const exportCsv = () => downloadCSV(`${csvName}-${istToday()}.csv`, shown, [
    ...cols.filter(c => c.csv).map(c => ({ header: c.header, value: c.csv! })), ...extraCsv])
  return (
    <div className="space-y-3">
      <div className="shoji p-3 sm:p-4 flex flex-col lg:flex-row gap-3 lg:items-center">
        <label className="relative flex-1 min-w-0"><span className="sr-only">Search</span>
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input className="field pl-9" placeholder={searchPlaceholder} value={q} onChange={e => setQ(e.target.value)} />
        </label>
        {filters && <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex gap-2">{filters}</div>}
        <button className="btn-ghost shrink-0" onClick={exportCsv}><Icon name="download" /> CSV</button>
      </div>
      {dateOf && (
        <p className="text-xs text-muted flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{allDates ? 'All dates' : <>Dated {formatRange(range)} <span className="text-muted">(the range in the top bar)</span></>}</span>
          <button className="underline underline-offset-4 hover:text-ink" onClick={() => setAllDates(a => !a)}>{allDates ? 'Use the date range' : 'Show all dates'}</button>
        </p>
      )}
      {shown.length === 0 ? <div className="shoji"><EmptyState sketch="koi" line={rows.length ? 'Nothing matches — try a wider net.' : empty} /></div> : (
        <div className="shoji overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line/20">
                {cols.map(c => (
                  <th key={c.key} scope="col" className={`px-4 py-3 font-normal whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${c.hideSm ? 'hidden md:table-cell' : ''}`}
                      aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                    {c.sort ? <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort(s => s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}>
                      {c.header}{sort?.key === c.key && <Icon name={sort.dir === 1 ? 'arrowUp' : 'arrowDown'} className="text-xs" />}</button> : c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/15">
              {shown.map(r => { const link = rowLink?.(r); return (
                <tr key={rowKey(r)} className={link ? 'hover:bg-raised/50 cursor-pointer' : ''}
                    onClick={link ? e => { if (!(e.target as HTMLElement).closest('a,button')) nav(link) } : undefined}>
                  {cols.map((c, i) => (
                    <td key={c.key} className={`px-4 py-3 align-top ${c.align === 'right' ? 'text-right num whitespace-nowrap' : ''} ${c.hideSm ? 'hidden md:table-cell' : ''}`}>
                      {i === 0 && link ? <Link to={link} className="text-ink hover:underline underline-offset-4">{c.cell(r)}</Link> : c.cell(r)}
                    </td>
                  ))}
                </tr>
              ) })}
            </tbody>
          </table>
          {footer && <div className="border-t border-line/20 px-4 py-3 text-sm">{footer(shown)}</div>}
        </div>
      )}
    </div>
  )
}

export function Select<V extends string>({ id, label, value, onChange, options, className = '' }: { id: string; label: string; value: V; onChange: (v: V) => void; options: [V, string][]; className?: string }) {
  return <>
    <label className="sr-only" htmlFor={id}>{label}</label>
    <select id={id} className={`field lg:w-44 ${className}`} value={value} onChange={e => onChange(e.target.value as V)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </>
}

/** Label + value rows on a detail page. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
      {rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
        <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-ink mt-0.5 break-words">{v}</dd></div>
      ))}
    </dl>
  )
}

export function Loading({ label }: { label: string }) {
  return <div className="py-16 grid place-items-center"><EnsoSpinner size={44} label={label} /></div>
}
export function NotFound({ what }: { what: string }) {
  return <div className="shoji"><EmptyState sketch="koi" line={`This ${what} isn’t here — it may be archived.`} /></div>
}

/** History of a money record (and its lines), with the reason for each change. */
export function MoneyHistory({ table, id, version, names = {} }: { table: string; id: string; version?: string; names?: Record<string, string> }) {
  const { data, loading } = useAsync(() => moneyApi.activity(table, id), [table, id, version])
  const rows = (data ?? []).map(e => ({ e, d: describeActivity(e, names) })).filter(r => r.d.text)
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="歴" aside={rows.length > 0 && <button className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5" onClick={() => downloadCSV(`${table}-${id.slice(0, 8)}-history-${istToday()}.csv`, rows, [
        { header: 'When (IST)', value: r => formatDateTime(r.e.created_at) }, { header: 'Who', value: r => r.e.actor_name }, { header: 'What', value: r => r.d.text }, { header: 'Reason', value: r => r.e.reason }])}>
        <Icon name="download" /> CSV</button>}>History</SectionTitle>
      {loading ? <EnsoSpinner /> : !rows.length ? <p className="text-sm text-muted">No history yet.</p> : (
        <ol className="relative ml-1.5 border-l border-line/30 space-y-5">
          {rows.map(({ e, d }) => (
            <li key={e.id} className="pl-5 relative">
              <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-card ${d.kind === 'archive' ? 'bg-akane' : d.kind === 'money' ? 'bg-yamabuki' : d.kind === 'status' ? 'bg-kaki' : 'bg-hai'}`} aria-hidden />
              <p className="text-sm text-ink"><span className="font-medium">{e.actor_name ?? 'System'}</span> {d.text}</p>
              {e.reason && <p className="text-sm text-ink mt-1 border-l-2 border-yamabuki/70 pl-2">“{e.reason}”</p>}
              <p className="text-xs text-muted mt-0.5 num">{formatDateTime(e.created_at)}{e.source !== 'app' ? ` · ${e.source}` : ''}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

export const dateCell = (d: string | null | undefined) => <span className="num whitespace-nowrap">{formatDate(d ?? null)}</span>

export function useAsyncAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await fn(); return true } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false } finally { setBusy(false) }
  }
  return { busy, error, setError, run }
}
