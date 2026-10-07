import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatDate } from '../../shared/dates.ts';
import { formatINR, formatNumberIN } from '../../shared/money.ts';
import { lineChart, SERIES_CSS, THEME_CSS } from '../../shared/charts.ts';
import { humanize } from '../../shared/schema.ts';
import { Async, Badge, Card, Chart, Empty, Modal, Money, PageHead, Stat, useApi, useCan, useMe, type Row } from '../lib.tsx';

type Drill = { title: string; note?: ReactNode; rows: { label: ReactNode; sub?: ReactNode; amount?: number; link?: string }[] } | null;

export function Overview() {
  const me = useMe();
  const q = useApi<Row>('/api/dashboard');
  const [drill, setDrill] = useState<Drill>(null);
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: me.timezone }).format(new Date()));
  return (
    <div className="stack">
      <PageHead title={`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${me.user.name.split(' ')[0]}`} sub={q.data ? `${formatDate(q.data.today)} · every figure opens the records behind it` : undefined} />
      <Async q={q}>
        {(d) => (
          <div className="stack">
            {d.finance && <FinanceBlock f={d.finance} open={setDrill} />}
            <div className="grid two">
              <Attention items={d.attention} />
              <div className="stack">
                <CampaignBlock c={d.campaigns} />
                <DealsBlock deals={d.deals} />
              </div>
            </div>
            <div className="grid two">
              <InfluencerTrends rows={d.influencers} />
              <EditorBlock rows={d.editors} />
            </div>
          </div>
        )}
      </Async>
      <Modal open={!!drill} onClose={() => setDrill(null)} title={drill?.title ?? ''} size="drawer">
        {drill?.note && <div className="alert info small">{drill.note}</div>}
        {drill?.rows.length ? (
          <div className="list">
            {drill.rows.map((r, i) => (
              <div key={i} className="list-item">
                <div className="grow">
                  {r.link ? <Link to={r.link} onClick={() => setDrill(null)}>{r.label}</Link> : r.label}
                  {r.sub && <div className="small muted">{r.sub}</div>}
                </div>
                {r.amount !== undefined && <Money p={r.amount} />}
              </div>
            ))}
            <div className="list-item strong"><span className="grow">Total</span><Money p={drill.rows.reduce((s, r) => s + (r.amount ?? 0), 0)} /></div>
          </div>
        ) : <Empty title="Nothing to show" />}
      </Modal>
    </div>
  );
}

function FinanceBlock({ f, open }: { f: Row; open: (d: Drill) => void }) {
  const [sel, setSel] = useState({ horizon: '30', planned: true, reserves: 'protected' });
  const pos = useApi<Row>(`/api/finance/position?horizon=${sel.horizon}&planned=${sel.planned ? 1 : 0}&reserves=${sel.reserves}`);
  const p = pos.data;
  const conf = f.receivables.byConfidence;
  const short = f.forecast.base.earliestShortfall;
  const cons = f.forecast.conservative.earliestShortfall;
  const payRows = (filter: (o: Row) => boolean) =>
    (p?.payables.items ?? []).filter(filter).map((o: Row) => ({ label: `${o.description}${o.payee ? ` — ${o.payee}` : ''}`, sub: `Due ${formatDate(o.due_date)} · ${humanize(o.status)}${o.days_overdue ? ` · ${o.days_overdue} days overdue` : ''}${o.earmarked ? ` · ${formatINR(o.earmarked)} earmarked` : ''}`, amount: o.outstanding, link: `/finance/payables/${o.id}` }));
  const recRows = (filter: (r: Row) => boolean) =>
    (p?.receivables.items ?? []).filter(filter).map((r: Row) => ({ label: `${r.label} — ${r.payer ?? ''}`, sub: `${r.number ?? 'Not yet invoiced'} · expected ${formatDate(r.expected_date)} · ${humanize(r.confidence)}${r.days_overdue ? ` · ${r.days_overdue} days overdue` : ''}`, amount: r.outstanding, link: `/finance/receivables/${r.id}` }));
  const today = f.forecast.base.daily[0]?.date;
  const within = (n: number) => (o: Row) => o.due_date <= addDaysISO(today, n);
  const daily: Row[] = f.forecast.base.daily;
  const svg = (w: number) => lineChart({
    width: w,
    labels: daily.map((x) => formatDate(x.date, { year: false })),
    series: [{ name: 'Projected balance', color: SERIES_CSS[0], values: daily.map((x) => x.closing) }],
    yFormat: (n) => formatINR(n, { compact: true }),
    reference: { value: 0, label: 'Zero' },
    interactive: true,
    theme: THEME_CSS,
    height: 200,
    title: 'Projected cash balance, base scenario',
  });
  return (
    <div className="stack">
      <div className="grid">
        <Stat hero label="Cash across accounts" value={<Money p={f.cash} />} foot={`${f.accounts.filter((a: Row) => a.active).length} active accounts · actual balances`}
          onClick={() => open({ title: 'Actual cash by account', note: 'Opening balances plus recorded transactions up to today. Unpaid invoices are not cash.', rows: f.accounts.filter((a: Row) => a.active).map((a: Row) => ({ label: a.name, sub: `${humanize(a.type)}${a.unreconciled ? ` · ${a.unreconciled} unreconciled` : ''}`, amount: a.balance, link: `/finance/accounts/${a.id}` })) })} />
        <Stat label="Expected incoming" value={<Money p={f.receivables.total} />} foot={<>Confirmed {formatINR(conf.confirmed, { compact: true })} · expected {formatINR(conf.expected, { compact: true })} · at risk {formatINR(conf.at_risk + conf.delayed, { compact: true })}</>}
          onClick={() => open({ title: 'Expected incoming payments', note: 'Outstanding receivables and scheduled milestones, with confidence. Not cash until received.', rows: recRows(() => true) })} />
        <Stat label="Overdue from brands" value={<Money p={f.receivables.overdue} className={f.receivables.overdue ? 'neg' : ''} />} foot="Past contractual due date"
          onClick={() => open({ title: 'Overdue receivables', rows: recRows((r) => r.days_overdue > 0) })} />
        <Stat label="We owe (all payables)" value={<Money p={f.payables.total} />} foot={<>Overdue {formatINR(f.payables.overdue)}</>}
          onClick={() => open({ title: 'Payment obligations', note: 'Creators, editors, vendors, operating costs, taxes. Includes planned and committed amounts still unpaid.', rows: payRows(() => true) })} />
        <Stat label="Due in 7 / 14 / 30 days" value={<span className="num">{formatINR(f.payables.due7, { compact: true })} / {formatINR(f.payables.due14, { compact: true })} / {formatINR(f.payables.due30, { compact: true })}</span>} foot="Including overdue"
          onClick={() => open({ title: 'Payments due within 30 days', rows: payRows(within(30)) })} />
        <Stat label="Projected shortage" value={short ? <span className="neg">{formatDate(short.date)}</span> : <span className="pos">None in 90 days</span>}
          foot={short ? `Funding needed ${formatINR(f.forecast.base.fundingRequired)} · base scenario` : cons ? `Conservative: short on ${formatDate(cons.date)} (${formatINR(f.forecast.conservative.fundingRequired)})` : 'Conservative scenario also clear'}
          to="/finance/forecast" />
      </div>

      <div className="grid two">
        <Card title="Cash left after commitments" hint="Actual cash − selected unpaid obligations − selected reserves">
          <div className="row" style={{ marginBottom: 10 }}>
            <select className="input" style={{ width: 'auto' }} value={sel.horizon} onChange={(e) => setSel({ ...sel, horizon: e.target.value })} aria-label="Obligations due within">
              <option value="7">Due within 7 days</option><option value="14">Due within 14 days</option><option value="30">Due within 30 days</option><option value="all">All unpaid</option>
            </select>
            <select className="input" style={{ width: 'auto' }} value={sel.reserves} onChange={(e) => setSel({ ...sel, reserves: e.target.value })} aria-label="Reserves">
              <option value="protected">Protected reserves</option><option value="all">All reserves</option><option value="none">No reserves</option>
            </select>
            <label className="check small"><input type="checkbox" checked={sel.planned} onChange={(e) => setSel({ ...sel, planned: e.target.checked })} /> Include planned costs</label>
          </div>
          {p ? (
            <div className={pos.loading ? 'loading-dim' : ''}>
              <dl className="kv num">
                <dt>Actual cash</dt><dd className="right"><Money p={p.cash} /></dd>
                <dt>Obligations selected</dt><dd className="right"><button className="btn ghost sm" onClick={() => open({ title: 'Obligations in this calculation', rows: payRows((o) => o.status !== 'on_hold' && (sel.planned || o.status !== 'planned') && (sel.horizon === 'all' || within(Number(sel.horizon))(o))) })}>− {formatINR(p.selection.payables)}</button></dd>
                <dt>Reserves selected</dt><dd className="right">− {formatINR(p.selection.reserveTotal)}</dd>
                <dt className="strong">Remaining</dt><dd className="right strong"><Money p={p.afterCommitments} /></dd>
              </dl>
              <div className="small muted" style={{ marginTop: 8 }}>
                Earmarked {formatINR(p.earmarks.total)} (internal allocations, not bank transfers) · Unallocated <Money p={p.unallocated} /> · <Link to="/finance/allocations">Manage allocations</Link>
              </div>
            </div>
          ) : <div className="skeleton" style={{ height: 80 }} />}
        </Card>
        <Card title="Projected balance — next 90 days" hint="Base scenario: confirmed + expected receipts on expected dates" actions={<Link className="btn sm" to="/finance/forecast">Forecast & what-ifs</Link>}>
          <Chart svg={svg} label="Projected cash balance" table={{ columns: ['Date', 'In', 'Out', 'Closing'], rows: daily.map((x) => [formatDate(x.date), formatINR(x.inflow), formatINR(x.outflow), formatINR(x.closing)]) }} />
        </Card>
      </div>

      <div className="grid">
        <Stat label={`Agency earnings (FY, ${f.earnings.basis} basis)`} value={<Money p={f.earnings.agency_earnings} />} foot="Net of pass-through creator fees" to="/finance/reports" />
        <Stat label="Cash collected (FY)" value={<Money p={f.earnings.cash_collected} />} foot="Brand & commission receipts, incl. GST" to="/finance/transactions" />
        <Stat label="Campaign contribution margin (FY)" value={<Money p={f.earnings.contribution_margin} />} foot={`Gross billings ${formatINR(f.earnings.gross_billings, { compact: true })}`} to="/finance/campaigns" />
        <Stat label="Operating expenses (FY)" value={<Money p={f.earnings.opex} />} foot={<>Operating result <Money p={f.earnings.operating_result} /> · assets {formatINR(f.earnings.capex, { compact: true })} separate</>} to="/finance/reports" />
      </div>
    </div>
  );
}

function addDaysISO(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

function Attention({ items }: { items: Row[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 12);
  return (
    <Card title="Needs my attention" hint={`${items.filter((i) => i.severity === 'high').length} urgent · ${items.length} total`} flush>
      {items.length ? (
        <div>
          {shown.map((a, i) => (
            <Link key={i} to={a.link} className={`attention-item sev-${a.severity}`}>
              <div className="grow">
                <div className="strong">{a.title}</div>
                <div className="small muted">{a.detail}</div>
              </div>
              <Badge value={a.severity} />
            </Link>
          ))}
          {items.length > 12 && <div style={{ padding: 10 }}><button className="btn sm" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length}`}</button></div>}
        </div>
      ) : <Empty title="Nothing needs you right now" hint="Overdue payments, approvals, follow-ups and expiring contracts will appear here." />}
    </Card>
  );
}

function CampaignBlock({ c }: { c: Row }) {
  const canFin = useCan('campaign_finance');
  return (
    <Card title="Campaigns" actions={<Link className="btn sm" to="/campaigns?view=health">Health view</Link>}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
        <Stat label="Active" value={c.active} to="/campaigns" />
        <Stat label="Pending approvals" value={c.pending_approvals} to="/content?stage=review" />
        <Stat label="Overdue deliverables" value={<span className={c.overdue_deliverables ? 'neg' : ''}>{c.overdue_deliverables}</span>} to="/campaigns?view=health" />
        {canFin && <Stat label="Over budget" value={<span className={c.over_budget ? 'neg' : ''}>{c.over_budget}</span>} to="/campaigns?view=health" />}
      </div>
      <div className="list" style={{ marginTop: 8 }}>
        {c.list.filter((x: Row) => x.health !== 'green').slice(0, 5).map((x: Row) => (
          <Link key={x.id} to={`/campaigns/${x.id}`} className="list-item" style={{ color: 'inherit' }}>
            <span className="dot" style={{ background: x.health === 'red' ? 'var(--critical)' : 'var(--series-4)', marginTop: 6 }} />
            <div className="grow"><div className="strong">{x.name}</div><div className="small muted">{x.flags.map((f: Row) => f.text).join(' · ')}</div></div>
            <Badge value={x.stage} />
          </Link>
        ))}
      </div>
    </Card>
  );
}

function DealsBlock({ deals }: { deals: Row }) {
  return (
    <Card title="Deals awaiting follow-up" hint={deals.weighted_margin !== null ? <>Open pipeline {deals.open} deals · probability-weighted margin <Money p={deals.weighted_margin} /></> : `${deals.open} open deals`} actions={<Link className="btn sm" to="/deals">Pipeline</Link>}>
      {deals.follow_ups.length ? (
        <div className="list">
          {deals.follow_ups.slice(0, 6).map((d: Row) => (
            <Link key={d.id} to={`/deals/${d.id}`} className="list-item" style={{ color: 'inherit' }}>
              <div className="grow"><div className="strong">{d.title}</div><div className="small muted">{d.next_action ?? 'No next action set'}{d.next_action_date ? ` · ${formatDate(d.next_action_date)}` : ''}</div></div>
              <div className="right small">{d.expected_fee !== null && <div><Money p={d.expected_fee} /></div>}<span className="muted">{d.probability}% · {humanize(d.stage)}</span></div>
            </Link>
          ))}
        </div>
      ) : <Empty title="No follow-ups due" />}
    </Card>
  );
}

function InfluencerTrends({ rows }: { rows: Row[] }) {
  return (
    <Card title="Creators improving or declining" hint="Latest week vs rolling 4-week baseline (views, else engagement)" actions={<Link className="btn sm" to="/analytics">Weekly analysis</Link>}>
      {rows.length ? (
        <div className="list">
          {rows.map((r) => (
            <Link key={r.influencer_id} to={`/analytics/influencer/${r.influencer_id}`} className="list-item" style={{ color: 'inherit' }}>
              <div className="grow"><div className="strong">{r.name}</div><div className="small muted">Week of {formatDate(r.period_start)} · {r.platform} · source: {r.source}</div></div>
              <div className="right">
                <Badge tone={r.direction === 'improving' ? 'good' : 'bad'}>{r.direction === 'improving' ? '▲' : '▼'} {r.views_vs_baseline !== null ? `${r.views_vs_baseline.toFixed(0)}% views` : `${r.engagement_vs_baseline?.toFixed(0)}% engagement`}</Badge>
                {r.follower_growth_pct !== null && <div className="small muted">followers {r.follower_growth_pct >= 0 ? '+' : ''}{r.follower_growth_pct.toFixed(2)}%</div>}
              </div>
            </Link>
          ))}
        </div>
      ) : <Empty title="No clear movers" hint="Creators appear here when weekly data shows a ±10% change against their baseline." />}
    </Card>
  );
}

function EditorBlock({ rows }: { rows: Row[] }) {
  return (
    <Card title="Editor workload" actions={<Link className="btn sm" to="/editors">Editors</Link>}>
      {rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Editor</th><th className="num">Open</th><th className="num">Due this week</th><th className="num">Overdue</th><th>Blocked</th><th className="num">Median turnaround</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td><Link to={`/editors/${e.id}`}>{e.name}</Link><div className="small muted">{humanize(e.availability)}{e.utilisation !== null ? ` · ${e.utilisation}% of weekly capacity` : ''}</div></td>
                  <td className="num">{e.open}</td>
                  <td className="num">{e.due_this_week}</td>
                  <td className={`num ${e.overdue ? 'neg' : ''}`}>{e.overdue}</td>
                  <td>{e.blocked_tasks.map((t: Row) => <div key={t.id} className="small"><Link to={`/content/${t.id}`}>{t.title}</Link><div className="muted">{t.reason}</div></div>)}</td>
                  <td className="num">{e.median_turnaround_days === null ? '—' : `${formatNumberIN(e.median_turnaround_days, { decimals: 1 })} d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty title="No editors yet" />}
    </Card>
  );
}
