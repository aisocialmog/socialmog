import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { formatDate } from '../../shared/dates.ts';
import { humanize } from '../../shared/schema.ts';
import {
  Activity, api, ArchiveButton, Async, attempt, Badge, Calendar, Card, DemoTag, Details, Empty, EntityForm, EntityTable, invalidate, Kanban, Modal, Money,
  PageHead, REF_PATHS, Stat, Timeline, toast, useApi, useCan, useMe, useOptions, useToday, type Row,
} from '../lib.tsx';
import { LinkedDocuments } from './influencers.tsx';

// ---------------------------------------------------------------- tasks

export function Tasks() {
  const me = useMe();
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') ?? 'board';
  const mine = sp.get('mine') === '1';
  const q = useApi<{ rows: Row[] }>('/api/e/tasks');
  const [creating, setCreating] = useState(false);
  const [month, setMonth] = useState(useToday().slice(0, 7));
  const today = useToday();
  const nav = useNavigate();
  return (
    <div className="stack">
      <PageHead title="Tasks" sub="Agency-wide work with owners, deadlines, checklists, dependencies and recurrence"
        actions={<>
          <label className="check small"><input type="checkbox" checked={mine} onChange={(e) => setSp({ view, ...(e.target.checked ? { mine: '1' } : {}) })} /> Only mine</label>
          <div className="seg">{['board', 'table', 'calendar'].map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setSp({ view: v, ...(mine ? { mine: '1' } : {}) })}>{humanize(v)}</button>)}</div>
          <button className="btn primary" onClick={() => setCreating(true)}>New task</button>
        </>} />
      <Async q={q}>
        {(d) => {
          const rows = mine ? d.rows.filter((t) => t.owner_id === me.user.id) : d.rows;
          if (view === 'table') return <EntityTable entity="tasks" rows={rows} />;
          if (view === 'calendar') return <Card><Calendar month={month} onMonth={setMonth} events={rows.filter((t) => t.due_date).map((t) => ({ date: t.due_date, label: t.title, link: `/tasks/${t.id}`, kind: t.status === 'done' ? 'in' : t.due_date < today ? 'out' : '' }))} /></Card>;
          return (
            <Kanban stages={['todo', 'in_progress', 'blocked', 'done']} items={rows} stageOf={(t) => t.status} onMove={async (t, status) => {
              if (await attempt(() => api(`/api/e/tasks/${t.id}`, { method: 'PATCH', body: { status } }), status === 'done' && t.recurrence !== 'none' ? 'Done — next occurrence created' : 'Updated')) q.reload();
            }} card={(t) => {
              const items: Row[] = t.checklist ?? [];
              return (
                <>
                  <Link to={`/tasks/${t.id}`} className="strong">{t.title}</Link>
                  <span className="row small"><Badge value={t.priority} />{t.owner_id_label && <span>{t.owner_id_label}</span>}{t.due_date && <span className={t.due_date < today && t.status !== 'done' ? 'neg' : 'muted'}>{formatDate(t.due_date)}</span>}{t.recurrence !== 'none' && <Badge tone="info">↻ {t.recurrence}</Badge>}<DemoTag row={t} /></span>
                  {items.length > 0 && <span className="small muted">☑ {items.filter((i) => i.done).length}/{items.length}</span>}
                  {(t.depends_on ?? []).length > 0 && <span className="small muted">Depends on {(t.depends_on as number[]).map((x) => `#${x}`).join(', ')}</span>}
                </>
              );
            }} />
          );
        }}
      </Async>
      <Modal open={creating} onClose={() => setCreating(false)} title="New task"><EntityForm entity="tasks" initial={{ owner_id: me.user.id }} onSaved={(r) => (setCreating(false), nav(`/tasks/${r.id}`))} /></Modal>
    </div>
  );
}

export function TaskPage() {
  const { id } = useParams();
  const q = useApi<{ row: Row }>(`/api/e/tasks/${id}`);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const nav = useNavigate();
  return (
    <Async q={q}>{({ row: t }) => {
      const items: Row[] = t.checklist ?? [];
      const patch = (body: Row, msg = 'Saved') => attempt(() => api(`/api/e/tasks/${t.id}`, { method: 'PATCH', body }), msg).then((ok) => ok && q.reload());
      return (
        <div className="stack">
          <PageHead title={<>{t.title} <DemoTag row={t} /></>} sub={<><Badge value={t.status} /> <Badge value={t.priority} /> · {t.owner_id_label ?? 'Unassigned'} · due {formatDate(t.due_date)}{t.recurrence !== 'none' && ` · repeats ${t.recurrence}`}</>}
            actions={<>{t.status !== 'done' && <button className="btn primary" onClick={() => patch({ status: 'done' }, 'Marked done')}>Mark done</button>}<button className="btn" onClick={() => setEditing(true)}>Edit</button><ArchiveButton entity="tasks" row={t} onDone={() => nav('/tasks')} /></>} />
          <div className="grid two">
            <div className="stack">
              <Card title="Details"><Details entity="tasks" row={t} skip={['title', 'related_type', 'related_id']} />
                {t.related_type && t.related_id && <p className="small" style={{ marginTop: 8 }}>Linked to <Link to={`/${REF_PATHS[t.related_type] ?? `r/${t.related_type}`}/${t.related_id}`}>{humanize(t.related_type)} #{t.related_id}</Link></p>}
                {(t.depends_on ?? []).length > 0 && <p className="small">Depends on: {(t.depends_on as number[]).map((x) => <Link key={x} to={`/tasks/${x}`}>#{x} </Link>)}</p>}
              </Card>
              <Card title="Checklist" hint={`${items.filter((i) => i.done).length}/${items.length}`}>
                <div className="stack tight">
                  {items.map((it, i) => <label key={i} className="check"><input type="checkbox" checked={!!it.done} onChange={(e) => patch({ checklist: items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) }, 'Updated')} /> {it.text}</label>)}
                  <div className="row nowrap-row"><input className="input" placeholder="Add item" value={text} onChange={(e) => setText(e.target.value)} /><button className="btn sm" disabled={!text.trim()} onClick={() => { patch({ checklist: [...items, { text: text.trim(), done: false }] }, 'Added'); setText(''); }}>Add</button></div>
                </div>
              </Card>
            </div>
            <Card title="Comments"><Timeline entity="tasks" id={t.id} kinds={['comment', 'note']} /></Card>
          </div>
          <Card title="Activity"><Activity entity="tasks" id={t.id} /></Card>
          <Modal open={editing} onClose={() => setEditing(false)} title="Edit task"><EntityForm entity="tasks" record={t} onSaved={() => (setEditing(false), q.reload())} /></Modal>
        </div>
      );
    }}</Async>
  );
}

// ---------------------------------------------------------------- documents

export function Documents() {
  const [sp] = useSearchParams();
  return (
    <div className="stack">
      <PageHead title="Documents" sub="Contracts, briefs, proposals, invoices, receipts, reports and templates — linked to the records they belong to" />
      <EntityTable entity="documents" defaults={sp.get('kind') ? { kind: sp.get('kind') } : undefined} overrides={{
        title: { render: (r) => <><strong>{r.title}</strong> {r.file && <Badge tone="info">File</Badge>} <DemoTag row={r} /></> },
        entity_type: { render: (r) => (r.entity_type && r.entity_id ? <Link to={`/${REF_PATHS[r.entity_type] ?? `r/${r.entity_type}`}/${r.entity_id}`} onClick={(e) => e.stopPropagation()}>{humanize(r.entity_type)} #{r.entity_id}</Link> : '—') },
      }} />
    </div>
  );
}

export function DocumentPage() {
  const { id } = useParams();
  const q = useApi<{ row: Row }>(`/api/e/documents/${id}`);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  return (
    <Async q={q}>{({ row: d }) => (
      <div className="stack">
        <PageHead title={<>{d.title} <DemoTag row={d} /></>} sub={<><Badge value={d.kind} /> <Badge value={d.visibility} />{d.expiry_date && <> · expires {formatDate(d.expiry_date)}</>}</>}
          actions={<><button className="btn" onClick={() => setEditing(true)}>Edit</button><ArchiveButton entity="documents" row={d} onDone={() => nav('/documents')} /></>} />
        <div className="grid two">
          <Card title="Details">
            <Details entity="documents" row={d} skip={['title', 'body']} />
            {d.entity_type && d.entity_id && <p className="small" style={{ marginTop: 8 }}>Linked to <Link to={`/${REF_PATHS[d.entity_type] ?? `r/${d.entity_type}`}/${d.entity_id}`}>{humanize(d.entity_type)} #{d.entity_id}</Link></p>}
          </Card>
          <Card title="File" hint="PDF, images, Office files, CSV, ZIP or MP4 up to 50 MB. Stored privately; only signed-in users with access can open it.">
            <div className="stack">
              {d.file ? (
                <>
                  <div className="row"><a className="btn" href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">Open</a><a className="btn" href={`/api/documents/${d.id}/file?download=1`}>Download</a><span className="small muted">{d.mime} · {Math.round((d.size ?? 0) / 1024)} KB</span></div>
                  {d.mime === 'application/pdf' && <iframe title="Preview" src={`/api/documents/${d.id}/file`} style={{ width: '100%', height: 420, border: '1px solid var(--border)', borderRadius: 8 }} />}
                  {d.mime?.startsWith('image/') && <img src={`/api/documents/${d.id}/file`} alt={d.title} style={{ maxWidth: '100%' }} />}
                  {d.mime?.startsWith('video/') && <video src={`/api/documents/${d.id}/file`} controls style={{ maxWidth: '100%' }} />}
                </>
              ) : d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.url}</a> : <Empty title="No file yet" />}
              <input type="file" disabled={busy} onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                if (await attempt(() => api(`/api/documents/${d.id}/file`, { raw: file, headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': file.name } }), 'Uploaded')) q.reload();
                setBusy(false);
              }} />
            </div>
          </Card>
        </div>
        {d.kind === 'template' && <TemplateFill d={d} />}
        <Card title="Activity"><Activity entity="documents" id={d.id} /></Card>
        <Modal open={editing} onClose={() => setEditing(false)} title="Edit document"><EntityForm entity="documents" record={d} onSaved={() => (setEditing(false), q.reload())} /></Modal>
      </div>
    )}</Async>
  );
}

function TemplateFill({ d }: { d: Row }) {
  const [vals, setVals] = useState<Row>({ date: formatDate(useToday()) });
  const keys = [...new Set([...(d.body ?? '').matchAll(/{{(\w+)}}/g)].map((m) => m[1]))];
  const out = (d.body ?? '').replace(/{{(\w+)}}/g, (_: string, k: string) => vals[k] || `{{${k}}}`);
  const nav = useNavigate();
  return (
    <Card title="Use this template" hint="Fill the placeholders, then copy the text or save it as a new document draft">
      <div className="form-grid">{keys.map((k) => <label key={k} className="field"><span>{humanize(k)}</span><input className="input" value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></label>)}</div>
      <pre className="pre card small" style={{ marginTop: 10 }}>{out}</pre>
      <div className="row">
        <button className="btn" onClick={() => navigator.clipboard.writeText(out).then(() => toast('Copied'))}>Copy text</button>
        <button className="btn primary" onClick={async () => {
          try {
            const r = await api('/api/e/documents', { body: { title: `${d.title.replace(/^Template:\s*/, '')} — ${vals.brand ?? vals.creator ?? vals.campaign ?? 'draft'}`, kind: d.template_for ?? (d.title.toLowerCase().includes('proposal') ? 'proposal' : d.title.toLowerCase().includes('brief') ? 'brief' : d.title.toLowerCase().includes('agreement') ? 'creator_agreement' : 'other'), body: out, visibility: 'internal' } });
            invalidate('/api/e/documents');
            nav(`/documents/${r.row.id}`);
          } catch (e) {
            toast((e as Error).message, 'error');
          }
        }}>Save as new document</button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- assets

export function Assets() {
  const q = useApi<{ rows: Row[] }>('/api/e/assets');
  const canFin = useCan('campaign_finance');
  return (
    <div className="stack">
      <PageHead title="Assets" sub="Equipment and subscriptions. Asset purchases are reported separately from operating expenses." actions={<Link className="btn" to="/reports?type=asset_register">Asset register PDF</Link>} />
      {canFin && q.data && (
        <div className="grid">
          <Stat label="Assets in use" value={q.data.rows.filter((a) => a.status === 'active').length} />
          <Stat label="Total cost (active)" value={<Money p={q.data.rows.filter((a) => a.status === 'active').reduce((s, a) => s + (a.cost ?? 0), 0)} />} />
          <Stat label="Renewals / maintenance in 30 days" value={q.data.rows.filter((a) => [a.renewal_date, a.next_maintenance].some((x) => x && x <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10))).length} />
          <Stat label="In repair / lost" value={q.data.rows.filter((a) => ['in_repair', 'lost'].includes(a.status)).length} />
        </div>
      )}
      <EntityTable entity="assets" overrides={{ name: { render: (r) => <><strong>{r.name}</strong> <DemoTag row={r} /></> } }} />
    </div>
  );
}

export function AssetPage() {
  const { id } = useParams();
  const q = useApi<{ row: Row }>(`/api/e/assets/${id}`);
  const canFinance = useCan('finance');
  const docs = useApi<{ rows: Row[] }>('/api/e/documents');
  const txns = useApi<{ rows: Row[] }>(canFinance ? `/api/finance/transactions?asset_id=${id}` : null);
  const [editing, setEditing] = useState(false);
  const [event, setEvent] = useState<Row | null>(null);
  const nav = useNavigate();
  const today = useToday();
  const canEdit = canFinance;
  const campaigns = useOptions('campaigns');
  return (
    <Async q={q}>{({ row: a }) => {
      const linked = (txns.data?.rows ?? []).filter((t) => t.asset_id === a.id);
      const events: Row[] = a.events ?? [];
      return (
        <div className="stack">
          <PageHead title={<>{a.name} <DemoTag row={a} /></>} sub={<><Badge value={a.status} /> {humanize(a.category ?? '')} · custodian {a.custodian ?? '—'} · {a.location ?? ''}</>}
            actions={canEdit && <><button className="btn" onClick={() => setEvent({ date: today, kind: 'maintenance', notes: '' })}>Log event</button><Link className="btn" to={`/finance/simulate`}>Simulate a replacement</Link><button className="btn" onClick={() => setEditing(true)}>Edit</button><ArchiveButton entity="assets" row={a} onDone={() => nav('/assets')} /></>} />
          <div className="grid">
            {a.cost !== undefined && <Stat label="Cost" value={<Money p={a.cost} />} foot={`Bought ${formatDate(a.purchase_date)}`} />}
            <Stat label="Warranty until" value={a.warranty_until ? formatDate(a.warranty_until) : '—'} />
            <Stat label="Next maintenance" value={a.next_maintenance ? formatDate(a.next_maintenance) : '—'} />
            <Stat label="Renewal" value={a.renewal_date ? formatDate(a.renewal_date) : '—'} />
          </div>
          <div className="grid two">
            <Card title="Details">
              <Details entity="assets" row={a} skip={['name']} />
              {a.campaign_id && <p className="small" style={{ marginTop: 8 }}>Funded via allocation from <Link to={`/campaigns/${a.campaign_id}`}>{campaigns.find((c) => c.id === a.campaign_id)?.label ?? `campaign #${a.campaign_id}`}</Link></p>}
            </Card>
            <div className="stack">
              <Card title="History">{events.length ? <div className="list">{[...events].reverse().map((e, i) => <div key={i} className="list-item small"><span className="nowrap muted">{formatDate(e.date)}</span><span className="grow"><Badge value={e.kind} /> {e.notes}</span>{e.cost ? <Money p={e.cost} /> : null}</div>)}</div> : <Empty title="No events logged" />}</Card>
              {txns.data && <Card title="Linked transactions" flush>{linked.length ? <table className="table"><tbody>{linked.map((t) => <tr key={t.id}><td><Link to={`/finance/transactions/${t.id}`}>{formatDate(t.txn_date)} · {t.description}</Link></td><td className="num"><Money p={t.amount} /></td></tr>)}</tbody></table> : <Empty title="No transactions linked" hint="Tag the purchase transaction with this asset from the transaction page." />}</Card>}
            </div>
          </div>
          <LinkedDocuments entity="assets" id={a.id} docs={(docs.data?.rows ?? []).filter((x) => x.entity_type === 'assets' && x.entity_id === a.id)} />
          <Card title="Notes"><Timeline entity="assets" id={a.id} kinds={['note', 'comment']} /></Card>
          <Modal open={editing} onClose={() => setEditing(false)} title="Edit asset"><EntityForm entity="assets" record={a} onSaved={() => (setEditing(false), q.reload())} /></Modal>
          <Modal open={!!event} onClose={() => setEvent(null)} title="Log asset event" size="narrow">
            {event && (
              <div className="stack">
                <label className="field"><span>Date</span><input type="date" className="input" value={event.date} onChange={(e) => setEvent({ ...event, date: e.target.value })} /></label>
                <label className="field"><span>Type</span><select className="input" value={event.kind} onChange={(e) => setEvent({ ...event, kind: e.target.value })}>{['maintenance', 'repair', 'assigned', 'moved', 'renewed', 'insured', 'other'].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></label>
                <label className="field"><span>Notes</span><input className="input" value={event.notes} onChange={(e) => setEvent({ ...event, notes: e.target.value })} /></label>
                <p className="small muted">Record any cost as a transaction or payable in Finance and tag it with this asset.</p>
                <button className="btn primary" onClick={async () => {
                  if (await attempt(() => api(`/api/assets/${a.id}/events`, { body: event }), 'Logged')) { setEvent(null); q.reload(); }
                }}>Save</button>
              </div>
            )}
          </Modal>
        </div>
      );
    }}</Async>
  );
}
