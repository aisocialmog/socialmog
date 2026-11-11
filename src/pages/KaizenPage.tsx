// Kaizen hub: workload balance (heijunka / muri), waste (muda), the kaizen log, and hansei.
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Card, EmptyState, Pill, SectionTitle } from '../components/ui/kit'
import { Icon } from '../components/ui/Icon'
import { Andon } from '../components/art/Ink'
import { Loading, useAsyncAction } from './money/MoneyBits'
import { useAsync } from '../hooks/useAsync'
import { useAuth } from '../lib/auth'
import { formatDate, istToday } from '../lib/format'
import { addDaysISO, weekStart } from '../lib/production'
import { weekStreak } from '../lib/tasks'
import { db } from '../data/db'
import { workApi } from '../data/work'

const TABS = [['load', 'Workload', '平'], ['muda', 'Waste', '無駄'], ['kaizen', 'Kaizen log', '改善'], ['hansei', 'Hansei', '反省']] as const
type Tab = typeof TABS[number][0]

// ─── Heijunka & muri ────────────────────────────────────────
interface Load { days: string[]; limit_hours: number; gap_pct: number
  people: { member_id: string; name: string; tasks: number; hours: number; days: { day: string; tasks: number; hours: number }[] }[]
  warnings: { member_id: string; name: string; text: string }[]; suggestions: { task_id: string; title: string; hours: number; from_name: string; to_id: string; to_name: string }[] }
function Workload() {
  const [week, setWeek] = useState(() => weekStart(istToday()))
  const { data, loading, error, reload } = useAsync(() => db.rpc<Load>('workload_week', { p_week_start: week }), [week])
  const act = useAsyncAction()
  const max = Math.max(8, ...(data?.people.flatMap(p => p.days.map(d => Number(d.hours))) ?? []))
  return (
    <div className="space-y-4 sm:space-y-6">
      <Card className="shoji-pad">
        <SectionTitle kanji="平" aside={<span className="flex items-center gap-1 text-sm text-muted">
          <button className="icon-btn" aria-label="Previous week" onClick={() => setWeek(addDaysISO(week, -7))}><Icon name="chevronLeft" /></button>
          <span className="num">{formatDate(week)} – {formatDate(addDaysISO(week, 6))}</span>
          <button className="icon-btn" aria-label="Next week" onClick={() => setWeek(addDaysISO(week, 7))}><Icon name="chevronRight" /></button></span>}>Weekly load</SectionTitle>
        {loading && !data ? <Loading label="Loading workload" /> : error ? <p role="alert" className="text-sm text-ink">{error}</p> : data && (
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[36rem]">
            <thead><tr className="text-xs text-muted border-b border-line/30"><th className="py-2 text-left font-normal">Person</th>
              {data.days.map(d => <th key={d} className="py-2 font-normal text-center w-[10%]">{new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'))} <span className="num">{Number(d.slice(8))}</span></th>)}
              <th className="py-2 text-right font-normal">Week</th></tr></thead>
            <tbody>{data.people.map(p => { const over = Number(p.hours) > data.limit_hours; return (
              <tr key={p.member_id} className="border-b border-line/15 align-bottom">
                <th scope="row" className="py-3 text-left font-normal text-ink">{p.name}</th>
                {p.days.map(d => (
                  <td key={d.day} className="py-3 px-1 text-center" title={`${d.tasks} task${d.tasks === 1 ? '' : 's'}, ${Number(d.hours)} h`}>
                    <div className="h-14 flex items-end justify-center"><span className={`block w-5 rounded-t-[4px] ${Number(d.hours) > 9 ? 'bg-akane' : 'bg-accent'}`} style={{ height: `${(Number(d.hours) / max) * 100}%` }} aria-hidden /></div>
                    <span className="block text-xs num text-ink mt-1">{Number(d.hours) ? `${Number(d.hours)}h` : '·'}</span><span className="block text-[10px] num text-muted">{d.tasks ? `${d.tasks} task${d.tasks === 1 ? '' : 's'}` : ''}</span>
                  </td>))}
                <td className="py-3 text-right whitespace-nowrap"><span className={`num ${over ? 'font-bold underline decoration-akane decoration-2 underline-offset-4' : ''} text-ink`}>{Number(p.hours)} h</span><span className="block text-xs text-muted num">{p.tasks} tasks</span></td>
              </tr>) })}</tbody>
          </table></div>
        )}
        <p className="text-xs text-muted mt-3">Open tasks by due date, using each task’s estimate (1 hour when none is set). A red bar is a day over 9 hours.</p>
      </Card>
      {data && data.warnings.length > 0 && (
        <Card className="shoji-pad border-akane/70">
          <SectionTitle kanji="無理">Muri — overburden</SectionTitle>
          <ul className="space-y-2 mb-4">{data.warnings.map((w, i) => <li key={i} className="text-sm text-ink flex gap-2"><Andon size={16} lit /> {w.text}</li>)}</ul>
          {data.suggestions.length > 0 && <>
            <p className="text-sm text-muted mb-2">Suggested moves — least urgent first:</p>
            <ul className="divide-y divide-line/15">{data.suggestions.map(s => (
              <li key={s.task_id} className="py-2.5 flex flex-wrap items-center gap-3"><Link to={`/tasks/${s.task_id}`} className="flex-1 min-w-[12rem] text-sm text-ink hover:underline underline-offset-4">{s.title} <span className="text-muted num">· {Number(s.hours)} h</span></Link>
                <button className="btn-ghost" disabled={act.busy} onClick={() => act.run(async () => { await db.rpc('task_move', { p_task: s.task_id, p_to: s.to_id }); await reload() })}>Move to {s.to_name}</button></li>))}</ul>
          </>}
          {act.error && <p role="alert" className="text-sm text-ink mt-2">{act.error}</p>}
        </Card>
      )}
      {data && !data.warnings.length && <p className="text-sm text-muted">Balanced: nobody is over {data.limit_hours} hours or {data.gap_pct}% busier than a teammate.</p>}
    </div>
  )
}

// ─── Muda ───────────────────────────────────────────────────
interface Waste { kind: string; id: string | null; title: string; detail: string; link: string; fix: string }
const WASTE_LABEL: Record<string, string> = { reopened: 'Tasks reopened', revisions: 'Revision rounds over the limit', stuck: 'Stuck more than 3 days', overdue_invoice: 'Invoices overdue more than 30 days', subscription: 'Subscriptions possibly unused' }
function Muda() {
  const { data, loading, error, reload } = useAsync(() => db.rpc<Waste[]>('muda_week'), [])
  const nav = useNavigate()
  const kinds = Object.keys(WASTE_LABEL).filter(k => data?.some(w => w.kind === k))
  if (loading && !data) return <Loading label="Looking for waste" />
  if (error) return <p role="alert" className="text-sm text-ink">{error}</p>
  if (!data?.length) return <div className="shoji"><EmptyState sketch="koi" line="Clear water. No waste spotted this week." /></div>
  return (
    <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
      {kinds.map(k => (
        <Card key={k} className="shoji-pad">
          <SectionTitle aside={<span className="text-xs text-muted num">{data.filter(w => w.kind === k).length}</span>}>{WASTE_LABEL[k]}</SectionTitle>
          <ul className="divide-y divide-line/15">{data.filter(w => w.kind === k).map((w, i) => (
            <li key={i} className="py-2.5 flex items-center gap-3"><Link to={w.link} className="flex-1 min-w-0"><span className="block text-sm text-ink truncate">{w.title}</span><span className="block text-xs text-muted">{w.detail}</span></Link>
              {k === 'subscription' ? <>
                <button className="btn-ghost" onClick={async () => { await db.rpc('subscription_reviewed', { p_id: w.id, p_stop: false }); reload() }}>Still using</button>
                <button className="btn-ghost" onClick={async () => { await db.rpc('subscription_reviewed', { p_id: w.id, p_stop: true }); reload() }}>Stop it</button></>
                : <button className="btn-ghost" onClick={() => nav(k === 'overdue_invoice' ? `${w.link}?ai=payment_reminder` : w.link)}>{w.fix}</button>}</li>))}</ul>
        </Card>
      ))}
    </div>
  )
}

// ─── Kaizen log ─────────────────────────────────────────────
interface Kaizen { id: string; problem: string; change_made: string; result: string | null; entry_date: string; created_by: string | null }
function KaizenLog({ preset, onUsed }: { preset: string; onUsed: () => void }) {
  const { data, reload } = useAsync(() => db.rows<Kaizen>('kaizen_entries', { is_archived: false }, 'entry_date', false), [])
  const { data: members } = useAsync(workApi.members, [])
  const [f, setF] = useState({ problem: '', change_made: preset, result: '', entry_date: istToday() })
  const act = useAsyncAction()
  const rows = data ?? []
  const streak = weekStreak(rows.map(r => r.entry_date), istToday())
  return (
    <div className="grid lg:grid-cols-[1fr_22rem] gap-4 sm:gap-6 items-start">
      <Card className="shoji-pad order-2 lg:order-1">
        <SectionTitle kanji="歩">Timeline</SectionTitle>
        {!rows.length ? <EmptyState sketch="branch" line="One small improvement at a time. Add the first." /> : (
          <ol className="relative ml-1.5 border-l border-line/30 space-y-6">{rows.map(r => (
            <li key={r.id} className="pl-5 relative"><span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-kaki ring-4 ring-card" aria-hidden />
              <p className="text-xs text-muted num">{formatDate(r.entry_date)} · {members?.find(m => m.id === r.created_by)?.name ?? ''}</p>
              <dl className="mt-1.5 space-y-1.5 text-sm"><div><dt className="text-xs text-muted">Problem</dt><dd className="text-ink">{r.problem}</dd></div>
                <div><dt className="text-xs text-muted">Change made</dt><dd className="text-ink">{r.change_made}</dd></div>
                {r.result ? <div><dt className="text-xs text-muted">Result</dt><dd className="text-ink">{r.result}</dd></div>
                  : <div><dt className="sr-only">Result</dt><dd><button className="text-xs text-muted hover:text-ink underline underline-offset-4" onClick={async () => { const v = window.prompt('What was the result?'); if (v?.trim()) { await db.update('kaizen_entries', r.id, { result: v.trim() }); reload() } }}>Add the result</button></dd></div>}</dl></li>))}</ol>
        )}
      </Card>
      <div className="space-y-4 sm:space-y-6 order-1 lg:order-2">
        <Card className="shoji-pad text-center"><p className="eyebrow">Kaizen streak</p><p className="font-mincho text-5xl text-ink num mt-2">{streak}</p>
          <p className="text-sm text-muted mt-1">week{streak === 1 ? '' : 's'} in a row with an improvement</p></Card>
        <Card className="shoji-pad">
          <SectionTitle kanji="改善">Record an improvement</SectionTitle>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); act.run(async () => { await db.insert('kaizen_entries', { problem: f.problem.trim(), change_made: f.change_made.trim(), result: f.result.trim() || null, entry_date: f.entry_date }); setF({ problem: '', change_made: '', result: '', entry_date: istToday() }); onUsed(); await reload() }) }}>
            <label className="block text-sm text-ink">Problem<textarea required className="field mt-1 h-16 py-2" value={f.problem} onChange={e => setF({ ...f, problem: e.target.value })} /></label>
            <label className="block text-sm text-ink">Change made<textarea required className="field mt-1 h-16 py-2" value={f.change_made} onChange={e => setF({ ...f, change_made: e.target.value })} /></label>
            <label className="block text-sm text-ink">Result <span className="text-muted">(can be added later)</span><input className="field mt-1" value={f.result} onChange={e => setF({ ...f, result: e.target.value })} /></label>
            <label className="block text-sm text-ink">Date<input type="date" required className="field mt-1 num" max={istToday()} value={f.entry_date} onChange={e => setF({ ...f, entry_date: e.target.value })} /></label>
            {act.error && <p role="alert" className="text-sm text-ink">{act.error}</p>}
            <button className="btn-primary" disabled={act.busy || !f.problem.trim() || !f.change_made.trim()}>Add to the log</button>
          </form>
        </Card>
      </div>
    </div>
  )
}

// ─── Hansei ─────────────────────────────────────────────────
interface Hansei { id: string; member_id: string; week_start: string; went_well: string | null; went_wrong: string | null; will_change: string | null }
const QUESTIONS: [keyof Pick<Hansei, 'went_well' | 'went_wrong' | 'will_change'>, string][] = [['went_well', 'What went well?'], ['went_wrong', 'What went wrong?'], ['will_change', 'What will we change next week?']]
function HanseiTab({ toKaizen }: { toKaizen: (text: string) => void }) {
  const { member, role } = useAuth()
  const [week, setWeek] = useState(() => weekStart(istToday()))
  const { data, reload } = useAsync(() => db.rows<Hansei>('hansei_entries', { week_start: week }), [week])
  const { data: members } = useAsync(workApi.members, [])
  const mine = data?.find(h => h.member_id === member?.id)
  const [f, setF] = useState<Record<string, string> | null>(null)
  const [made, setMade] = useState<string[]>([])
  const act = useAsyncAction()
  const form = f ?? { went_well: mine?.went_well ?? '', went_wrong: mine?.went_wrong ?? '', will_change: mine?.will_change ?? '' }
  const founders = (members ?? []).filter(m => m.role === 'founder')
  const cols = role === 'founder' || role === 'manager' ? founders : (members ?? []).filter(m => m.id === member?.id)
  const save = () => act.run(async () => {
    if (mine) await db.update('hansei_entries', mine.id, form); else await db.insert('hansei_entries', { member_id: member!.id, week_start: week, ...form })
    setF(null); await reload()
  })
  const changes = [...new Set((data ?? []).flatMap(h => (h.will_change ?? '').split('\n').map(s => s.trim()).filter(Boolean)))]
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-1 text-sm text-muted">
        <button className="icon-btn" aria-label="Previous week" onClick={() => { setWeek(addDaysISO(week, -7)); setF(null) }}><Icon name="chevronLeft" /></button>
        <span className="num">Week of {formatDate(week)}</span>
        <button className="icon-btn" aria-label="Next week" disabled={week >= weekStart(istToday())} onClick={() => { setWeek(addDaysISO(week, 7)); setF(null) }}><Icon name="chevronRight" /></button>
      </div>
      {role === 'founder' && week === weekStart(istToday()) && (
        <Card className="shoji-pad">
          <SectionTitle kanji="反省">{mine ? 'Your reflection' : 'Reflect on the week'}</SectionTitle>
          <form className="grid md:grid-cols-3 gap-4" onSubmit={e => { e.preventDefault(); save() }}>
            {QUESTIONS.map(([k, q]) => <label key={k} className="block text-sm text-ink">{q}<textarea className="field mt-1 h-28 py-2" value={form[k]} onChange={e => setF({ ...form, [k]: e.target.value })} />
              {k === 'will_change' && <span className="text-xs text-muted">One change per line — each can become a task or a kaizen entry.</span>}</label>)}
            {act.error && <p role="alert" className="text-sm text-ink md:col-span-3">{act.error}</p>}
            <button className="btn-primary w-fit" disabled={act.busy || !Object.values(form).some(v => v.trim())}>{mine ? 'Update' : 'Save reflection'}</button>
          </form>
        </Card>
      )}
      <div className={`grid gap-4 sm:gap-6 ${cols.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {cols.map(m => { const h = data?.find(x => x.member_id === m.id); return (
          <Card key={m.id} className="shoji-pad"><SectionTitle>{m.name}</SectionTitle>
            {!h ? <p className="text-sm text-muted">No reflection for this week yet.</p> : <dl className="space-y-4">{QUESTIONS.map(([k, q]) => <div key={k}><dt className="text-xs text-muted">{q}</dt><dd className="text-sm text-ink whitespace-pre-wrap mt-0.5">{h[k] || '—'}</dd></div>)}</dl>}</Card>) })}
      </div>
      {changes.length > 0 && (
        <Card className="shoji-pad">
          <SectionTitle kanji="次">What we’ll change → make it happen</SectionTitle>
          <ul className="divide-y divide-line/15">{changes.map(c => (
            <li key={c} className="py-2.5 flex flex-wrap items-center gap-2"><span className="flex-1 min-w-[12rem] text-sm text-ink">{c}</span>
              {made.includes(c) ? <Pill tone="ink">Task created</Pill> : <button className="btn-ghost" onClick={async () => { await workApi.create({ title: c, due_date: addDaysISO(weekStart(istToday()), 11), description: `From hansei, week of ${formatDate(week)}` }, [member!.id]); setMade(x => [...x, c]) }}>Make a task</button>}
              <button className="btn-ghost" onClick={() => toKaizen(c)}>Kaizen entry</button></li>))}</ul>
        </Card>
      )}
    </div>
  )
}

export function KaizenPage() {
  const [sp, setSp] = useSearchParams()
  const tab = (TABS.some(t => t[0] === sp.get('tab')) ? sp.get('tab') : 'load') as Tab
  const [preset, setPreset] = useState('')
  return (
    <div className="space-y-5 sm:space-y-6">
      <h1 className="font-mincho text-3xl text-ink"><span className="text-accent-ink mr-2" aria-hidden lang="ja">改</span>Kaizen</h1>
      <nav aria-label="Kaizen sections" className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map(([k, label, kanji]) => (
          <button key={k} onClick={() => setSp(k === 'load' ? {} : { tab: k })} aria-current={tab === k ? 'page' : undefined}
            className={`px-3.5 h-10 text-sm whitespace-nowrap border-b-2 ${tab === k ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}><span className="font-mincho text-accent-ink mr-1.5" lang="ja" aria-hidden>{kanji}</span>{label}</button>))}
      </nav>
      {tab === 'load' ? <Workload /> : tab === 'muda' ? <Muda /> : tab === 'kaizen' ? <KaizenLog key={preset} preset={preset} onUsed={() => setPreset('')} />
        : <HanseiTab toKaizen={text => { setPreset(text); setSp({ tab: 'kaizen' }) }} />}
    </div>
  )
}
