// One task: details, checklist, comments with @mentions, attachments, time log, activity.
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Card, MoreMenu, Pill, SectionTitle } from '../../components/ui/kit'
import { Icon } from '../../components/ui/Icon'
import { Hanko } from '../../components/art/Ink'
import { RecordFiles } from '../../components/files/RecordFiles'
import { AndonButton, memberName, TimerButton } from '../../components/work/WorkBits'
import { Facts, Loading, NotFound } from '../money/MoneyBits'
import { TaskEditor } from './TasksPage'
import { useAsync } from '../../hooks/useAsync'
import { describeActivity } from '../../lib/activity'
import { formatDate, formatDateTime } from '../../lib/format'
import { formatMinutes, formatTime, LINK_LABEL, LINK_PATH, PRIORITY_LABEL, PRIORITY_TONE, TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from '../../lib/tasks'
import { workApi, type Member } from '../../data/work'

function Checklist({ taskId, onChange }: { taskId: string; onChange: () => void }) {
  const { data, reload } = useAsync(() => workApi.checklist(taskId), [taskId])
  const [title, setTitle] = useState('')
  const items = data ?? []
  const after = async (p: Promise<unknown>) => { await p; await reload(); onChange() }
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="点" aside={items.length > 0 && <span className="text-xs text-muted num">{items.filter(i => i.is_done).length}/{items.length}</span>}>Checklist</SectionTitle>
      <ul className="space-y-1">
        {items.map(i => (
          <li key={i.id} className="flex items-center gap-3 group">
            <label className="flex items-center gap-3 flex-1 py-1.5 text-sm cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-[#E3793A]" checked={i.is_done} onChange={() => after(workApi.patchCheck(i.id, { is_done: !i.is_done }))} />
              <span className={i.is_done ? 'text-muted line-through' : 'text-ink'}>{i.title}</span>
            </label>
            <button className="icon-btn w-8 h-8 opacity-60 hover:opacity-100" aria-label={`Remove “${i.title}”`} onClick={() => after(workApi.patchCheck(i.id, { is_archived: true }))}><Icon name="close" /></button>
          </li>
        ))}
      </ul>
      <form className="flex gap-2 mt-3" onSubmit={e => { e.preventDefault(); if (title.trim()) { after(workApi.addCheck(taskId, title.trim(), items.length)); setTitle('') } }}>
        <label className="sr-only" htmlFor="new-check">Add a checklist item</label>
        <input id="new-check" className="field flex-1" placeholder="Add an item" value={title} onChange={e => setTitle(e.target.value)} />
        <button className="btn-ghost" disabled={!title.trim()}>Add</button>
      </form>
    </Card>
  )
}

function Comments({ taskId, members, onChange }: { taskId: string; members: Member[]; onChange: () => void }) {
  const { data, reload } = useAsync(() => workApi.comments(taskId), [taskId])
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const tag = (n: string) => '@' + n.replace(/[^\w]/g, '')
  const post = async () => { setError(null); try { await workApi.addComment(taskId, body.trim()); setBody(''); await reload(); onChange() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="話">Comments</SectionTitle>
      <ul className="space-y-4 mb-4">
        {(data ?? []).map(c => (
          <li key={c.id}><p className="text-xs text-muted"><span className="text-ink font-medium">{memberName(members, c.created_by)}</span> · <span className="num">{formatDateTime(c.created_at)}</span></p>
            <p className="text-sm text-ink mt-1 whitespace-pre-wrap">{c.body.split(/(@[\w.-]+)/g).map((part, i) => part.startsWith('@') ? <span key={i} className="text-accent-ink font-medium">{part}</span> : part)}</p></li>
        ))}
        {data?.length === 0 && <li className="text-sm text-muted">No comments yet.</li>}
      </ul>
      <form onSubmit={e => { e.preventDefault(); if (body.trim()) post() }}>
        <label className="sr-only" htmlFor="new-comment">Write a comment</label>
        <textarea id="new-comment" className="field h-20 py-2" placeholder="Write a comment. Use @name to notify someone." value={body} onChange={e => setBody(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button className="btn-primary" disabled={!body.trim()}>Comment</button>
          <span className="text-xs text-muted">Mention:</span>
          {members.map(m => <button type="button" key={m.id} className="text-xs text-muted hover:text-ink underline underline-offset-4" onClick={() => setBody(b => `${b}${b && !b.endsWith(' ') ? ' ' : ''}${tag(m.name)} `)}>{tag(m.name)}</button>)}
        </div>
        {error && <p role="alert" className="text-sm text-ink mt-2 border-l-2 border-akane pl-2">{error}</p>}
      </form>
    </Card>
  )
}

function TimeLog({ taskId, members, version }: { taskId: string; members: Member[]; version: number }) {
  const { data } = useAsync(() => workApi.logs(taskId), [taskId, version])
  const logs = data ?? []
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="時" aside={<span className="text-xs text-muted num">{formatMinutes(logs.reduce((s, l) => s + (l.duration_minutes ?? 0), 0))}</span>}>Time logged</SectionTitle>
      {!logs.length ? <p className="text-sm text-muted">No time logged. Start the timer, or use Focus mode.</p> : (
        <ul className="divide-y divide-line/15 text-sm">
          {logs.map(l => <li key={l.id} className="py-2 flex justify-between gap-3"><span className="text-ink">{memberName(members, l.member_id)} <span className="text-muted">· {formatDateTime(l.started_at)}{l.source === 'focus' && ' · focus'}</span></span>
            <span className="num text-ink whitespace-nowrap">{l.ended_at ? formatMinutes(l.duration_minutes ?? 0) : 'running…'}</span></li>)}
        </ul>
      )}
    </Card>
  )
}

function History({ taskId, version }: { taskId: string; version: number }) {
  const { data } = useAsync(() => workApi.activity(taskId), [taskId, version])
  const rows = (data ?? []).map(e => ({ e, d: describeActivity(e) })).filter(r => r.d.text)
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="歴">Activity</SectionTitle>
      {!rows.length ? <p className="text-sm text-muted">No activity yet.</p> : (
        <ol className="relative ml-1.5 border-l border-line/30 space-y-4">
          {rows.map(({ e, d }) => (
            <li key={e.id} className="pl-5 relative">
              <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-card ${d.kind === 'status' ? 'bg-kaki' : d.kind === 'archive' ? 'bg-akane' : 'bg-hai'}`} aria-hidden />
              <p className="text-sm text-ink"><span className="font-medium">{e.actor_name}</span> {d.text}</p>
              <p className="text-xs text-muted mt-0.5 num">{formatDateTime(e.created_at)}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

export function TaskDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { data: t, loading, reload } = useAsync(() => workApi.task(id), [id])
  const { data: members } = useAsync(workApi.members, [])
  const { data: brands } = useAsync(workApi.brands, [])
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(0)
  const bump = () => { setV(n => n + 1); reload() }
  if (loading && !t) return <Loading label="Loading task" />
  if (!t) return <NotFound what="task" />
  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl">
      <Link to="/tasks" className="text-sm text-muted hover:text-ink inline-flex items-center gap-1"><Icon name="chevronLeft" /> Tasks</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[14rem]">
          <h1 className={`font-mincho text-2xl sm:text-3xl text-ink ${t.status === 'done' ? 'line-through decoration-1' : ''}`}>{t.title}</h1>
          <p className="mt-2 flex flex-wrap gap-2 items-center">
            <Pill tone={t.status === 'done' ? 'ink' : t.status === 'in_progress' ? 'accent' : 'quiet'}>{TASK_STATUS_LABEL[t.status]}</Pill>
            <Pill tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]} priority</Pill>
            {t.is_overdue && <Pill tone="alert">Overdue</Pill>}{t.recurring_id && <Pill>Recurring</Pill>}
          </p>
        </div>
        {t.status === 'done' && <Hanko kind="completed" size={52} />}
        <div className="flex flex-wrap gap-2 items-center">
          <label className="sr-only" htmlFor="task-status">Status</label>
          <select id="task-status" className="field w-auto" value={t.status} onChange={async e => { await workApi.update(t.id, { status: e.target.value as TaskStatus }); bump() }}>
            {TASK_STATUSES.map(s => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
          </select>
          {t.status !== 'done' && <><TimerButton taskId={t.id} onChange={bump} /><Link to={`/focus/${t.id}`} className="btn-ghost"><span lang="ja" aria-hidden>集</span> Focus</Link><AndonButton table="tasks" id={t.id} onChange={bump} /></>}
          <MoreMenu items={[{ label: 'Edit task', onSelect: () => setEditing(true) }, { label: 'Archive task', danger: true, onSelect: async () => { await workApi.update(t.id, { is_archived: true }); nav('/tasks') } }]} />
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <Card className="shoji-pad">
            {t.description && <p className="text-sm text-ink whitespace-pre-wrap mb-5">{t.description}</p>}
            <Facts rows={[
              ['Assigned to', t.assignee_names.join(', ') || 'Nobody'],
              ['Due', t.due_date ? `${formatDate(t.due_date)}${t.due_time ? ', ' + formatTime(t.due_time) : ''}` : 'No date'],
              [t.link_table ? LINK_LABEL[t.link_table] : 'Linked to', t.link_table && t.link_id ? <Link className="underline underline-offset-4" to={`${LINK_PATH[t.link_table]}/${t.link_id}`}>{t.link_name}</Link> : null],
              ['Estimate', t.estimate_hours != null ? `${t.estimate_hours} h` : null],
              ['Completed', t.completed_at ? formatDateTime(t.completed_at) : null],
            ]} />
          </Card>
          <Checklist taskId={t.id} onChange={bump} />
          <Comments taskId={t.id} members={members ?? []} onChange={bump} />
          <Card className="shoji-pad">
            <SectionTitle kanji="付">Attachments</SectionTitle>
            <RecordFiles load={() => workApi.files(t.id)} upload={f => workApi.uploadFile(t.id, f)} archive={workApi.archiveFile} signedUrl={workApi.signedUrl}
              kinds={[{ value: 'other', label: 'File' }]} defaultKind="other" hint="Drop files here, up to 50 MB each." />
          </Card>
        </div>
        <div className="space-y-4 sm:space-y-6">
          <TimeLog taskId={t.id} members={members ?? []} version={v} />
          <History taskId={t.id} version={v} />
        </div>
      </div>
      {editing && <TaskEditor task={t} members={members ?? []} brands={brands ?? []} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); bump() }} />}
    </div>
  )
}
