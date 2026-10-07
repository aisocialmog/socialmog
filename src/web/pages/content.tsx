import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { diffWords } from 'diff';
import { formatDate } from '../../shared/dates.ts';
import { formatINR } from '../../shared/money.ts';
import { CONTENT_STAGES, humanize } from '../../shared/schema.ts';
import {
  Activity, AnalyseButton, api, ArchiveButton, Async, attempt, Badge, Calendar, Card, confirmAction, DataTable, DemoTag, Details, Empty, EntityForm, EntityTable, invalidate, Kanban,
  Modal, Money, PageHead, Stat, Tabs, Timeline, toast, useApi, useCan, useMe, useToday, type Row,
} from '../lib.tsx';
import { PayableTable } from './finance.tsx';

const EDITOR_STAGES = ['footage_pending', 'editing', 'internal_review'];

export function Content() {
  const me = useMe();
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') ?? 'board';
  const q = useApi<{ rows: Row[] }>('/api/e/content_tasks');
  const [creating, setCreating] = useState(false);
  const [month, setMonth] = useState(useToday().slice(0, 7));
  const nav = useNavigate();
  const editor = me.user.role === 'editor';
  const canCreate = useCan('campaigns');
  const reviewOnly = sp.get('stage') === 'review';
  return (
    <div className="stack">
      <PageHead title={editor ? 'My content tasks' : 'Content & editors'} sub="Brief ready → Footage → Editing → Internal review → Changes → Brand review → Approved → Delivered"
        actions={<>
          <div className="seg">{['board', 'table', 'calendar'].map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setSp({ view: v })}>{humanize(v)}</button>)}</div>
          {!editor && <Link className="btn" to="/editors">Editors & workload</Link>}
          {editor && <Link className="btn" to="/settings/payments">My payments</Link>}
          {canCreate && <button className="btn primary" onClick={() => setCreating(true)}>New content task</button>}
        </>} />
      {reviewOnly && <div className="alert info row between">Showing tasks awaiting review. <button className="btn sm" onClick={() => setSp({})}>Show all</button></div>}
      <Async q={q}>
        {(d) => {
          const rows = reviewOnly ? d.rows.filter((r) => ['internal_review', 'brand_review'].includes(r.stage)) : d.rows;
          if (view === 'table') return <EntityTable entity="content_tasks" rows={rows} />;
          if (view === 'calendar') return <Card><Calendar month={month} onMonth={setMonth} events={rows.filter((r) => r.due_date).map((r) => ({ date: r.due_date, label: r.title, link: `/content/${r.id}`, kind: ['approved', 'delivered'].includes(r.stage) ? 'in' : '' }))} /></Card>;
          return (
            <Kanban stages={CONTENT_STAGES} items={rows} stageOf={(r) => r.stage} onMove={async (t, stage) => {
              if (editor && !EDITOR_STAGES.includes(stage)) return toast('Only reviewers can move tasks to that stage', 'error');
              if (await attempt(() => api(`/api/e/content_tasks/${t.id}`, { method: 'PATCH', body: { stage } }), `Moved to ${humanize(stage)}`)) q.reload();
            }} card={(t) => (
              <>
                <Link to={`/content/${t.id}`} className="strong">{t.title}</Link>
                <span className="small muted">{t.campaign_id_label ?? 'No campaign'} <DemoTag row={t} /></span>
                <span className="row small"><Badge value={t.priority} />{t.editor_id_label && <span>✂ {t.editor_id_label}</span>}{t.due_date && <span className="muted">due {formatDate(t.due_date)}</span>}</span>
                {t.blocked_reason && <Badge tone="warn">Blocked: {t.blocked_reason}</Badge>}
              </>
            )} />
          );
        }}
      </Async>
      <Modal open={creating} onClose={() => setCreating(false)} title="New content task"><EntityForm entity="content_tasks" onSaved={(r) => nav(`/content/${r.id}`)} /></Modal>
    </div>
  );
}

export function ContentTaskPage() {
  const { id } = useParams();
  const q = useApi<{ row: Row }>(`/api/e/content_tasks/${id}`);
  const [tab, setTab] = useState('work');
  const [editing, setEditing] = useState(false);
  const me = useMe();
  const editor = me.user.role === 'editor';
  const canContent = useCan('content');
  const canReview = !editor && canContent;
  const canEdit = useCan('campaigns');
  const nav = useNavigate();
  return (
    <Async q={q}>
      {({ row: t }) => {
        const patch = (body: Row, msg = 'Saved') => attempt(() => api(`/api/e/content_tasks/${t.id}`, { method: 'PATCH', body }), msg).then((ok) => ok && q.reload());
        return (
          <div className="stack">
            <PageHead title={<>{t.title} <DemoTag row={t} /></>} sub={<>{t.campaign_id ? <Link to={`/campaigns/${t.campaign_id}`}>{t.campaign_id_label}</Link> : 'No campaign'} · creator {t.influencer_id_label ?? '—'} · editor {t.editor_id_label ?? 'unassigned'} · reviewer {t.reviewer_id_label ?? '—'} · due {formatDate(t.due_date)}</>}
              actions={<>
                {editor && EDITOR_STAGES.includes(t.stage) && t.stage !== 'internal_review' && <button className="btn primary" onClick={() => patch({ stage: 'internal_review' }, 'Submitted for review')}>Submit for review</button>}
                {editor && t.stage === 'changes_requested' && <button className="btn primary" onClick={() => patch({ stage: 'editing' }, 'Back in editing')}>Start changes</button>}
                {canReview && <ReviewActions t={t} onDone={q.reload} />}
                {!editor && <AnalyseButton type="content_planning" ids={[t.id]} cap="campaigns" />}
                {canEdit && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
                {canEdit && <ArchiveButton entity="content_tasks" row={t} onDone={() => nav('/content')} />}
              </>} />
            <div className="row"><Badge value={t.stage} /><Badge value={t.priority} />{t.blocked_reason && <Badge tone="warn">Blocked: {t.blocked_reason}</Badge>}{(t.depends_on ?? []).length > 0 && <span className="small">Depends on {(t.depends_on as number[]).map((x) => <Link key={x} to={`/content/${x}`}>#{x} </Link>)}</span>}</div>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: 'work', label: 'Brief & script' }, { key: 'versions', label: `Versions (${(t.versions ?? []).length})` }, { key: 'feedback', label: 'Feedback & approvals' }, { key: 'activity', label: 'Activity' }]} />
            {tab === 'work' && (
              <div className="grid two">
                <div className="stack">
                  <Card title="Brief"><p className="pre">{t.brief ?? <span className="muted">No brief yet</span>}</p>
                    <dl className="kv small" style={{ marginTop: 10 }}>
                      <dt>Output specs</dt><dd>{t.output_specs ?? '—'}</dd>
                      <dt>References</dt><dd>{(t.reference_links ?? []).map((u: string) => <div key={u}><a href={u} target="_blank" rel="noreferrer">{u}</a></div>)}{!(t.reference_links ?? []).length && '—'}</dd>
                      <dt>Raw footage</dt><dd>{(t.raw_footage_links ?? []).map((u: string) => <div key={u}><a href={u} target="_blank" rel="noreferrer">{u}</a></div>)}{!(t.raw_footage_links ?? []).length && '—'}</dd>
                      <dt>Final delivery</dt><dd>{t.final_url ? <a href={t.final_url} target="_blank" rel="noreferrer">{t.final_url}</a> : '—'}</dd>
                      <dt>Revisions</dt><dd>{t.revision_allowance ?? 2} included{t.extra_revision_cost !== undefined && t.extra_revision_cost ? ` · extra ${formatINR(t.extra_revision_cost)} each` : ''}</dd>
                      {t.editor_fee !== undefined && <><dt>Editor fee</dt><dd><Money p={t.editor_fee} /></dd></>}
                    </dl>
                  </Card>
                  <Checklist t={t} onChange={(checklist) => patch({ checklist }, 'Checklist updated')} />
                  {editor && <Card title="Delivery"><label className="field"><span>Final delivery link</span><input className="input" defaultValue={t.final_url ?? ''} onBlur={(e) => e.target.value !== (t.final_url ?? '') && patch({ final_url: e.target.value })} /></label>
                    <label className="field" style={{ marginTop: 8 }}><span>Blocked by</span><input className="input" placeholder="e.g. waiting for raw footage" defaultValue={t.blocked_reason ?? ''} onBlur={(e) => e.target.value !== (t.blocked_reason ?? '') && patch({ blocked_reason: e.target.value })} /></label></Card>}
                </div>
                <ScriptEditor t={t} onSaved={q.reload} />
              </div>
            )}
            {tab === 'versions' && <Versions t={t} onChange={q.reload} />}
            {tab === 'feedback' && <Card title="Feedback, approvals & discussion" hint="Feedback can be pinned to a version and timestamp"><FeedbackForm t={t} onDone={() => invalidate('/api/comments')} /><Timeline entity="content_tasks" id={t.id} kinds={['comment', 'feedback']} /></Card>}
            {tab === 'activity' && <Card><Activity entity="content_tasks" id={t.id} /></Card>}
            <Modal open={editing} onClose={() => setEditing(false)} title="Edit content task"><EntityForm entity="content_tasks" record={t} onSaved={() => (setEditing(false), q.reload())} /></Modal>
          </div>
        );
      }}
    </Async>
  );
}

function ReviewActions({ t, onDone }: { t: Row; onDone: () => void }) {
  const act = async (decision: string, label: string, needsComment = false) => {
    let comment = '';
    if (needsComment) {
      const r = await confirmAction({ title: 'Request changes', message: `Revision allowance: ${t.revision_allowance ?? 2}. Extra revisions may cost ${formatINR(t.extra_revision_cost ?? 0)} each.`, confirm: 'Request changes', reason: 'What needs to change' });
      if (r === false) return;
      comment = r;
    }
    try {
      const res = await api(`/api/content/${t.id}/review`, { body: { decision, comment } });
      toast(label);
      if (res.extra_revision) toast(`Revision ${res.revisions_used} exceeds the allowance of ${res.allowance}${res.extra_revision.cost ? ` — extra cost ${formatINR(res.extra_revision.cost)}` : ''}`, 'error');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <>
      {t.stage === 'internal_review' && <button className="btn primary" onClick={() => act('approve_internal', 'Sent to brand review')}>Approve → brand review</button>}
      {['internal_review', 'brand_review'].includes(t.stage) && <button className="btn" onClick={() => act('request_changes', 'Changes requested', true)}>Request changes</button>}
      {t.stage === 'brand_review' && <button className="btn primary" onClick={() => act('brand_approved', 'Marked approved by brand')}>Brand approved</button>}
      {t.stage === 'approved' && <button className="btn primary" onClick={() => act('deliver', 'Marked delivered')}>Mark delivered</button>}
    </>
  );
}

function Checklist({ t, onChange }: { t: Row; onChange: (c: Row[]) => void }) {
  const items: Row[] = t.checklist ?? [];
  const [text, setText] = useState('');
  return (
    <Card title="Checklist" hint={`${items.filter((i) => i.done).length}/${items.length} done`}>
      <div className="stack tight">
        {items.map((it, i) => <label key={i} className="check"><input type="checkbox" checked={!!it.done} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} /> {it.text}</label>)}
        <div className="row nowrap-row"><input className="input" placeholder="Add item" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onChange([...items, { text: text.trim(), done: false }]); setText(''); } }} /><button className="btn sm" disabled={!text.trim()} onClick={() => { onChange([...items, { text: text.trim(), done: false }]); setText(''); }}>Add</button></div>
      </div>
    </Card>
  );
}

function ScriptEditor({ t, onSaved }: { t: Row; onSaved: () => void }) {
  const [script, setScript] = useState(t.script ?? '');
  const [caption, setCaption] = useState(t.caption ?? '');
  const dirty = script !== (t.script ?? '') || caption !== (t.caption ?? '');
  const words = script.trim() ? script.trim().split(/\s+/).length : 0;
  return (
    <Card title="Script & caption" hint={`${words} words · ~${Math.round(words / 2.5)}s spoken · caption ${caption.length}/2200 characters`} actions={<button className="btn primary sm" disabled={!dirty} onClick={async () => { if (await attempt(() => api(`/api/content/${t.id}/script`, { method: 'PUT', body: { script, caption } }), 'Script saved')) onSaved(); }}>Save</button>}>
      <div className="stack">
        <label className="field"><span>Script</span><textarea className="input code" style={{ minHeight: 260 }} value={script} onChange={(e) => setScript(e.target.value)} /></label>
        <label className="field"><span>Caption</span><textarea className="input" value={caption} maxLength={2200} onChange={(e) => setCaption(e.target.value)} /></label>
        <p className="small muted">Saving a version (Versions tab) snapshots this script and caption so versions can be compared.</p>
      </div>
    </Card>
  );
}

function Preview({ url }: { url: string | null }) {
  if (!url) return null;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return <video src={url} controls style={{ maxWidth: '100%', maxHeight: 360 }} />;
  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) return <img src={url} alt="Version preview" style={{ maxWidth: '100%', maxHeight: 360 }} />;
  return <a href={url} target="_blank" rel="noreferrer">Open file ({url.replace(/^https?:\/\//, '').split('/')[0]})</a>;
}

function Versions({ t, onChange }: { t: Row; onChange: () => void }) {
  const versions: Row[] = t.versions ?? [];
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [a, setA] = useState(Math.max(0, versions.length - 2));
  const [b, setB] = useState(versions.length - 1);
  const diff = useMemo(() => (versions[a] && versions[b] ? { script: diffWords(versions[a].script ?? '', versions[b].script ?? ''), caption: diffWords(versions[a].caption ?? '', versions[b].caption ?? '') } : null), [a, b, versions]);
  return (
    <div className="stack">
      <Card title="Submit a new version" hint="Upload the cut to Drive/Frame.io/YouTube (unlisted) and paste the link. Heavy editing stays in your editing tool.">
        <div className="form-grid">
          <label className="field"><span>Link to the cut</span><input className="input" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
          <label className="field"><span>What changed</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={async () => { if (await attempt(() => api(`/api/content/${t.id}/versions`, { body: { url, notes } }), 'Version saved')) { setUrl(''); setNotes(''); onChange(); } }}>Save version {versions.length + 1}</button></div>
      </Card>
      {versions.length ? (
        <div className="grid two">
          {[...versions].reverse().map((v) => (
            <Card key={v.no} title={`Version ${v.no}`} hint={`${formatDate(v.at)} · ${v.by}`}>
              <p className="small">{v.notes}</p>
              <Preview url={v.url} />
            </Card>
          ))}
        </div>
      ) : <Empty title="No versions yet" />}
      {versions.length >= 2 && diff && (
        <Card title="Compare versions" actions={<div className="row small">
          <select className="input" style={{ width: 'auto' }} value={a} onChange={(e) => setA(Number(e.target.value))}>{versions.map((v, i) => <option key={i} value={i}>v{v.no}</option>)}</select> →
          <select className="input" style={{ width: 'auto' }} value={b} onChange={(e) => setB(Number(e.target.value))}>{versions.map((v, i) => <option key={i} value={i}>v{v.no}</option>)}</select>
        </div>}>
          <h3>Script</h3>
          <p className="pre diff small">{diff.script.map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}</p>
          <h3 style={{ marginTop: 10 }}>Caption</h3>
          <p className="pre diff small">{diff.caption.map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}</p>
        </Card>
      )}
    </div>
  );
}

function FeedbackForm({ t, onDone }: { t: Row; onDone: () => void }) {
  const [body, setBody] = useState('');
  const [ts, setTs] = useState('');
  const versions: Row[] = t.versions ?? [];
  const [version, setVersion] = useState(versions.length || '');
  return (
    <div className="card stack tight" style={{ padding: 12, marginBottom: 12 }}>
      <div className="row">
        <select className="input" style={{ width: 'auto' }} value={version} onChange={(e) => setVersion(e.target.value ? Number(e.target.value) : '')} aria-label="Version"><option value="">General</option>{versions.map((v) => <option key={v.no} value={v.no}>Version {v.no}</option>)}</select>
        <input className="input" style={{ width: 110 }} placeholder="mm:ss" value={ts} onChange={(e) => setTs(e.target.value)} aria-label="Timestamp" />
      </div>
      <textarea className="input" placeholder="Timestamped feedback, e.g. 0:12 — cut the pause before the product shot" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary sm" disabled={!body.trim()} onClick={async () => {
        const m = /^(\d+):(\d{1,2})$/.exec(ts.trim());
        const sec = m ? Number(m[1]) * 60 + Number(m[2]) : null;
        if (ts.trim() && sec === null) return toast('Timestamp must look like 1:05', 'error');
        if (await attempt(() => api('/api/comments', { body: { entity_type: 'content_tasks', entity_id: t.id, kind: 'feedback', body, meta: { version: version || null, timestamp_sec: sec } } }), 'Feedback added')) { setBody(''); setTs(''); onDone(); }
      }}>Add feedback</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- editors

export function Editors() {
  const w = useApi<{ rows: Row[] }>('/api/editors-workload');
  return (
    <div className="stack">
      <PageHead title="Editors" sub="Skills, availability, workload and turnaround" actions={<><AnalyseButton type="editor_workload" cap="campaigns" /><Link className="btn" to="/content">Content board</Link></>} />
      <Async q={w}>{(d) => (
        <div className="grid wide">{d.rows.map((e) => (
          <Link key={e.id} to={`/editors/${e.id}`} className="card stack tight" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="row between"><strong>{e.name}</strong><Badge value={e.availability} /></div>
            <div className="small">{e.open} open · {e.due_this_week} due this week · <span className={e.overdue ? 'neg' : ''}>{e.overdue} overdue</span> · {e.blocked} blocked</div>
            {e.utilisation !== null && <div className={`meter ${e.utilisation > 100 ? 'bad' : e.utilisation > 80 ? 'warn' : ''}`} title={`${e.utilisation}% of weekly capacity`}><div style={{ width: `${Math.min(100, e.utilisation)}%` }} /></div>}
            <div className="small muted">Median turnaround {e.median_turnaround_days ?? '—'} days · {e.avg_revisions ?? '—'} revisions/task · {e.delivered} delivered</div>
          </Link>
        ))}</div>
      )}</Async>
      <EntityTable entity="editors" />
    </div>
  );
}

export function EditorPage() {
  const { id } = useParams();
  const q = useApi<{ row: Row }>(`/api/e/editors/${id}`);
  const tasks = useApi<{ rows: Row[] }>('/api/e/content_tasks');
  const canFin = useCan('campaign_finance');
  const pay = useApi<{ rows: Row[] }>(canFin ? `/api/finance/payables?editor_id=${id}` : null);
  const [editing, setEditing] = useState(false);
  const nav = useNavigate();
  const canEdit = useCan('campaigns');
  return (
    <Async q={q}>{({ row: e }) => {
      const mine = (tasks.data?.rows ?? []).filter((t) => t.editor_id === e.id);
      return (
        <div className="stack">
          <PageHead title={<>{e.name} <DemoTag row={e} /></>} sub={<><Badge value={e.availability} /> {(e.skills ?? []).join(', ')} {e.portfolio_url && <a href={e.portfolio_url} target="_blank" rel="noreferrer">Portfolio</a>}</>} actions={<><AnalyseButton type="editor_workload" ids={[e.id]} cap="campaigns" />{canEdit && <><button className="btn" onClick={() => setEditing(true)}>Edit</button><ArchiveButton entity="editors" row={e} onDone={() => nav('/editors')} /></>}</>} />
          <div className="grid">
            <Stat label="Open tasks" value={mine.filter((t) => !['approved', 'delivered'].includes(t.stage)).length} />
            <Stat label="Delivered" value={mine.filter((t) => t.stage === 'delivered').length} />
            {e.rate !== undefined && <Stat label="Rate" value={<Money p={e.rate} />} foot={humanize(e.rate_type ?? '')} />}
          </div>
          <div className="grid two">
            <Card title="Profile"><Details entity="editors" row={e} skip={['name']} /></Card>
            <Card title="Assigned work" flush>
              <DataTable rows={mine} viewKey="editor-tasks" onRowClick={(r) => nav(`/content/${r.id}`)} columns={[{ key: 'title', label: 'Task' }, { key: 'stage', label: 'Stage', filter: true, render: (r) => <Badge value={r.stage} /> }, { key: 'due_date', label: 'Due', render: (r) => formatDate(r.due_date) }]} />
            </Card>
          </div>
          {pay.data && <Card title="Payment history" flush><PayableTable rows={pay.data.rows} /></Card>}
          <Card title="Notes"><Timeline entity="editors" id={e.id} /></Card>
          <Modal open={editing} onClose={() => setEditing(false)} title="Edit editor"><EntityForm entity="editors" record={e} onSaved={() => (setEditing(false), q.reload())} /></Modal>
        </div>
      );
    }}</Async>
  );
}
