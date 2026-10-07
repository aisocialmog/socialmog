import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';
import { addDays, addMonths, financialYearStart, formatDate, monthStart, weekStart } from '../../shared/dates.ts';
import { humanize } from '../../shared/schema.ts';
import { api, Async, attempt, Badge, Card, DataTable, Empty, EntityTable, fmtDateTime, PageHead, toast, useApi, useOptions, useToday, type Row } from '../lib.tsx';

export function Reports() {
  return (
    <div className="stack">
      <div className="tabs">{[['/reports', 'Generate & archive'], ['/reports/templates', 'Saved templates & schedules']].map(([to, l]) => <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'on' : '')}>{l}</NavLink>)}</div>
      <Routes>
        <Route index element={<Centre />} />
        <Route path="templates" element={<Templates />} />
        <Route path=":id" element={<ReportView />} />
      </Routes>
    </div>
  );
}

function presets(today: string) {
  const lastWeek = addDays(weekStart(today), -7);
  return {
    last_week: [lastWeek, addDays(lastWeek, 6)],
    this_month: [monthStart(today), today],
    last_month: [addMonths(monthStart(today), -1), addDays(monthStart(today), -1)],
    this_fy: [financialYearStart(today), today],
    last_90: [addDays(today, -90), today],
  } as Record<string, [string, string]>;
}

export function ReportForm({ initial, onCreated, saveAsTemplate }: { initial?: Row; onCreated?: (id: number) => void; saveAsTemplate?: boolean }) {
  const today = useToday();
  const types = useApi<{ types: Row[] }>('/api/reports/types');
  const campaigns = useOptions('campaigns');
  const influencers = useOptions('influencers');
  const brands = useOptions('brands');
  const editors = useOptions('editors');
  const p = presets(today);
  const [v, setV] = useState<Row>({ report_type: 'founder', audience: 'internal', period: 'this_fy', params: {}, ...initial, ...(initial?.params ? { params: initial.params } : {}) });
  const [busy, setBusy] = useState(false);
  const def = types.data?.types.find((t) => t.key === v.report_type);
  const setParam = (k: string, x: any) => setV({ ...v, params: { ...v.params, [k]: x } });
  const [from, to] = v.period === 'custom' ? [v.params.from ?? today, v.params.to ?? today] : p[v.period] ?? p.this_fy;
  useEffect(() => {
    if (def && !def[v.audience]) setV((x) => ({ ...x, audience: def.internal ? 'internal' : 'external' }));
  }, [def?.key]);
  const params = { ...v.params, from, to };
  return (
    <div className="stack">
      <div className="form-grid">
        <label className="field"><span>Report</span><select className="input" value={v.report_type} onChange={(e) => setV({ ...v, report_type: e.target.value, params: {} })}>{types.data?.types.filter((t) => t.internal || t.external).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
        <label className="field"><span>Audience</span><select className="input" value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value })}>{def?.internal && <option value="internal">Internal</option>}{def?.external && <option value="external">External (client / creator safe)</option>}</select><span className="hint">{v.audience === 'external' ? 'Hides commissions, margins, private notes and unrelated financials.' : 'Full figures. Do not share outside Socialmog.'}</span></label>
        <label className="field"><span>Period</span><select className="input" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })}><option value="last_week">Last week</option><option value="this_month">This month</option><option value="last_month">Last month</option><option value="last_90">Last 90 days</option><option value="this_fy">This financial year</option><option value="custom">Custom…</option></select></label>
        {v.period === 'custom' && <><label className="field"><span>From</span><input type="date" className="input" value={from} onChange={(e) => setParam('from', e.target.value)} /></label><label className="field"><span>To</span><input type="date" className="input" value={to} onChange={(e) => setParam('to', e.target.value)} /></label></>}
        {v.report_type === 'campaign' && <label className="field"><span>Campaign</span><select className="input" value={v.params.campaign_id ?? ''} onChange={(e) => setParam('campaign_id', Number(e.target.value))}><option value="">Choose…</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
        {['influencer_growth', 'creator_statement'].includes(v.report_type) && <label className="field"><span>Creator</span><select className="input" value={v.params.influencer_id ?? ''} onChange={(e) => setParam('influencer_id', Number(e.target.value))}><option value="">Choose…</option>{influencers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
        {v.report_type === 'brand_statement' && <label className="field"><span>Brand</span><select className="input" value={v.params.brand_id ?? ''} onChange={(e) => setParam('brand_id', Number(e.target.value))}><option value="">Choose…</option>{brands.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
        {v.report_type === 'editor_summary' && <label className="field"><span>Editor</span><select className="input" value={v.params.editor_id ?? ''} onChange={(e) => setParam('editor_id', Number(e.target.value))}><option value="">Choose…</option>{editors.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
        {v.report_type === 'roster' && <label className="field full"><span>Creators (leave empty for all active)</span><select className="input" multiple style={{ height: 120 }} value={(v.params.influencer_ids ?? []).map(String)} onChange={(e) => setParam('influencer_ids', [...e.target.selectedOptions].map((o) => Number(o.value)))}>{influencers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
      </div>
      {def && def.sections.length > 1 && (
        <div className="row small"><strong>Sections:</strong>{def.sections.map((s: string) => {
          const on = !v.params.sections || v.params.sections.includes(s);
          return <label key={s} className="check"><input type="checkbox" checked={on} onChange={(e) => setParam('sections', (e.target.checked ? [...(v.params.sections ?? def.sections), s] : (v.params.sections ?? def.sections).filter((x: string) => x !== s)).filter((x: string, i: number, a: string[]) => a.indexOf(x) === i))} /> {humanize(s)}</label>;
        })}</div>
      )}
      <div className="row">
        <span className="small muted">Period {formatDate(from)} – {formatDate(to)}</span>
        <span className="grow" />
        {saveAsTemplate && <button className="btn" onClick={async () => {
          const name = window.prompt('Template name');
          if (!name) return;
          const schedule = window.prompt('Schedule: none, weekly (Mondays, last week) or monthly (1st, last month)', 'none') ?? 'none';
          if (await attempt(() => api('/api/e/report_templates', { body: { name, report_type: v.report_type, audience: v.audience, params: { ...v.params, period: v.period }, schedule: ['weekly', 'monthly'].includes(schedule) ? schedule : 'none' } }), 'Template saved')) toast('Find it under Saved templates');
        }}>Save as template</button>}
        <button className="btn primary" disabled={busy || !def} onClick={async () => {
          setBusy(true);
          try {
            const r = await api('/api/reports', { body: { report_type: v.report_type, audience: v.audience, params } });
            onCreated?.(r.id);
          } catch (e) {
            toast((e as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        }}>Generate PDF</button>
      </div>
    </div>
  );
}

function Centre() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const q = useApi<{ rows: Row[] }>('/api/reports');
  const initial = sp.get('type') ? { report_type: sp.get('type'), params: Object.fromEntries([...sp.entries()].filter(([k]) => k.endsWith('_id')).map(([k, x]) => [k, Number(x)])) } : undefined;
  useEffect(() => {
    if (!q.data?.rows.some((r) => ['queued', 'running'].includes(r.status))) return;
    const t = setTimeout(q.reload, 2000);
    return () => clearTimeout(t);
  }, [q.data]);
  return (
    <div className="stack">
      <PageHead title="PDF reporting centre" sub="Figures come from stored records; reports are generated in the background, saved here with a data snapshot, and never sent anywhere automatically." />
      <Card title="New report"><ReportForm initial={initial} saveAsTemplate onCreated={(id) => nav(`/reports/${id}`)} /></Card>
      <Async q={q}>{(d) => (
        <DataTable rows={d.rows} viewKey="reports" onRowClick={(r) => nav(`/reports/${r.id}`)} empty={<Empty title="No reports yet" />} columns={[
          { key: 'title', label: 'Report' },
          { key: 'report_type', label: 'Type', filter: true, render: (r) => humanize(r.report_type) },
          { key: 'audience', label: 'Audience', filter: true, render: (r) => <Badge tone={r.audience === 'external' ? 'info' : ''}>{humanize(r.audience)}</Badge> },
          { key: 'period', label: 'Period', render: (r) => (r.params.from ? `${formatDate(r.params.from)} – ${formatDate(r.params.to)}` : '—') },
          { key: 'version', label: 'Version', num: true },
          { key: 'status', label: 'Status', filter: true, render: (r) => <Badge value={r.status}>{humanize(r.status)}{r.status === 'running' ? ` ${r.progress ?? 0}%` : ''}</Badge> },
          { key: 'created_at', label: 'Requested', render: (r) => <span className="small">{fmtDateTime(r.created_at)} · {r.requested_by ?? 'schedule'}</span> },
          { key: 'files', label: 'Files', render: (r) => (r.status === 'completed' ? <span className="row" onClick={(e) => e.stopPropagation()}><a className="btn sm" href={`/api/reports/${r.id}/pdf?download=1`}>PDF</a><a className="btn sm" href={`/api/reports/${r.id}/csv?download=1`}>CSV</a></span> : '—') },
        ]} />
      )}</Async>
    </div>
  );
}

function ReportView() {
  const { id } = useParams();
  const q = useApi<{ row: Row }>(`/api/reports/${id}`);
  useEffect(() => {
    if (q.data && !['queued', 'running'].includes(q.data.row.status)) return;
    const t = setTimeout(q.reload, 1500);
    return () => clearTimeout(t);
  }, [q.data]);
  return (
    <Async q={q}>{({ row: r }) => (
      <div className="stack">
        <PageHead title={r.title ?? humanize(r.report_type)} sub={<>{humanize(r.audience)} · version {r.version} · {r.params.from ? `${formatDate(r.params.from)} – ${formatDate(r.params.to)}` : ''} · requested {fmtDateTime(r.created_at)}</>}
          actions={r.status === 'completed' && <>
            <a className="btn primary" href={`/api/reports/${r.id}/pdf?download=1`}>Download PDF</a>
            <a className="btn" href={`/api/reports/${r.id}/csv?download=1`}>CSV data</a>
            <a className="btn" href={`mailto:?subject=${encodeURIComponent(r.title ?? 'Report')}&body=${encodeURIComponent('Please find the report attached.')}`} title="Opens your email app; attach the downloaded PDF yourself">Email…</a>
          </>} />
        {['queued', 'running'].includes(r.status) && (
          <Card><div className="stack tight"><div>{r.status === 'queued' ? 'Waiting to start…' : `Generating… ${r.progress ?? 0}%`}</div><div className="meter"><div style={{ width: `${r.progress ?? 5}%` }} /></div><p className="small muted">You can leave this page; the report is saved here when ready and you'll get a notification.</p></div></Card>
        )}
        {r.status === 'failed' && <div className="alert bad row between"><span>Generation failed: {r.error}</span><button className="btn sm" onClick={async () => { if (await attempt(() => api(`/api/reports/${r.id}/retry`, { body: {} }), 'Retrying')) q.reload(); }}>Retry</button></div>}
        {r.status === 'completed' && <iframe title="Report preview" src={`/api/reports/${r.id}/pdf`} style={{ width: '100%', height: '80vh', border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />}
        {r.status === 'completed' && <p className="small muted">Archived with its data snapshot (generated {fmtDateTime(r.finished_at)}). Regenerating creates a new version; old versions stay available. <Link to="/reports">Back to archive</Link></p>}
      </div>
    )}</Async>
  );
}

function Templates() {
  const nav = useNavigate();
  return (
    <div className="stack">
      <PageHead title="Report templates" sub="Saved selections. Weekly templates run on Mondays for the previous week; monthly ones on the 1st for the previous month. Generated reports are saved here — never emailed automatically." />
      <EntityTable entity="report_templates" onRowClick={async (t) => {
        const ok = window.confirm(`Generate "${t.name}" now?`);
        if (!ok) return;
        const today = new Date().toISOString().slice(0, 10);
        const p = presets(today)[t.params?.period ?? 'this_fy'] ?? presets(today).this_fy;
        try {
          const r = await api('/api/reports', { body: { report_type: t.report_type, audience: t.audience, params: { ...t.params, from: p[0], to: p[1] }, template_id: t.id } });
          nav(`/reports/${r.id}`);
        } catch (e) {
          toast((e as Error).message, 'error');
        }
      }} />
    </div>
  );
}
