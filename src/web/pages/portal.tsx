import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { formatDate } from '../../shared/dates.ts';
import { formatNumberIN } from '../../shared/money.ts';
import { api, Async, attempt, Badge, Card, confirmAction, Empty, Money, PageHead, ThemeToggle, toast, useApi, useMe, type Row } from '../lib.tsx';

/** External portal for brand and creator users. Data comes only from /api/portal routes. */
export function Portal() {
  const me = useMe();
  return (
    <div className="main">
      <header className="topbar">
        <div className="brand" style={{ padding: 0 }}><span className="brand-mark">S</span> Socialmog {me.user.role === 'brand' ? 'brand portal' : 'creator portal'}</div>
        <span className="grow" />
        <span className="small muted hide-mobile">{me.user.name}</span>
        <ThemeToggle />
        <button className="btn ghost sm" onClick={async () => { await api('/api/auth/logout', { body: {} }); location.href = '/'; }}><LogOut /> Sign out</button>
      </header>
      <main className="content">{me.user.role === 'brand' ? <BrandPortal /> : <CreatorPortal />}</main>
    </div>
  );
}

function Deliverables({ rows, onLive, showCreator = true }: { rows: Row[]; onLive?: (d: Row) => void; showCreator?: boolean }) {
  if (!rows.length) return <Empty title="No deliverables yet" />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Deliverable</th>{showCreator && <th>Creator</th>}<th>Campaign</th><th>Status</th><th>Due</th><th>Live link</th><th className="num">Views</th></tr></thead>
        <tbody>{rows.map((d) => (
          <tr key={d.id}>
            <td>{d.title}</td>{showCreator && <td>{d.creator}</td>}<td>{d.campaign}</td><td><Badge value={d.status} /></td><td className="nowrap">{formatDate(d.due_date)}</td>
            <td>{d.live_url ? <a href={d.live_url} target="_blank" rel="noreferrer">Open</a> : onLive ? <button className="btn sm" onClick={() => onLive(d)}>Add link</button> : '—'}</td>
            <td className="num">{d.metrics?.views != null ? <span title={`${d.metrics.source ?? ''} ${d.metrics.as_of ?? ''}`}>{formatNumberIN(d.metrics.views)}</span> : <span className="muted">—</span>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Docs({ docs }: { docs: Row[] }) {
  return docs.length ? <ul>{docs.map((d) => <li key={d.id}><a href={`/api/portal/documents/${d.id}`} target="_blank" rel="noreferrer">{d.title}</a> <Badge value={d.kind} /></li>)}</ul> : <Empty title="No shared documents" />;
}

function BrandPortal() {
  const q = useApi<Row>('/api/portal/brand');
  const review = async (t: Row, decision: 'approve' | 'changes') => {
    const comment = await confirmAction({ title: decision === 'approve' ? `Approve "${t.title}"?` : `Request changes to "${t.title}"`, confirm: decision === 'approve' ? 'Approve' : 'Send feedback', reason: decision === 'changes' ? 'What should change' : false });
    if (comment === false) return;
    if (await attempt(() => api(`/api/portal/content/${t.id}/review`, { body: { decision, comment } }), decision === 'approve' ? 'Approved — thank you' : 'Feedback sent to the team')) q.reload();
  };
  return (
    <Async q={q}>{(d) => (
      <div className="stack">
        <PageHead title={d.brand?.name ?? 'Your campaigns'} sub="Campaign progress, content awaiting your approval, invoices and shared documents" />
        <Card title="Awaiting your approval">
          {d.approvals.filter((t: Row) => t.stage === 'brand_review').length ? (
            <div className="stack">{d.approvals.filter((t: Row) => t.stage === 'brand_review').map((t: Row) => (
              <div key={t.id} className="card stack tight">
                <div className="row between"><strong>{t.title}</strong><span className="small muted">{t.creator} · {t.campaign} · due {formatDate(t.due_date)}</span></div>
                {t.latest_version?.url ? <a href={t.latest_version.url} target="_blank" rel="noreferrer">View version {t.latest_version.no}</a> : <span className="small muted">No preview link attached</span>}
                {t.caption && <p className="small pre">Caption: {t.caption}</p>}
                <div className="row"><button className="btn primary" onClick={() => review(t, 'approve')}>Approve</button><button className="btn" onClick={() => review(t, 'changes')}>Request changes</button></div>
              </div>
            ))}</div>
          ) : <Empty title="Nothing waiting for you" />}
        </Card>
        <Card title="Campaigns" flush>
          {d.campaigns.length ? <table className="table"><tbody>{d.campaigns.map((c: Row) => <tr key={c.id}><td><strong>{c.name}</strong><div className="small muted">{c.objective}</div></td><td><Badge value={c.stage} /></td><td className="small">{formatDate(c.start_date)} – {formatDate(c.end_date)}</td></tr>)}</tbody></table> : <Empty title="No campaigns yet" />}
        </Card>
        <Card title="Deliverables & live posts" flush><Deliverables rows={d.deliverables} /></Card>
        <Card title="Invoices" flush>
          {d.invoices.length ? <table className="table"><thead><tr><th>Invoice</th><th>For</th><th>Due</th><th className="num">Amount</th><th className="num">Received</th><th className="num">Outstanding</th></tr></thead><tbody>{d.invoices.map((i: Row) => <tr key={i.id}><td>{i.number}</td><td>{i.label}<div className="small muted">{i.campaign}</div></td><td>{formatDate(i.due_date)}</td><td className="num"><Money p={i.total} /></td><td className="num"><Money p={i.received} /></td><td className="num"><Money p={i.outstanding} /></td></tr>)}</tbody></table> : <Empty title="No invoices issued" />}
        </Card>
        <Card title="Documents"><Docs docs={d.documents} /></Card>
      </div>
    )}</Async>
  );
}

function CreatorPortal() {
  const q = useApi<Row>('/api/portal/creator');
  const [busy, setBusy] = useState(false);
  const addLive = async (d: Row) => {
    const url = window.prompt(`Paste the live link for "${d.title}"`);
    if (!url) return;
    setBusy(true);
    try {
      await api(`/api/portal/deliverables/${d.id}/live`, { body: { live_url: url } });
      toast('Thanks — link saved');
      q.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Async q={q}>{(d) => (
      <div className={`stack ${busy ? 'loading-dim' : ''}`}>
        <PageHead title={`Hi ${d.me?.name?.split(' ')[0] ?? ''}`} sub="Your deliverables, payments and weekly reports" />
        <Card title="Your deliverables" flush><Deliverables rows={d.deliverables} onLive={addLive} showCreator={false} /></Card>
        <Card title="Payments" flush>
          {d.payments.length ? <table className="table"><thead><tr><th>For</th><th>Due</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">TDS</th><th className="num">Outstanding</th><th>Status</th></tr></thead><tbody>{d.payments.map((p: Row) => <tr key={p.id}><td>{p.description}<div className="small muted">{p.campaign}</div></td><td>{formatDate(p.due_date)}</td><td className="num"><Money p={p.amount} /></td><td className="num"><Money p={p.paid} /></td><td className="num"><Money p={p.tds_deducted} /></td><td className="num"><Money p={p.outstanding} /></td><td><Badge value={p.state} /></td></tr>)}</tbody></table> : <Empty title="No payments yet" hint="Payments for brand-paid (commission) collaborations are made by the brand directly." />}
        </Card>
        <Card title="Weekly reports">
          {d.reports.length ? d.reports.map((r: Row) => (
            <details key={r.id} style={{ marginBottom: 8 }}>
              <summary><strong>Week of {formatDate(r.period_start)}</strong> — {r.summary}</summary>
              <table className="table small"><tbody>{r.metrics.filter((m: Row) => m.current !== null).map((m: Row) => <tr key={m.key}><td>{m.label}</td><td className="num">{formatNumberIN(m.current, { decimals: m.key === 'engagement_rate' ? 2 : 0 })}</td><td className="num">{m.change_pct === null ? '—' : `${m.change_pct >= 0 ? '+' : ''}${m.change_pct.toFixed(1)}%`}</td></tr>)}</tbody></table>
              <p className="small muted">Source: {r.source ?? '—'}</p>
              <ol className="small">{r.recommendations.map((x: Row, i: number) => <li key={i}>{x.action}</li>)}</ol>
            </details>
          )) : <Empty title="No reports yet" />}
        </Card>
        <Card title="Documents"><Docs docs={d.documents} /></Card>
      </div>
    )}</Async>
  );
}
