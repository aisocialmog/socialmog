/**
 * Manual ChatGPT analysis: build a context package + prompt, run it in the user's own ChatGPT, import the JSON result,
 * review it field by field, apply selected items atomically, undo. Imported text is only ever rendered as text.
 */
import { useState, type ReactNode } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';
import { Copy, Download, FileBarChart, Sparkles, Upload } from 'lucide-react';
import { addDays, addMonths, formatDate, formatPeriod, monthStart, weekStart } from '../../shared/dates.ts';
import { formatNumberIN } from '../../shared/money.ts';
import { ENTITY, humanize } from '../../shared/schema.ts';
import { api, Async, attempt, Badge, Card, confirmAction, DataTable, Empty, fmtDateTime, invalidate, Modal, PageHead, REF_PATHS, toast, useApi, useMe, useOptions, useToday, type Row } from '../lib.tsx';

export const LABEL = 'Manual ChatGPT analysis';

export function ChatGPT() {
  return (
    <Routes>
      <Route index element={<Workspace />} />
      <Route path="new" element={<NewAnalysis />} />
      <Route path="exports/:key" element={<ExportPage />} />
      <Route path="imports/:id" element={<ImportPage />} />
      <Route path="analyses/:id" element={<AnalysisPage />} />
    </Routes>
  );
}

const STATUS: Record<string, [string, string]> = {
  awaiting_import: ['Waiting for ChatGPT result', 'warn'],
  awaiting_apply: ['Result checked — not applied', 'info'],
  imported: ['Imported', 'good'],
};
const StatusBadge = ({ s }: { s: string }) => <Badge tone={STATUS[s]?.[1]}>{STATUS[s]?.[0] ?? humanize(s)}</Badge>;

/** Link to a Socialmog record reference like "influencers:12". */
export function refLink(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const [entity, id] = ref.split(':');
  if (entity === 'analytics_snapshots' || entity === 'posts') return null;
  return REF_PATHS[entity] ? `${REF_PATHS[entity]}/${id}` : `/r/${entity}/${id}`;
}
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));
const platformName = (p: string) => (p === 'youtube' ? 'YouTube' : humanize(p));

/** The report (and its parameters) that turns a package into a PDF. */
function reportLink(e: Row, analysisId?: number | null): string | null {
  if (!e.report) return null;
  const ids: number[] = (e.report.fromExtra ? e.params.extra_ids : e.params.ids) ?? [];
  const q = new URLSearchParams({ type: e.report.type, from: e.params.from, to: e.params.to });
  if (e.report.idParam && ids.length) q.set(e.report.idParam, ids.join(','));
  if (analysisId) q.set('analysis_id', String(analysisId));
  return `/reports?${q}`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs HTTPS or localhost; fall back to a selection copy.
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  toast('Copied — paste it into ChatGPT');
}

// ---------------------------------------------------------------- workspace

function Workspace() {
  const nav = useNavigate();
  const exports = useApi<{ rows: Row[] }>('/api/chatgpt/exports');
  const analyses = useApi<{ rows: Row[] }>('/api/chatgpt/analyses');
  const [importing, setImporting] = useState(false);
  const weekly = exports.data?.rows.find((e) => e.trigger === 'weekly');
  return (
    <div className="stack">
      <PageHead title={LABEL} sub="Export agency data with a ready-to-copy prompt, run it in your own ChatGPT, then import the JSON result. Socialmog HQ does not call any AI service in this workflow."
        actions={<><button className="btn" onClick={() => setImporting(true)}><Upload /> Import ChatGPT result</button><Link className="btn primary" to="/chatgpt/new"><Sparkles /> New analysis</Link></>} />
      <Card title="How it works">
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Choose the analysis, records, period and questions. Socialmog HQ builds a JSON context package and a prompt.</li>
          <li>In ChatGPT, attach the package and paste the prompt. For Instagram, ChatGPT can use a connector you authorised there (for example Windsor.ai) — that connection is between you and ChatGPT, not this website.</li>
          <li>Paste or upload ChatGPT's JSON reply here. You see every affected record, value conflicts and proposed changes before anything is saved.</li>
          <li>Apply the items you accept. Apply is all-or-nothing, audited and can be undone. Then generate the PDF.</li>
        </ol>
      </Card>
      {weekly && (
        <Card title="This week's analysis package" hint="Prepared automatically; running it in ChatGPT is up to you." actions={<StatusBadge s={weekly.status} />}>
          <div className="row">
            <span>{weekly.label} · {formatPeriod(weekly.params.from, weekly.params.to)}</span>
            <span className="grow" />
            <Link className="btn primary sm" to={`/chatgpt/exports/${weekly.export_key}`}>Open package</Link>
          </div>
        </Card>
      )}
      <Card title="Context packages" flush>
        <Async q={exports}>{(d) => (
          <DataTable rows={d.rows.map((e) => ({ ...e, id: e.created_at + e.export_key }))} viewKey="chatgpt-exports" onRowClick={(e) => nav(`/chatgpt/exports/${e.export_key}`)} empty={<Empty title="No packages yet" action={<Link className="btn primary" to="/chatgpt/new">New analysis</Link>} />} columns={[
            { key: 'label', label: 'Analysis', filter: true },
            { key: 'period', label: 'Period', render: (e) => formatPeriod(e.params.from, e.params.to), value: (e) => e.params.from },
            { key: 'records', label: 'Records', num: true, value: (e) => e.params.ids?.length ?? 0, render: (e) => (e.params.ids?.length ? e.params.ids.length : 'All') },
            { key: 'trigger', label: 'Prepared', render: (e) => (e.trigger === 'weekly' ? 'Automatically (weekly)' : 'Manually') },
            { key: 'status', label: 'Status', filter: true, render: (e) => <StatusBadge s={e.status} /> },
            { key: 'created_at', label: 'Created', render: (e) => <span className="small">{fmtDateTime(e.created_at)}</span> },
          ]} />
        )}</Async>
      </Card>
      <Card title="Imported analyses" hint="Written by ChatGPT and imported by your team — not calculated by Socialmog HQ" flush>
        <Async q={analyses}>{(d) => (
          <DataTable rows={d.rows} viewKey="chatgpt-analyses" onRowClick={(a) => nav(`/chatgpt/analyses/${a.id}`)} empty={<Empty title="No imported analyses yet" />} columns={[
            { key: 'analysis_type', label: 'Analysis', filter: true, render: (a) => humanize(a.analysis_type) },
            { key: 'period', label: 'Period', render: (a) => formatPeriod(a.period_start, a.period_end), value: (a) => a.period_start },
            { key: 'summary', label: 'Summary', render: (a) => <span className="ellipsis" style={{ maxWidth: 420, display: 'inline-block' }}>{a.summary}</span> },
            { key: 'recs', label: 'Recommendations', num: true, value: (a) => a.recommendations?.length ?? 0 },
            { key: 'flags', label: 'Shown', render: (a) => <>{a.on_dashboard && <Badge tone="info">Dashboard</Badge>} {a.shareable && <Badge tone="good">Shareable</Badge>}</> },
            { key: 'created_at', label: 'Imported', render: (a) => <span className="small">{fmtDateTime(a.created_at)}</span> },
          ]} />
        )}</Async>
      </Card>
      <Modal open={importing} onClose={() => setImporting(false)} title="Import ChatGPT result">{importing && <ImportPanel />}</Modal>
    </div>
  );
}

// ---------------------------------------------------------------- choose the analysis

function periods(today: string): Record<string, [string, string, string]> {
  const lw = addDays(weekStart(today), -7);
  return {
    last_week: ['Last week (Mon–Sun)', lw, addDays(lw, 6)],
    this_week: ['This week so far', weekStart(today), today],
    last_month: ['Last month', addMonths(monthStart(today), -1), addDays(monthStart(today), -1)],
    this_month: ['This month so far', monthStart(today), today],
    last_90: ['Last 90 days', addDays(today, -90), today],
  };
}

function PickList({ entity, value, onChange, single }: { entity: string; value: number[]; onChange: (v: number[]) => void; single?: boolean }) {
  const opts = useOptions(entity);
  const [q, setQ] = useState('');
  const shown = opts.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack tight">
      <div className="row"><input className="input" placeholder={`Search ${ENTITY[entity].plural.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} /><span className="small muted nowrap">{value.length} selected</span>{value.length > 0 && <button className="btn ghost sm" onClick={() => onChange([])}>Clear</button>}</div>
      <div className="picklist">
        {shown.map((o) => (
          <label key={o.id} className="check" style={{ display: 'flex' }}>
            <input type={single ? 'radio' : 'checkbox'} checked={value.includes(o.id)} onChange={(e) => onChange(single ? [o.id] : e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} /> {o.label}
          </label>
        ))}
        {!shown.length && <span className="small muted">No matches</span>}
      </div>
    </div>
  );
}

function NewAnalysis() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const today = useToday();
  const types = useApi<{ types: Row[] }>('/api/chatgpt/types');
  const [type, setType] = useState(sp.get('type') ?? 'influencer_growth');
  const [ids, setIds] = useState<number[]>((sp.get('ids') ?? '').split(',').filter(Boolean).map(Number));
  const [extra, setExtra] = useState<number[]>([]);
  const [period, setPeriod] = useState(sp.get('period') ?? 'last_week');
  const [custom, setCustom] = useState<[string, string]>([addDays(today, -6), today]);
  const [questions, setQuestions] = useState<string | null>(null);
  const [links, setLinks] = useState('');
  const [busy, setBusy] = useState(false);
  const t = types.data?.types.find((x) => x.key === type);
  const linkList = links.split(/\s+/).map((x) => x.trim()).filter(Boolean);
  const p = periods(today);
  const [from, to] = period === 'custom' ? custom : [p[period][1], p[period][2]];
  const create = async () => {
    setBusy(true);
    try {
      const r = await api('/api/chatgpt/exports', { body: { type, ids, extra_ids: extra, links: t?.profiles ? linkList : [], ...(t?.profiles ? {} : { from, to }), questions: (questions ?? t!.questions.join('\n')).split('\n').map((x: string) => x.trim()).filter(Boolean) } });
      invalidate('/api/chatgpt');
      nav(`/chatgpt/exports/${r.export_key}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <PageHead title="Analyse with ChatGPT" sub={`${LABEL} · choose what to analyse; nothing leaves Socialmog HQ until you download the package`} actions={<Link className="btn" to="/chatgpt">Back</Link>} />
      <Async q={types}>{(d) => (
        <Card>
          <div className="stack">
            <div className="form-grid">
              <label className="field"><span>Analysis</span>
                <select className="input" value={type} onChange={(e) => { setType(e.target.value); setIds([]); setExtra([]); setQuestions(null); }}>
                  {d.types.filter((x) => x.allowed).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                {t && !t.allowed && <span className="error">Your role cannot run this analysis.</span>}
                {t?.connector && <span className="hint">Supports Instagram metrics from a connector you have authorised inside ChatGPT.</span>}
              </label>
              {!t?.profiles && <label className="field"><span>Reporting period</span>
                <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>{Object.entries(p).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}<option value="custom">Custom…</option></select>
                <span className="hint">{formatPeriod(from, to)}</span>
              </label>}
              {!t?.profiles && period === 'custom' && <>
                <label className="field"><span>From</span><input type="date" className="input" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} /></label>
                <label className="field"><span>To</span><input type="date" className="input" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} /></label>
              </>}
            </div>
            {t?.profiles && (
              <label className="field"><span>Instagram / YouTube profile links (one per line)</span>
                <textarea className="input mono" rows={5} value={links} onChange={(e) => setLinks(e.target.value)} placeholder={'https://www.instagram.com/creatorhandle/\nhttps://www.youtube.com/@creatorhandle'} />
                <span className="hint">ChatGPT reads each public profile (or your analytics connector, or screenshots you upload when Instagram blocks it) and returns the creator's details, both channels and their recent videos with views. New creators are added; existing ones are matched only by exact handle or link, and you review everything before it is saved.</span>
              </label>
            )}
            {t?.pick && <div className="field"><span>{t.pick.label}</span><PickList entity={t.pick.entity} value={ids} onChange={setIds} single={t.pick.single} /></div>}
            {t?.extra && <div className="field"><span>{t.extra.label}</span><PickList entity={t.extra.entity} value={extra} onChange={setExtra} /></div>}
            {t && (
              <label className="field"><span>Questions for ChatGPT (one per line)</span>
                <textarea className="input" rows={5} value={questions ?? t.questions.join('\n')} onChange={(e) => setQuestions(e.target.value)} />
              </label>
            )}
            <div className="alert info small">The package includes record IDs, handles and profile links, the period and timezone, money in INR, metric definitions, relevant budgets, deliverables, targets and previous results, data sources and timestamps, missing-data notes, record versions and the required JSON response format. Passwords, tokens, bank and identity details and internal notes are never included.</div>
            <div className="row"><span className="grow" /><button className="btn primary" disabled={busy || !t?.allowed || (t.pick?.required && !ids.length) || (t.profiles && !ids.length && !linkList.length)} onClick={create}><Sparkles /> Create package & prompt</button></div>
          </div>
        </Card>
      )}</Async>
    </div>
  );
}

// ---------------------------------------------------------------- package: copy prompt, download, import, PDF

function ExportPage() {
  const { key } = useParams();
  const q = useApi<Row>(`/api/chatgpt/exports/${key}`);
  const [mode, setMode] = useState<'connector' | 'standard'>('connector');
  const [inline, setInline] = useState(false);
  const useConnector = q.data?.connector && mode === 'connector';
  const prompt = useApi<{ prompt: string }>(q.data ? `/api/chatgpt/exports/${key}/prompt?mode=${useConnector ? 'connector' : 'standard'}${inline ? '&inline=1' : ''}` : null);
  return (
    <Async q={q}>{(e) => {
      const applied = e.imports.find((i: Row) => i.status === 'applied');
      const pdf = reportLink(e, null);
      return (
        <div className="stack">
          <PageHead title={e.label} sub={<>{LABEL} · package <code>{e.export_key}</code>{e.profiles ? '' : <> · {formatPeriod(e.period.start, e.period.end)} ({e.period.timezone})</>} · created {fmtDateTime(e.created_at)}</>} actions={<><StatusBadge s={e.status} /><Link className="btn" to="/chatgpt">All packages</Link></>} />
          <div className="grid two">
            <Card title="1. Download context package" actions={<a className="btn primary" href={`/api/chatgpt/exports/${e.export_key}/package`}><Download /> Download context package</a>}>
              <div className="stack tight small">
                <div>{Object.entries(e.counts).map(([k, n]) => `${n} ${humanize(k).toLowerCase()}`).join(' · ')}{e.platform_accounts ? ` · ${e.platform_accounts} platform accounts` : ''} · {formatNumberIN(Math.round(e.size / 1024))} KB</div>
                <div className="muted">Questions: {e.questions.length}. The response schema and record versions are inside the file.</div>
                {e.links.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{e.links.map((l: Row) => <li key={l.link}>{l.link} — {l.matched ? <Link to={refLink(l.matched) ?? '#'}>already in the roster</Link> : l.ambiguous ? 'matches several creators — you choose on import' : 'new creator'}</li>)}</ul>}
                {e.missing.length > 0 && <div className="alert warn"><strong>Missing data flagged in the package</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{e.missing.map((m: Row, i: number) => <li key={i}>{m.name ?? m.record}: {m.item} — {m.reason}</li>)}</ul></div>}
              </div>
            </Card>
            <Card title="2. Copy ChatGPT prompt" actions={<button className="btn primary" disabled={!prompt.data} onClick={() => copyText(prompt.data!.prompt)}><Copy /> Copy ChatGPT prompt</button>}>
              <div className="stack tight">
                {e.connector && !e.profiles && <label className="check small"><input type="checkbox" checked={mode === 'connector'} onChange={(x) => setMode(x.target.checked ? 'connector' : 'standard')} /> Ask ChatGPT to use my Instagram analytics connector (e.g. Windsor.ai or another provider I connected in ChatGPT)</label>}
                <label className="check small"><input type="checkbox" checked={inline} onChange={(x) => setInline(x.target.checked)} /> Put the data in the prompt instead of attaching the file</label>
                <textarea className="input mono" rows={9} readOnly value={prompt.data?.prompt ?? 'Loading…'} onFocus={(x) => x.target.select()} />
                {e.connector && <p className="small muted">Connector availability, account permissions, supported metrics and free-plan limits vary by provider. Connecting a provider in ChatGPT does not connect it to Socialmog HQ — never paste connector credentials here. If the connector can't retrieve something, the prompt tells ChatGPT to report it as unavailable and ask you for a manual export.</p>}
              </div>
            </Card>
          </div>
          <Card title="3. Import ChatGPT result" hint="Paste the JSON ChatGPT returned, or upload it as a .json file">
            <div className="stack">
              {e.imports.length > 0 && (
                <div className="list">{e.imports.map((i: Row) => (
                  <div key={i.id} className="list-item"><span className="grow">Result <code>{i.result_id}</code> · checked {fmtDateTime(i.created_at)}</span><Badge value={i.status} /><Link className="btn sm" to={`/chatgpt/imports/${i.id}`}>{i.status === 'previewed' ? 'Review & apply' : 'Open'}</Link></div>
                ))}</div>
              )}
              <ImportPanel exportKey={e.export_key} />
            </div>
          </Card>
          {!e.profiles && <Card title="4. Generate PDF" hint="Website figures are calculated by Socialmog HQ; imported commentary is added in a separate, labelled section">
            <div className="row">
              {!applied && <span className="small muted">No ChatGPT result applied yet — a PDF now contains website figures only.</span>}
              {applied && <span className="small">Result {applied.result_id} applied {fmtDateTime(applied.applied_at)}.</span>}
              <span className="grow" />
              {pdf ? <ImportedPdfLink e={e} importId={applied?.id} /> : <span className="small muted">This analysis type has no PDF template; save the analysis and create tasks instead.</span>}
            </div>
          </Card>}
        </div>
      );
    }}</Async>
  );
}

function ImportedPdfLink({ e, importId }: { e: Row; importId?: number }) {
  const imp = useApi<Row>(importId ? `/api/chatgpt/imports/${importId}` : null);
  const href = reportLink(e, imp.data?.analysis ?? null);
  return <Link className="btn primary" to={href!}><FileBarChart /> Generate PDF</Link>;
}

export function ImportPanel({ exportKey }: { exportKey?: string }) {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [error, setError] = useState<{ message: string; list: string[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/api/chatgpt/preview', { body: { text, export_key: exportKey } });
      invalidate('/api/chatgpt');
      nav(`/chatgpt/imports/${r.import_id}`);
    } catch (e: any) {
      setError({ message: e.message, list: e.details?.schema_errors ?? null });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack tight">
      <label className="field"><span>JSON result from ChatGPT</span>
        <textarea className="input mono" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'{ "schema_version": "socialmog.chatgpt.v1", "export_id": "exp_…", … }'} />
      </label>
      <div className="row">
        <label className="btn"><Upload /> Upload .json file
          <input type="file" accept=".json,application/json,text/plain" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 3_000_000) return toast('File is larger than 3 MB', 'error');
            setText(await f.text());
          }} />
        </label>
        <span className="grow" />
        <button className="btn primary" disabled={!text.trim() || busy} onClick={check}>Check result</button>
      </div>
      <span className="small muted">Nothing is changed until you review the preview and click Apply.</span>
      {error && (
        <div className="alert bad small">
          <strong>{error.message}</strong>
          {error.list && <><ul style={{ margin: '6px 0', paddingLeft: 18 }}>{error.list.slice(0, 25).map((x) => <li key={x}><code>{x}</code></li>)}</ul>
            <div>Tip: send ChatGPT these errors and ask for “the corrected JSON only, matching response_schema”.</div></>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- review & apply

function ImportPage() {
  const { id } = useParams();
  const q = useApi<Row>(`/api/chatgpt/imports/${id}`);
  return <Async q={q}>{(d) => (d.preview ? <Review d={d} onDone={q.reload} /> : <Applied d={d} onDone={q.reload} />)}</Async>;
}

function RefSelect({ entity, value, onChange, placeholder = 'Choose the record…' }: { entity: string; value: string; onChange: (ref: string) => void; placeholder?: string }) {
  const opts = useOptions(ENTITY[entity] ? entity : undefined);
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o.id} value={`${entity}:${o.id}`}>{o.label}</option>)}
    </select>
  );
}

function AiBox({ label = 'ChatGPT output — not calculated by Socialmog HQ', children }: { label?: string; children: ReactNode }) {
  return <div className="ai stack tight"><span className="ai-label">{label}</span>{children}</div>;
}

function Review({ d, onDone }: { d: Row; onDone: () => void }) {
  const me = useMe();
  const users = useOptions('users');
  const pv = d.preview;
  const [s, setS] = useState(() => ({
    analysis: true,
    dashboard: false,
    shareable: false,
    recommendations: pv.recommendations.map((r: Row) => r.id) as string[],
    metrics: Object.fromEntries(pv.connector.map((c: Row) => [c.index, { on: c.storable && c.permitted && !c.unresolved, resolve_ref: '', choices: {} as Row, posts: true, replace_posts: false }])) as Record<number, Row>,
    tasks: Object.fromEntries(pv.tasks.map((t: Row) => [t.id, { on: false, owner_id: me.user.id, priority: t.priority, due_date: t.due_date ?? '', related_ref: t.related_error ? '' : undefined }])) as Record<string, Row>,
    changes: Object.fromEntries(pv.changes.map((c: Row) => [c.id, { on: c.applicable && !c.financial && !c.stale && !c.unresolved, resolve_ref: '', confirm_financial: false, acknowledge_stale: false }])) as Record<string, Row>,
    profiles: Object.fromEntries((pv.profiles ?? []).map((p: Row) => [p.index, {
      on: p.usable && p.permitted && !p.problem && !p.possible_matches.length && !p.stale, resolve_ref: '', create_new: false, acknowledge_stale: false, relationship: 'prospect', platforms: true, posts: true, replace_posts: false,
      fields: p.fields.filter((f: Row) => f.ok && (f.changed || !p.resolved)).map((f: Row) => f.key),
    }])) as Record<number, Row>,
  }));
  const [busy, setBusy] = useState(false);
  const set = (k: 'metrics' | 'tasks' | 'changes' | 'profiles', id: string | number, patch: Row) => setS((x) => ({ ...x, [k]: { ...x[k], [id]: { ...(x[k] as Record<string, Row>)[id], ...patch } } }));
  const on = (k: 'metrics' | 'tasks' | 'changes' | 'profiles') => Object.entries(s[k]).filter(([, v]) => v.on);
  const count = on('metrics').length + on('tasks').length + on('changes').length + on('profiles').length + (s.analysis ? 1 : 0);
  const apply = async () => {
    const body = {
      analysis: s.analysis, dashboard: s.dashboard, shareable: s.shareable, recommendations: s.recommendations,
      metrics: on('metrics').map(([i, v]) => ({ index: Number(i), resolve_ref: v.resolve_ref || undefined, choices: v.choices, posts: v.posts, replace_posts: v.replace_posts })),
      tasks: on('tasks').map(([id, v]) => ({ id, owner_id: v.owner_id ? Number(v.owner_id) : null, priority: v.priority, due_date: v.due_date || null, related_ref: v.related_ref })),
      changes: on('changes').map(([id, v]) => ({ id, resolve_ref: v.resolve_ref || undefined, confirm_financial: v.confirm_financial, acknowledge_stale: v.acknowledge_stale })),
      profiles: on('profiles').map(([i, v]) => ({ index: Number(i), resolve_ref: v.resolve_ref || undefined, create_new: v.create_new, acknowledge_stale: v.acknowledge_stale, relationship: v.relationship, fields: v.fields, platforms: v.platforms, posts: v.posts, replace_posts: v.replace_posts })),
    };
    const ok = await confirmAction({ title: `Apply ${count} selected item${count === 1 ? '' : 's'}?`, message: 'Everything is applied together: if any item fails, nothing is changed. Applied changes are audited and can be undone.', confirm: 'Apply' });
    if (ok === false) return;
    setBusy(true);
    if (await attempt(() => api(`/api/chatgpt/imports/${d.import.id}/apply`, { body }), 'Applied')) {
      invalidate('/api');
      onDone();
    }
    setBusy(false);
  };
  const obs = (type: string) => pv.observations.filter((o: Row) => o.type === type);
  return (
    <div className="stack">
      <PageHead title="Review ChatGPT result" sub={<>{pv.export.label} · package <Link to={`/chatgpt/exports/${pv.export.key}`}><code>{pv.export.key}</code></Link> · result <code>{pv.result_id}</code> · generated {fmtDateTime(pv.generated_at)}{pv.profiles?.length ? '' : <> · {formatPeriod(pv.reporting_period.start, pv.reporting_period.end)}</>}</>} actions={<Badge tone="warn">Not applied yet</Badge>} />
      {pv.parse_notes?.map((n: string) => <div key={n} className="alert info small">{n}</div>)}
      {!pv.period_matches && <div className="alert warn small">The result's reporting period differs from the package ({formatPeriod(pv.export.period.start, pv.export.period.end)}).</div>}
      {pv.version_mismatch.length > 0 && <div className="alert warn small">ChatGPT changed the source record versions for {pv.version_mismatch.length} record(s); stale checks use the versions saved with the package.</div>}
      {pv.stale.length > 0 && (
        <div className="alert warn small"><strong>Changed since export — review the current values before applying</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{pv.stale.map((x: Row) => <li key={x.ref}>{x.link ? <Link to={x.link}>{x.label}</Link> : x.label}{x.reason ? ` — ${x.reason}` : ''}</li>)}</ul>
        </div>
      )}
      <Card title="Records affected">
        <div className="row" style={{ flexWrap: 'wrap' }}>{pv.records.length ? pv.records.map((r: Row) => (
          <span key={r.ref} className={`badge ${r.error ? 'bad' : r.stale ? 'warn' : ''}`} title={r.error ?? (r.in_export ? '' : 'Not in the exported package')}>
            {r.link ? <Link to={r.link}>{r.label ?? r.ref}</Link> : r.label ?? r.ref}{r.error ? ` — ${r.error}` : r.stale ? ' — changed since export' : !r.in_export ? ' — not in package' : ''}
          </span>
        )) : <span className="small muted">No Socialmog records referenced.</span>}</div>
      </Card>
      <Card title="Summary">
        <AiBox><div className="pre">{pv.summary}</div>{pv.provenance.length > 0 && <div className="small muted">Sources: {pv.provenance.map((p: Row) => `${p.source} (${humanize(p.kind)}${p.retrieved_at ? `, ${fmtDateTime(p.retrieved_at)}` : ''})`).join(' · ')}</div>}</AiBox>
      </Card>

      {pv.profiles?.length > 0 && (
        <Card title="Creator profiles" hint="Read by ChatGPT from public profiles, a connector or your screenshots. Saved with their source as user-imported data — not verified by Socialmog HQ. Nothing is matched by guesswork.">
          <div className="stack">{pv.profiles.map((p: Row) => <ProfileItem key={p.index} p={p} st={s.profiles[p.index]} set={(patch) => set('profiles', p.index, patch)} />)}</div>
        </Card>
      )}

      {pv.connector.length > 0 && (
        <Card title="Retrieved metrics" hint="Connector data pasted through ChatGPT. Saved as user-imported data with its source and retrieval time — not independently verified by Socialmog HQ. Existing values are kept unless you choose otherwise.">
          <div className="stack">{pv.connector.map((c: Row) => {
            const st = s.metrics[c.index];
            const rows = c.metrics.filter((m: Row) => m.imported !== null);
            const unavailable = c.metrics.filter((m: Row) => m.imported === null);
            const newPosts = c.content.filter((p: Row) => !p.exists && (p.url || p.external_id) && p.published_at).length;
            const conflictPosts = c.content.filter((p: Row) => p.conflict).length;
            return (
              <div key={c.index} className="card stack tight">
                <div className="row">
                  <label className="check"><input type="checkbox" checked={st.on} disabled={!c.storable || !c.permitted} onChange={(e) => set('metrics', c.index, { on: e.target.checked })} /> <strong>Save as weekly snapshot</strong></label>
                  <span>{c.resolved ? <Link to={c.resolved.link}>{c.resolved.label}</Link> : <span className="neg">Creator not matched</span>}</span>
                  <span className="small muted">{humanize(c.platform)} · @{c.username ?? '—'} · {c.source} · retrieved {fmtDateTime(c.retrieved_at)} · {formatPeriod(c.period.start, c.period.end)} ({c.granularity})</span>
                  <Badge tone={c.status === 'retrieved' ? 'good' : c.status === 'partial' ? 'warn' : 'bad'}>{humanize(c.status)}</Badge>
                  {c.snapshot_exists && <Badge tone="info">Week already recorded</Badge>}
                </div>
                {!c.permitted && <div className="small neg">Your role cannot save platform metrics.</div>}
                {c.unresolved && <label className="field"><span>Which creator are these metrics for? (required before applying)</span><RefSelect entity="influencers" value={st.resolve_ref} onChange={(ref) => set('metrics', c.index, { resolve_ref: ref, on: !!ref && c.storable && c.permitted })} /></label>}
                {c.issues.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{c.issues.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>}
                {rows.length > 0 && (
                  <div className="table-wrap"><table className="table small">
                    <thead><tr><th>Metric</th><th className="num">In Socialmog HQ</th><th className="num">Imported</th><th>Keep</th></tr></thead>
                    <tbody>{rows.map((m: Row) => (
                      <tr key={m.key}>
                        <td>{m.label}</td>
                        <td className="num">{m.existing === null ? <span className="muted">—</span> : formatNumberIN(m.existing, { decimals: m.key === 'engagement_rate' ? 2 : 0 })}</td>
                        <td className="num">{m.imported === null ? <span className="muted">Unavailable</span> : formatNumberIN(m.imported, { decimals: m.key === 'engagement_rate' ? 2 : 0 })}</td>
                        <td>{m.conflict ? (
                          <span className="row small" style={{ gap: 8 }}>
                            <label className="check"><input type="radio" name={`m${c.index}${m.key}`} checked={(st.choices[m.key] ?? 'existing') === 'existing'} onChange={() => set('metrics', c.index, { choices: { ...st.choices, [m.key]: 'existing' } })} /> Current</label>
                            <label className="check"><input type="radio" name={`m${c.index}${m.key}`} checked={st.choices[m.key] === 'imported'} onChange={() => set('metrics', c.index, { choices: { ...st.choices, [m.key]: 'imported' } })} /> Imported</label>
                            <Badge tone="warn">Conflict</Badge>
                          </span>
                        ) : m.imported !== null && m.existing === null ? <span className="small">Add</span> : <span className="small muted">Unchanged</span>}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
                {unavailable.length > 0 && rows.length > 0 && <div className="small muted">Not returned (stored values kept): {unavailable.map((m: Row) => m.label).join(', ')}</div>}
                {c.content.length > 0 && (
                  <div className="row small">
                    <span>{c.content.length} posts in the result.</span>
                    {newPosts > 0 && <label className="check"><input type="checkbox" checked={st.posts} onChange={(e) => set('metrics', c.index, { posts: e.target.checked })} /> Add {newPosts} new post(s)</label>}
                    {conflictPosts > 0 && <label className="check"><input type="checkbox" checked={st.replace_posts} onChange={(e) => set('metrics', c.index, { replace_posts: e.target.checked })} /> Replace metrics on {conflictPosts} existing post(s) with different values</label>}
                  </div>
                )}
              </div>
            );
          })}</div>
        </Card>
      )}

      <Card title="Analysis" actions={<label className="check"><input type="checkbox" checked={s.analysis} onChange={(e) => setS({ ...s, analysis: e.target.checked })} /> Save this analysis</label>}>
        <AiBox>
          {obs('observed').length > 0 && <><strong className="small">Observed</strong><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{obs('observed').map((o: Row, i: number) => <li key={i}>{o.text}{o.evidence && <span className="muted"> — {o.evidence}</span>}</li>)}</ul></>}
          {obs('hypothesis').length > 0 && <><strong className="small">Hypotheses (not proven)</strong><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{obs('hypothesis').map((o: Row, i: number) => <li key={i}>{o.text}</li>)}</ul></>}
          {pv.derived.length > 0 && <><strong className="small">ChatGPT's calculations</strong><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{pv.derived.map((x: Row, i: number) => <li key={i}>{x.name}: {show(x.value)}{x.unit ? ` ${x.unit}` : ''} <span className="muted">({x.formula})</span></li>)}</ul></>}
          {pv.website_facts.length > 0 && <><strong className="small">Website facts it relied on</strong><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{pv.website_facts.map((x: Row, i: number) => <li key={i}>{x.fact}</li>)}</ul></>}
          {(pv.missing.length > 0 || pv.limitations.length > 0 || pv.assumptions.length > 0) && <><strong className="small">Missing data, assumptions & limitations</strong><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{pv.missing.map((m: Row, i: number) => <li key={`m${i}`}>{m.item}: {m.reason}</li>)}{pv.assumptions.map((x: string, i: number) => <li key={`a${i}`}>Assumption: {x}</li>)}{pv.limitations.map((x: string, i: number) => <li key={`l${i}`}>{x}</li>)}</ul></>}
        </AiBox>
        {s.analysis && (
          <div className="row small" style={{ marginTop: 8 }}>
            <label className="check"><input type="checkbox" checked={s.dashboard} onChange={(e) => setS({ ...s, dashboard: e.target.checked })} /> Show selected recommendations on the founder dashboard</label>
            <label className="check" title="Check the text contains no margins, commissions or internal notes"><input type="checkbox" checked={s.shareable} onChange={(e) => setS({ ...s, shareable: e.target.checked })} /> Allow in external (client/creator) PDF reports</label>
          </div>
        )}
      </Card>

      {pv.recommendations.length > 0 && (
        <Card title="Recommendations" hint="Saved with the analysis">
          <div className="stack tight">{pv.recommendations.map((r: Row) => (
            <label key={r.id} className="check" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" disabled={!s.analysis} checked={s.recommendations.includes(r.id)} onChange={(e) => setS({ ...s, recommendations: e.target.checked ? [...s.recommendations, r.id] : s.recommendations.filter((x) => x !== r.id) })} />
              <span><strong>{r.text}</strong> <Badge value={r.priority} />{r.record && <> · {refLink(r.record) ? <Link to={refLink(r.record)!}>{pv.records.find((x: Row) => x.ref === r.record)?.label ?? r.record}</Link> : r.record}</>}<div className="small muted">{r.rationale}{r.metric_to_watch ? ` · watch: ${r.metric_to_watch}` : ''}</div></span>
            </label>
          ))}</div>
        </Card>
      )}

      {pv.tasks.length > 0 && (
        <Card title="Proposed tasks" hint="Tick the ones to create; set the owner, priority and deadline" flush>
          <div className="table-wrap"><table className="table">
            <thead><tr><th /><th>Task</th><th>Related to</th><th>Owner</th><th>Priority</th><th>Due</th></tr></thead>
            <tbody>{pv.tasks.map((t: Row) => {
              const st = s.tasks[t.id];
              return (
                <tr key={t.id}>
                  <td><input type="checkbox" aria-label={`Create ${t.title}`} checked={st.on} onChange={(e) => set('tasks', t.id, { on: e.target.checked })} /></td>
                  <td><input className="input" value={st.title ?? t.title} onChange={(e) => set('tasks', t.id, { title: e.target.value })} />{t.description && <div className="small muted pre">{t.description}</div>}{t.owner_hint && <div className="small muted">Suggested owner: {t.owner_hint}</div>}</td>
                  <td>{t.related ? <Link to={t.related.link}>{t.related.label}</Link> : t.related_error ? <div className="stack tight"><span className="small neg">{t.related_error}</span><RefSelect entity={t.related_record.split(':')[0]} value={st.related_ref ?? ''} onChange={(ref) => set('tasks', t.id, { related_ref: ref })} placeholder="No related record" /></div> : <span className="muted">—</span>}</td>
                  <td><select className="input" value={st.owner_id ?? ''} onChange={(e) => set('tasks', t.id, { owner_id: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select></td>
                  <td><select className="input" value={st.priority} onChange={(e) => set('tasks', t.id, { priority: e.target.value })}>{['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select></td>
                  <td><input type="date" className="input" value={st.due_date} onChange={(e) => set('tasks', t.id, { due_date: e.target.value })} /></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </Card>
      )}

      {pv.changes.length > 0 && (
        <Card title="Proposed record changes" hint="Field-by-field. Amounts, payment status, bank transactions and financial commitments are never changed by an import.">
          <div className="stack">{pv.changes.map((c: Row) => {
            const st = s.changes[c.id];
            const blocked = c.errors.length > 0 || c.fields.some((f: Row) => !f.ok) || (c.unresolved && !st.resolve_ref);
            return (
              <div key={c.id} className="card stack tight">
                <div className="row">
                  <label className="check"><input type="checkbox" checked={st.on} disabled={c.errors.length > 0 || c.fields.some((f: Row) => !f.ok)} onChange={(e) => set('changes', c.id, { on: e.target.checked })} /> <strong>{c.action === 'create' ? `Create ${ENTITY[c.entity]?.label.toLowerCase() ?? c.entity}` : <>Update {c.link ? <Link to={c.link}>{c.label}</Link> : c.record ?? 'record'}</>}</strong></label>
                  <Badge>{ENTITY[c.entity]?.label ?? c.entity}</Badge>
                  {c.action === 'create' && <Badge tone="info">New record</Badge>}
                  {c.financial && <Badge tone="warn">Finance planning</Badge>}
                  {c.stale && <Badge tone="warn">Changed since export</Badge>}
                </div>
                <div className="small muted">Reason given: {c.reason}</div>
                {c.errors.map((x: string) => <div key={x} className="small neg">{x}</div>)}
                {c.unresolved && <label className="field"><span>{c.unresolved}</span><RefSelect entity={c.entity} value={st.resolve_ref} onChange={(ref) => set('changes', c.id, { resolve_ref: ref })} /></label>}
                <div className="table-wrap"><table className="table small">
                  <thead><tr><th>Field</th><th>Current</th><th>Proposed</th></tr></thead>
                  <tbody>{c.fields.map((f: Row) => (
                    <tr key={f.field}>
                      <td>{f.label}</td>
                      <td className="pre">{c.unresolved && !st.resolve_ref ? <span className="muted">Choose the record</span> : show(f.current)}</td>
                      <td className="pre">{f.ok ? <span className={f.changed ? 'strong' : 'muted'}>{show(f.proposed)}{!f.changed && ' (no change)'}</span> : <span className="neg">{f.error}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
                {c.financial && <label className="check small"><input type="checkbox" checked={st.confirm_financial} onChange={(e) => set('changes', c.id, { confirm_financial: e.target.checked })} /> I confirm this finance planning change (expected dates, confidence, priority or notes only)</label>}
                {c.stale && <label className="check small"><input type="checkbox" checked={st.acknowledge_stale} onChange={(e) => set('changes', c.id, { acknowledge_stale: e.target.checked })} /> This record changed after the export — I've checked the current values; apply anyway</label>}
                {st.on && blocked && <div className="small neg">Resolve the issues above before applying this change.</div>}
              </div>
            );
          })}</div>
        </Card>
      )}

      <div className="applybar row">
        <span className="small">{count} item(s) selected{s.analysis ? ` · analysis with ${s.recommendations.length} recommendation(s)` : ''}</span>
        <span className="grow" />
        <Link className="btn" to={`/chatgpt/exports/${pv.export.key}`}>Cancel</Link>
        <button className="btn primary" disabled={busy || count === 0} onClick={apply}>Apply selected</button>
      </div>
    </div>
  );
}

const compactN = (n: number | null | undefined) => (n == null ? '—' : formatNumberIN(n, { compact: true }));

/** The roster's previous average views after applying, with the same rule as the roster (last 10 posts not marked paid, at least 3). */
function avgAfter(p: Row, st: Row): string[] {
  const plats = new Set<string>([...p.saved_platforms, ...(st.platforms ? p.platforms.map((x: Row) => x.platform) : [])]);
  const update = new Map(st.replace_posts ? p.content.filter((c: Row) => c.usable && c.conflict && c.views != null).map((c: Row) => [c.existing_id, c.views]) : []);
  const posts = [
    ...p.saved_posts.map((x: Row) => (update.has(x.id) ? { ...x, views: update.get(x.id) } : x)),
    ...(st.posts ? p.content.filter((c: Row) => c.usable && !c.exists && c.promotion !== 'paid') : []),
  ];
  return [...plats].flatMap((pl) => {
    const v = posts.filter((x) => x.platform === pl && typeof x.views === 'number').sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).slice(0, 10).map((x) => x.views as number);
    return v.length >= 3 ? [`${platformName(pl)} ${compactN(Math.round(v.reduce((a, b) => a + b, 0) / v.length))} (last ${v.length} posts, boosted excluded)`] : [];
  });
}

/** One creator profile from ChatGPT: who it is (new / existing / your choice), field diffs, channels and recent videos. */
function ProfileItem({ p, st, set }: { p: Row; st: Row; set: (patch: Row) => void }) {
  const name = p.fields.find((f: Row) => f.key === 'name')?.proposed ?? p.fields.find((f: Row) => f.key === 'handle')?.proposed ?? p.link;
  const target = p.resolved ? 'existing' : st.resolve_ref ? 'chosen' : 'new';
  const usable = p.content.filter((c: Row) => c.usable);
  const skipped = p.content.filter((c: Row) => !c.usable);
  const fresh = usable.filter((c: Row) => !c.exists).length;
  const conflicts = usable.filter((c: Row) => c.conflict).length;
  const decide = !p.resolved && (p.problem || p.possible_matches.length > 0);
  const needsDecision = target === 'new' && decide && !st.create_new;
  const avg = avgAfter(p, st);
  return (
    <div className="card stack tight">
      <div className="row">
        <label className="check"><input type="checkbox" checked={st.on} disabled={!p.usable || !p.permitted} onChange={(e) => set({ on: e.target.checked })} />{' '}
          <strong>{target === 'existing' ? <>Update <Link to={p.resolved.link}>{p.resolved.label}</Link></> : target === 'chosen' ? 'Update the creator chosen below' : needsDecision ? `Choose the creator: ${name}` : `Add new creator: ${name}`}</strong></label>
        <Badge tone={p.status === 'retrieved' ? 'good' : p.status === 'partial' ? 'warn' : 'bad'}>{humanize(p.status)}</Badge>
        <span className="small muted">{/^https?:\/\//i.test(p.link) ? <a href={p.link} target="_blank" rel="noreferrer">{p.link}</a> : p.link} · {p.source}{p.retrieved_at ? ` · retrieved ${fmtDateTime(p.retrieved_at)}` : ''}</span>
      </div>
      {!p.permitted && <div className="small neg">Your role cannot change creator profiles.</div>}
      {!p.usable && <div className="small neg">ChatGPT could not read this profile ({p.status}). Ask it to work from screenshots, then import the new result.</div>}
      {decide && (
        <div className="alert warn small stack tight">
          <span>{p.problem ? `${p.problem}.` : 'This handle or link is already in the roster.'}{p.possible_matches.length > 0 && <> Matching creators: {p.possible_matches.map((m: Row, i: number) => <span key={m.ref}>{i ? ', ' : ''}<Link to={m.link}>{m.label}</Link></span>)}.</>} Choose what to do:</span>
          <RefSelect entity="influencers" value={st.resolve_ref} placeholder="Update an existing creator…" onChange={(ref) => set({ resolve_ref: ref, create_new: false, on: !!ref && p.usable && p.permitted })} />
          <label className="check"><input type="checkbox" checked={st.create_new} onChange={(e) => set({ create_new: e.target.checked, resolve_ref: '', on: e.target.checked && p.usable && p.permitted })} /> It is a different person — add as a new creator</label>
        </div>
      )}
      {p.stale && <label className="check small"><input type="checkbox" checked={st.acknowledge_stale} onChange={(e) => set({ acknowledge_stale: e.target.checked, on: e.target.checked && p.usable && p.permitted })} /> This creator changed after the export — I've checked the current values; apply anyway</label>}
      {target === 'new' && !needsDecision && (
        <label className="field" style={{ maxWidth: 260 }}><span>Add to the roster as</span><select className="input" value={st.relationship} onChange={(e) => set({ relationship: e.target.value })}>{['prospect', 'campaign_only', 'non_exclusive', 'exclusive', 'agency_owned'].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</select></label>
      )}
      {p.issues.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.issues.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>}
      {p.bio && <div className="small muted pre">Bio: {p.bio}</div>}
      {p.fields.length > 0 && (
        <div className="table-wrap"><table className="table small">
          <thead><tr><th /><th>Field</th><th>Now</th><th>From ChatGPT</th></tr></thead>
          <tbody>{p.fields.map((f: Row) => (
            <tr key={f.key}>
              <td><input type="checkbox" aria-label={`Use ${f.label}`} disabled={!f.ok} checked={st.fields.includes(f.key)} onChange={(e) => set({ fields: e.target.checked ? [...st.fields, f.key] : st.fields.filter((k: string) => k !== f.key) })} /></td>
              <td>{f.label}{f.inferred && <> <Badge tone="warn">inferred</Badge></>}</td>
              <td className="pre">{target === 'existing' ? show(f.current) : <span className="muted">{target === 'new' ? 'new' : 'see the chosen creator'}</span>}</td>
              <td className="pre">{f.ok ? <span className={f.changed || target !== 'existing' ? 'strong' : 'muted'}>{show(f.proposed)}{target === 'existing' && !f.changed ? ' (same)' : ''}</span> : <span className="neg">{f.error}</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {p.platforms.length > 0 && (
        <div className="table-wrap"><table className="table small">
          <thead><tr><th>Channel</th><th>Link</th><th className="num">Followers now</th><th className="num">From ChatGPT</th></tr></thead>
          <tbody>{p.platforms.map((x: Row, i: number) => (
            <tr key={i}><td>{platformName(x.platform)}{x.is_new && <> <Badge tone="info">new</Badge></>}</td><td>{x.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.host}{x.username ? ` · @${x.username}` : ''}</a> : <span className="muted">{x.username ? `@${x.username} · ` : ''}no link</span>}</td>
              <td className="num">{compactN(x.current_followers)}</td><td className="num strong">{compactN(x.followers)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="row small">
        <label className="check"><input type="checkbox" checked={st.platforms} onChange={(e) => set({ platforms: e.target.checked })} /> Save channel links and follower counts</label>
        <label className="check"><input type="checkbox" checked={st.posts && fresh > 0} disabled={!fresh} onChange={(e) => set({ posts: e.target.checked })} /> Save {fresh} new post{fresh === 1 ? '' : 's'}/video{fresh === 1 ? '' : 's'}</label>
        {conflicts > 0 && <label className="check"><input type="checkbox" checked={st.replace_posts} onChange={(e) => set({ replace_posts: e.target.checked })} /> Update views, likes and comments on {conflicts} already saved</label>}
      </div>
      {avg.length > 0 && <div className="small">Prev. avg views after saving: {avg.join(' · ')}</div>}
      {skipped.length > 0 && <div className="small muted">Not saved: {skipped.map((c: Row) => `${platformName(c.platform)} ${c.topic ?? c.format ?? 'post'} (${c.skipped})`).join('; ')}</div>}
      {usable.length > 0 && (
        <details className="small"><summary>{usable.length} recent posts/videos</summary>
          <table className="table small"><tbody>{usable.map((c: Row) => (
            <tr key={c.j}><td>{platformName(c.platform)}</td><td><a href={c.url} target="_blank" rel="noreferrer">{c.topic ?? humanize(c.format ?? 'post')}</a>{c.promotion === 'paid' && <> <Badge tone="warn">paid</Badge></>}{c.exists && <> <Badge>saved</Badge></>}</td><td>{fmtDateTime(c.published_at)}</td><td className="num">{c.views == null ? <span className="muted">—</span> : formatNumberIN(c.views)} views</td></tr>
          ))}</tbody></table>
        </details>
      )}
      {st.on && needsDecision && <div className="small neg">Choose the creator or confirm a new one before applying.</div>}
    </div>
  );
}

function Applied({ d, onDone }: { d: Row; onDone: () => void }) {
  const imp = d.import;
  const link = (a: Row): string | null =>
    a.kind === 'analysis' ? `/chatgpt/analyses/${a.id}` : a.kind === 'task' ? `/tasks/${a.id}` : a.kind === 'snapshot' ? refLink(a.ref) : a.entity ? refLink(`${a.entity}:${a.id}`) : null;
  const what = (a: Row) => (a.kind === 'snapshot' ? `${a.created ? 'New' : 'Updated'} weekly snapshot — ${a.label ?? a.ref}` : a.kind === 'post' ? `${a.created ? 'New' : 'Updated'} post metrics #${a.id}` : a.kind === 'task' ? `New task — ${a.label ?? `#${a.id}`}` : a.kind === 'analysis' ? 'Saved analysis' : `${a.kind === 'create' ? 'Created' : 'Updated'} ${ENTITY[a.entity]?.label.toLowerCase() ?? a.entity} — ${a.label || `#${a.id}`}`);
  return (
    <div className="stack">
      <PageHead title="ChatGPT result" sub={<>{d.export.label} · package <Link to={`/chatgpt/exports/${imp.export_key}`}><code>{imp.export_key}</code></Link> · result <code>{imp.result_id}</code></>}
        actions={<>{imp.status === 'applied' ? <Badge tone="good">Applied {fmtDateTime(imp.applied_at)}</Badge> : <Badge tone="warn">Undone {fmtDateTime(imp.undone_at)}</Badge>}
          {imp.status === 'applied' && <button className="btn danger" onClick={async () => {
            const reason = await confirmAction({ title: 'Undo this import?', message: 'Restores previous values and archives what the import created. History and the audit trail are kept. Values edited since the import are left as they are.', confirm: 'Undo import', danger: true, reason: 'Why are you undoing it' });
            if (reason === false) return;
            if (await attempt(() => api(`/api/chatgpt/imports/${imp.id}/undo`, { body: { reason } }), 'Import undone')) {
              invalidate('/api');
              onDone();
            }
          }}>Undo import</button>}</>} />
      <Card title="What was applied" flush>
        {imp.applied?.length ? <div className="list">{imp.applied.map((a: Row, i: number) => (
          <div key={i} className="list-item"><span className="grow">{link(a) ? <Link to={link(a)!}>{what(a)}</Link> : what(a)}</span>{a.before && <span className="small muted">previous version kept</span>}</div>
        ))}</div> : <Empty title="Nothing recorded" />}
      </Card>
      {imp.notes?.length > 0 && <Card title="Notes"><ul className="small">{imp.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></Card>}
      {d.analysis && imp.status === 'applied' && <div className="row"><Link className="btn primary" to={`/chatgpt/analyses/${d.analysis}`}>Open saved analysis</Link>{reportLink(d.export, d.analysis) && <Link className="btn" to={reportLink(d.export, d.analysis)!}><FileBarChart /> Generate PDF</Link>}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- saved analyses

function AnalysisBody({ a, refKey }: { a: Row; refKey?: string }) {
  const mine = (x: Row) => !refKey || !x.record || x.record === refKey;
  const recs = (a.recommendations ?? []).filter(mine);
  const obs = (a.observations ?? []).filter(mine);
  return (
    <AiBox label={`ChatGPT analysis · imported ${formatDate(a.created_at)} — not calculated by Socialmog HQ`}>
      <div className="pre">{a.summary}</div>
      {obs.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{obs.map((o: Row, i: number) => <li key={i}><Badge tone={o.type === 'observed' ? 'info' : 'warn'}>{o.type === 'observed' ? 'Observed' : 'Hypothesis'}</Badge> {o.text}</li>)}</ul>}
      {recs.length > 0 && <><strong className="small">Recommendations</strong><ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{recs.map((r: Row, i: number) => <li key={i}>{r.text} <span className="muted">— {r.rationale}</span></li>)}</ol></>}
    </AiBox>
  );
}

function AnalysisPage() {
  const { id } = useParams();
  const q = useApi<Row>(`/api/chatgpt/analyses/${id}`);
  const patch = async (v: Row) => {
    if (await attempt(() => api(`/api/chatgpt/analyses/${id}`, { method: 'PATCH', body: v }), 'Saved')) q.reload();
  };
  return (
    <Async q={q}>{(d) => {
      const a = d.row;
      const pdf = d.report ? `/reports?${new URLSearchParams({ type: d.report.type, from: a.period_start, to: a.period_end, analysis_id: String(a.id), ...(d.report.idParam ? { [d.report.idParam]: (a.records as string[]).filter((r) => r.startsWith(d.report.idParam.replace('_ids', 's:'))).map((r) => r.split(':')[1]).join(',') } : {}) })}` : null;
      return (
        <div className="stack">
          <PageHead title={`ChatGPT analysis — ${d.label}`} sub={<>{formatPeriod(a.period_start, a.period_end)} · imported {fmtDateTime(a.created_at)} · package <Link to={`/chatgpt/exports/${a.export_key}`}><code>{a.export_key}</code></Link></>}
            actions={<>{pdf && <Link className="btn primary" to={pdf}><FileBarChart /> Generate PDF</Link>}<Link className="btn" to={`/chatgpt/imports/${a.import_id}`}>Import record</Link></>} />
          <Card>
            <div className="row small">
              <label className="check"><input type="checkbox" checked={a.on_dashboard} onChange={(e) => patch({ on_dashboard: e.target.checked })} /> Show recommendations on the founder dashboard</label>
              <label className="check"><input type="checkbox" checked={a.shareable} onChange={(e) => patch({ shareable: e.target.checked })} /> Allow in external PDF reports (check it has no margins, commissions or internal notes)</label>
            </div>
          </Card>
          <Card title="Linked records"><div className="row">{d.records.map((r: Row) => <Link key={r.ref} className="badge" to={refLink(r.ref) ?? '#'}>{r.label}</Link>)}{!d.records.length && <span className="small muted">Agency-level analysis</span>}</div></Card>
          <AnalysisBody a={a} />
          {(a.derived ?? []).length > 0 && <Card title="ChatGPT's calculations" hint="Shown with their formulas; Socialmog HQ's own figures are on the record pages"><ul className="small">{a.derived.map((x: Row, i: number) => <li key={i}>{x.name}: {show(x.value)}{x.unit ? ` ${x.unit}` : ''} — {x.formula}</li>)}</ul></Card>}
          {(a.connector ?? []).length > 0 && <Card title="Connector data provenance" hint="User-imported through ChatGPT; not independently verified by Socialmog HQ"><ul className="small">{a.connector.map((m: Row, i: number) => <li key={i}>{m.username ?? m.record} · {m.source} · {humanize(m.status)} · {formatPeriod(m.period.start, m.period.end)}{m.retrieved_at ? ` · retrieved ${fmtDateTime(m.retrieved_at)}` : ''}</li>)}</ul></Card>}
          {((a.limitations ?? []).length > 0 || (a.missing ?? []).length > 0) && <Card title="Limitations & missing data"><ul className="small">{[...a.limitations, ...a.missing.map((m: Row) => `${m.item}: ${m.reason}`)].map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></Card>}
        </div>
      );
    }}</Async>
  );
}

/** Imported analyses for one record, for record pages (influencer, campaign). */
export function ImportedAnalyses({ refKey }: { refKey: string }) {
  const q = useApi<{ rows: Row[] }>(`/api/chatgpt/analyses?ref=${encodeURIComponent(refKey)}`);
  return (
    <Async q={q}>{(d) => d.rows.length ? (
      <div className="stack">{d.rows.map((a) => (
        <Card key={a.id} title={<Link to={`/chatgpt/analyses/${a.id}`}>{humanize(a.analysis_type)} · {formatPeriod(a.period_start, a.period_end)}</Link>}><AnalysisBody a={a} refKey={refKey} /></Card>
      ))}</div>
    ) : <Empty title="No imported ChatGPT analyses" hint="Use “Analyse with ChatGPT” to create a package for this record." />}</Async>
  );
}

/** Founder dashboard card: weekly package reminder + pinned recommendations. */
export function ChatGPTCard({ c }: { c: Row | null }) {
  if (!c || (!c.weekly && !c.recommendations.length)) return null;
  return (
    <Card title={LABEL} hint="Recommendations imported from ChatGPT — not calculated by Socialmog HQ" actions={<Link className="btn sm" to="/chatgpt">Open workspace</Link>}>
      <div className="stack tight">
        {c.weekly && (
          <div className={`alert small ${c.weekly.status === 'imported' ? 'good' : 'warn'} row`}>
            <span className="grow">{c.weekly.status === 'imported' ? 'Weekly analysis imported' : 'Weekly analysis package ready — run it in ChatGPT and import the result'} · {formatPeriod(c.weekly.period.from, c.weekly.period.to)}</span>
            <Link className="btn sm" to={`/chatgpt/exports/${c.weekly.export_key}`}>{c.weekly.status === 'imported' ? 'View' : 'Copy prompt & import'}</Link>
          </div>
        )}
        {c.recommendations.length > 0 && (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{c.recommendations.map((r: Row, i: number) => (
            <li key={i}><Link to={`/chatgpt/analyses/${r.analysis_id}`}>{r.text}</Link> <span className="muted">— {r.type}, {formatPeriod(r.period.start, r.period.end)}</span>{r.priority === 'high' || r.priority === 'urgent' ? <> <Badge tone="warn">{humanize(r.priority)}</Badge></> : null}</li>
          ))}</ul>
        )}
      </div>
    </Card>
  );
}
