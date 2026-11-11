// Small working parts shared by tasks, production and campaigns:
// the timer, the andon lantern, WIP limits and "go and see" (genchi genbutsu).
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { Andon } from '../art/Ink'
import { EnsoSpinner } from '../art/Ink'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { db } from '../../data/db'
import { workApi, type Member } from '../../data/work'
import { formatDate, formatDateTime, formatINR } from '../../lib/format'
import { downloadCSV } from '../../lib/csv'

const errText = (e: unknown) => e instanceof Error ? e.message : String(e)

// ─── Timer ──────────────────────────────────────────────────
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }

/** Start / stop the timer on a task. One timer runs per person; starting another stops the first. */
export function TimerButton({ taskId, onChange }: { taskId: string; onChange?: () => void }) {
  const { member } = useAuth()
  const { data: running, reload } = useAsync(() => workApi.running(member!.id), [member?.id])
  const [, tick] = useState(0)
  const mine = running?.task_id === taskId
  useEffect(() => { if (!mine) return; const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t) }, [mine])
  const toggle = async () => { await (mine ? workApi.stopTimer() : workApi.startTimer(taskId)); await reload(); onChange?.() }
  return (
    <button className={mine ? 'btn-primary' : 'btn-ghost'} onClick={toggle} aria-pressed={mine}>
      <span aria-hidden>{mine ? '■' : '▶'}</span>
      {mine ? <>Stop <span className="num">{clock(Date.now() - Date.parse(running!.started_at))}</span></> : 'Start timer'}
    </button>
  )
}

// ─── Andon: "I'm blocked" ───────────────────────────────────
export interface AndonRow { id: string; title: string; reason: string; unblocker_id: string | null; unblocker_name: string | null; raised_by_name: string | null; created_at: string; source: string; record_table: string | null; record_id: string | null }
export const andonApi = {
  open: () => db.rows<AndonRow>('open_andons', {}, 'created_at'),
  raise: (table: string, id: string, reason: string, unblocker: string | null) => db.rpc('andon_raise', { p_table: table, p_id: id, p_reason: reason, p_unblocker: unblocker }),
  resolve: (id: string, note: string | null) => db.rpc('andon_resolve', { p_id: id, p_note: note }),
}

/** The lantern. Unlit: press to say you're blocked. Lit: shows why, and resolves it. */
export function AndonButton({ table, id, onChange }: { table: 'tasks' | 'deliverables' | 'campaigns'; id: string; onChange?: () => void }) {
  const { data, reload } = useAsync(andonApi.open, [id])
  const { data: members } = useAsync(workApi.members, [])
  const { member } = useAuth()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(''), [who, setWho] = useState(''), [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const lit = (data ?? []).find(a => a.record_table === table && a.record_id === id)
  const done = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); setOpen(false); setReason(''); setNote(''); await reload(); onChange?.() } catch (e) { setError(errText(e)) } }
  return <>
    <button className={`btn ${lit ? 'bg-akane text-kinari andon-glow' : 'border border-line/40 text-ink hover:bg-raised'}`} onClick={() => setOpen(true)} aria-pressed={!!lit}>
      <Andon size={16} lit={!!lit} /> {lit ? 'Blocked' : 'I’m blocked'}
    </button>
    {open && (
      <Modal title={lit ? 'Blocked' : 'Light the andon'} onClose={() => setOpen(false)}>
        {lit ? (
          <div className="space-y-4">
            <p className="text-ink">“{lit.reason}”</p>
            <p className="text-sm text-muted">{lit.raised_by_name ?? 'An automation'} · {formatDateTime(lit.created_at)}{lit.unblocker_name && <> · waiting on <span className="text-ink">{lit.unblocker_name}</span></>}</p>
            <label className="block text-sm text-ink">How was it resolved? <span className="text-muted">(optional)</span>
              <input className="field mt-1" value={note} onChange={e => setNote(e.target.value)} /></label>
            {error && <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{error}</p>}
            <button className="btn-primary" onClick={() => done(() => andonApi.resolve(lit.id, note || null))}>Resolved — put the lantern out</button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); done(() => andonApi.raise(table, id, reason.trim(), who || null)) }}>
            <label className="block text-sm text-ink">What’s blocking you? (one line)
              <input className="field mt-1" required maxLength={200} value={reason} onChange={e => setReason(e.target.value)} /></label>
            <label className="block text-sm text-ink">Who can unblock it?
              <select className="field mt-1" value={who} onChange={e => setWho(e.target.value)}>
                <option value="">Not sure</option>
                {(members ?? []).filter(m => m.id !== member?.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></label>
            <p className="text-xs text-muted">The founders are notified, and the lantern glows on the dashboard until it’s resolved.</p>
            {error && <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{error}</p>}
            <button className="btn-primary" disabled={!reason.trim()}>Light the andon</button>
          </form>
        )}
      </Modal>
    )}
  </>
}

// ─── WIP limits ─────────────────────────────────────────────
interface Wip { id: string; board: string; column_key: string; max_items: number }
/** Limits for one board, as { column: max }, plus the editor button (founders and managers). */
export function useWipLimits<K extends string>(board: string, columns: { key: K; label: string }[]) {
  const { role } = useAuth()
  const { data, reload } = useAsync(() => db.rows<Wip>('wip_limits', { board }), [board])
  const [open, setOpen] = useState(false)
  const limits = Object.fromEntries((data ?? []).map(w => [w.column_key, w.max_items])) as Partial<Record<K, number>>
  const save = async (key: K, v: string) => {
    const row = (data ?? []).find(w => w.column_key === key), n = Number(v)
    if (!v.trim() || !(n > 0)) { if (row) await db.del('wip_limits', { id: row.id }) }
    else if (row) await db.update('wip_limits', row.id, { max_items: n })
    else await db.insert('wip_limits', { board, column_key: key, max_items: n })
    await reload()
  }
  const button: ReactNode = (role === 'founder' || role === 'manager') ? <>
    <button className="btn-ghost" onClick={() => setOpen(true)}>WIP limits</button>
    {open && (
      <Modal title="WIP limits" onClose={() => setOpen(false)}>
        <p className="text-sm text-muted mb-4">The most items a column should hold at once. Leave blank for no limit. A column over its limit turns red.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {columns.map(c => (
            <label key={c.key} className="text-sm text-ink flex items-center justify-between gap-3">{c.label}
              <input type="number" min={1} className="field w-20 num" defaultValue={limits[c.key] ?? ''} onBlur={e => save(c.key, e.target.value)} /></label>
          ))}
        </div>
        <button className="btn-primary mt-5" onClick={() => setOpen(false)}>Done</button>
      </Modal>
    )}
  </> : null
  return { limits, button }
}

// ─── Go and see: the records behind a number ────────────────
export interface Behind { metric: string; title: string; id?: string | null; from?: string; to?: string }
interface BehindRow { label: string; sub: string | null; on_date: string | null; amount: number | null; link: string | null }
export function GoSee({ what, range, onClose }: { what: Behind; range: { from: string; to: string }; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => db.rpc<BehindRow[]>('records_behind', { p_metric: what.metric, p_from: what.from ?? range.from, p_to: what.to ?? range.to, p_id: what.id ?? null }), [what.metric, what.id])
  const rows = data ?? []
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0), hasAmount = rows.some(r => r.amount != null)
  return (
    <Modal title={what.title} onClose={onClose} wide>
      {loading ? <EnsoSpinner /> : error ? <p role="alert" className="text-sm text-ink">{error}</p> : !rows.length ? <p className="text-sm text-muted">No records behind this number in the period.</p> : <>
        <p className="text-sm text-muted mb-3">{rows.length} record{rows.length === 1 ? '' : 's'}{hasAmount && <> · adds up to <span className="text-ink num">{formatINR(total)}</span></>}
          <button className="ml-3 underline underline-offset-4 hover:text-ink" onClick={() => downloadCSV(`${what.metric}.csv`, rows, [
            { header: 'Record', value: r => r.label }, { header: 'Detail', value: r => r.sub }, { header: 'Date', value: r => r.on_date }, { header: 'Amount', value: r => r.amount }])}>CSV</button></p>
        <ul className="divide-y divide-line/15 max-h-[60vh] overflow-y-auto">
          {rows.map((r, i) => {
            const body = <><span className="min-w-0"><span className="block text-sm text-ink truncate">{r.label}</span>
              <span className="block text-xs text-muted">{[r.sub, r.on_date && formatDate(r.on_date)].filter(Boolean).join(' · ')}</span></span>
              {r.amount != null && <span className="num text-sm text-ink ml-auto pl-3 whitespace-nowrap">{formatINR(r.amount)}</span>}</>
            return <li key={i}>{r.link ? <Link to={r.link} onClick={onClose} className="flex items-center py-2.5 hover:bg-card px-1">{body}</Link> : <div className="flex items-center py-2.5 px-1">{body}</div>}</li>
          })}
        </ul>
      </>}
    </Modal>
  )
}

export const memberName = (members: Member[] | null, id: string | null) => members?.find(m => m.id === id)?.name ?? '—'
