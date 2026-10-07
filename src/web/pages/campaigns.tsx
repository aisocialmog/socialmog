import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { formatDate } from '../../shared/dates.ts';
import { formatINR, formatNumberIN } from '../../shared/money.ts';
import { barChart, SERIES_CSS, THEME_CSS } from '../../shared/charts.ts';
import { CAMPAIGN_STAGES, humanize } from '../../shared/schema.ts';
import {
  Activity, api, ArchiveButton, Async, attempt, Badge, Card, Chart, DataTable, DemoTag, Details, Empty, EntityForm, EntityTable, invalidate, Kanban, Modal, Money,
  PageHead, Stat, Tabs, Timeline, useApi, useCan, useToday, type Row,
} from '../lib.tsx';
import { LinkedDocuments } from './influencers.tsx';

export function Campaigns() {
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') ?? 'table';
  const q = useApi<{ rows: Row[] }>('/api/e/campaigns');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const canEdit = useCan('campaigns');
  return (
    <div className="stack">
      <PageHead title="Campaigns" sub="Operational stage and financial closure are tracked separately"
        actions={<><div className="seg">{['table', 'board', 'health'].map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setSp({ view: v })}>{humanize(v)}</button>)}</div>{canEdit && <button className="btn primary" onClick={() => setCreating(true)}>New campaign</button>}</>} />
      {view === 'health' ? <Health /> : view === 'board' ? (
        <Async q={q}>{(d) => (
          <Kanban stages={CAMPAIGN_STAGES} items={d.rows} stageOf={(c) => c.stage} canMove={canEdit} onMove={async (c, stage) => {
            if (await attempt(() => api(`/api/e/campaigns/${c.id}`, { method: 'PATCH', body: { stage } }), `Moved to ${humanize(stage)}`)) q.reload();
          }} card={(c) => <><Link to={`/campaigns/${c.id}`} className="strong">{c.name}</Link><span className="small muted">{c.brand_id_label} · ends {formatDate(c.end_date)} <DemoTag row={c} /></span>{c.client_budget != null && <span className="small">Budget <Money p={c.client_budget} /></span>}</>} />
        )}</Async>
      ) : (
        <EntityTable entity="campaigns" overrides={{ name: { render: (r) => <><strong>{r.name}</strong> <DemoTag row={r} /></> } }} />
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New campaign"><EntityForm entity="campaigns" onSaved={(r) => nav(`/campaigns/${r.id}`)} /></Modal>
    </div>
  );
}

function Health() {
  const q = useApi<{ rows: Row[] }>('/api/campaigns-health');
  const canFin = useCan('campaign_finance');
  return (
    <Async q={q}>{(d) => d.rows.length ? (
      <div className="grid wide">
        {d.rows.map((c) => (
          <Link key={c.id} to={`/campaigns/${c.id}`} className="card stack tight" style={{ color: 'inherit', textDecoration: 'none', borderLeft: `4px solid ${c.health === 'red' ? 'var(--critical)' : c.health === 'amber' ? 'var(--series-4)' : 'var(--good)'}` }}>
            <div className="row between"><strong>{c.name}</strong><Badge value={c.health}>{c.health === 'green' ? 'On track' : c.health === 'amber' ? 'Watch' : 'At risk'}</Badge></div>
            <div className="small muted">{c.brand_name} · <Badge value={c.stage} /> · ends {formatDate(c.end_date)}</div>
            <div className="small">Deliverables {c.live}/{c.deliverables} live · {c.overdue} overdue · {c.pending_approvals} awaiting approval</div>
            {canFin && c.finance && <div className="small">Budget <Money p={c.finance.client_budget} /> · committed <Money p={c.finance.committed_cost} /> · margin {c.finance.margin_bps === null ? '—' : `${(c.finance.margin_bps / 100).toFixed(1)}%`}<br />To collect <Money p={c.finance.receivable_outstanding} /> · to pay <Money p={c.finance.unpaid_cost} /></div>}
            {c.flags.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{c.flags.map((f: Row, i: number) => <li key={i} style={{ color: f.level === 'red' ? 'var(--bad)' : 'var(--warn)' }}>{f.text}</li>)}</ul>}
          </Link>
        ))}
      </div>
    ) : <Empty title="No active campaigns" />}</Async>
  );
}

export function CampaignPage() {
  const { id } = useParams();
  const q = useApi<Row>(`/api/campaigns/${id}/overview`);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState<null | 'edit' | 'creator' | 'deliverable' | 'task' | string>(null);
  const canEdit = useCan('campaigns');
  const canRates = useCan('rates');
  const today = useToday();
  const nav = useNavigate();
  return (
    <Async q={q}>
      {(d) => {
        const c = d.row;
        const f = d.finance;
        const stageIdx = CAMPAIGN_STAGES.indexOf(c.stage);
        return (
          <div className="stack">
            <PageHead title={<>{c.name} <DemoTag row={c} /></>} sub={<><Link to={`/brands/${c.brand_id}`}>{c.brand_id_label}</Link> · {humanize(c.billing_model)} · owner {c.owner_id_label ?? '—'} · {formatDate(c.start_date)} – {formatDate(c.end_date)}{c.deal_id && <> · from <Link to={`/deals/${c.deal_id}`}>deal</Link></>}</>}
              actions={<>{canEdit && <select className="input" style={{ width: 'auto' }} value={c.stage} aria-label="Stage" onChange={async (e) => { if (await attempt(() => api(`/api/e/campaigns/${c.id}`, { method: 'PATCH', body: { stage: e.target.value } }), 'Stage updated')) q.reload(); }}>{CAMPAIGN_STAGES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>}
                <Link className="btn" to={`/reports?type=campaign&campaign_id=${c.id}`}>Report</Link>
                {canEdit && <button className="btn" onClick={() => setModal('edit')}>Edit</button>}<ArchiveButton entity="campaigns" row={c} onDone={() => nav('/campaigns')} /></>} />
            <div className="row small" aria-label="Stage progress">{CAMPAIGN_STAGES.map((s, i) => <span key={s} className={`badge ${i < stageIdx ? 'good' : i === stageIdx ? 'info' : ''}`}>{humanize(s)}</span>)}</div>
            {f && (
              <div className={`alert ${f.financially_closed ? 'good' : 'warn'} small`}>
                Financial status: {f.financially_closed ? 'all collections and payouts settled.' : <>still to collect <strong>{formatINR(f.receivable_outstanding)}</strong> from the brand and to pay <strong>{formatINR(f.unpaid_cost)}</strong> to creators/editors/vendors — independent of the operational stage.</>}
              </div>
            )}
            {d.health?.flags.length > 0 && <div className="alert bad small">{d.health.flags.map((x: Row) => x.text).join(' · ')}</div>}
            {f && (
              <div className="grid">
                <Stat label="Client budget" value={<Money p={f.client_budget} />} foot={f.billing_model === 'commission' ? 'Commission campaign' : undefined} />
                <Stat label="Revenue (ex-tax)" value={<Money p={f.revenue} />} foot={f.revenue_basis} />
                <Stat label="Planned / committed / paid" value={<span className="num">{formatINR(f.planned_cost, { compact: true })} / {formatINR(f.committed_cost, { compact: true })} / {formatINR(f.paid_cost, { compact: true })}</span>} foot={f.over_budget ? 'Committed exceeds client budget' : 'Costs shown separately, never added together'} />
                <Stat label="Contribution margin" value={<Money p={f.contribution_margin} />} foot={f.margin_bps === null ? undefined : `${(f.margin_bps / 100).toFixed(1)}% · agency earnings ${formatINR(f.agency_earnings)}`} />
                <Stat label="Collected / paid out" value={<span className="num">{formatINR(f.collected, { compact: true })} / {formatINR(f.paid_cost, { compact: true })}</span>} foot={`Payment exposure ${formatINR(f.payment_exposure)} · funding gap ${formatINR(f.funding_gap)}`} />
              </div>
            )}
            <Tabs value={tab} onChange={setTab} tabs={[
              { key: 'overview', label: 'Overview' }, { key: 'roster', label: `Creators (${d.roster.length})` }, { key: 'deliverables', label: `Deliverables (${d.deliverables.length})` },
              { key: 'content', label: `Content (${d.tasks.length})` }, ...(f ? [{ key: 'finance', label: 'Finance' }] : []), { key: 'results', label: 'Results' },
              { key: 'approvals', label: 'Approvals' }, { key: 'documents', label: 'Documents' }, { key: 'notes', label: 'Notes' }, { key: 'activity', label: 'Activity' },
            ]} />
            {tab === 'overview' && (
              <div className="grid two">
                <Card title="Brief & details"><Details entity="campaigns" row={c} only={['objective', 'brief', 'start_date', 'end_date', 'owner_id', 'billing_model', 'lessons', 'notes']} /></Card>
                <div className="stack">
                  <Card title="Agreed targets vs results"><Targets targets={c.kpi_targets} deliverables={d.deliverables} /></Card>
                  {f && <ScopeChanges c={c} />}
                </div>
              </div>
            )}
            {tab === 'roster' && (
              <Card title="Creator roster" hint={c.billing_model === 'gross' ? 'Confirmed creators with a fee become payables automatically.' : 'Commission campaign: creators are paid by the brand directly.'} actions={canEdit && <button className="btn sm" onClick={() => setModal('creator')}>Add creator</button>} flush>
                <DataTable rows={d.roster} viewKey="campaign-roster" onRowClick={(r) => setModal(`cc:${r.id}`)} columns={[
                  { key: 'influencer_name', label: 'Creator', render: (r) => <Link to={`/influencers/${r.influencer_id}`} onClick={(e) => e.stopPropagation()}>{r.influencer_name}</Link> },
                  { key: 'status', label: 'Status', filter: true, render: (r) => <Badge value={r.status} /> },
                  ...(canRates ? [{ key: 'fee', label: 'Negotiated cost', num: true, render: (r: Row) => <Money p={r.fee} /> }] : []),
                  { key: 'payout_due', label: 'Payout due', render: (r) => formatDate(r.payout_due) },
                  { key: 'payment_terms', label: 'Terms' },
                  { key: 'deliverables', label: 'Deliverables', value: (r) => d.deliverables.filter((x: Row) => x.influencer_id === r.influencer_id).length },
                ]} />
              </Card>
            )}
            {tab === 'deliverables' && (
              <Card title="Deliverables" actions={canEdit && <button className="btn sm" onClick={() => setModal('deliverable')}>Add deliverable</button>} flush>
                <DataTable rows={d.deliverables} viewKey="campaign-deliverables" onRowClick={(r) => setModal(`dl:${r.id}`)} columns={[
                  { key: 'title', label: 'Deliverable' }, { key: 'influencer_id_label', label: 'Creator', filter: true }, { key: 'type', label: 'Type', render: (r) => humanize(r.type) },
                  { key: 'status', label: 'Status', filter: true, render: (r) => <Badge value={r.status} /> }, { key: 'due_date', label: 'Due', render: (r) => <span className={r.due_date && r.status !== 'live' && r.status !== 'cancelled' && r.due_date < today ? 'neg' : ''}>{formatDate(r.due_date)}</span> },
                  { key: 'publish_date', label: 'Published', render: (r) => formatDate(r.publish_date) },
                  { key: 'live_url', label: 'Live link', render: (r) => (r.live_url ? <a href={r.live_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open</a> : '—') },
                ]} />
              </Card>
            )}
            {tab === 'content' && (
              <Card title="Content tasks" actions={canEdit && <button className="btn sm" onClick={() => setModal('task')}>New content task</button>} flush>
                <DataTable rows={d.tasks} viewKey="campaign-content" onRowClick={(r) => nav(`/content/${r.id}`)} columns={[
                  { key: 'title', label: 'Task' }, { key: 'influencer_id_label', label: 'Creator' }, { key: 'editor_id_label', label: 'Editor', filter: true },
                  { key: 'stage', label: 'Stage', filter: true, render: (r) => <Badge value={r.stage} /> }, { key: 'due_date', label: 'Due', render: (r) => formatDate(r.due_date) },
                  { key: 'blocked_reason', label: 'Blocked', render: (r) => (r.blocked_reason ? <Badge tone="warn">{r.blocked_reason}</Badge> : '') },
                ]} />
              </Card>
            )}
            {tab === 'finance' && f && <CampaignFinance d={d} />}
            {tab === 'results' && <Results d={d} />}
            {tab === 'approvals' && (
              <Card title="Approval history" flush>
                {d.approvals.length ? <table className="table"><tbody>{d.approvals.map((a: Row) => <tr key={a.id}><td className="small nowrap">{formatDate(a.created_at)}</td><td><Link to={`/content/${a.entity_id}`}>{a.title}</Link></td><td>{a.body}</td><td className="small muted">{a.user_name}</td></tr>)}</tbody></table> : <Empty title="No approvals yet" />}
              </Card>
            )}
            {tab === 'documents' && <LinkedDocuments entity="campaigns" id={c.id} docs={d.documents} />}
            {tab === 'notes' && <Card><Timeline entity="campaigns" id={c.id} /></Card>}
            {tab === 'activity' && <Card><Activity entity="campaigns" id={c.id} /></Card>}
            <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit campaign"><EntityForm entity="campaigns" record={c} onSaved={() => (setModal(null), q.reload())} /></Modal>
            <Modal open={modal === 'creator'} onClose={() => setModal(null)} title="Add creator to roster"><EntityForm entity="campaign_creators" initial={{ campaign_id: c.id }} onSaved={() => (setModal(null), q.reload(), invalidate('/api/finance'))} /></Modal>
            <Modal open={modal === 'deliverable'} onClose={() => setModal(null)} title="Add deliverable"><EntityForm entity="deliverables" initial={{ campaign_id: c.id }} onSaved={() => (setModal(null), q.reload())} /></Modal>
            <Modal open={modal === 'task'} onClose={() => setModal(null)} title="New content task"><EntityForm entity="content_tasks" initial={{ campaign_id: c.id }} onSaved={(r) => nav(`/content/${r.id}`)} /></Modal>
            {typeof modal === 'string' && modal.startsWith('cc:') && <Modal open onClose={() => setModal(null)} title="Roster entry"><EntityForm entity="campaign_creators" record={d.roster.find((r: Row) => `cc:${r.id}` === modal)} onSaved={() => (setModal(null), q.reload(), invalidate('/api/finance'))} /></Modal>}
            {typeof modal === 'string' && modal.startsWith('dl:') && <Modal open onClose={() => setModal(null)} title="Deliverable"><EntityForm entity="deliverables" record={d.deliverables.find((r: Row) => `dl:${r.id}` === modal)} onSaved={() => (setModal(null), q.reload())} /></Modal>}
          </div>
        );
      }}
    </Async>
  );
}

function ScopeChanges({ c }: { c: Row }) {
  const changes: Row[] = c.scope_changes ?? [];
  const approved = changes.filter((x) => x.status === 'approved');
  const cost = approved.reduce((s, x) => s + (x.cost_impact ?? 0), 0);
  const rev = approved.reduce((s, x) => s + (x.revenue_impact ?? 0), 0);
  return (
    <Card title="Scope changes" hint="Edit the campaign to add one. Approved changes: margin effect = revenue impact − cost impact.">
      {changes.length ? (
        <div className="stack tight">
          <table className="table"><tbody>{changes.map((x, i) => <tr key={i}><td className="small nowrap">{formatDate(x.date)}</td><td>{x.description}</td><td><Badge value={x.status} /></td><td className="num small">cost <Money p={x.cost_impact ?? 0} /><br />revenue <Money p={x.revenue_impact ?? 0} /></td><td className="small">{x.days_impact ? `+${x.days_impact} days` : ''}</td></tr>)}</tbody></table>
          <div className="small">Approved effect on margin: <Money p={rev - cost} signed /> · timeline +{approved.reduce((s, x) => s + (x.days_impact ?? 0), 0)} days. Add matching payables/receivables so cash forecasts include them.</div>
        </div>
      ) : <Empty title="No scope changes" />}
    </Card>
  );
}

function CampaignFinance({ d }: { d: Row }) {
  const f = d.finance;
  const cats = ['creator', 'editing', 'production', 'other'];
  const nav = useNavigate();
  return (
    <div className="stack">
      <Card title="Planned vs committed vs actual" hint="Planned = budget allocation. Committed = payables + direct spend. Paid = settled. These are separate views of the same costs, not added together.">
        <Chart label="Planned, committed and paid cost by category" svg={(w) => barChart({ width: w,  categories: cats.map(humanize), series: [{ name: 'Planned', color: SERIES_CSS[0], values: cats.map((k) => f.planned_by[k]) }, { name: 'Committed', color: SERIES_CSS[1], values: cats.map((k) => f.committed_by[k]) }, { name: 'Paid', color: SERIES_CSS[2], values: cats.map((k) => f.paid_by[k]) }], yFormat: (n) => formatINR(n, { compact: true }), interactive: true, theme: THEME_CSS, height: 220 })}
          table={{ columns: ['Category', 'Planned', 'Committed', 'Paid'], rows: cats.map((k) => [humanize(k), formatINR(f.planned_by[k]), formatINR(f.committed_by[k]), formatINR(f.paid_by[k])]) }} />
        <table className="table" style={{ marginTop: 12 }}>
          <thead><tr><th>Category</th><th className="num">Planned</th><th className="num">Committed</th><th className="num">Paid</th><th className="num">Variance (committed − planned)</th></tr></thead>
          <tbody>{cats.map((k) => <tr key={k}><td>{humanize(k)}</td><td className="num"><Money p={f.planned_by[k]} /></td><td className="num"><Money p={f.committed_by[k]} /></td><td className="num"><Money p={f.paid_by[k]} /></td><td className="num"><Money p={f.committed_by[k] - f.planned_by[k]} signed /></td></tr>)}</tbody>
          <tfoot><tr><td>Total</td><td className="num"><Money p={f.planned_cost} /></td><td className="num"><Money p={f.committed_cost} /></td><td className="num"><Money p={f.paid_cost} /></td><td className="num"><Money p={f.committed_cost - f.planned_cost} signed /></td></tr></tfoot>
        </table>
      </Card>
      <div className="grid two">
        <Card title="Incoming milestones & invoices" flush>
          <DataTable rows={d.invoices} viewKey="campaign-invoices" onRowClick={(r) => nav(`/finance/receivables/${r.id}`)} columns={[
            { key: 'label', label: 'Milestone' }, { key: 'number', label: 'Invoice', render: (r) => r.number ?? <span className="muted">Scheduled</span> }, { key: 'expected_date', label: 'Expected', render: (r) => formatDate(r.expected_date) },
            { key: 'confidence', label: 'Confidence', render: (r) => <Badge value={r.confidence} /> }, { key: 'total', label: 'Total', num: true, render: (r) => <Money p={r.total} /> }, { key: 'outstanding', label: 'Outstanding', num: true, render: (r) => <Money p={r.outstanding} /> },
          ]} />
        </Card>
        <Card title="Payouts" flush>
          <DataTable rows={d.obligations} viewKey="campaign-payouts" onRowClick={(r) => nav(`/finance/payables/${r.id}`)} columns={[
            { key: 'description', label: 'Payable' }, { key: 'payee', label: 'Payee' }, { key: 'due_date', label: 'Due', render: (r) => formatDate(r.due_date) },
            { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> }, { key: 'amount', label: 'Amount', num: true, render: (r) => <Money p={r.amount} /> }, { key: 'outstanding', label: 'Outstanding', num: true, render: (r) => <Money p={r.outstanding} /> },
            { key: 'earmarked', label: 'Earmarked', num: true, render: (r) => <Money p={r.earmarked} /> },
          ]} />
        </Card>
      </div>
      <div className="alert info small">Collected {formatINR(f.collected)} and paid {formatINR(f.paid_cost)} are based on records linked to this campaign. Bank money is pooled, so funds are only reserved for this campaign where an earmark exists ({formatINR(f.earmarked)}; funding gap {formatINR(f.funding_gap)}). <Link to="/finance/allocations">Manage allocations</Link></div>
    </div>
  );
}

const METRICS = ['views', 'likes', 'comments', 'shares', 'saves', 'clicks', 'conversions'];
function Results({ d }: { d: Row }) {
  const rows = d.deliverables.filter((x: Row) => x.metrics);
  const sum = (k: string) => {
    const vals = rows.map((x: Row) => x.metrics[k]).filter((v: unknown) => typeof v === 'number');
    return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) : null;
  };
  return (
    <div className="stack">
      <div className="alert info small">Views and interactions are counts of events and can be totalled. Reach is unique people per creator and audiences overlap, so reach is shown per deliverable and never summed. Sales/ROI appear only when conversions and revenue are recorded with a source.</div>
      <div className="grid">{METRICS.map((k) => <Stat key={k} label={`Total ${k}`} value={sum(k) === null ? <span className="muted">Unavailable</span> : formatNumberIN(sum(k))} foot={d.row.kpi_targets?.[k] ? `Target ${formatNumberIN(d.row.kpi_targets[k])}` : undefined} />)}</div>
      <Card title="By creator and deliverable" flush>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Deliverable</th><th>Creator</th>{['reach', ...METRICS].map((k) => <th key={k} className="num">{humanize(k)}</th>)}<th>Source · as of</th></tr></thead>
              <tbody>{rows.map((x: Row) => <tr key={x.id}><td>{x.live_url ? <a href={x.live_url} target="_blank" rel="noreferrer">{x.title}</a> : x.title}</td><td>{x.influencer_id_label}</td>{['reach', ...METRICS].map((k) => <td key={k} className="num">{x.metrics[k] != null ? formatNumberIN(x.metrics[k]) : <span className="muted">—</span>}</td>)}<td className="small">{x.metrics.source ?? 'Unknown'}{x.metrics.as_of ? ` · ${formatDate(x.metrics.as_of)}` : ''}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <Empty title="No results recorded yet" hint="Open a deliverable and fill in its metrics with the source (screenshot, insights export) and date." />}
      </Card>
      {d.posts?.length > 0 && <Card title="Linked posts from weekly analytics" flush><table className="table"><tbody>{d.posts.map((p: Row) => <tr key={p.id}><td><a href={p.permalink} target="_blank" rel="noreferrer">{p.caption ?? p.permalink}</a></td><td>{p.influencer_name}</td><td className="num">{formatNumberIN(p.metrics?.views)}</td><td className="small">{p.source}</td></tr>)}</tbody></table></Card>}
    </div>
  );
}

function Targets({ targets, deliverables }: { targets: Row | null; deliverables: Row[] }) {
  if (!targets || !Object.values(targets).some((v) => v != null)) return <Empty title="No targets agreed" hint="Edit the campaign to record agreed targets." />;
  const total = (k: string) => {
    const vals = deliverables.map((x) => x.metrics?.[k]).filter((v) => typeof v === 'number');
    return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) : null;
  };
  return (
    <div className="stack tight">
      {Object.entries(targets).filter(([, v]) => v != null).map(([k, v]) => {
        if (k === 'reach') return <div key={k} className="small">Reach target {formatNumberIN(v as number)} — compared per creator; unique reach is not summed.</div>;
        if (k === 'engagement_rate') return <div key={k} className="small">Engagement target {String(v)}% — see Results for per-deliverable figures.</div>;
        const actual = total(k);
        const pct = actual === null ? null : Math.min(100, Math.round((actual / (v as number)) * 100));
        return (
          <div key={k}>
            <div className="row between small"><span>{humanize(k)}</span><span>{actual === null ? 'Unavailable' : formatNumberIN(actual)} / {formatNumberIN(v as number)}</span></div>
            <div className={`meter ${pct !== null && pct < 50 ? 'warn' : ''}`} role="meter" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct ?? 0}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}
