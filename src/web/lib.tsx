/** Shared web building blocks: API client, feedback, tables, forms, kanban, calendar, charts. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronDown, ChevronUp, Columns3, Download, Moon, Plus, Sparkles, Sun, Trash2, X } from 'lucide-react';
import { formatDate, formatDateTime, todayInTz } from '../shared/dates.ts';
import { formatINR, formatNumberIN, MoneyError, paiseToRupeesString, rupeesToPaise } from '../shared/money.ts';
import { can, ENTITY, fieldLabel, humanize, PLATFORMS, visibleFields, type Cap, type Entity, type Field, type Role } from '../shared/schema.ts';

export type Row = Record<string, any>;

// ---------------------------------------------------------------- API

export class ApiError extends Error {
  status: number;
  details: any;
  constructor(message: string, status: number, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined || opts.raw ? 'POST' : 'GET'),
    headers: { 'x-hq': '1', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth')) window.dispatchEvent(new Event('hq:logout'));
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.details);
  }
  return data as T;
}

const cache = new Map<string, Promise<any>>();
export function invalidate(prefix = '') {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
  window.dispatchEvent(new CustomEvent('hq:invalidate', { detail: prefix }));
}

/** Fetch JSON for a path; reloads on invalidate(). Keeps previous data while refetching. */
export function useApi<T = any>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api<T>(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState((s) => ({ data: s.data, error, loading: false })));
    return () => {
      alive = false;
    };
  }, [path, nonce]);
  useEffect(() => {
    const h = (e: Event) => {
      const p = (e as CustomEvent).detail as string;
      if (path && (!p || path.startsWith(p) || p === '*')) setNonce((n) => n + 1);
    };
    window.addEventListener('hq:invalidate', h);
    return () => window.removeEventListener('hq:invalidate', h);
  }, [path]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** Cached list of {id,label} for reference selects. */
export function useOptions(entity: string | undefined) {
  const [opts, setOpts] = useState<{ id: number; label: string }[]>([]);
  useEffect(() => {
    if (!entity) return;
    const e = ENTITY[entity];
    const key = `/api/e/${entity}`;
    if (!cache.has(key)) cache.set(key, api(key).catch(() => ({ rows: [] })));
    cache.get(key)!.then((d) => setOpts((d.rows as Row[]).map((r) => ({ id: r.id, label: String(r[e.title] ?? r[`${e.title}_label`] ?? `#${r.id}`) })).sort((a, b) => a.label.localeCompare(b.label))));
  }, [entity]);
  return opts;
}

// ---------------------------------------------------------------- session context

export interface Me {
  user: { id: number; name: string; email: string; role: Role; editor_id: number | null; influencer_id: number | null; brand_id: number | null };
  prefs: Row;
  timezone: string;
  demo: boolean;
}
export const MeContext = createContext<Me | null>(null);
export function useMe(): Me {
  return useContext(MeContext)!;
}
export function useCan(cap: Cap): boolean {
  return can(useMe().user.role, cap);
}
export function useToday(): string {
  return todayInTz(useMe().timezone);
}
export async function savePrefs(me: Me, patch: Row) {
  Object.assign(me.prefs, patch);
  await api('/api/auth/prefs', { method: 'PUT', body: me.prefs });
}

// ---------------------------------------------------------------- feedback: toasts & confirm

type Toast = { id: number; text: string; kind: 'info' | 'error' };
let pushToast: (t: Omit<Toast, 'id'>) => void = () => {};
export function toast(text: string, kind: 'info' | 'error' = 'info') {
  pushToast({ text, kind });
}
export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { ...t, id }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.kind === 'error' ? 7000 : 3500);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}

interface ConfirmOpts { title: string; message?: ReactNode; confirm?: string; danger?: boolean; reason?: string | boolean }
let openConfirm: (o: ConfirmOpts, resolve: (v: string | false) => void) => void = () => {};
/** Confirmation for destructive actions; resolves to the typed reason (or '' when none asked) or false. */
export function confirmAction(o: ConfirmOpts): Promise<string | false> {
  return new Promise((resolve) => openConfirm(o, resolve));
}
export function ConfirmHost() {
  const [state, setState] = useState<{ o: ConfirmOpts; resolve: (v: string | false) => void } | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    openConfirm = (o, resolve) => {
      setReason('');
      setState({ o, resolve });
    };
  }, []);
  if (!state) return null;
  const close = (v: string | false) => {
    state.resolve(v);
    setState(null);
  };
  const needsReason = !!state.o.reason;
  return (
    <Modal open title={state.o.title} onClose={() => close(false)} size="narrow"
      footer={<><button className="btn" onClick={() => close(false)}>Cancel</button><button className={`btn ${state.o.danger ? 'danger' : 'primary'}`} disabled={needsReason && !reason.trim()} onClick={() => close(reason.trim())}>{state.o.confirm ?? 'Confirm'}</button></>}>
      {state.o.message && <div>{state.o.message}</div>}
      {needsReason && (
        <label className="field">
          <span>{typeof state.o.reason === 'string' ? state.o.reason : 'Reason'} (required)</span>
          <textarea className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
    </Modal>
  );
}

/** Wrap an async action with error toasts; returns true on success. */
export async function attempt(fn: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await fn();
    if (success) toast(success);
    return true;
  } catch (e) {
    toast((e as Error).message, 'error');
    return false;
  }
}

// ---------------------------------------------------------------- primitives

export function Modal({ open, onClose, title, children, footer, size }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'narrow' | 'drawer' }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog ref={ref} className={`modal ${size ?? ''}`} onCancel={(e) => (e.preventDefault(), onClose())}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="btn ghost sm" aria-label="Close" onClick={onClose}><X /></button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}

export const Money = ({ p, compact, signed, className = '' }: { p: number | null | undefined; compact?: boolean; signed?: boolean; className?: string }) => (
  <span className={`num ${p !== null && p !== undefined && p < 0 ? 'neg' : ''} ${className}`} title={compact && p != null ? formatINR(p) : undefined}>{formatINR(p, { compact, signed })}</span>
);

export const fmtDate = (d: string | null | undefined) => formatDate(d);
export const fmtDateTime = (d: string | null | undefined) => formatDateTime(d);

const TONES: Record<string, string> = {
  active: 'good', available: 'good', confirmed: 'good', settled: 'good', won: 'good', live: 'good', approved: 'good', delivered: 'good', done: 'good', completed: 'good', connected: 'good', exclusive: 'info', issued: 'info', reconciled: 'good', financial_closure: 'good', green: 'good',
  expected: 'info', in_progress: 'info', scheduled: 'info', committed: 'info', brand_review: 'info', internal_review: 'info', running: 'info', queued: 'info',
  at_risk: 'warn', delayed: 'warn', part_paid: 'warn', limited: 'warn', busy: 'warn', changes_requested: 'warn', planned: 'warn', on_hold: 'warn', amber: 'warn', blocked: 'warn', unreconciled: 'warn', medium: 'warn', high: 'bad', urgent: 'bad', critical: 'bad',
  unpaid: 'bad', overdue: 'bad', lost: 'bad', cancelled: 'bad', unavailable: 'bad', failed: 'bad', inactive: 'bad', red: 'bad', flagged: 'bad', expired: 'bad', error: 'bad', not_connected: '',
};
export function Badge({ value, tone, children }: { value?: string | null; tone?: string; children?: ReactNode }) {
  if (!value && !children) return null;
  return <span className={`badge ${tone ?? TONES[value ?? ''] ?? ''}`}>{children ?? humanize(String(value))}</span>;
}

export function Empty({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint && <div>{hint}</div>}
      {action}
    </div>
  );
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack tight" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="alert bad row between">
      <span>{error.message}</span>
      {retry && <button className="btn sm" onClick={retry}>Retry</button>}
    </div>
  );
}

/** Standard loading/error/empty wrapper for useApi results. */
export function Async<T>({ q, children, empty }: { q: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; empty?: ReactNode }) {
  if (q.error && !q.data) return <ErrorBox error={q.error} retry={q.reload} />;
  if (!q.data) return <Loading />;
  return <div className={q.loading ? 'loading-dim' : ''}>{children(q.data) ?? empty}</div>;
}

export function Stat({ label, value, foot, onClick, hero, to }: { label: string; value: ReactNode; foot?: ReactNode; onClick?: () => void; hero?: boolean; to?: string }) {
  const body = (
    <>
      <span className="label">{label}</span>
      <span className={`value ${hero ? 'hero' : ''}`}>{value}</span>
      {foot && <span className="foot">{foot}</span>}
    </>
  );
  if (to) return <Link className="stat" to={to} style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link>;
  return onClick ? <button className="stat" onClick={onClick}>{body}</button> : <div className="stat">{body}</div>;
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: ReactNode }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={t.key === value} className={t.key === value ? 'on' : ''} onClick={() => onChange(t.key)}>{t.label}</button>
      ))}
    </div>
  );
}

export function Card({ title, hint, actions, children, flush }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className={`card ${flush ? 'flush' : ''}`}>
      {(title || actions) && (
        <div className="card-head" style={flush ? { padding: '14px 16px 0' } : undefined}>
          <div>
            {title && <h2>{title}</h2>}
            {hint && <div className="hint">{hint}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export const DemoTag = ({ row }: { row: Row }) => (row?.is_demo ? <span className="badge demo">DEMO</span> : null);

// ---------------------------------------------------------------- value rendering from schema

export function renderValue(field: Field | undefined, row: Row, key: string): ReactNode {
  const v = row[key];
  if (!field) return v ?? '—';
  if (v === null || v === undefined || v === '') return field.type === 'ref' ? '—' : <span className="muted">—</span>;
  switch (field.type) {
    case 'money':
      return <Money p={v} />;
    case 'percent':
      return `${(v / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
    case 'int':
      return <span className="num">{formatNumberIN(v)}</span>;
    case 'date':
      return <span className="nowrap">{formatDate(v)}</span>;
    case 'datetime':
      return <span className="nowrap">{formatDateTime(v)}</span>;
    case 'bool':
      return v ? 'Yes' : 'No';
    case 'enum':
      return <Badge value={v} />;
    case 'ref': {
      const label = row[`${key}_label`] ?? `#${v}`;
      const path = REF_PATHS[field.ref!];
      return path ? <Link to={`/${path}/${v}`} onClick={(e) => e.stopPropagation()}>{label}</Link> : label;
    }
    case 'url':
      return <a href={v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{v.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</a>;
    case 'email':
      return <a href={`mailto:${v}`}>{v}</a>;
    case 'tags':
      return (v as string[]).length ? <span className="row" style={{ gap: 4 }}>{(v as string[]).map((t) => <span key={t} className="badge">{t}</span>)}</span> : <span className="muted">—</span>;
    case 'json':
      return Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : <span className="muted">{Object.keys(v).length} fields</span>;
    default:
      return String(v);
  }
}

export const REF_PATHS: Record<string, string> = {
  influencers: 'influencers', brands: 'brands', deals: 'deals', campaigns: 'campaigns', content_tasks: 'content', editors: 'editors',
  tasks: 'tasks', documents: 'documents', assets: 'assets', users: 'settings/users', accounts: 'finance/accounts', invoices: 'finance/receivables', obligations: 'finance/payables', transactions: 'finance/transactions',
  contacts: 'r/contacts', deliverables: 'r/deliverables', campaign_creators: 'r/campaign_creators',
};

export function sortValue(field: Field | undefined, row: Row, key: string): string | number | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  if (field?.type === 'ref') return row[`${key}_label`] ?? v;
  if (field?.type === 'tags' && Array.isArray(v)) return v.join(', ');
  if (field?.type === 'json') return Array.isArray(v) ? v.length : null;
  return v;
}

// ---------------------------------------------------------------- DataTable

export interface Col {
  key: string;
  label: string;
  render?: (r: Row) => ReactNode;
  value?: (r: Row) => string | number | null;
  num?: boolean;
  hidden?: boolean;
  filter?: boolean;
  options?: readonly string[];
  csv?: (r: Row) => string | number | null;
}

export function colsFromEntity(entity: Entity, role: Role, overrides: Partial<Record<string, Partial<Col>>> = {}, extra: Col[] = []): Col[] {
  const cols: Col[] = visibleFields(entity, role)
    .filter((f) => !['password_hash', 'prefs', 'body', 'versions', 'script', 'caption'].includes(f.key))
    .map((f) => ({
      key: f.key,
      label: fieldLabel(f),
      render: (r: Row) => renderValue(f, r, f.key),
      value: (r: Row) => sortValue(f, r, f.key),
      csv: (r: Row) => (f.type === 'money' && typeof r[f.key] === 'number' ? paiseToRupeesString(r[f.key]) : f.type === 'ref' ? r[`${f.key}_label`] ?? '' : Array.isArray(r[f.key]) ? r[f.key].map((x: any) => (typeof x === 'object' ? Object.values(x).filter(Boolean).join(' ') : x)).join('; ') : r[f.key]),
      num: ['money', 'int', 'percent'].includes(f.type),
      hidden: !f.list,
      filter: !!f.list && (f.type === 'enum' || f.type === 'ref' || f.type === 'tags'),
      options: f.options,
      ...overrides[f.key],
    }));
  return [...cols, ...extra];
}

interface View { name: string; q: string; filters: Record<string, string>; sort: [string, 'asc' | 'desc'] | null; cols: string[] | null }

export function DataTable({ rows, columns, viewKey, onRowClick, bulk, toolbar, exportName, empty, footer, initialSort, pageSize: ps = 25 }: {
  rows: Row[];
  columns: Col[];
  viewKey?: string;
  onRowClick?: (r: Row) => void;
  bulk?: { label: string; danger?: boolean; run: (ids: number[]) => Promise<unknown> | void }[];
  toolbar?: ReactNode;
  exportName?: string;
  empty?: ReactNode;
  footer?: (rows: Row[]) => ReactNode;
  initialSort?: [string, 'asc' | 'desc'];
  pageSize?: number;
}) {
  const me = useMe();
  const saved: View[] = (viewKey && me.prefs.views?.[viewKey]) || [];
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<[string, 'asc' | 'desc'] | null>(initialSort ?? null);
  const [shown, setShown] = useState<string[]>(() => (viewKey && me.prefs.columns?.[viewKey]) || columns.filter((c) => !c.hidden).map((c) => c.key));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(ps);
  const [colMenu, setColMenu] = useState(false);
  const [views, setViews] = useState<View[]>(saved);

  const colByKey = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c])), [columns]);
  const val = (c: Col, r: Row) => (c.value ? c.value(r) : r[c.key]);
  const filterable = columns.filter((c) => c.filter);
  const optionsFor = (c: Col) => {
    if (c.options) return c.options.map((o) => ({ v: o, l: humanize(o) }));
    const seen = new Set<string>();
    for (const r of rows) {
      const raw = r[c.key];
      const vals = Array.isArray(raw) ? raw : [raw];
      for (const x of vals) if (x !== null && x !== undefined && typeof x !== 'object') seen.add(String(x));
    }
    return [...seen].map((v) => ({ v, l: c.key.endsWith('_id') ? String(rows.find((r) => String(r[c.key]) === v)?.[`${c.key}_label`] ?? v) : v })).sort((a, b) => a.l.localeCompare(b.l));
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      for (const [k, fv] of Object.entries(filters)) {
        if (!fv) continue;
        const raw = r[k];
        if (Array.isArray(raw) ? !raw.map(String).includes(fv) : String(raw ?? '') !== fv) return false;
      }
      if (!needle) return true;
      return columns.some((c) => String(val(c, r) ?? '').toLowerCase().includes(needle));
    });
    if (sort && colByKey[sort[0]]) {
      const c = colByKey[sort[0]];
      const dir = sort[1] === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const x = val(c, a);
        const y = val(c, b);
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-IN', { numeric: true })) * dir;
      });
    }
    return out;
  }, [rows, q, filters, sort, columns]);

  useEffect(() => setPage(0), [q, filters, pageSize]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const cols = shown.map((k) => colByKey[k]).filter(Boolean);

  const persistCols = (next: string[]) => {
    setShown(next);
    if (viewKey) void savePrefs(me, { columns: { ...(me.prefs.columns ?? {}), [viewKey]: next } });
  };
  const saveView = async () => {
    const name = window.prompt('Name this view');
    if (!name?.trim() || !viewKey) return;
    const next = [...views.filter((v) => v.name !== name), { name: name.trim(), q, filters, sort, cols: shown }];
    setViews(next);
    await attempt(() => savePrefs(me, { views: { ...(me.prefs.views ?? {}), [viewKey]: next } }), 'View saved');
  };
  const applyView = (name: string) => {
    const v = views.find((x) => x.name === name);
    if (!v) return;
    setQ(v.q);
    setFilters(v.filters);
    setSort(v.sort);
    if (v.cols) setShown(v.cols);
  };
  const deleteView = async (name: string) => {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    await savePrefs(me, { views: { ...(me.prefs.views ?? {}), [viewKey!]: next } });
  };
  const exportCsv = (onlySelected: boolean) => {
    const data = onlySelected ? filtered.filter((r) => selected.has(r.id)) : filtered;
    const escCell = (v: unknown) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.map((c) => escCell(c.label)).join(','), ...data.map((r) => cols.map((c) => escCell(c.csv ? c.csv(r) : val(c, r))).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' }));
    a.download = `${exportName ?? viewKey ?? 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const allOnPage = visible.length > 0 && visible.every((r) => selected.has(r.id));
  return (
    <div className="card flush">
      <div className="toolbar">
        <input className="input" style={{ width: 220 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search table" />
        {filterable.map((c) => (
          <select key={c.key} className="input" style={{ width: 'auto', maxWidth: 180 }} value={filters[c.key] ?? ''} onChange={(e) => setFilters({ ...filters, [c.key]: e.target.value })} aria-label={`Filter by ${c.label}`}>
            <option value="">{c.label}: all</option>
            {optionsFor(c).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        ))}
        {(q || Object.values(filters).some(Boolean)) && <button className="btn ghost sm" onClick={() => (setQ(''), setFilters({}))}>Clear</button>}
        <span className="grow" />
        {toolbar}
        {viewKey && (
          <select className="input" style={{ width: 'auto' }} value="" onChange={(e) => (e.target.value.startsWith('del:') ? deleteView(e.target.value.slice(4)) : e.target.value === '__save' ? saveView() : applyView(e.target.value))} aria-label="Saved views">
            <option value="">Views…</option>
            {views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            <option value="__save">+ Save current view</option>
            {views.map((v) => <option key={`d${v.name}`} value={`del:${v.name}`}>Delete “{v.name}”</option>)}
          </select>
        )}
        <div className="rel">
          <button className="btn sm" onClick={() => setColMenu(!colMenu)} aria-expanded={colMenu}><Columns3 /> Columns</button>
          {colMenu && (
            <div className="popover" style={{ width: 240, padding: 8 }}>
              {columns.map((c) => (
                <label key={c.key} className="check" style={{ display: 'flex', padding: '4px 6px' }}>
                  <input type="checkbox" checked={shown.includes(c.key)} onChange={(e) => persistCols(e.target.checked ? [...shown, c.key] : shown.filter((k) => k !== c.key))} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button className="btn sm" onClick={() => exportCsv(false)} title="Export filtered rows to CSV"><Download /> CSV</button>
      </div>
      {selected.size > 0 && (
        <div className="bulkbar">
          <strong>{selected.size} selected</strong>
          <button className="btn sm" onClick={() => exportCsv(true)}>Export selected</button>
          {bulk?.map((b) => (
            <button key={b.label} className={`btn sm ${b.danger ? 'danger' : ''}`} onClick={async () => {
              await b.run([...selected]);
              setSelected(new Set());
            }}>{b.label}</button>
          ))}
          <button className="btn ghost sm" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {bulk && <th style={{ width: 32 }}><input type="checkbox" aria-label="Select page" checked={allOnPage} onChange={(e) => setSelected(new Set(e.target.checked ? [...selected, ...visible.map((r) => r.id)] : [...selected].filter((id) => !visible.some((r) => r.id === id))))} /></th>}
              {cols.map((c) => (
                <th key={c.key} className={`sortable ${c.num ? 'num' : ''}`} onClick={() => setSort(sort?.[0] === c.key ? (sort[1] === 'asc' ? [c.key, 'desc'] : null) : [c.key, 'asc'])} aria-sort={sort?.[0] === c.key ? (sort[1] === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {c.label} {sort?.[0] === c.key && (sort[1] === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id ?? JSON.stringify(r)} className={`${onRowClick ? 'clickable' : ''} ${selected.has(r.id) ? 'selected' : ''}`} onClick={() => onRowClick?.(r)}>
                {bulk && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Select row" checked={selected.has(r.id)} onChange={(e) => { const s = new Set(selected); e.target.checked ? s.add(r.id) : s.delete(r.id); setSelected(s); }} /></td>}
                {cols.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : String(r[c.key] ?? '—')}</td>)}
              </tr>
            ))}
          </tbody>
          {footer && filtered.length > 0 && <tfoot>{footer(filtered)}</tfoot>}
        </table>
        {!filtered.length && (empty ?? <Empty title={rows.length ? 'No records match these filters' : 'Nothing here yet'} hint={rows.length ? 'Clear the search or filters to see everything.' : undefined} />)}
      </div>
      {filtered.length > 0 && (
        <div className="pager">
          <span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span>
          <select className="input" style={{ width: 'auto', height: 28 }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page">
            {[25, 50, 100, 500].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
          <span>{page + 1} / {pages}</span>
          <button className="btn sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

/** Generic list for a schema entity with create, archive and bulk edit. */
export function EntityTable({ entity, rows, onRowClick, overrides, extra, toolbar, defaults, fields }: {
  entity: string;
  rows?: Row[];
  onRowClick?: (r: Row) => void;
  overrides?: Partial<Record<string, Partial<Col>>>;
  extra?: Col[];
  toolbar?: ReactNode;
  defaults?: Row;
  fields?: string[];
}) {
  const me = useMe();
  const e = ENTITY[entity];
  const [archived, setArchived] = useState(false);
  const q = useApi<{ rows: Row[] }>(rows ? null : `/api/e/${entity}${archived ? '?archived=1' : ''}`);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const writable = can(me.user.role, e.write);
  const data = rows ?? q.data?.rows;
  const cols = colsFromEntity(e, me.user.role, overrides, extra);
  const enumFields = e.fields.filter((f) => f.type === 'enum' && !f.readonly && (!f.sensitive || can(me.user.role, f.sensitive)));
  const bulk = writable ? [
    ...(archived
      ? [{ label: 'Restore', run: async (ids: number[]) => { await attempt(() => api(`/api/e/${entity}/bulk`, { body: { ids, action: 'restore' } }), 'Restored'); invalidate(`/api/e/${entity}`); } }]
      : [
          ...enumFields.slice(0, 2).map((f) => ({
            label: `Set ${fieldLabel(f).toLowerCase()}…`,
            run: async (ids: number[]) => {
              const v = window.prompt(`New ${fieldLabel(f).toLowerCase()} (${f.options!.join(', ')})`);
              if (!v) return;
              const r = await api(`/api/e/${entity}/bulk`, { body: { ids, action: 'update', values: { [f.key]: v.trim() } } }).catch((err) => ({ ok: 0, failed: [{ error: err.message }] }));
              toast(`${r.ok} updated${r.failed.length ? `, ${r.failed.length} failed: ${r.failed[0].error}` : ''}`, r.failed.length ? 'error' : 'info');
              invalidate(`/api/e/${entity}`);
            },
          })),
          {
            label: 'Archive',
            danger: true,
            run: async (ids: number[]) => {
              const reason = await confirmAction({ title: `Archive ${ids.length} ${ids.length === 1 ? e.label.toLowerCase() : e.plural.toLowerCase()}?`, message: 'Archived records are hidden but can be restored at any time.', confirm: 'Archive', danger: true, reason: 'Why' });
              if (reason === false) return;
              const r = await api(`/api/e/${entity}/bulk`, { body: { ids, action: 'archive', reason } });
              toast(`${r.ok} archived${r.failed.length ? `, ${r.failed.length} could not be: ${r.failed[0].error}` : ''}`, r.failed.length ? 'error' : 'info');
              invalidate(`/api/e/${entity}`);
            },
          },
        ]),
  ] : undefined;
  return (
    <>
      {!data && q.error ? <ErrorBox error={q.error} retry={q.reload} /> : !data ? <Loading lines={6} /> : (
        <DataTable rows={data} columns={cols} viewKey={entity} exportName={entity} bulk={bulk}
          onRowClick={onRowClick ?? ((r) => nav(`/${REF_PATHS[entity] ?? `r/${entity}`}/${r.id}`))}
          toolbar={<>
            {toolbar}
            {!rows && <label className="check small"><input type="checkbox" checked={archived} onChange={(ev) => setArchived(ev.target.checked)} /> Archived</label>}
            {writable && !archived && <button className="btn primary sm" onClick={() => setCreating(true)}><Plus /> New {e.label.toLowerCase()}</button>}
          </>}
          empty={<Empty title={archived ? 'No archived records' : `No ${e.plural.toLowerCase()} yet`} action={writable && !archived ? <button className="btn primary" onClick={() => setCreating(true)}><Plus /> Add the first one</button> : undefined} />}
        />
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title={`New ${e.label.toLowerCase()}`}>
        <EntityForm entity={entity} initial={defaults} fields={fields} onSaved={(r) => { setCreating(false); invalidate(`/api/e/${entity}`); nav(`/${REF_PATHS[entity] ?? `r/${entity}`}/${r.id}`); }} />
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- forms

type ShapeField = { key: string; label?: string; type: 'text' | 'int' | 'number' | 'money' | 'date' | 'bool' | 'enum' | 'url' | 'ref' | 'tags'; options?: readonly string[]; ref?: string };
const DELIVERABLES = ['reel', 'story', 'post', 'carousel', 'youtube_video', 'short', 'live', 'ugc', 'other'] as const;
export const SHAPES: Record<string, { kind: 'list' | 'object' | 'ids'; fields: ShapeField[] }> = {
  platforms: { kind: 'list', fields: [{ key: 'platform', type: 'enum', options: PLATFORMS }, { key: 'handle', type: 'text' }, { key: 'url', type: 'url' }, { key: 'followers', type: 'int' }, { key: 'avg_views', type: 'int', label: 'Avg views' }, { key: 'median_views', type: 'int', label: 'Median views' }, { key: 'engagement_rate', type: 'number', label: 'Engagement %' }, { key: 'source', type: 'text' }, { key: 'updated_at', type: 'date', label: 'As of' }] },
  rate_card: { kind: 'list', fields: [{ key: 'deliverable', type: 'enum', options: DELIVERABLES }, { key: 'platform', type: 'enum', options: PLATFORMS }, { key: 'rate', type: 'money', label: 'Rate card' }, { key: 'negotiated_rate', type: 'money', label: 'Negotiated' }, { key: 'notes', type: 'text' }] },
  creators: { kind: 'list', fields: [{ key: 'influencer_id', type: 'ref', ref: 'influencers', label: 'Creator' }, { key: 'fee', type: 'money', label: 'Creator fee' }, { key: 'deliverables', type: 'text', label: 'Deliverables (e.g. 2 reels, 3 stories)' }, { key: 'status', type: 'enum', options: ['proposed', 'confirmed', 'declined'] }] },
  payment_milestones: { kind: 'list', fields: [{ key: 'label', type: 'text' }, { key: 'pct', type: 'number', label: '% of value' }, { key: 'due_days', type: 'int', label: 'Due in (days)' }] },
  budget_plan: { kind: 'list', fields: [{ key: 'category', type: 'enum', options: ['creator', 'editing', 'production', 'other'] }, { key: 'description', type: 'text' }, { key: 'planned', type: 'money' }] },
  checklist: { kind: 'list', fields: [{ key: 'text', type: 'text', label: 'Item' }, { key: 'done', type: 'bool' }] },
  scope_changes: { kind: 'list', fields: [{ key: 'date', type: 'date' }, { key: 'description', type: 'text' }, { key: 'cost_impact', type: 'money', label: 'Cost impact' }, { key: 'revenue_impact', type: 'money', label: 'Revenue impact' }, { key: 'days_impact', type: 'int', label: 'Timeline (days)' }, { key: 'status', type: 'enum', options: ['proposed', 'approved', 'rejected'] }] },
  kpi_targets: { kind: 'object', fields: [{ key: 'views', type: 'int' }, { key: 'reach', type: 'int', label: 'Reach (per creator, not summed)' }, { key: 'engagement_rate', type: 'number', label: 'Engagement %' }, { key: 'clicks', type: 'int' }, { key: 'conversions', type: 'int' }] },
  audience: { kind: 'object', fields: [{ key: 'summary', type: 'text' }, { key: 'top_cities', type: 'tags', label: 'Top cities' }, { key: 'source', type: 'text' }, { key: 'as_of', type: 'date', label: 'As of' }] },
  metrics: { kind: 'object', fields: [{ key: 'views', type: 'int' }, { key: 'reach', type: 'int' }, { key: 'likes', type: 'int' }, { key: 'comments', type: 'int' }, { key: 'shares', type: 'int' }, { key: 'saves', type: 'int' }, { key: 'clicks', type: 'int' }, { key: 'conversions', type: 'int' }, { key: 'source', type: 'text' }, { key: 'as_of', type: 'date', label: 'As of' }] },
  depends_on: { kind: 'ids', fields: [] },
};

function ShapeInput({ f, value, onChange }: { f: ShapeField; value: any; onChange: (v: any) => void }) {
  const opts = useOptions(f.type === 'ref' ? f.ref : undefined);
  const label = f.label ?? humanize(f.key);
  switch (f.type) {
    case 'bool':
      return <input type="checkbox" aria-label={label} checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'enum':
      return <select className="input" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}><option value="">—</option>{f.options!.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</select>;
    case 'ref':
      return <select className="input" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>;
    case 'money':
      return <MoneyField value={value ?? null} onChange={onChange} label={label} />;
    case 'tags':
      return <TagsInput value={value ?? []} onChange={onChange} label={label} />;
    case 'int':
    case 'number':
      return <input className="input" aria-label={label} type="number" step={f.type === 'int' ? 1 : 'any'} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    default:
      return <input className="input" aria-label={label} type={f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text'} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
  }
}

export function JsonEditor({ name, value, onChange }: { name: string; value: any; onChange: (v: any) => void }) {
  const shape = SHAPES[name];
  if (!shape) {
    return <JsonTextarea value={value} onChange={onChange} />;
  }
  if (shape.kind === 'ids') {
    return <input className="input" placeholder="e.g. 12, 15" value={(value ?? []).join(', ')} onChange={(e) => onChange(e.target.value.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))} />;
  }
  if (shape.kind === 'object') {
    const v = value ?? {};
    return (
      <div className="form-grid">
        {shape.fields.map((f) => (
          <label key={f.key} className="field"><span>{f.label ?? humanize(f.key)}</span><ShapeInput f={f} value={v[f.key]} onChange={(x) => onChange({ ...v, [f.key]: x })} /></label>
        ))}
      </div>
    );
  }
  const list: Row[] = Array.isArray(value) ? value : [];
  return (
    <div className="stack tight">
      <div className="table-wrap">
        <table className="table">
          <thead><tr>{shape.fields.map((f) => <th key={f.key}>{f.label ?? humanize(f.key)}</th>)}<th /></tr></thead>
          <tbody>
            {list.map((item, i) => (
              <tr key={i}>
                {shape.fields.map((f) => <td key={f.key} style={{ minWidth: f.type === 'bool' ? 40 : 110 }}><ShapeInput f={f} value={item[f.key]} onChange={(x) => onChange(list.map((it, j) => (j === i ? { ...it, [f.key]: x } : it)))} /></td>)}
                <td><button type="button" className="btn ghost sm" aria-label="Remove row" onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><button type="button" className="btn sm" onClick={() => onChange([...list, {}])}><Plus /> Add row</button></div>
    </div>
  );
}

function JsonTextarea({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const [text, setText] = useState(() => (value == null ? '' : JSON.stringify(value, null, 2)));
  const [err, setErr] = useState('');
  return (
    <>
      <textarea className={`input code ${err ? 'invalid' : ''}`} value={text} onChange={(e) => {
        setText(e.target.value);
        try {
          onChange(e.target.value.trim() ? JSON.parse(e.target.value) : null);
          setErr('');
        } catch {
          setErr('Not valid JSON yet');
        }
      }} />
      {err && <span className="error">{err}</span>}
    </>
  );
}

export function MoneyField({ value, onChange, label, invalid }: { value: number | null; onChange: (p: number | null) => void; label?: string; invalid?: boolean }) {
  const [text, setText] = useState(value == null ? '' : paiseToRupeesString(value).replace(/\.00$/, ''));
  const [err, setErr] = useState('');
  useEffect(() => {
    try {
      if ((text.trim() === '' ? null : rupeesToPaise(text)) !== value) setText(value == null ? '' : paiseToRupeesString(value).replace(/\.00$/, ''));
    } catch {
      /* keep the user's in-progress text */
    }
  }, [value]);
  return (
    <div className="stack tight" style={{ gap: 2 }}>
      <div className="money-input">
        <input className={`input num ${err || invalid ? 'invalid' : ''}`} inputMode="decimal" aria-label={label} placeholder="0" value={text} onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setErr('');
            return onChange(null);
          }
          try {
            onChange(rupeesToPaise(e.target.value));
            setErr('');
          } catch (ex) {
            setErr(ex instanceof MoneyError ? ex.message : 'Invalid amount');
          }
        }} />
      </div>
      {err ? <span className="error small" style={{ color: 'var(--bad)' }}>{err}</span> : value != null && value >= 1_00_000 ? <span className="hint small muted">{formatINR(value)}</span> : null}
    </div>
  );
}

function TagsInput({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label?: string }) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => {
    if (text.split(',').map((s) => s.trim()).filter(Boolean).join('|') !== value.join('|')) setText(value.join(', '));
  }, [value]);
  return <input className="input" aria-label={label} placeholder="comma, separated" value={text} onChange={(e) => (setText(e.target.value), onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean)))} />;
}

export function FieldInput({ field, value, onChange, error }: { field: Field; value: any; onChange: (v: any) => void; error?: string }) {
  const opts = useOptions(field.type === 'ref' ? field.ref : undefined);
  const cls = `input ${error ? 'invalid' : ''}`;
  switch (field.type) {
    case 'longtext':
      return <textarea className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'money':
      return <MoneyField value={value ?? null} onChange={onChange} invalid={!!error} label={fieldLabel(field)} />;
    case 'percent':
      return <input className={cls} type="number" step="0.01" value={value == null ? '' : value / 100} onChange={(e) => onChange(e.target.value === '' ? null : Math.round(Number(e.target.value) * 100))} />;
    case 'int':
      return <input className={cls} type="number" step="1" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'date':
      return <input className={cls} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return <input className={cls} type="datetime-local" value={value ? value.slice(0, 16) : ''} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />;
    case 'bool':
      return <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {fieldLabel(field)}</label>;
    case 'enum':
      return <select className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>{!field.required && <option value="">—</option>}{field.options!.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</select>;
    case 'ref':
      return <select className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>;
    case 'tags':
      return <TagsInput value={value ?? []} onChange={onChange} label={fieldLabel(field)} />;
    case 'json':
      return <JsonEditor name={field.key} value={value} onChange={onChange} />;
    default:
      return <input className={cls} type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Create/edit form generated from the schema. Only sends fields the user changed. */
export function EntityForm({ entity, record, initial, fields, onSaved, submitLabel }: { entity: string; record?: Row; initial?: Row; fields?: string[]; onSaved: (r: Row) => void; submitLabel?: string }) {
  const me = useMe();
  const e = ENTITY[entity];
  const editable = visibleFields(e, me.user.role).filter((f) => !f.readonly && (!fields || fields.includes(f.key)) && !['password_hash', 'prefs'].includes(f.key));
  const [values, setValues] = useState<Row>(() => ({ ...Object.fromEntries(editable.filter((f) => f.default !== undefined && !record).map((f) => [f.key, f.default])), ...initial, ...(record ? Object.fromEntries(editable.map((f) => [f.key, record[f.key]])) : {}) }));
  const [changed, setChanged] = useState<Set<string>>(() => new Set(record ? [] : Object.keys({ ...initial })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const set = (k: string, v: any) => {
    setValues((x) => ({ ...x, [k]: v }));
    setChanged((s) => new Set(s).add(k));
  };
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const missing = editable.filter((f) => f.required && (values[f.key] === null || values[f.key] === undefined || values[f.key] === ''));
    if (missing.length) {
      setErrors(Object.fromEntries(missing.map((f) => [f.key, `${fieldLabel(f)} is required`])));
      setFormError('Fill in the required fields.');
      return;
    }
    const body = record ? Object.fromEntries([...changed].map((k) => [k, values[k]])) : Object.fromEntries(editable.filter((f) => values[f.key] !== undefined).map((f) => [f.key, values[f.key]]));
    if (record && !Object.keys(body).length) return onSaved(record);
    setBusy(true);
    setFormError('');
    try {
      const res = await api<{ row: Row }>(record ? `/api/e/${entity}/${record.id}` : `/api/e/${entity}`, { method: record ? 'PATCH' : 'POST', body });
      setErrors({});
      invalidate(`/api/e/${entity}`);
      toast(`${e.label} saved`);
      onSaved(res.row);
    } catch (err) {
      const ae = err as ApiError;
      setErrors(ae.details?.fields ?? {});
      setFormError(ae.message);
    } finally {
      setBusy(false);
    }
  };
  const wide = (f: Field) => ['longtext', 'json'].includes(f.type);
  return (
    <form className="stack" onSubmit={submit} noValidate>
      {formError && <div className="alert bad" role="alert">{formError}</div>}
      <div className="form-grid">
        {editable.map((f) => (
          <label key={f.key} className={`field ${wide(f) ? 'full' : ''}`}>
            {f.type !== 'bool' && <span>{fieldLabel(f)}{f.required ? ' *' : ''}{f.sensitive && <span className="hint"> · restricted</span>}</span>}
            <FieldInput field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} error={errors[f.key]} />
            {errors[f.key] ? <span className="error">{errors[f.key]}</span> : f.hint && <span className="hint">{f.hint}</span>}
          </label>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : submitLabel ?? (record ? 'Save changes' : `Create ${e.label.toLowerCase()}`)}</button>
      </div>
    </form>
  );
}

/** Read-only field list for a record. */
export function Details({ entity, row, only, skip }: { entity: string; row: Row; only?: string[]; skip?: string[] }) {
  const me = useMe();
  const fields = visibleFields(ENTITY[entity], me.user.role).filter((f) => (!only || only.includes(f.key)) && !skip?.includes(f.key) && !['password_hash', 'prefs'].includes(f.key) && f.type !== 'json');
  return (
    <dl className="kv">
      {fields.map((f) => (
        <div key={f.key} style={{ display: 'contents' }}>
          <dt>{fieldLabel(f)}</dt>
          <dd className={f.type === 'longtext' ? 'pre' : ''}>{renderValue(f, row, f.key)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ArchiveButton({ entity, row, onDone }: { entity: string; row: Row; onDone?: () => void }) {
  const e = ENTITY[entity];
  if (!useCan(e.write)) return null;
  const archived = !!row.archived_at;
  return (
    <button className={`btn sm ${archived ? '' : 'danger'}`} onClick={async () => {
      const reason = await confirmAction({ title: `${archived ? 'Restore' : 'Archive'} this ${e.label.toLowerCase()}?`, message: archived ? undefined : 'It will be hidden from lists. You can restore it later from the Archived filter.', confirm: archived ? 'Restore' : 'Archive', danger: !archived, reason: archived ? false : 'Why' });
      if (reason === false) return;
      if (await attempt(() => api(`/api/e/${entity}/${row.id}/${archived ? 'restore' : 'archive'}`, { body: { reason } }), archived ? 'Restored' : 'Archived')) {
        invalidate(`/api/e/${entity}`);
        onDone?.();
      }
    }}>{archived ? 'Restore' : 'Archive'}</button>
  );
}

// ---------------------------------------------------------------- kanban & calendar

export function Kanban({ stages, items, stageOf, onMove, card, canMove = true }: { stages: readonly string[]; items: Row[]; stageOf: (r: Row) => string; onMove: (r: Row, stage: string) => void; card: (r: Row) => ReactNode; canMove?: boolean }) {
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="kanban">
      {stages.map((s) => {
        const col = items.filter((i) => stageOf(i) === s);
        return (
          <div key={s} className={`kcol ${over === s ? 'over' : ''}`}
            onDragOver={(e) => { if (canMove) { e.preventDefault(); setOver(s); } }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              setOver(null);
              const id = Number(e.dataTransfer.getData('text/plain'));
              const item = items.find((i) => i.id === id);
              if (item && stageOf(item) !== s) onMove(item, s);
            }}>
            <div className="kcol-head"><span>{humanize(s)}</span><span className="muted">{col.length}</span></div>
            <div className="kcol-body">
              {col.map((i) => (
                <div key={i.id} className="kcard" draggable={canMove} onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i.id))}>
                  {card(i)}
                  {canMove && (
                    <select className="input" style={{ height: 26, fontSize: 12 }} aria-label="Move to stage" value={s} onClick={(e) => e.stopPropagation()} onChange={(e) => onMove(i, e.target.value)}>
                      {stages.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface CalEvent { date: string; label: string; kind?: string; link?: string; title?: string }
export function Calendar({ events, month, onMonth }: { events: CalEvent[]; month: string; onMonth: (m: string) => void }) {
  const today = useToday();
  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - offset * 86_400_000);
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const shift = (n: number) => {
    const d = new Date(first);
    d.setUTCMonth(d.getUTCMonth() + n);
    onMonth(d.toISOString().slice(0, 7));
  };
  const nav = useNavigate();
  return (
    <div className="stack tight">
      <div className="row between">
        <h3>{first.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3>
        <div className="row"><button className="btn sm" onClick={() => shift(-1)}>Prev</button><button className="btn sm" onClick={() => onMonth(today.slice(0, 7))}>Today</button><button className="btn sm" onClick={() => shift(1)}>Next</button></div>
      </div>
      <div className="cal">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="dow">{d}</div>)}
        {days.map((d) => {
          const ev = events.filter((e) => e.date === d);
          return (
            <div key={d} className={`day ${d.slice(0, 7) !== month ? 'other' : ''} ${d === today ? 'today' : ''}`}>
              <span className="dnum">{Number(d.slice(8))}</span>
              {ev.slice(0, 4).map((e, i) => (
                <div key={i} className={`ev ${e.kind ?? ''}`} title={e.title ?? e.label} role={e.link ? 'link' : undefined} style={{ cursor: e.link ? 'pointer' : undefined }} onClick={() => e.link && nav(e.link)}>{e.label}</div>
              ))}
              {ev.length > 4 && <span className="small muted">+{ev.length - 4} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- charts

/** Renders an SVG chart at the container's real width so text stays legible. */
export function Chart({ svg, table, label }: { svg: string | ((width: number) => string); table?: { columns: string[]; rows: (string | number)[][] }; label: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [asTable, setAsTable] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [asTable]);
  const markup = typeof svg === 'function' ? svg(width) : svg;
  const move = useCallback((e: React.PointerEvent | React.FocusEvent) => {
    const el = (e.target as Element).closest('[data-tip]');
    if (!el || !ref.current) return setTip(null);
    const box = ref.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const x = 'clientX' in e ? e.clientX - box.left : r.left - box.left + r.width / 2;
    setTip({ x: Math.min(x + 12, box.width - 160), y: ('clientY' in e ? e.clientY : r.top) - box.top + 12, text: el.getAttribute('data-tip') ?? '' });
  }, []);
  return (
    <div className="stack tight">
      {table && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost sm" onClick={() => setAsTable(!asTable)}>{asTable ? 'Show chart' : 'Show as table'}</button></div>}
      {asTable && table ? (
        <div className="table-wrap"><table className="table"><thead><tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'num' : ''}>{c}</td>)}</tr>)}</tbody></table></div>
      ) : (
        <div ref={ref} className="chart" aria-label={label} onPointerMove={move} onPointerLeave={() => setTip(null)} onFocus={move} onBlur={() => setTip(null)}>
          <div dangerouslySetInnerHTML={{ __html: markup }} />
          {tip && <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- comments, timeline, activity

const KINDS = ['note', 'call', 'email', 'meeting', 'whatsapp', 'comment'];
export function Timeline({ entity, id, kinds = KINDS }: { entity: string; id: number; kinds?: string[] }) {
  const q = useApi<{ rows: Row[] }>(`/api/comments?entity=${entity}&id=${id}`);
  const [body, setBody] = useState('');
  const [kind, setKind] = useState(kinds[0]);
  const [follow, setFollow] = useState('');
  const add = async () => {
    if (!body.trim()) return;
    if (await attempt(() => api('/api/comments', { body: { entity_type: entity, entity_id: id, kind, body, follow_up_date: follow || null } }))) {
      setBody('');
      setFollow('');
      q.reload();
    }
  };
  return (
    <div className="stack">
      <div className="stack tight">
        <textarea className="input" placeholder="Add a note, call log or update. Use @name to mention a teammate." value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="row">
          <select className="input" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Entry type">{kinds.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select>
          {entity === 'brands' || entity === 'deals' ? <label className="row small muted">Follow up <input type="date" className="input" style={{ width: 'auto' }} value={follow} onChange={(e) => setFollow(e.target.value)} /></label> : null}
          <span className="grow" />
          <button className="btn primary sm" onClick={add} disabled={!body.trim()}>Add</button>
        </div>
      </div>
      <Async q={q}>
        {(d) => d.rows.length ? (
          <div className="list">
            {d.rows.map((c) => (
              <div key={c.id} className="list-item">
                <div className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>{(c.user_name ?? '?').slice(0, 1)}</div>
                <div className="grow">
                  <div className="row small"><strong>{c.user_name ?? 'System'}</strong><Badge value={c.kind} /><span className="muted">{fmtDateTime(c.created_at)}</span>{c.follow_up_date && <Badge tone="warn">Follow up {fmtDate(c.follow_up_date)}</Badge>}{c.meta?.timestamp_sec != null && <Badge tone="info">at {Math.floor(c.meta.timestamp_sec / 60)}:{String(c.meta.timestamp_sec % 60).padStart(2, '0')}{c.meta.version ? ` · v${c.meta.version}` : ''}</Badge>}</div>
                  <div className="pre">{c.body}</div>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty title="No entries yet" hint="Calls, emails and notes you log here form the communication timeline." />}
      </Async>
    </div>
  );
}

export function Activity({ entity, id }: { entity: string; id: number }) {
  const q = useApi<{ rows: Row[] }>(`/api/activity?entity=${entity}&id=${id}`);
  return (
    <Async q={q}>
      {(d) => d.rows.length ? (
        <div className="list">
          {d.rows.map((a) => (
            <div key={a.id} className="list-item small">
              <span className="muted nowrap">{fmtDateTime(a.created_at)}</span>
              <span><strong>{a.user_name ?? 'System'}</strong> {a.action.replace(/_/g, ' ')}{a.note ? ` — ${a.note}` : ''}{a.after && typeof a.after === 'object' ? <span className="muted"> · {Object.keys(a.after).slice(0, 6).join(', ')}</span> : null}</span>
            </div>
          ))}
        </div>
      ) : <Empty title="No activity recorded" />}
    </Async>
  );
}

export function useIdempotencyKey() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return [key, () => setKey(crypto.randomUUID())] as const;
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches));
  return (
    <button className="btn ghost sm" aria-label="Toggle dark mode" onClick={() => {
      const next = dark ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('hq-theme', next); } catch { /* private mode */ }
      setDark(!dark);
    }}>{dark ? <Sun /> : <Moon />}</button>
  );
}


/** "Analyse with ChatGPT": opens the Manual ChatGPT analysis form pre-filled for these records. */
export function AnalyseButton({ type, ids = [], cap = 'staff', period }: { type: string; ids?: number[]; cap?: Cap; period?: string }) {
  const me = useMe();
  if (me.user.role === 'editor' || !can(me.user.role, cap)) return null;
  const q = new URLSearchParams({ type, ...(ids.length ? { ids: ids.join(',') } : {}), ...(period ? { period } : {}) });
  return <Link className="btn" to={`/chatgpt/new?${q}`} title="Manual ChatGPT analysis: export a package and prompt for your own ChatGPT"><Sparkles /> Analyse with ChatGPT</Link>;
}

export function Gate({ cap, children }: { cap: Cap; children: ReactNode }) {
  return can(useMe().user.role, cap) ? <>{children}</> : <Card><p>You don't have access to this area.</p></Card>;
}

