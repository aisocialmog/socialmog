// Tasks: My tasks, All, Board, Calendar, Overdue — one list, five views.
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Card, EmptyState, Pill, SectionTitle } from '../../components/ui/kit'
import { Kanban } from '../../components/ui/Kanban'
import { Modal } from '../../components/ui/Modal'
import { Icon } from '../../components/ui/Icon'
import { useWipLimits } from '../../components/work/WorkBits'
import { DataTable, Loading, Select, useAsyncAction, type Col } from '../money/MoneyBits'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { formatDate, istToday } from '../../lib/format'
import { addDaysISO, monthGrid, MONTHS } from '../../lib/production'
import { formatMinutes, formatTime, parseQuickAdd, PRIORITIES, PRIORITY_LABEL, PRIORITY_RANK, PRIORITY_TONE, TASK_STATUSES, TASK_STATUS_KANJI, TASK_STATUS_LABEL, type Priority, type TaskStatus } from '../../lib/tasks'
import { linkPatch, workApi, type Member, type Recurring, type Task } from '../../data/work'

const VIEWS = [['mine', 'My tasks'], ['all', 'All tasks'], ['board', 'Board'], ['calendar', 'Calendar'], ['overdue', 'Overdue']] as const
type View = typeof VIEWS[number][0]
const dueText = (t: Task) => t.due_date ? `${formatDate(t.due_date)}${t.due_time ? ', ' + formatTime(t.due_time) : ''}` : 'No date'

export function TaskRow({ t, onDone }: { t: Task; onDone?: (t: Task) => void }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {onDone && <button aria-label={`Mark “${t.title}” done`} onClick={() => onDone(t)}
        className="mt-0.5 w-5 h-5 shrink-0 rounded-full border border-line/60 hover:border-accent hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />}
      <Link to={`/tasks/${t.id}`} className="min-w-0 flex-1 group">
        <span className="block text-sm text-ink group-hover:underline underline-offset-4">{t.title}</span>
        <span className="block text-xs text-muted mt-0.5">
          <span className={t.is_overdue ? 'text-ink underline decoration-akane decoration-2 underline-offset-4' : ''}>{dueText(t)}</span>
          {t.link_name && <> · {t.link_name}</>}{t.assignee_names.length > 0 && <> · {t.assignee_names.join(', ')}</>}
          {t.checklist_total > 0 && <> · <span className="num">{t.checklist_done}/{t.checklist_total}</span></>}
        </span>
      </Link>
      {t.priority !== 'normal' && <Pill tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Pill>}
    </li>
  )
}

/** Type a line; people (@), brand (#), date and time are read out of it. */
function QuickAdd({ members, brands, onAdded }: { members: Member[]; brands: { id: string; name: string }[]; onAdded: () => void }) {
  const { member } = useAuth()
  const [text, setText] = useState('')
  const act = useAsyncAction()
  const p = useMemo(() => parseQuickAdd(text, members, brands, istToday()), [text, members, brands])
  const submit = () => act.run(async () => {
    if (!p.title) return
    await workApi.create({ title: p.title, due_date: p.due_date, due_time: p.due_time, brand_id: p.brand_id }, p.assignee_ids.length ? p.assignee_ids : [member!.id])
    setText(''); onAdded()
  })
  return (
    <Card className="shoji-pad">
      <form onSubmit={e => { e.preventDefault(); submit() }} className="flex gap-2">
        <label className="sr-only" htmlFor="quick-add">Quick add a task</label>
        <input id="quick-add" className="field flex-1" value={text} onChange={e => setText(e.target.value)} autoComplete="off"
          placeholder="Call Rohan about reel edit tomorrow 4pm @name #brand" />
        <button className="btn-primary" disabled={!p.title || act.busy}><Icon name="plus" /> Add</button>
      </form>
      {text.trim() && (
        <p className="text-xs text-muted mt-2.5 flex flex-wrap gap-x-3 gap-y-1" aria-live="polite">
          <span>Task: <span className="text-ink">{p.title || '—'}</span></span>
          <span>For: <span className="text-ink">{p.assignee_ids.length ? p.assignee_ids.map(id => members.find(m => m.id === id)?.name).join(', ') : 'me'}</span></span>
          {p.due_date && <span>Due: <span className="text-ink">{formatDate(p.due_date)}{p.due_time && ', ' + formatTime(p.due_time)}</span></span>}
          {p.brand_id && <span>Brand: <span className="text-ink">{brands.find(b => b.id === p.brand_id)?.name}</span></span>}
          {p.unmatched.length > 0 && <span className="text-ink underline decoration-akane decoration-2 underline-offset-4">No match for {p.unmatched.join(', ')}</span>}
        </p>
      )}
      {act.error && <p role="alert" className="text-sm text-ink mt-2 border-l-2 border-akane pl-2">{act.error}</p>}
    </Card>
  )
}

export function TaskEditor({ task, members, brands, preset, onClose, onSaved }: {
  task?: Task; members: Member[]; brands: { id: string; name: string }[]; preset?: Partial<Task>; onClose: () => void; onSaved: (id: string) => void
}) {
  const { member } = useAuth()
  const src = task ?? preset
  const [f, setF] = useState({
    title: src?.title ?? '', description: src?.description ?? '', status: (src?.status ?? 'todo') as TaskStatus, priority: (src?.priority ?? 'normal') as Priority,
    due_date: src?.due_date ?? '', due_time: src?.due_time?.slice(0, 5) ?? '', estimate_hours: src?.estimate_hours != null ? String(src.estimate_hours) : '', brand_id: src?.brand_id ?? '',
  })
  const [who, setWho] = useState<string[]>(task?.assignee_ids ?? src?.assignee_ids ?? [member!.id])
  const act = useAsyncAction()
  const set = <K extends keyof typeof f>(k: K, v: typeof f[K]) => setF(x => ({ ...x, [k]: v }))
  const otherLink = !!task?.link_table && task.link_table !== 'brands'
  const save = () => act.run(async () => {
    const body = { title: f.title.trim(), description: f.description.trim() || null, status: f.status, priority: f.priority, due_date: f.due_date || null,
      due_time: f.due_date && f.due_time ? f.due_time : null, estimate_hours: f.estimate_hours ? Number(f.estimate_hours) : null,
      ...(otherLink ? {} : task ? linkPatch(f.brand_id ? 'brand_id' : null, f.brand_id || null) : { ...Object.fromEntries(Object.entries(preset ?? {}).filter(([k]) => k.endsWith('_id') && k !== 'assignee_id')), ...(f.brand_id ? { brand_id: f.brand_id } : {}) }) }
    if (task) { await workApi.update(task.id, body); await workApi.setAssignees(task, who); onSaved(task.id) }
    else onSaved(await workApi.create(body, who))
  })
  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={onClose} wide>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); save() }}>
        <label className="block text-sm text-ink">Title<input className="field mt-1" required value={f.title} onChange={e => set('title', e.target.value)} /></label>
        <label className="block text-sm text-ink">Description<textarea className="field mt-1 h-24 py-2" value={f.description} onChange={e => set('description', e.target.value)} /></label>
        <fieldset><legend className="text-sm text-ink mb-1.5">Assigned to</legend>
          <div className="flex flex-wrap gap-2">
            {members.map(m => { const on = who.includes(m.id); return (
              <label key={m.id} className={`pill cursor-pointer border ${on ? 'bg-accent text-sumi border-accent' : 'border-line/50 text-muted'} focus-within:ring-2 focus-within:ring-accent`}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => setWho(w => on ? w.filter(x => x !== m.id) : [...w, m.id])} />{m.name}</label>) })}
          </div></fieldset>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="text-sm text-ink">Due date<input type="date" className="field mt-1 num" value={f.due_date} onChange={e => set('due_date', e.target.value)} /></label>
          <label className="text-sm text-ink">Time<input type="time" className="field mt-1 num" value={f.due_time} disabled={!f.due_date} onChange={e => set('due_time', e.target.value)} /></label>
          <label className="text-sm text-ink">Priority<select className="field mt-1" value={f.priority} onChange={e => set('priority', e.target.value as Priority)}>{PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
          <label className="text-sm text-ink">Status<select className="field mt-1" value={f.status} onChange={e => set('status', e.target.value as TaskStatus)}>{TASK_STATUSES.map(s => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}</select></label>
          <label className="text-sm text-ink">Estimate (hours)<input type="number" min={0} step={0.25} className="field mt-1 num" value={f.estimate_hours} onChange={e => set('estimate_hours', e.target.value)} /></label>
          {otherLink ? <p className="text-sm text-muted col-span-2 self-end pb-2">Linked to {task!.link_name}</p>
            : !preset?.link_name && <label className="text-sm text-ink col-span-2">Linked brand<select className="field mt-1" value={f.brand_id} onChange={e => set('brand_id', e.target.value)}><option value="">None</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          {preset?.link_name && <p className="text-sm text-muted col-span-2 self-end pb-2">Linked to {preset.link_name}</p>}
        </div>
        {act.error && <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{act.error}</p>}
        <div className="flex gap-2"><button className="btn-primary" disabled={!f.title.trim() || act.busy}>{task ? 'Save changes' : 'Create task'}</button><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  )
}

function RecurringModal({ members, brands, onClose }: { members: Member[]; brands: { id: string; name: string }[]; onClose: () => void }) {
  const { data, reload } = useAsync(workApi.recurring, [])
  const [f, setF] = useState({ title: '', frequency: 'weekly' as Recurring['frequency'], next_on: addDaysISO(istToday(), 1), assignee_id: '', brand_id: '' })
  const act = useAsyncAction()
  const add = () => act.run(async () => {
    await workApi.saveRecurring({ title: f.title.trim(), description: null, frequency: f.frequency, next_on: f.next_on, due_time: null, priority: 'normal', assignee_id: f.assignee_id || null, brand_id: f.brand_id || null })
    setF(x => ({ ...x, title: '' })); await reload()
  })
  return (
    <Modal title="Recurring tasks" onClose={onClose} wide>
      <ul className="divide-y divide-line/15 mb-5">
        {(data ?? []).map(r => (
          <li key={r.id} className="py-3 flex items-center gap-3">
            <span className="min-w-0 flex-1"><span className="block text-sm text-ink">{r.title}</span>
              <span className="block text-xs text-muted capitalize">{r.frequency} · next {formatDate(r.next_on)}{r.assignee_id && ` · ${members.find(m => m.id === r.assignee_id)?.name ?? ''}`}{r.is_paused && ' · paused'}</span></span>
            <button className="text-sm text-muted hover:text-ink underline underline-offset-4" onClick={async () => { await workApi.patchRecurring(r.id, { is_paused: !r.is_paused }); reload() }}>{r.is_paused ? 'Resume' : 'Pause'}</button>
            <button className="text-sm text-muted hover:text-ink underline underline-offset-4" onClick={async () => { await workApi.patchRecurring(r.id, { is_archived: true }); reload() }}>Remove</button>
          </li>
        ))}
        {data?.length === 0 && <li className="py-3 text-sm text-muted">Nothing repeats yet.</li>}
      </ul>
      <form className="grid grid-cols-2 gap-3" onSubmit={e => { e.preventDefault(); add() }}>
        <label className="text-sm text-ink col-span-2">Task<input className="field mt-1" required placeholder="Send weekly report to Chai Sutra" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <label className="text-sm text-ink">Repeats<select className="field mt-1" value={f.frequency} onChange={e => setF({ ...f, frequency: e.target.value as Recurring['frequency'] })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        <label className="text-sm text-ink">First due<input type="date" className="field mt-1 num" required value={f.next_on} onChange={e => setF({ ...f, next_on: e.target.value })} /></label>
        <label className="text-sm text-ink">Assigned to<select className="field mt-1" value={f.assignee_id} onChange={e => setF({ ...f, assignee_id: e.target.value })}><option value="">Nobody yet</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="text-sm text-ink">Brand<select className="field mt-1" value={f.brand_id} onChange={e => setF({ ...f, brand_id: e.target.value })}><option value="">None</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        {act.error && <p role="alert" className="text-sm text-ink col-span-2 border-l-2 border-akane pl-2">{act.error}</p>}
        <p className="text-xs text-muted col-span-2">Weekly repeats on the weekday of the first due date; monthly on its day of the month.</p>
        <button className="btn-primary w-fit" disabled={!f.title.trim() || act.busy}>Add recurring task</button>
      </form>
    </Modal>
  )
}

function Mine({ tasks, me, onDone }: { tasks: Task[]; me: string; onDone: (t: Task) => void }) {
  const today = istToday()
  const mine = tasks.filter(t => t.assignee_ids.includes(me) && t.status !== 'done').sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
  const groups: [string, string, Task[]][] = [
    ['遅', 'Overdue', mine.filter(t => t.is_overdue)], ['今', 'Today', mine.filter(t => t.due_date === today)],
    ['次', 'Coming up', mine.filter(t => t.due_date && t.due_date > today)], ['無', 'No date', mine.filter(t => !t.due_date)]]
  if (!mine.length) return <div className="shoji"><EmptyState sketch="koi" line="Still water. Nothing on your list." /></div>
  return <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">{groups.filter(g => g[2].length).map(([k, label, list]) => (
    <Card key={label} className="shoji-pad"><SectionTitle kanji={k} aside={<span className="text-xs text-muted num">{list.length}</span>}>{label}</SectionTitle>
      <ul className="divide-y divide-line/15 -my-1">{list.map(t => <TaskRow key={t.id} t={t} onDone={onDone} />)}</ul></Card>))}</div>
}

function Table({ tasks, members, name }: { tasks: Task[]; members: Member[]; name: string }) {
  const [status, setStatus] = useState<'open' | 'any' | TaskStatus>('open'), [prio, setPrio] = useState<'any' | Priority>('any'), [who, setWho] = useState('any')
  const rows = tasks.filter(t => (status === 'any' || (status === 'open' ? t.status !== 'done' : t.status === status)) && (prio === 'any' || t.priority === prio) && (who === 'any' || t.assignee_ids.includes(who)))
  const cols: Col<Task>[] = [
    { key: 'title', header: 'Task', cell: t => <span className="text-ink">{t.title}</span>, sort: t => t.title.toLowerCase(), csv: t => t.title },
    { key: 'who', header: 'Assigned to', cell: t => t.assignee_names.join(', ') || '—', sort: t => t.assignee_names[0] ?? '', hideSm: true, csv: t => t.assignee_names.join('; ') },
    { key: 'due', header: 'Due', cell: t => <span className={`num whitespace-nowrap ${t.is_overdue ? 'underline decoration-akane decoration-2 underline-offset-4' : ''}`}>{dueText(t)}</span>, sort: t => t.due_date ?? '9999', csv: t => t.due_date },
    { key: 'priority', header: 'Priority', cell: t => <Pill tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Pill>, sort: t => PRIORITY_RANK[t.priority], hideSm: true, csv: t => PRIORITY_LABEL[t.priority] },
    { key: 'status', header: 'Status', cell: t => TASK_STATUS_LABEL[t.status], sort: t => TASK_STATUSES.indexOf(t.status), csv: t => TASK_STATUS_LABEL[t.status] },
    { key: 'link', header: 'Linked to', cell: t => t.link_name ?? '—', sort: t => t.link_name ?? '', hideSm: true, csv: t => t.link_name },
    { key: 'time', header: 'Logged', cell: t => t.minutes_logged ? formatMinutes(t.minutes_logged) : '—', sort: t => t.minutes_logged, align: 'right', hideSm: true, csv: t => Math.round(t.minutes_logged) },
  ]
  return <DataTable rows={rows} cols={cols} rowKey={t => t.id} rowLink={t => `/tasks/${t.id}`} search={t => `${t.title} ${t.link_name ?? ''} ${t.assignee_names.join(' ')}`} searchPlaceholder="Search tasks"
    csvName={`${name}-${istToday()}.csv`} empty="No tasks match." defaultSort={{ key: 'due', dir: 1 }} extraCsv={[{ header: 'Due time', value: t => t.due_time }, { header: 'Description', value: t => t.description }]}
    filters={<>
      <Select id="f-status" label="Status" value={status} onChange={setStatus} options={[['open', 'Open'], ['any', 'Any status'], ...TASK_STATUSES.map(s => [s, TASK_STATUS_LABEL[s]] as [TaskStatus, string])]} />
      <Select id="f-prio" label="Priority" value={prio} onChange={setPrio} options={[['any', 'Any priority'], ...PRIORITIES.map(p => [p, PRIORITY_LABEL[p]] as [Priority, string])]} />
      <Select id="f-who" label="Assigned to" value={who} onChange={setWho} options={[['any', 'Anyone'], ...members.map(m => [m.id, m.name] as [string, string])]} />
    </>} />
}

function Calendar({ tasks }: { tasks: Task[] }) {
  const today = istToday()
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))
  const days = monthGrid(ym.y, ym.m + 1)
  const move = (n: number) => setYm(({ y, m }) => { const d = new Date(Date.UTC(y, m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() } })
  const prefix = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}`
  return (
    <Card className="shoji-pad">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-mincho text-lg text-ink flex-1">{MONTHS[ym.m]} {ym.y}</h2>
        <button className="icon-btn" aria-label="Previous month" onClick={() => move(-1)}><Icon name="chevronLeft" /></button>
        <button className="icon-btn" aria-label="Next month" onClick={() => move(1)}><Icon name="chevronRight" /></button>
      </div>
      <div className="hidden sm:grid grid-cols-7 text-xs text-muted mb-1">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <span key={d} className="px-2">{d}</span>)}</div>
      <ol className="grid grid-cols-1 sm:grid-cols-7 gap-px bg-line/20 border border-line/20 rounded-shoji overflow-hidden">
        {days.map(d => {
          const list = tasks.filter(t => t.due_date === d), inMonth = d.startsWith(prefix)
          return (
            <li key={d} className={`bg-card p-2 sm:min-h-[6.5rem] ${inMonth ? '' : 'opacity-40'} ${!list.length ? 'hidden sm:block' : ''}`}>
              <p className={`text-xs num mb-1 ${d === today ? 'text-accent-ink font-bold' : 'text-muted'}`}><span className="sm:hidden">{formatDate(d)}</span><span className="hidden sm:inline">{Number(d.slice(8))}</span></p>
              {list.map(t => <Link key={t.id} to={`/tasks/${t.id}`} className={`block text-xs truncate rounded px-1.5 py-1 mb-1 hover:bg-raised ${t.status === 'done' ? 'text-muted line-through' : 'text-ink'} ${t.is_overdue ? 'border-l-2 border-akane' : 'border-l-2 border-accent/60'}`}>{t.due_time && <span className="num">{formatTime(t.due_time)} </span>}{t.title}</Link>)}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

export function TasksPage() {
  const { member, role } = useAuth()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const view = (VIEWS.some(v => v[0] === sp.get('view')) ? sp.get('view') : 'mine') as View
  const { data: tasks, loading, error, reload } = useAsync(workApi.tasks, [])
  const { data: members } = useAsync(workApi.members, [])
  const { data: brands } = useAsync(workApi.brands, [])
  const [editing, setEditing] = useState(false), [recurring, setRecurring] = useState(false)
  const wip = useWipLimits('tasks', TASK_STATUSES.map(s => ({ key: s, label: TASK_STATUS_LABEL[s] })))
  if (!member) return null
  const staff = role === 'founder' || role === 'manager'
  const all = tasks ?? []
  const done = async (t: Task) => { await workApi.update(t.id, { status: 'done' }); reload() }
  const overdue = all.filter(t => t.is_overdue)

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="font-mincho text-3xl text-ink flex-1"><span className="text-accent-ink mr-2" aria-hidden lang="ja">務</span>Tasks</h1>
        {staff && <button className="btn-ghost" onClick={() => setRecurring(true)}>Recurring</button>}
        <Link to="/kaizen?tab=load" className="btn-ghost">Workload</Link>
        <button className="btn-primary" onClick={() => setEditing(true)}><Icon name="plus" /> New task</button>
      </div>
      <QuickAdd members={members ?? []} brands={brands ?? []} onAdded={reload} />
      <nav aria-label="Task views" className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {VIEWS.map(([k, label]) => (
          <button key={k} onClick={() => setSp(k === 'mine' ? {} : { view: k })} aria-current={view === k ? 'page' : undefined}
            className={`px-3.5 h-10 text-sm whitespace-nowrap border-b-2 ${view === k ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {label}{k === 'overdue' && overdue.length > 0 && <span className="ml-1.5 pill bg-alert text-kinari num">{overdue.length}</span>}
          </button>
        ))}
      </nav>
      {error && <p role="alert" className="text-sm text-ink border-l-2 border-akane pl-2">{error}</p>}
      {loading && !tasks ? <Loading label="Loading tasks" />
        : view === 'mine' ? <Mine tasks={all} me={member.id} onDone={done} />
        : view === 'all' ? <Table tasks={all} members={members ?? []} name="tasks" />
        : view === 'overdue' ? (overdue.length ? <Table tasks={overdue} members={members ?? []} name="overdue-tasks" /> : <div className="shoji"><EmptyState sketch="fuji" line="A clear horizon. Nothing is overdue." /></div>)
        : view === 'calendar' ? <Calendar tasks={all} />
        : <Kanban columns={TASK_STATUSES.map(s => ({ key: s, label: TASK_STATUS_LABEL[s], kanji: TASK_STATUS_KANJI[s] }))} items={all.filter(t => t.status !== 'done' || (t.completed_at ?? '') > addDaysISO(istToday(), -7))}
            getId={t => t.id} getColumn={t => t.status} getName={t => t.title} limits={wip.limits} toolbar={wip.button} hint="Done shows the last 7 days."
            onMove={async (t, to) => { await workApi.update(t.id, { status: to }); await reload() }} onOpen={t => nav(`/tasks/${t.id}`)}
            renderCard={(t, grip) => <>
              <div className="flex items-start gap-2 pr-6">{grip}<p className="text-sm text-ink">{t.title}</p></div>
              <p className="text-xs text-muted mt-1.5"><span className={t.is_overdue ? 'text-ink underline decoration-akane decoration-2 underline-offset-4' : ''}>{dueText(t)}</span>{t.assignee_names.length > 0 && ` · ${t.assignee_names.join(', ')}`}</p>
              {t.priority !== 'normal' && <p className="mt-2"><Pill tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Pill></p>}
            </>} />}
      {editing && <TaskEditor members={members ?? []} brands={brands ?? []} onClose={() => setEditing(false)} onSaved={id => { setEditing(false); nav(`/tasks/${id}`) }} />}
      {recurring && <RecurringModal members={members ?? []} brands={brands ?? []} onClose={() => { setRecurring(false); reload() }} />}
    </div>
  )
}
