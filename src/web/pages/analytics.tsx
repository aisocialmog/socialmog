import { useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router';
import Papa from 'papaparse';
import { addDays, formatDate, weekStart } from '../../shared/dates.ts';
import { formatNumberIN } from '../../shared/money.ts';
import { barChart, lineChart, SERIES_CSS, THEME_CSS } from '../../shared/charts.ts';
import { humanize, PLATFORMS } from '../../shared/schema.ts';
import { AnalyseButton, api, Async, attempt, Badge, Card, Chart, DataTable, Empty, fmtDateTime, Modal, PageHead, Stat, toast, useApi, useCan, useMe, useOptions, useToday, type Row } from '../lib.tsx';

const SNAP_FIELDS = ['followers_start', 'followers_end', 'posts', 'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'engagement_rate', 'profile_visits', 'website_clicks', 'avg_views', 'median_views', 'paid_views', 'paid_reach'];
const val = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? <span className="muted">Unavailable</span> : formatNumberIN(v, { decimals: d }));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? <span className="muted">—</span> : <span className={n >= 0 ? 'pos' : 'neg'}>{n >= 0 ? '+' : ''}{n.toFixed(1)}%</span>);

export function Analytics() {
  return (
    <div className="stack">
      <div className="tabs">
        {[['/analytics', 'Weekly overview'], ['/analytics/connections', 'Connections'], ['/analytics/import', 'Manual entry & CSV']].map(([to, l]) => <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'on' : '')}>{l}</NavLink>)}
      </div>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="influencer/:id" element={<InfluencerAnalytics />} />
        <Route path="reports/:id" element={<WeeklyReport />} />
        <Route path="connections" element={<Connections />} />
        <Route path="import" element={<ImportData />} />
      </Routes>
    </div>
  );
}

function Overview() {
  const q = useApi<Row>('/api/analytics/overview');
  const [running, setRunning] = useState(false);
  const nav = useNavigate();
  const canRun = useCan('talent');
  return (
    <div className="stack">
      <PageHead title="Weekly influencer analysis" sub="Every Monday 9:00 IST (configurable) for the week that just ended. Metrics show their period, source and last update; missing data stays unavailable."
        actions={<><AnalyseButton type="influencer_growth" />{canRun && <button className="btn primary" disabled={running} onClick={async () => {
          setRunning(true);
          try {
            const r = await api('/api/analytics/run', { body: {} });
            toast(`${r.made} report(s) generated${r.errors.length ? `, ${r.errors.length} problem(s)` : ''}`, r.errors.length ? 'error' : 'info');
            q.reload();
          } catch (e) {
            toast((e as Error).message, 'error');
          } finally {
            setRunning(false);
          }
        }}>{running ? 'Running…' : 'Run analysis now'}</button>}</>} />
      <Async q={q}>
        {(d) => (
          <div className="stack">
            <div className="row small">
              <Badge tone={d.instagram ? 'good' : ''}>Instagram API: {d.instagram ? 'configured' : 'not connected'}</Badge>
              <Badge tone={d.ai ? 'good' : ''}>AI narrative (OpenAI): {d.ai ? 'configured' : 'not connected — rule-based suggestions are used and labelled'}</Badge>
            </div>
            {d.summary && <AgencySummary s={d.summary} />}
            <DataTable rows={d.rows} viewKey="analytics" onRowClick={(r) => nav(`/analytics/influencer/${r.id}`)} columns={[
              { key: 'name', label: 'Creator', render: (r) => <><strong>{r.name}</strong><div className="small muted">{r.handle}</div></> },
              { key: 'relationship', label: 'Relationship', filter: true, render: (r) => <Badge value={r.relationship} /> },
              { key: 'week', label: 'Latest week', value: (r) => r.latest?.period_start ?? null, render: (r) => (r.latest ? <span className={r.missing_last_week ? 'neg' : ''}>{formatDate(r.latest.period_start)}</span> : <Badge tone="warn">No data</Badge>) },
              { key: 'followers', label: 'Followers', num: true, value: (r) => r.latest?.metrics.followers_end ?? null, render: (r) => val(r.latest?.metrics.followers_end) },
              { key: 'views', label: 'Views (week)', num: true, value: (r) => r.latest?.metrics.views ?? null, render: (r) => val(r.latest?.metrics.views) },
              { key: 'er', label: 'Engagement %', num: true, value: (r) => r.latest?.metrics.engagement_rate ?? null, render: (r) => val(r.latest?.metrics.engagement_rate, 2) },
              { key: 'source', label: 'Source · updated', render: (r) => (r.latest ? <span className="small">{r.latest.source} · {fmtDateTime(r.latest.updated_at ?? r.latest.created_at)}</span> : '—') },
              { key: 'connection', label: 'Instagram link', render: (r) => (r.connection ? <Badge value={r.connection.status} /> : <span className="muted small">Manual / CSV</span>) },
              { key: 'report', label: 'Latest report', render: (r) => (r.report ? <Link to={`/analytics/reports/${r.report.id}`} onClick={(e) => e.stopPropagation()}>Week of {formatDate(r.report.period_start)} (v{r.report.version})</Link> : '—') },
            ]} />
          </div>
        )}
      </Async>
    </div>
  );
}

function AgencySummary({ s }: { s: Row }) {
  const c = s.content;
  return (
    <Card title={`Agency summary — week of ${formatDate(c.period.start)}`} hint={`Generated ${fmtDateTime(s.created_at)}`}>
      <div className="grid two">
        <div>
          <h3>Growth leaders (views vs 4-week baseline)</h3>
          {c.growth_leaders.length ? <ul className="small">{c.growth_leaders.map((g: Row) => <li key={g.id}><Link to={`/analytics/influencer/${g.id}`}>{g.name}</Link> {g.views_vs_baseline >= 0 ? '+' : ''}{g.views_vs_baseline.toFixed(1)}%</li>)}</ul> : <p className="small muted">Not enough data.</p>}
          <h3 style={{ marginTop: 8 }}>Campaign posts published that week</h3>
          {c.campaign_deliverables.length ? <ul className="small">{c.campaign_deliverables.map((x: Row, i: number) => <li key={i}>{x.creator} — {x.title} ({x.campaign}) {x.metrics?.views != null && `· ${formatNumberIN(x.metrics.views)} views`}</li>)}</ul> : <p className="small muted">None.</p>}
        </div>
        <div>
          <h3>Needs attention</h3>
          {c.attention.length ? <ul className="small">{c.attention.map((a: Row) => <li key={a.id}><Link to={`/analytics/influencer/${a.id}`}>{a.name}</Link>: {!a.has_data ? 'no data for the week' : a.flags.map((f: Row) => f.text).join('; ') || `views ${a.views_vs_baseline?.toFixed(1)}% vs baseline`}</li>)}</ul> : <p className="small muted">Nothing flagged.</p>}
        </div>
      </div>
    </Card>
  );
}

function InfluencerAnalytics() {
  const { id } = useParams();
  const q = useApi<Row>(`/api/analytics/influencer/${id}`);
  const [modal, setModal] = useState<null | 'snapshot' | 'post'>(null);
  const [busy, setBusy] = useState(false);
  const today = useToday();
  const nav = useNavigate();
  const canEdit = useCan('talent');
  return (
    <Async q={q}>
      {(d) => {
        const snaps = [...d.snapshots].reverse().filter((s: Row) => s.platform === (d.snapshots[0]?.platform ?? 'instagram'));
        const labels = snaps.map((s: Row) => formatDate(s.period_start, { year: false }));
        const generate = async (period: string, regenerate = false) => {
          setBusy(true);
          try {
            const r = await api('/api/analytics/reports', { body: { influencer_id: Number(id), period_start: period, regenerate } });
            nav(`/analytics/reports/${r.id}`);
          } catch (e) {
            toast((e as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        };
        return (
          <div className="stack">
            <PageHead title={<>{d.influencer.name} — weekly analytics</>} sub={<><Link to={`/influencers/${d.influencer.id}`}>Profile</Link> · {d.connection ? <>Instagram <Badge value={d.connection.status} /> {d.connection.last_sync_at && `· last sync ${fmtDateTime(d.connection.last_sync_at)}`}</> : 'Manual / CSV data'}</>}
              actions={<><AnalyseButton type="influencer_growth" ids={[d.influencer.id]} />{canEdit && <button className="btn" onClick={() => setModal('snapshot')}>Enter a week</button>}{canEdit && <button className="btn" onClick={() => setModal('post')}>Add post</button>}<button className="btn primary" disabled={busy} onClick={() => generate(addDays(weekStart(today), -7))}>{busy ? 'Analysing…' : 'Analyse last week'}</button></>} />
            {snaps.length > 1 ? (
              <div className="grid two">
                <Card title="Followers at week end"><Chart label="Followers" svg={(w) => lineChart({ width: w,  labels, series: [{ name: 'Followers', color: SERIES_CSS[0], values: snaps.map((s: Row) => s.metrics.followers_end ?? null) }], yFormat: (n) => formatNumberIN(n, { compact: true }), interactive: true, theme: THEME_CSS, height: 200 })} table={{ columns: ['Week', 'Followers', 'Source'], rows: snaps.map((s: Row) => [formatDate(s.period_start), s.metrics.followers_end ?? 'Unavailable', s.source]) }} /></Card>
                <Card title="Weekly views"><Chart label="Views" svg={(w) => barChart({ width: w,  categories: labels, series: [{ name: 'Views', color: SERIES_CSS[0], values: snaps.map((s: Row) => s.metrics.views ?? null) }], yFormat: (n) => formatNumberIN(n, { compact: true }), interactive: true, theme: THEME_CSS, height: 200 })} table={{ columns: ['Week', 'Views', 'Source'], rows: snaps.map((s: Row) => [formatDate(s.period_start), s.metrics.views ?? 'Unavailable', s.source]) }} /></Card>
              </div>
            ) : <Empty title="Not enough weekly data for charts" hint="Enter weeks manually, import a CSV, or connect Instagram." />}
            <Card title="Weekly snapshots" hint="Blank = unavailable. Each row keeps its source and update time." flush>
              <DataTable rows={d.snapshots} viewKey="snapshots" columns={[
                { key: 'period_start', label: 'Week', render: (s) => `${formatDate(s.period_start)} – ${formatDate(s.period_end, { year: false })}` },
                { key: 'platform', label: 'Platform', filter: true },
                ...['followers_end', 'follower_change', 'posts', 'views', 'reach', 'engagement_rate', 'median_views', 'paid_views'].map((k) => ({ key: k, label: humanize(k), num: true, value: (s: Row) => s.metrics[k] ?? null, render: (s: Row) => val(s.metrics[k], k === 'engagement_rate' ? 2 : 0) })),
                { key: 'source', label: 'Source', filter: true }, { key: 'updated', label: 'Updated', render: (s) => <span className="small">{fmtDateTime(s.updated_at ?? s.created_at)}</span> },
                { key: 'act', label: '', render: (s) => <button className="btn sm" onClick={(e) => { e.stopPropagation(); generate(s.period_start, true); }}>Analyse</button> },
              ]} />
            </Card>
            <Card title="Weekly reports" flush>
              {d.reports.length ? <table className="table"><tbody>{d.reports.map((r: Row) => <tr key={r.id}><td><Link to={`/analytics/reports/${r.id}`}>Week of {formatDate(r.period_start)}</Link> <span className="small muted">v{r.version} · {r.trigger}</span></td><td><Badge tone={r.ai_status === 'generated' ? 'good' : r.ai_status === 'failed' ? 'bad' : ''}>AI: {humanize(r.ai_status)}</Badge></td><td className="small">{fmtDateTime(r.created_at)}</td></tr>)}</tbody></table> : <Empty title="No reports yet" />}
            </Card>
            <Card title="Posts" hint="Per-post results power median views, top/weak content and pattern detection" flush>
              <DataTable rows={d.posts} viewKey="posts" columns={[
                { key: 'published_at', label: 'Published', render: (p) => formatDate(p.published_at) },
                { key: 'permalink', label: 'Post', render: (p) => (p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer">{p.caption?.slice(0, 40) || 'Open'}</a> : p.caption ?? '—') },
                { key: 'format', label: 'Format', filter: true }, { key: 'topic', label: 'Topic', filter: true },
                { key: 'promotion', label: 'Organic/paid', filter: true, render: (p) => <Badge value={p.promotion ?? 'unknown'} /> },
                { key: 'views', label: 'Views', num: true, value: (p) => p.metrics?.views ?? null, render: (p) => val(p.metrics?.views) },
                { key: 'reach', label: 'Reach', num: true, value: (p) => p.metrics?.reach ?? null, render: (p) => val(p.metrics?.reach) },
                { key: 'source', label: 'Source', filter: true },
              ]} />
            </Card>
            <Modal open={modal === 'snapshot'} onClose={() => setModal(null)} title="Enter weekly metrics">{modal === 'snapshot' && <SnapshotForm influencerId={d.influencer.id} onDone={() => (setModal(null), q.reload())} />}</Modal>
            <Modal open={modal === 'post'} onClose={() => setModal(null)} title="Add post results">{modal === 'post' && <PostForm influencerId={d.influencer.id} onDone={() => (setModal(null), q.reload())} />}</Modal>
          </div>
        );
      }}
    </Async>
  );
}

function SnapshotForm({ influencerId, onDone }: { influencerId?: number; onDone: () => void }) {
  const today = useToday();
  const infs = useOptions('influencers');
  const [v, setV] = useState<Row>({ influencer_id: influencerId, platform: 'instagram', period_start: addDays(weekStart(today), -7), source: 'manual', metrics: {} });
  const [err, setErr] = useState('');
  return (
    <div className="stack">
      <div className="alert info small">Leave a field blank if you don't have it — it will be shown as unavailable, never estimated. The week runs Monday to Sunday.</div>
      {err && <div className="alert bad">{err}</div>}
      <div className="form-grid">
        {!influencerId && <label className="field"><span>Creator</span><select className="input" value={v.influencer_id ?? ''} onChange={(e) => setV({ ...v, influencer_id: Number(e.target.value) })}><option value="">Choose…</option>{infs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>}
        <label className="field"><span>Platform</span><select className="input" value={v.platform} onChange={(e) => setV({ ...v, platform: e.target.value })}>{PLATFORMS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select></label>
        <label className="field"><span>Week starting (Monday)</span><input className="input" type="date" value={v.period_start} onChange={(e) => setV({ ...v, period_start: weekStart(e.target.value) })} /></label>
        <label className="field"><span>Source</span><input className="input" placeholder="e.g. Instagram insights screenshot" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} /></label>
        {SNAP_FIELDS.map((k) => (
          <label key={k} className="field"><span>{humanize(k)}{k === 'engagement_rate' ? ' (%)' : ''}</span><input className="input" type="number" min={0} step={k === 'engagement_rate' ? '0.01' : '1'} value={v.metrics[k] ?? ''} onChange={(e) => setV({ ...v, metrics: { ...v.metrics, [k]: e.target.value === '' ? null : Number(e.target.value) } })} /></label>
        ))}
        <label className="field full"><span>Notes</span><input className="input" value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} /></label>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={async () => {
        try {
          await api('/api/analytics/snapshots', { body: v });
          toast('Week saved');
          onDone();
        } catch (e) {
          setErr((e as Error).message);
        }
      }}>Save week</button></div>
    </div>
  );
}

function PostForm({ influencerId, onDone }: { influencerId: number; onDone: () => void }) {
  const [v, setV] = useState<Row>({ influencer_id: influencerId, platform: 'instagram', promotion: 'unknown', metrics: {}, source: 'manual' });
  const campaigns = useOptions('campaigns');
  const set = (k: string, x: any) => setV({ ...v, [k]: x });
  return (
    <div className="stack">
      <div className="form-grid">
        <label className="field"><span>Post link</span><input className="input" value={v.permalink ?? ''} onChange={(e) => set('permalink', e.target.value)} /></label>
        <label className="field"><span>Published</span><input className="input" type="datetime-local" onChange={(e) => set('published_at', e.target.value)} /></label>
        <label className="field"><span>Format</span><select className="input" value={v.format ?? ''} onChange={(e) => set('format', e.target.value)}><option value="">—</option>{['reel', 'post', 'carousel', 'story', 'video', 'short', 'live'].map((f) => <option key={f}>{f}</option>)}</select></label>
        <label className="field"><span>Topic</span><input className="input" value={v.topic ?? ''} onChange={(e) => set('topic', e.target.value)} /></label>
        <label className="field"><span>Duration (seconds)</span><input className="input" type="number" value={v.duration_sec ?? ''} onChange={(e) => set('duration_sec', e.target.value ? Number(e.target.value) : null)} /></label>
        <label className="field"><span>Organic or paid</span><select className="input" value={v.promotion} onChange={(e) => set('promotion', e.target.value)}><option value="unknown">Unknown</option><option value="organic">Organic</option><option value="paid">Paid promotion</option></select></label>
        <label className="field"><span>Campaign</span><select className="input" value={v.campaign_id ?? ''} onChange={(e) => set('campaign_id', e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        {['views', 'reach', 'likes', 'comments', 'shares', 'saves'].map((k) => <label key={k} className="field"><span>{humanize(k)}</span><input className="input" type="number" min={0} value={v.metrics[k] ?? ''} onChange={(e) => set('metrics', { ...v.metrics, [k]: e.target.value === '' ? null : Number(e.target.value) })} /></label>)}
        <label className="field"><span>Source</span><input className="input" value={v.source} onChange={(e) => set('source', e.target.value)} /></label>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={async () => { if (await attempt(() => api('/api/analytics/posts', { body: v }), 'Post saved')) onDone(); }}>Save post</button></div>
    </div>
  );
}

function WeeklyReport() {
  const { id } = useParams();
  const q = useApi<Row>(`/api/analytics/reports/${id}`);
  const me = useMe();
  const nav = useNavigate();
  return (
    <Async q={q}>
      {({ row, versions }) => {
        const c = row.content;
        const save = (body: Row, msg = 'Saved') => attempt(() => api(`/api/analytics/reports/${row.id}`, { method: 'PATCH', body }), msg).then((ok) => ok && q.reload());
        if (!row.influencer_id) return <AgencySummary s={row} />;
        return (
          <div className="stack">
            <PageHead title={<>{row.name} — week of {formatDate(c.period.start)}</>} sub={<>{c.platform} · source: {c.source ?? 'no data'} · updated {fmtDateTime(c.updated_at)} · version {row.version} ({row.trigger}) · <Badge tone={c.ai.status === 'generated' ? 'good' : c.ai.status === 'failed' ? 'bad' : ''}>AI {humanize(c.ai.status)}{c.ai.model ? ` · ${c.ai.model}` : ''}</Badge></>}
              actions={<>
                <button className="btn" onClick={async () => { try { const r = await api('/api/analytics/reports', { body: { influencer_id: row.influencer_id, period_start: c.period.start, regenerate: true } }); nav(`/analytics/reports/${r.id}`); } catch (e) { toast((e as Error).message, 'error'); } }}>Regenerate</button>
                <button className="btn primary" onClick={async () => { try { const r = await api('/api/reports', { body: { report_type: 'influencer_growth', audience: 'internal', params: { influencer_id: row.influencer_id, from: addDays(c.period.start, -56), to: c.period.end } } }); nav(`/reports/${r.id}`); } catch (e) { toast((e as Error).message, 'error'); } }}>PDF report</button>
                <Link className="btn" to={`/analytics/influencer/${row.influencer_id}`}>All weeks</Link>
              </>} />
            {c.ai.status === 'failed' && <div className="alert warn small">AI narrative failed ({c.ai.error}); rule-based suggestions are shown instead.</div>}
            {c.flags.length > 0 && <div className="stack tight">{c.flags.map((f: Row, i: number) => <div key={i} className={`alert small ${f.level === 'high' ? 'bad' : f.level === 'medium' ? 'warn' : ''}`}>{f.text}</div>)}</div>}
            <Card title="Summary"><p>{c.summary}</p></Card>
            <Card title="This week vs last week and 4-week baseline" hint={`${formatDate(c.period.start)} – ${formatDate(c.period.end)} · ${c.source ?? 'no source'}`} flush>
              <table className="table">
                <thead><tr><th>Metric</th><th className="num">This week</th><th className="num">Last week</th><th className="num">Change</th><th className="num">4-week avg</th><th className="num">vs baseline</th></tr></thead>
                <tbody>{c.metrics.map((m: Row) => <tr key={m.key}><td>{m.label}</td><td className="num">{val(m.current, m.key === 'engagement_rate' ? 2 : 0)}</td><td className="num">{val(m.previous, m.key === 'engagement_rate' ? 2 : 0)}</td><td className="num">{pct(m.change_pct)}</td><td className="num">{m.baseline === null ? <span className="muted">—</span> : formatNumberIN(m.baseline, { decimals: m.key === 'engagement_rate' ? 2 : 0 })} <span className="small muted">({m.baseline_weeks}w)</span></td><td className="num">{pct(m.change_vs_baseline_pct)}</td></tr>)}</tbody>
              </table>
            </Card>
            <div className="grid">
              <Stat label="Median views per post" value={val(c.median_views.value)} foot={c.median_views.basis} />
              <Stat label="Average views per post" value={val(c.avg_views)} foot="Shown with the median: one viral post skews the average" />
              {c.organic_vs_paid && <Stat label="Organic vs paid post views" value={<>{val(c.organic_vs_paid.organic_post_views)} / {val(c.organic_vs_paid.paid_post_views)}</>} foot={`Unknown: ${formatNumberIN(c.organic_vs_paid.unknown_post_views)}`} />}
            </div>
            <div className="grid two">
              <Card title="Strongest content" flush><ContentList items={c.top_content} /></Card>
              <Card title="Weakest content" flush><ContentList items={c.weak_content} /></Card>
            </div>
            <div className="grid two">
              <Card title="What the data shows" hint="Observed findings only">
                <ul className="small">{[...c.observations, ...c.patterns].map((o: string, i: number) => <li key={i}>{o}</li>)}</ul>
                {!c.patterns.length && <p className="small muted">No format/topic/duration/time patterns: each group needs at least 2 posts.</p>}
              </Card>
              <Card title="Hypotheses" hint="Possible explanations — not proven by the data">
                {c.hypotheses.length ? <ul className="small">{c.hypotheses.map((h: string, i: number) => <li key={i}>{h}</li>)}</ul> : <p className="small muted">None.</p>}
              </Card>
            </div>
            <Card title="Three actions for next week" hint={c.recommendations_source === 'ai' ? 'Drafted by AI from the numbers above' : 'Rule-based suggestions (AI not connected or unavailable)'}>
              <ol>{c.recommendations.map((r: Row, i: number) => <li key={i}><strong>{r.action}</strong> <span className="small muted">— {r.rationale}</span></li>)}</ol>
              <h3 style={{ marginTop: 10 }}>Action checklist</h3>
              <div className="stack tight">{(row.checklist ?? []).map((it: Row, i: number) => <label key={i} className="check"><input type="checkbox" checked={!!it.done} onChange={(e) => save({ checklist: row.checklist.map((x: Row, j: number) => (j === i ? { ...x, done: e.target.checked } : x)) }, 'Updated')} /> {it.text}</label>)}</div>
            </Card>
            {c.previous_review.length > 0 && <Card title="Last week's recommendations vs results"><ul className="small">{c.previous_review.map((r: Row, i: number) => <li key={i}><strong>{r.action}</strong>: {r.outcome}</li>)}</ul></Card>}
            <div className="grid two">
              <Card title="Manager notes"><Notes value={row.manager_notes} onSave={(t) => save({ manager_notes: t })} /></Card>
              <Card title="Founder notes">{me.user.role === 'founder' ? <Notes value={row.founder_notes} onSave={(t) => save({ founder_notes: t })} /> : <p className="pre">{row.founder_notes ?? '—'}</p>}</Card>
            </div>
            <Card title="Versions" hint="Each regeneration is kept">{versions.map((v: Row) => <div key={v.id} className="small"><Link to={`/analytics/reports/${v.id}`}>v{v.version}</Link> · {v.trigger} · {fmtDateTime(v.created_at)} · AI {humanize(v.ai_status)}</div>)}</Card>
          </div>
        );
      }}
    </Async>
  );
}

function ContentList({ items }: { items: Row[] }) {
  if (!items.length) return <Empty title="No per-post data" hint="Add posts to see strongest and weakest content." />;
  return <table className="table"><tbody>{items.map((p) => <tr key={p.id}><td>{p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer">{p.topic ?? p.format ?? 'Post'}</a> : p.topic ?? 'Post'}<div className="small muted">{p.format} · {formatDate(p.published_at)}{p.duration_sec ? ` · ${p.duration_sec}s` : ''} · {p.promotion}</div></td><td className="num">{formatNumberIN(p.views)} views<div className="small muted">{p.engagement_rate === null ? '' : `${p.engagement_rate}% eng.`}</div></td></tr>)}</tbody></table>;
}

function Notes({ value, onSave }: { value: string | null; onSave: (t: string) => void }) {
  const [t, setT] = useState(value ?? '');
  return <div className="stack tight"><textarea className="input" value={t} onChange={(e) => setT(e.target.value)} /><div><button className="btn sm" disabled={t === (value ?? '')} onClick={() => onSave(t)}>Save notes</button></div></div>;
}

function Connections() {
  const q = useApi<Row>('/api/integrations/status');
  const infs = useOptions('influencers');
  const [invite, setInvite] = useState<Row | null>(null);
  const [who, setWho] = useState('');
  const canEdit = useCan('talent');
  return (
    <Async q={q}>
      {(d) => (
        <div className="stack">
          <PageHead title="Connections" sub="Instagram accounts authorised through Meta's official login. Socialmog never asks for Instagram passwords." />
          <div className="grid two">
            <Card title="Instagram (Meta)">
              {d.instagram.configured ? (
                <div className="stack tight small">
                  <Badge tone="good">Configured</Badge>
                  <div>Redirect URI to register in the Meta app: <code>{d.instagram.redirect_uri}</code></div>
                  <div>Permissions requested: {d.instagram.scopes}</div>
                </div>
              ) : (
                <div className="stack tight small">
                  <Badge>Not connected</Badge>
                  <p>To enable: create a Meta app with "Instagram API with Instagram Login", add <code>META_APP_ID</code>, <code>META_APP_SECRET</code>, <code>APP_BASE_URL</code> and a strong <code>APP_SECRET</code> to the server environment, register <code>{'{APP_BASE_URL}'}/oauth/instagram/callback</code> as the redirect URI, then restart. Until then, use manual entry or CSV import.</p>
                </div>
              )}
            </Card>
            <Card title="AI analysis (OpenAI)">
              <div className="small stack tight">
                {d.openai.configured ? <><Badge tone="good">Configured</Badge><div>Model: {d.openai.model}. AI writes summaries, hypotheses and the three actions from computed metrics; it never calculates figures.</div></> : <><Badge>Not connected</Badge><div>Set <code>OPENAI_API_KEY</code> (and optionally <code>OPENAI_MODEL</code>) on the server. Without it, reports use clearly labelled rule-based suggestions.</div></>}
                <div className="muted">{d.email.note}</div>
              </div>
            </Card>
          </div>
          {canEdit && d.instagram.configured && (
            <Card title="Connect an account" hint="Creates a single-use link valid for 7 days. Send it yourself — nothing is sent automatically.">
              <div className="row">
                <select className="input" style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose roster profile…</option>{infs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                <button className="btn primary" disabled={!who} onClick={async () => { try { setInvite(await api('/api/integrations/instagram/invite', { body: { influencer_id: Number(who) } })); } catch (e) { toast((e as Error).message, 'error'); } }}>Create link</button>
              </div>
              {invite && (
                <div className="stack tight" style={{ marginTop: 10 }}>
                  <input className="input" readOnly value={invite.link} onFocus={(e) => e.target.select()} />
                  <div className="row">
                    <button className="btn sm" onClick={() => navigator.clipboard.writeText(invite.link).then(() => toast('Link copied'))}>Copy link</button>
                    <a className="btn sm" href={`mailto:?subject=${encodeURIComponent('Connect your Instagram to Socialmog')}&body=${encodeURIComponent(`Hi! Please connect your Instagram professional account so we can prepare your weekly report:\n\n${invite.link}\n\nYou'll sign in on Instagram's own page. We never ask for your password.`)}`}>Open in my email app</a>
                    <a className="btn sm" href={invite.authorize_url} target="_blank" rel="noreferrer">Authorise now (Socialmog-owned account)</a>
                  </div>
                </div>
              )}
            </Card>
          )}
          <Card title="Accounts" flush>
            {d.accounts.length ? (
              <table className="table">
                <thead><tr><th>Profile</th><th>Instagram</th><th>Status</th><th>Last sync</th><th>Available metrics</th><th /></tr></thead>
                <tbody>{d.accounts.map((a: Row) => (
                  <tr key={a.id}>
                    <td>{a.influencer_id ? <Link to={`/analytics/influencer/${a.influencer_id}`}>{a.name}</Link> : '—'}</td>
                    <td>{a.username ? `@${a.username}` : <span className="muted">Pending</span>}</td>
                    <td><Badge value={a.status} />{a.status === 'invited' && a.invite_expires_at && <div className="small muted">link expires {fmtDateTime(a.invite_expires_at)}</div>}{a.token_expires_at && <div className="small muted">token renews before {formatDate(a.token_expires_at)}</div>}</td>
                    <td className="small">{a.last_sync_at ? `${fmtDateTime(a.last_sync_at)} · ${a.last_sync_status}` : 'Never'}{a.last_error && <div className="neg">{a.last_error}</div>}</td>
                    <td className="small">{a.available_metrics?.join(', ') ?? '—'}</td>
                    <td className="nowrap">{canEdit && a.status === 'connected' && <><button className="btn sm" onClick={async () => { if (await attempt(() => api(`/api/integrations/instagram/${a.id}/sync`, { body: {} }), 'Synced last week')) q.reload(); else q.reload(); }}>Sync now</button><button className="btn ghost sm" onClick={async () => { if (await attempt(() => api(`/api/integrations/instagram/${a.id}/disconnect`, { body: {} }), 'Disconnected')) q.reload(); }}>Disconnect</button></>}{canEdit && ['expired', 'error', 'revoked'].includes(a.status) && <span className="small">Create a new link to reconnect</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <Empty title="No connected accounts" hint="Connected accounts sync automatically before each weekly analysis." />}
          </Card>
        </div>
      )}
    </Async>
  );
}

function ImportData() {
  const [kind, setKind] = useState<'snapshots' | 'posts'>('snapshots');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [result, setResult] = useState<Row | null>(null);
  const [manual, setManual] = useState(false);
  const headers = kind === 'snapshots' ? ['influencer', 'platform', 'week_start', ...SNAP_FIELDS] : ['influencer', 'platform', 'permalink', 'external_id', 'published_at', 'format', 'topic', 'duration_sec', 'promotion', 'views', 'reach', 'likes', 'comments', 'shares', 'saves'];
  return (
    <div className="stack">
      <PageHead title="Manual entry & CSV import" sub="Use for accounts that can't connect, or for other platforms. Blank cells stay unavailable." actions={<button className="btn primary" onClick={() => setManual(true)}>Enter a week manually</button>} />
      <Card title="Import CSV">
        <div className="stack">
          <div className="seg">{(['snapshots', 'posts'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => (setKind(k), setRows(null), setResult(null))}>{k === 'snapshots' ? 'Weekly snapshots' : 'Post results'}</button>)}</div>
          <p className="small">Columns: <code>{headers.join(', ')}</code>. <code>influencer</code> is the creator's name or handle. <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(headers.join(',') + '\n')}`} download={`${kind}-template.csv`}>Download template</a></p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) Papa.parse<Row>(f, { header: true, skipEmptyLines: true, complete: (r) => (setRows(r.data), setResult(null)) }); }} />
          {rows && <p className="small">{rows.length} rows read. First row: <code>{JSON.stringify(rows[0]).slice(0, 200)}</code></p>}
          {result && <div className={`alert ${result.errors.length ? 'warn' : 'good'}`}>Imported {result.imported}, updated {result.updated}{result.errors.length ? `, ${result.errors.length} errors: ${result.errors.slice(0, 4).map((e: Row) => `row ${e.row}: ${e.error}`).join('; ')}` : ''}</div>}
          <div><button className="btn primary" disabled={!rows?.length} onClick={async () => { try { setResult(await api('/api/analytics/import', { body: { kind, rows } })); } catch (e) { toast((e as Error).message, 'error'); } }}>Import</button></div>
        </div>
      </Card>
      <Modal open={manual} onClose={() => setManual(false)} title="Enter weekly metrics">{manual && <SnapshotForm onDone={() => setManual(false)} />}</Modal>
    </div>
  );
}
