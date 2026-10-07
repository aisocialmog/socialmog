import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatDate } from '../../shared/dates.ts';
import { dealEconomics, STAGE_PROBABILITY } from '../../shared/calc.ts';
import { formatINR } from '../../shared/money.ts';
import { DEAL_STAGES, humanize } from '../../shared/schema.ts';
import {
  Activity, AnalyseButton, api, ArchiveButton, Async, attempt, Badge, Card, confirmAction, DataTable, DemoTag, Details, Empty, EntityForm, EntityTable, invalidate, Kanban, Modal, Money,
  PageHead, Stat, Tabs, Timeline, toast, useApi, useCan, useToday, type Row,
} from '../lib.tsx';
import { LinkedDocuments, Shortlist } from './influencers.tsx';

// ---------------------------------------------------------------- brands

export function Brands() {
  return (
    <div className="stack">
      <PageHead title="Brands & leads" sub="Clients, prospects and inbound leads" />
      <EntityTable entity="brands" overrides={{
        name: { render: (r) => <><strong>{r.name}</strong> <DemoTag row={r} /></> },
        follow_up_date: { render: (r) => (r.follow_up_date ? <BadgeDate d={r.follow_up_date} /> : '—') },
      }} />
    </div>
  );
}

function BadgeDate({ d }: { d: string }) {
  const today = useToday();
  return <Badge tone={d < today ? 'bad' : d === today ? 'warn' : ''}>{formatDate(d)}</Badge>;
}

export function BrandPage() {
  const { id } = useParams();
  const q = useApi<Row>(`/api/brands/${id}/overview`);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState<null | 'edit' | 'contact' | 'deal'>(null);
  const canSales = useCan('sales');
  const nav = useNavigate();
  return (
    <Async q={q}>
      {(d) => {
        const b = d.row;
        const paid = d.invoices?.reduce((s: number, i: Row) => s + i.paid, 0) ?? 0;
        const due = d.invoices?.reduce((s: number, i: Row) => s + i.outstanding, 0) ?? 0;
        return (
          <div className="stack">
            <PageHead title={<>{b.name} <DemoTag row={b} /></>} sub={<><Badge value={b.status} /> {b.industry} {b.owner_id_label && `· owner ${b.owner_id_label}`} {b.website && <a href={b.website} target="_blank" rel="noreferrer">Website</a>} {b.instagram_url && <a href={b.instagram_url} target="_blank" rel="noreferrer">Instagram</a>}</>}
              actions={canSales && <><AnalyseButton type="brand_proposal" ids={[b.id]} cap="sales" /><button className="btn" onClick={() => setModal('deal')}>New deal</button><button className="btn" onClick={() => setModal('edit')}>Edit</button><ArchiveButton entity="brands" row={b} onDone={() => nav('/brands')} /></>} />
            <div className="grid">
              <Stat label="Open deals" value={d.deals.filter((x: Row) => !['won', 'lost'].includes(x.stage)).length} />
              <Stat label="Campaigns" value={d.campaigns.length} />
              {d.invoices && <Stat label="Paid to us (all time)" value={<Money p={paid} />} />}
              {d.invoices && <Stat label="Outstanding" value={<Money p={due} />} foot={`Terms: ${b.payment_terms_days ?? '—'} days${b.payment_terms ? ` · ${b.payment_terms}` : ''}`} />}
              {b.follow_up_date && <Stat label="Next follow-up" value={formatDate(b.follow_up_date)} />}
            </div>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'timeline', label: 'Communication' }, ...(d.invoices ? [{ key: 'payments', label: 'Payment history' }] : []), { key: 'documents', label: 'Documents' }, { key: 'activity', label: 'Activity' }]} />
            {tab === 'overview' && (
              <div className="grid two">
                <Card title="Details"><Details entity="brands" row={b} skip={['name']} /></Card>
                <div className="stack">
                  <Card title="Contacts" actions={canSales && <button className="btn sm" onClick={() => setModal('contact')}>Add contact</button>} flush>
                    {d.contacts.length ? <table className="table"><tbody>{d.contacts.map((c: Row) => <tr key={c.id}><td><Link to={`/r/contacts/${c.id}`}>{c.name}</Link>{c.is_primary ? <Badge tone="info">Primary</Badge> : null}<div className="small muted">{c.title}</div></td><td className="small">{c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}<div>{c.phone}</div></td></tr>)}</tbody></table> : <Empty title="No contacts yet" />}
                  </Card>
                  <Card title="Deals" flush>{d.deals.length ? <table className="table"><tbody>{d.deals.map((x: Row) => <tr key={x.id}><td><Link to={`/deals/${x.id}`}>{x.title}</Link><div className="small muted">{x.next_action ?? ''}</div></td><td><Badge value={x.stage} /></td><td className="num">{x.brand_price !== undefined && <Money p={x.brand_price} />}</td></tr>)}</tbody></table> : <Empty title="No deals" />}</Card>
                  <Card title="Campaigns" flush>{d.campaigns.length ? <table className="table"><tbody>{d.campaigns.map((x: Row) => <tr key={x.id}><td><Link to={`/campaigns/${x.id}`}>{x.name}</Link></td><td><Badge value={x.stage} /></td><td className="small">{formatDate(x.start_date)}</td></tr>)}</tbody></table> : <Empty title="No campaigns yet" />}</Card>
                </div>
              </div>
            )}
            {tab === 'timeline' && <Card title="Communication & follow-ups"><Timeline entity="brands" id={b.id} /></Card>}
            {tab === 'payments' && d.invoices && (
              <Card flush>
                <DataTable rows={d.invoices} viewKey="brand-invoices" onRowClick={(r) => nav(`/finance/receivables/${r.id}`)} columns={[
                  { key: 'label', label: 'Milestone' }, { key: 'number', label: 'Invoice' }, { key: 'campaign_name', label: 'Campaign' },
                  { key: 'due_date', label: 'Due', render: (r) => formatDate(r.due_date) }, { key: 'total', label: 'Total', num: true, render: (r) => <Money p={r.total} /> },
                  { key: 'paid', label: 'Received', num: true, render: (r) => <Money p={r.paid} /> }, { key: 'outstanding', label: 'Outstanding', num: true, render: (r) => <Money p={r.outstanding} /> },
                  { key: 'payment_state', label: 'Status', render: (r) => <Badge value={r.payment_state} /> },
                ]} />
              </Card>
            )}
            {tab === 'documents' && <LinkedDocuments entity="brands" id={b.id} docs={d.documents} />}
            {tab === 'activity' && <Card><Activity entity="brands" id={b.id} /></Card>}
            <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit brand"><EntityForm entity="brands" record={b} onSaved={() => (setModal(null), q.reload())} /></Modal>
            <Modal open={modal === 'contact'} onClose={() => setModal(null)} title="Add contact"><EntityForm entity="contacts" initial={{ brand_id: b.id }} fields={['name', 'title', 'email', 'phone', 'is_primary', 'notes', 'brand_id']} onSaved={() => (setModal(null), q.reload())} /></Modal>
            <Modal open={modal === 'deal'} onClose={() => setModal(null)} title="New deal"><EntityForm entity="deals" initial={{ brand_id: b.id, title: `${b.name} — ` }} onSaved={(r) => nav(`/deals/${r.id}`)} /></Modal>
          </div>
        );
      }}
    </Async>
  );
}

// ---------------------------------------------------------------- deals

export function Deals() {
  const q = useApi<{ rows: Row[] }>('/api/e/deals');
  const [view, setView] = useState<'board' | 'table'>('board');
  const [creating, setCreating] = useState(false);
  const canRates = useCan('rates');
  const nav = useNavigate();
  const move = async (d: Row, stage: string) => {
    let body: Row = { stage };
    if (stage === 'lost') {
      const reason = await confirmAction({ title: `Mark "${d.title}" as lost?`, confirm: 'Mark lost', danger: true, reason: 'Loss reason' });
      if (reason === false) return;
      body = { stage, loss_reason: reason };
    }
    if (await attempt(() => api(`/api/e/deals/${d.id}`, { method: 'PATCH', body }), `Moved to ${humanize(stage)}`)) q.reload();
  };
  return (
    <div className="stack">
      <PageHead title="Deal pipeline" sub="Lead → Contacted → Brief → Shortlist → Proposal → Negotiation → Won / Lost"
        actions={<><div className="seg">{(['board', 'table'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{humanize(v)}</button>)}</div><button className="btn primary" onClick={() => setCreating(true)}>New deal</button></>} />
      <Async q={q}>
        {(d) => {
          const open = d.rows.filter((x) => !['won', 'lost'].includes(x.stage));
          const econ = open.map((x) => dealEconomics(x));
          return (
            <div className="stack">
              <div className="grid">
                <Stat label="Open deals" value={open.length} />
                {canRates && <Stat label="Expected agency fee (open)" value={<Money p={econ.reduce((s, e) => s + e.agencyFee, 0)} />} foot="Brand price − creator fees, or commission" />}
                {canRates && <Stat label="Probability-weighted margin" value={<Money p={econ.reduce((s, e) => s + e.weightedMargin, 0)} />} foot="After editor & other costs" />}
                <Stat label="Won (all time)" value={d.rows.filter((x) => x.stage === 'won').length} foot={`Lost ${d.rows.filter((x) => x.stage === 'lost').length}`} />
              </div>
              {view === 'board' ? (
                <Kanban stages={DEAL_STAGES} items={d.rows} stageOf={(x) => x.stage} onMove={move} card={(x) => {
                  const e = dealEconomics(x);
                  return (
                    <>
                      <Link to={`/deals/${x.id}`} className="strong">{x.title}</Link>
                      <span className="small muted">{x.brand_id_label}{x.campaign_id ? ' · converted' : ''} <DemoTag row={x} /></span>
                      {canRates && <span className="small">{x.billing_model === 'commission' ? 'Commission' : 'Brand price'} <Money p={x.billing_model === 'commission' ? x.agency_fee : x.brand_price} /> · margin <Money p={e.margin} /></span>}
                      <span className="small muted">{x.probability ?? 0}%{x.next_action_date ? ` · next ${formatDate(x.next_action_date)}` : ''}</span>
                    </>
                  );
                }} />
              ) : (
                <EntityTable entity="deals" rows={d.rows} />
              )}
            </div>
          );
        }}
      </Async>
      <Modal open={creating} onClose={() => setCreating(false)} title="New deal"><EntityForm entity="deals" onSaved={(r) => nav(`/deals/${r.id}`)} /></Modal>
    </div>
  );
}

export function DealPage() {
  const { id } = useParams();
  const q = useApi<{ row: Row }>(`/api/e/deals/${id}`);
  const infl = useApi<{ rows: Row[] }>('/api/e/influencers');
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState<null | 'edit' | 'shortlist'>(null);
  const canSales = useCan('sales');
  const canConvert = useCan('campaigns');
  const canRates = useCan('rates');
  const nav = useNavigate();
  return (
    <Async q={q}>
      {({ row: d }) => {
        const e = dealEconomics(d);
        const names = new Map((infl.data?.rows ?? []).map((i) => [i.id, i.name]));
        return (
          <div className="stack">
            <PageHead title={<>{d.title} <DemoTag row={d} /></>} sub={<><Link to={`/brands/${d.brand_id}`}>{d.brand_id_label}</Link> · <Badge value={d.stage} /> · {humanize(d.billing_model)} model · owner {d.owner_id_label ?? '—'}</>}
              actions={<>
                <AnalyseButton type="brand_proposal" ids={[d.brand_id]} cap="sales" />
                {d.campaign_id ? <Link className="btn primary" to={`/campaigns/${d.campaign_id}`}>Open campaign</Link> : canConvert && d.stage !== 'lost' && (
                  <button className="btn primary" onClick={async () => {
                    const ok = await confirmAction({ title: 'Convert to campaign?', message: 'Creates the campaign with brand, brief, budget plan, confirmed creators (and their payables), deliverables and payment milestones from this deal. The deal is marked won.', confirm: 'Convert' });
                    if (ok === false) return;
                    try {
                      const r = await api(`/api/deals/${d.id}/convert`, { body: {} });
                      toast('Campaign created');
                      invalidate('/api/');
                      nav(`/campaigns/${r.campaign_id}`);
                    } catch (err) {
                      toast((err as Error).message, 'error');
                    }
                  }}>Won — convert to campaign</button>
                )}
                {canSales && <button className="btn" onClick={() => setModal('shortlist')}>Shortlist creators</button>}
                {canSales && <button className="btn" onClick={() => setModal('edit')}>Edit</button>}
                <ArchiveButton entity="deals" row={d} onDone={() => nav('/deals')} />
              </>} />
            {canRates && (
              <div className="grid">
                <Stat label={d.billing_model === 'commission' ? 'Brand spend (paid to creators directly)' : 'Proposed brand price'} value={<Money p={d.brand_price} />} />
                <Stat label="Creator commitments" value={<Money p={e.creatorCost} />} foot={`${(d.creators ?? []).length} creators`} />
                <Stat label={d.billing_model === 'commission' ? 'Our commission' : 'Agency fee (price − creators)'} value={<Money p={e.agencyFee} />} />
                <Stat label="Expected margin" value={<Money p={e.margin} />} foot={`After editor ${formatINR(d.editor_costs ?? 0)} + other ${formatINR(d.other_costs ?? 0)}`} />
                <Stat label="Weighted" value={<Money p={e.weightedMargin} />} foot={`${e.probability}% probability (stage default ${STAGE_PROBABILITY[d.stage]}%)`} />
              </div>
            )}
            <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'notes', label: 'Notes & follow-ups' }, { key: 'activity', label: 'Activity' }]} />
            {tab === 'overview' && (
              <div className="grid two">
                <Card title="Terms & next steps"><Details entity="deals" row={d} skip={['title', 'brand_id']} /></Card>
                <div className="stack">
                  <Card title="Creators" flush>
                    {(d.creators ?? []).length ? (
                      <table className="table"><thead><tr><th>Creator</th><th>Deliverables</th><th>Status</th>{canRates && <th className="num">Fee</th>}</tr></thead>
                        <tbody>{(d.creators ?? []).map((c: Row, i: number) => <tr key={i}><td><Link to={`/influencers/${c.influencer_id}`}>{names.get(c.influencer_id) ?? `#${c.influencer_id}`}</Link></td><td className="small">{c.deliverables ?? '—'}</td><td><Badge value={c.status ?? 'proposed'} /></td>{canRates && <td className="num"><Money p={c.fee} /></td>}</tr>)}</tbody>
                      </table>
                    ) : <Empty title="No creators yet" action={canSales && <button className="btn sm" onClick={() => setModal('shortlist')}>Shortlist creators</button>} />}
                  </Card>
                  <Card title="Payment milestones" flush>
                    {(d.payment_milestones ?? []).length ? <table className="table"><tbody>{d.payment_milestones.map((m: Row, i: number) => <tr key={i}><td>{m.label}</td><td className="num">{m.pct}%</td><td>{m.due_days != null ? `due in ${m.due_days} days` : ''}</td></tr>)}</tbody></table> : <Empty title="No milestones" hint="Default on conversion: 100% due in 30 days." />}
                  </Card>
                  {d.brief && <Card title="Brief"><p className="pre">{d.brief}</p></Card>}
                </div>
              </div>
            )}
            {tab === 'notes' && <Card><Timeline entity="deals" id={d.id} /></Card>}
            {tab === 'activity' && <Card><Activity entity="deals" id={d.id} /></Card>}
            <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit deal"><EntityForm entity="deals" record={d} onSaved={() => (setModal(null), q.reload())} /></Modal>
            <Modal open={modal === 'shortlist'} onClose={() => (setModal(null), q.reload())} title="Shortlist creators for this deal" size="drawer">{modal === 'shortlist' && <Shortlist preset={{ brand_id: d.brand_id }} />}</Modal>
          </div>
        );
      }}
    </Async>
  );
}
