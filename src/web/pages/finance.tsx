import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';
import Papa from 'papaparse';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Upload } from 'lucide-react';
import { addDays, financialYearStart, formatDate, monthStart } from '../../shared/dates.ts';
import { formatINR, paiseToRupeesString } from '../../shared/money.ts';
import { lineChart, barChart, SERIES_CSS, THEME_CSS } from '../../shared/charts.ts';
import { can, humanize, TXN_CATEGORIES } from '../../shared/schema.ts';
import {
  AnalyseButton, api, ApiError, ArchiveButton, Async, attempt, Badge, Calendar, Card, Chart, confirmAction, DataTable, DemoTag, Details, Empty, EntityForm,
  Gate, invalidate, Modal, Money, MoneyField, PageHead, Stat, Timeline, toast, Activity, useApi, useCan, useIdempotencyKey, useMe, useOptions, useToday, type Col, type Row,
} from '../lib.tsx';

const SUBNAV: { to: string; label: string; cap: 'finance' | 'campaign_finance' }[] = [
  { to: '/finance', label: 'Position', cap: 'finance' },
  { to: '/finance/transactions', label: 'Transactions', cap: 'finance' },
  { to: '/finance/receivables', label: 'Receivables', cap: 'campaign_finance' },
  { to: '/finance/payables', label: 'Payables', cap: 'campaign_finance' },
  { to: '/finance/allocations', label: 'Allocations', cap: 'finance' },
  { to: '/finance/forecast', label: 'Forecast', cap: 'finance' },
  { to: '/finance/simulate', label: 'Can we afford it?', cap: 'finance' },
  { to: '/finance/calendar', label: 'Cash calendar', cap: 'finance' },
  { to: '/finance/campaigns', label: 'Campaign margins', cap: 'campaign_finance' },
  { to: '/finance/reports', label: 'Reports', cap: 'finance' },
  { to: '/finance/accounts', label: 'Accounts', cap: 'finance' },
];

export function Finance() {
  const me = useMe();
  const fin = can(me.user.role, 'finance');
  return (
    <Gate cap="campaign_finance">
      <div className="stack">
        <div className="tabs">{SUBNAV.filter((s) => can(me.user.role, s.cap)).map((s) => <NavLink key={s.to} to={s.to} end={s.to === '/finance'} className={({ isActive }) => (isActive ? 'on' : '')}>{s.label}</NavLink>)}</div>
        <Routes>
          <Route index element={fin ? <Position /> : <Receivables />} />
          <Route path="transactions" element={<Gate cap="finance"><Transactions /></Gate>} />
          <Route path="transactions/:id" element={<Gate cap="finance"><TransactionPage /></Gate>} />
          <Route path="receivables" element={<Receivables />} />
          <Route path="receivables/:id" element={<ReceivablePage />} />
          <Route path="payables" element={<Payables />} />
          <Route path="payables/:id" element={<PayablePage />} />
          <Route path="allocations" element={<Gate cap="finance"><Allocations /></Gate>} />
          <Route path="forecast" element={<Gate cap="finance"><Forecast /></Gate>} />
          <Route path="simulate" element={<Gate cap="finance"><Simulate /></Gate>} />
          <Route path="calendar" element={<Gate cap="finance"><CashCalendar /></Gate>} />
          <Route path="campaigns" element={<CampaignMargins />} />
          <Route path="reports" element={<Gate cap="finance"><FinanceReports /></Gate>} />
          <Route path="accounts" element={<Gate cap="finance"><Accounts /></Gate>} />
          <Route path="accounts/:id" element={<Gate cap="finance"><AccountPage /></Gate>} />
        </Routes>
      </div>
    </Gate>
  );
}

// ---------------------------------------------------------------- position

function Position() {
  const q = useApi<Row>('/api/finance/position?horizon=30');
  const [modal, setModal] = useState<null | 'in' | 'out' | 'transfer'>(null);
  return (
    <div className="stack">
      <PageHead title="Cash position" sub="Actual money, what is committed against it, and what is still free" actions={<><AnalyseButton type="finance_summary" cap="finance" period="this_month" /><MoneyActions onOpen={setModal} /></>} />
      <Async q={q}>
        {(p) => (
          <div className="stack">
            <div className="grid">
              <Stat hero label="Actual cash" value={<Money p={p.cash} />} foot="All active accounts, today" />
              <Stat label="Earmarked" value={<Money p={p.earmarks.total} />} foot={`Payables ${formatINR(p.earmarks.obligations, { compact: true })} · campaigns ${formatINR(p.earmarks.campaigns, { compact: true })} · reserves ${formatINR(p.earmarks.reserves, { compact: true })}`} to="/finance/allocations" />
              <Stat label="Unallocated cash" value={<Money p={p.unallocated} />} foot={p.unallocated < 0 ? 'Earmarks exceed cash' : 'Cash minus earmarks'} to="/finance/allocations" />
              <Stat label="Committed, due in 30 days" value={<Money p={p.selection.payables} />} foot={`Overdue ${formatINR(p.payables.overdue)}`} to="/finance/payables" />
              <Stat label="After 30-day commitments & protected reserves" value={<Money p={p.afterCommitments} />} />
              <Stat label="Expected incoming" value={<Money p={p.receivables.total} />} foot={`Overdue ${formatINR(p.receivables.overdue)}`} to="/finance/receivables" />
            </div>
            <div className="grid two">
              <Card title="Accounts" actions={<Link className="btn sm" to="/finance/accounts">Manage</Link>} flush>
                <table className="table">
                  <thead><tr><th>Account</th><th>Type</th><th className="num">Balance</th></tr></thead>
                  <tbody>{p.accounts.map((a: Row) => <tr key={a.id}><td><Link to={`/finance/accounts/${a.id}`}>{a.name}</Link>{!a.active && <Badge value="inactive" />}</td><td>{humanize(a.type)}</td><td className="num"><Money p={a.balance} /></td></tr>)}</tbody>
                  <tfoot><tr><td colSpan={2}>Total (active)</td><td className="num"><Money p={p.cash} /></td></tr></tfoot>
                </table>
              </Card>
              <Card title="What we owe, by category" flush>
                <table className="table">
                  <tbody>{Object.entries(p.payables.byCategory as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{humanize(k)}</td><td className="num"><Money p={v} /></td></tr>)}</tbody>
                  <tfoot><tr><td>Total unpaid</td><td className="num"><Money p={p.payables.total} /></td></tr></tfoot>
                </table>
              </Card>
            </div>
            <Card title="Overdue and due within 14 days" flush>
              <PayableTable rows={p.payables.items.filter((o: Row) => o.due_date <= addDays(p.today, 14))} />
            </Card>
          </div>
        )}
      </Async>
      <MoneyModals modal={modal} onClose={() => setModal(null)} />
    </div>
  );
}

function MoneyActions({ onOpen }: { onOpen: (m: 'in' | 'out' | 'transfer') => void }) {
  if (!useCan('finance')) return null;
  return (
    <>
      <button className="btn" onClick={() => onOpen('in')}><ArrowDownLeft /> Money in</button>
      <button className="btn" onClick={() => onOpen('out')}><ArrowUpRight /> Money out</button>
      <button className="btn" onClick={() => onOpen('transfer')}><ArrowLeftRight /> Transfer</button>
    </>
  );
}

function MoneyModals({ modal, onClose, preset }: { modal: null | 'in' | 'out' | 'transfer'; onClose: () => void; preset?: Row }) {
  return (
    <>
      <Modal open={modal === 'in' || modal === 'out'} onClose={onClose} title={modal === 'in' ? 'Record money received' : 'Record money paid'}>
        {(modal === 'in' || modal === 'out') && <RecordMoney direction={modal} preset={preset} onDone={onClose} />}
      </Modal>
      <Modal open={modal === 'transfer'} onClose={onClose} title="Transfer between accounts" size="narrow">
        {modal === 'transfer' && <TransferForm onDone={onClose} />}
      </Modal>
    </>
  );
}

function refreshFinance() {
  invalidate('/api/finance');
  invalidate('/api/dashboard');
  invalidate('/api/e/');
}

// ---------------------------------------------------------------- record money in/out

function RecordMoney({ direction, preset, onDone }: { direction: 'in' | 'out'; preset?: Row; onDone: () => void }) {
  const today = useToday();
  const accounts = useApi<{ rows: Row[] }>('/api/finance/accounts');
  const open = useApi<{ rows: Row[] }>(direction === 'in' ? '/api/finance/receivables?open=1' : '/api/finance/payables?open=1');
  const campaigns = useOptions('campaigns');
  const [key, renewKey] = useIdempotencyKey();
  const defaultCategory = direction === 'in' ? 'brand_payment' : 'creator_payout';
  const [v, setV] = useState<Row>({ txn_date: today, category: preset?.category ?? defaultCategory, amount: preset?.amount ?? null, counterparty_name: preset?.counterparty_name ?? '', campaign_id: preset?.campaign_id ?? null, reference: '', method: 'neft', description: preset?.description ?? '' });
  const [alloc, setAlloc] = useState<Record<number, { amount: number | null; tds: number | null }>>(() => (preset?.target ? { [preset.target.id]: { amount: preset.target.outstanding, tds: null } } : {}));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const set = (k: string, val: any) => setV((x) => ({ ...x, [k]: val }));
  useEffect(() => {
    if (!v.account_id && accounts.data?.rows.length) set('account_id', accounts.data.rows.find((a) => a.active && a.type === 'bank')?.id ?? accounts.data.rows[0].id);
  }, [accounts.data]);
  const [autoAlloc, setAutoAlloc] = useState(!!preset?.target);
  const allocated = Object.values(alloc).reduce((s, a) => s + (a.amount ?? 0), 0);
  // The record being paid is listed first.
  const targets = (open.data?.rows ?? [])
    .filter((r) => r.status !== 'cancelled' && (!filter || `${r.label ?? r.description} ${r.payer ?? r.payee ?? ''} ${r.campaign_name ?? ''}`.toLowerCase().includes(filter.toLowerCase())))
    .sort((a, b) => Number(b.id === preset?.target?.id) - Number(a.id === preset?.target?.id));
  const setAmount = (p: number | null) => {
    set('amount', p);
    if (autoAlloc && preset?.target) setAlloc({ ...alloc, [preset.target.id]: { amount: p === null ? null : Math.min(p, preset.target.outstanding), tds: alloc[preset.target.id]?.tds ?? null } });
  };
  const submit = async (allowDuplicate = false) => {
    setError('');
    if (!v.amount || v.amount <= 0) return setError('Enter the amount that actually moved');
    if (allocated > v.amount) return setError(`Allocated ${formatINR(allocated)} is more than the amount ${formatINR(v.amount)}`);
    setBusy(true);
    try {
      const allocations = Object.entries(alloc).filter(([, a]) => (a.amount ?? 0) > 0 || (a.tds ?? 0) > 0).map(([id, a]) => ({ [direction === 'in' ? 'invoice_id' : 'obligation_id']: Number(id), amount: a.amount ?? 0, tds: a.tds || undefined }));
      if (allocations.some((a) => !a.amount)) throw new Error('Each allocation needs a cash amount (record pure TDS/write-offs from the receivable or payable page)');
      await api('/api/finance/transactions', { body: { ...v, direction, allocations, idempotency_key: key, allow_duplicate: allowDuplicate } });
      toast(direction === 'in' ? 'Receipt recorded' : 'Payment recorded');
      renewKey();
      refreshFinance();
      onDone();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.details?.confirmable) {
        const ok = await confirmAction({ title: 'Possible duplicate', message: err.message, confirm: 'It is a separate payment — record it' });
        if (ok !== false) return submit(true);
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="alert info small">Record only money that has actually {direction === 'in' ? 'arrived in' : 'left'} an account. Expected money belongs in receivables or payables.</div>
      {error && <div className="alert bad" role="alert">{error}</div>}
      <div className="form-grid">
        <label className="field"><span>Account *</span><select className="input" value={v.account_id ?? ''} onChange={(e) => set('account_id', Number(e.target.value))}>{accounts.data?.rows.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name} ({formatINR(a.balance)})</option>)}</select></label>
        <label className="field"><span>Date *</span><input className="input" type="date" max={today} value={v.txn_date} onChange={(e) => set('txn_date', e.target.value)} /></label>
        <label className="field"><span>Amount *</span><MoneyField value={v.amount} onChange={setAmount} label="Amount" /></label>
        <label className="field"><span>Category *</span><select className="input" value={v.category} onChange={(e) => set('category', e.target.value)}>{TXN_CATEGORIES[direction].filter((c) => !c.startsWith('transfer') && !c.startsWith('uncategorised')).map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></label>
        <label className="field"><span>{direction === 'in' ? 'Received from' : 'Paid to'}</span><input className="input" value={v.counterparty_name} onChange={(e) => set('counterparty_name', e.target.value)} /></label>
        <label className="field"><span>Campaign</span><select className="input" value={v.campaign_id ?? ''} onChange={(e) => set('campaign_id', e.target.value ? Number(e.target.value) : null)}><option value="">Agency-level (no campaign)</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label className="field"><span>Bank / UPI reference</span><input className="input" placeholder="UTR, cheque no." value={v.reference} onChange={(e) => set('reference', e.target.value)} /><span className="hint">Prevents the same payment being recorded twice</span></label>
        <label className="field"><span>Method</span><select className="input" value={v.method} onChange={(e) => set('method', e.target.value)}>{['neft', 'imps', 'rtgs', 'upi', 'cash', 'cheque', 'card', 'other'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</select></label>
        <label className="field full"><span>Description</span><input className="input" value={v.description} onChange={(e) => set('description', e.target.value)} /></label>
      </div>
      <div className="stack tight">
        <div className="row between">
          <h3>{direction === 'in' ? 'Apply to receivables (optional)' : 'Apply to payables (optional)'}</h3>
          <input className="input" style={{ width: 220 }} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <p className="small muted">Supports partial payments. {direction === 'in' ? 'If the brand withheld TDS, enter it so the invoice settles without counting it as cash.' : 'If you deducted TDS, enter it; a TDS payable to the government is created automatically.'}</p>
        <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr><th>{direction === 'in' ? 'Receivable' : 'Payable'}</th><th className="num">Outstanding</th><th style={{ width: 150 }}>Cash applied</th><th style={{ width: 130 }}>TDS</th></tr></thead>
            <tbody>
              {targets.map((r) => (
                <tr key={r.id}>
                  <td><div>{r.label ?? r.description}</div><div className="small muted">{r.payer ?? r.payee ?? ''}{r.campaign_name ? ` · ${r.campaign_name}` : ''} · due {formatDate(r.due_date)}</div></td>
                  <td className="num"><Money p={r.outstanding} /></td>
                  <td><MoneyField value={alloc[r.id]?.amount ?? null} onChange={(p) => (setAutoAlloc(false), setAlloc({ ...alloc, [r.id]: { amount: p, tds: alloc[r.id]?.tds ?? null } }))} label="Cash applied" /></td>
                  <td><MoneyField value={alloc[r.id]?.tds ?? null} onChange={(p) => setAlloc({ ...alloc, [r.id]: { amount: alloc[r.id]?.amount ?? null, tds: p } })} label="TDS" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!targets.length && <Empty title="Nothing outstanding" />}
        </div>
        <div className="small">Applied <strong>{formatINR(allocated)}</strong> of {formatINR(v.amount ?? 0)} · unapplied {formatINR(Math.max(0, (v.amount ?? 0) - allocated))} stays on the transaction{v.campaign_id ? ' (tagged to the campaign)' : ''}</div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy} onClick={() => submit()}>{busy ? 'Saving…' : 'Record'}</button></div>
    </div>
  );
}

function TransferForm({ onDone }: { onDone: () => void }) {
  const today = useToday();
  const accounts = useApi<{ rows: Row[] }>('/api/finance/accounts');
  const [key] = useIdempotencyKey();
  const [v, setV] = useState<Row>({ txn_date: today, amount: null });
  const [error, setError] = useState('');
  const active = accounts.data?.rows.filter((a) => a.active) ?? [];
  return (
    <div className="stack">
      <div className="alert info small">Transfers move money between your own accounts. They are never counted as income or expense.</div>
      {error && <div className="alert bad">{error}</div>}
      <label className="field"><span>From</span><select className="input" value={v.from_account_id ?? ''} onChange={(e) => setV({ ...v, from_account_id: Number(e.target.value) })}><option value="">Choose…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatINR(a.balance)})</option>)}</select></label>
      <label className="field"><span>To</span><select className="input" value={v.to_account_id ?? ''} onChange={(e) => setV({ ...v, to_account_id: Number(e.target.value) })}><option value="">Choose…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="field"><span>Amount</span><MoneyField value={v.amount} onChange={(p) => setV({ ...v, amount: p })} /></label>
      <label className="field"><span>Date</span><input type="date" className="input" max={today} value={v.txn_date} onChange={(e) => setV({ ...v, txn_date: e.target.value })} /></label>
      <label className="field"><span>Reference</span><input className="input" value={v.reference ?? ''} onChange={(e) => setV({ ...v, reference: e.target.value })} /></label>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={async () => {
          try {
            await api('/api/finance/transfers', { body: { ...v, idempotency_key: key } });
            toast('Transfer recorded');
            refreshFinance();
            onDone();
          } catch (e) {
            setError((e as Error).message);
          }
        }}>Record transfer</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- transactions

const txnCols: Col[] = [
  { key: 'txn_date', label: 'Date', render: (r) => <span className="nowrap">{formatDate(r.txn_date)}</span> },
  { key: 'account_name', label: 'Account', filter: true },
  { key: 'description', label: 'Description', render: (r) => <span>{r.description ?? '—'} {r.reversal_of_id && <Badge tone="warn">Reversal of #{r.reversal_of_id}</Badge>}{r.reversed_by_id && <Badge tone="bad">Reversed</Badge>}{r.transfer_group && <Badge tone="info">Transfer</Badge>}</span> },
  { key: 'category', label: 'Category', filter: true, render: (r) => <Badge tone={r.category.startsWith('uncategorised') ? 'warn' : ''}>{humanize(r.category)}</Badge> },
  { key: 'counterparty_name', label: 'Counterparty', hidden: true },
  { key: 'campaign_name', label: 'Campaign', filter: true },
  { key: 'reference', label: 'Reference', hidden: true },
  { key: 'reconciliation', label: 'Reconciled', filter: true, render: (r) => <Badge value={r.reconciliation} /> },
  { key: 'unallocated', label: 'Unapplied', num: true, hidden: true, render: (r) => (r.unallocated && !r.transfer_group ? <Money p={r.unallocated} /> : '—') },
  { key: 'amount', label: 'Amount', num: true, value: (r) => (r.direction === 'in' ? r.amount : -r.amount), render: (r) => <Money p={r.direction === 'in' ? r.amount : -r.amount} signed />, csv: (r) => paiseToRupeesString(r.direction === 'in' ? r.amount : -r.amount) },
];

function Transactions() {
  const [sp, setSp] = useSearchParams();
  const today = useToday();
  const [from, setFrom] = useState(addDays(today, -90));
  const [to, setTo] = useState(today);
  const q = useApi<{ rows: Row[] }>(`/api/finance/transactions?from=${from}&to=${to}${sp.get('category') === 'uncategorised' ? '' : ''}`);
  const [modal, setModal] = useState<null | 'in' | 'out' | 'transfer' | 'import'>(sp.get('new') ? 'in' : null);
  const nav = useNavigate();
  const rows = (q.data?.rows ?? []).filter((r) => sp.get('category') !== 'uncategorised' || r.category.startsWith('uncategorised'));
  return (
    <div className="stack">
      <PageHead title="Transactions" sub="Every real money movement. Corrections are reversals — nothing is silently edited." actions={<><MoneyActions onOpen={setModal} /><button className="btn" onClick={() => setModal('import')}><Upload /> Import bank CSV</button></>} />
      {sp.get('category') === 'uncategorised' && <div className="alert warn row between">Showing uncategorised imported transactions only. <button className="btn sm" onClick={() => setSp({})}>Show all</button></div>}
      <div className="row">
        <label className="row small">From <input type="date" className="input" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="row small">To <input type="date" className="input" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <a className="btn sm" href={`/api/finance/transactions?from=${from}&to=${to}&format=csv`}>Download CSV</a>
      </div>
      <Async q={q}>
        {() => (
          <DataTable rows={rows} columns={txnCols} viewKey="transactions" exportName="transactions" onRowClick={(r) => nav(`/finance/transactions/${r.id}`)}
            bulk={[{ label: 'Mark reconciled', run: async (ids) => { for (const id of ids) await api(`/api/finance/transactions/${id}`, { method: 'PATCH', body: { reconciliation: 'reconciled' } }).catch(() => {}); toast('Updated'); q.reload(); } }]}
            footer={(rs) => <tr><td colSpan={txnCols.length}>Net of {rs.length} rows: <Money p={rs.filter((r) => !r.transfer_group).reduce((s, r) => s + (r.direction === 'in' ? r.amount : -r.amount), 0)} /> (transfers excluded)</td></tr>} />
        )}
      </Async>
      <MoneyModals modal={modal === 'import' ? null : modal} onClose={() => setModal(null)} />
      <Modal open={modal === 'import'} onClose={() => setModal(null)} title="Import bank statement (CSV)">
        {modal === 'import' && <ImportCsv onDone={() => (setModal(null), q.reload())} />}
      </Modal>
    </div>
  );
}

function ImportCsv({ onDone }: { onDone: () => void }) {
  const accounts = useApi<{ rows: Row[] }>('/api/finance/accounts');
  const [account, setAccount] = useState<number | null>(null);
  const [data, setData] = useState<Row[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Row>({});
  const [result, setResult] = useState<Row | null>(null);
  const guess = (hs: string[], ...words: string[]) => hs.find((h) => words.some((w) => h.toLowerCase().includes(w))) ?? '';
  const rows = useMemo(() => (data ?? []).map((r) => {
    const amount = map.amount ? r[map.amount] : (() => {
      const cr = String(r[map.credit] ?? '').replace(/[,\s]/g, '');
      const dr = String(r[map.debit] ?? '').replace(/[,\s]/g, '');
      return cr && Number(cr) ? cr : dr && Number(dr) ? `-${dr}` : '';
    })();
    return { date: r[map.date], description: r[map.description], reference: map.reference ? r[map.reference] : undefined, amount };
  }).filter((r) => r.date || r.amount), [data, map]);
  return (
    <div className="stack">
      <p className="small muted">Rows are imported as uncategorised and unreconciled; re-importing the same statement skips duplicates. Dates like 03/10/2026 are read as day/month/year.</p>
      <label className="field"><span>Account</span><select className="input" value={account ?? ''} onChange={(e) => setAccount(Number(e.target.value))}><option value="">Choose…</option>{accounts.data?.rows.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <input type="file" accept=".csv,text/csv" onChange={(e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        Papa.parse<Row>(file, {
          header: true,
          skipEmptyLines: true,
          complete: (res) => {
            const hs = res.meta.fields ?? [];
            setHeaders(hs);
            setData(res.data);
            setMap({ date: guess(hs, 'date'), description: guess(hs, 'narration', 'description', 'particular', 'remark'), reference: guess(hs, 'ref', 'utr', 'chq', 'cheque'), debit: guess(hs, 'withdrawal', 'debit', 'dr'), credit: guess(hs, 'deposit', 'credit', 'cr'), amount: '' });
          },
        });
      }} />
      {data && (
        <>
          <div className="form-grid">
            {['date', 'description', 'reference', 'amount', 'debit', 'credit'].map((k) => (
              <label key={k} className="field"><span>{k === 'amount' ? 'Signed amount (or use debit/credit)' : humanize(k)}</span>
                <select className="input" value={map[k] ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value })}><option value="">—</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</select>
              </label>
            ))}
          </div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="num">Amount</th></tr></thead>
            <tbody>{rows.slice(0, 6).map((r, i) => <tr key={i}><td>{r.date}</td><td>{r.description}</td><td>{r.reference}</td><td className="num">{r.amount}</td></tr>)}</tbody></table></div>
          <p className="small muted">{rows.length} rows ready.</p>
        </>
      )}
      {result && <div className={`alert ${result.errors.length ? 'warn' : 'good'}`}>Imported {result.imported}, skipped {result.duplicates} duplicates{result.errors.length ? `, ${result.errors.length} errors: ${result.errors.slice(0, 3).map((e: Row) => `row ${e.row}: ${e.error}`).join('; ')}` : ''}.</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {result ? <button className="btn primary" onClick={onDone}>Done</button> : <button className="btn primary" disabled={!account || !rows.length} onClick={async () => {
          try {
            setResult(await api('/api/finance/import', { body: { account_id: account, rows } }));
            refreshFinance();
          } catch (e) {
            toast((e as Error).message, 'error');
          }
        }}>Import {rows.length} rows</button>}
      </div>
    </div>
  );
}

function TransactionPage() {
  const { id } = useParams();
  const q = useApi<Row>(`/api/finance/transactions/${id}`);
  const campaigns = useOptions('campaigns');
  const [allocating, setAllocating] = useState(false);
  return (
    <Async q={q}>
      {({ row: t, settlements, legs }) => {
        const applied = settlements.filter((s: Row) => !s.reversed_at && s.kind === 'cash').reduce((a: number, s: Row) => a + s.amount, 0);
        const cats = TXN_CATEGORIES[t.direction as 'in' | 'out'].filter((c) => !c.startsWith('transfer'));
        const patch = (body: Row) => attempt(() => api(`/api/finance/transactions/${t.id}`, { method: 'PATCH', body }), 'Saved').then((ok) => ok && (q.reload(), refreshFinance()));
        return (
          <div className="stack">
            <PageHead title={<>{t.direction === 'in' ? 'Money in' : 'Money out'}: <Money p={t.amount} /> <DemoTag row={t} /></>} sub={`${formatDate(t.txn_date)} · ${t.account_name} · #${t.id}`}
              actions={!t.reversed_by_id && !t.reversal_of_id && <button className="btn danger" onClick={async () => {
                const reason = await confirmAction({ title: 'Reverse this transaction?', message: `An equal and opposite entry will be posted${t.transfer_group ? ' for both legs of the transfer' : ''}; payments it settled become outstanding again. The original stays in history.`, confirm: 'Post reversal', danger: true, reason: true });
                if (reason === false) return;
                if (await attempt(() => api(`/api/finance/transactions/${t.id}/reverse`, { body: { reason } }), 'Reversal posted')) (q.reload(), refreshFinance());
              }}>Reverse</button>} />
            {t.reversed_by_id && <div className="alert warn">Reversed by <Link to={`/finance/transactions/${t.reversed_by_id}`}>#{t.reversed_by_id}</Link>. It no longer affects balances.</div>}
            {t.reversal_of_id && <div className="alert info">This is the reversal of <Link to={`/finance/transactions/${t.reversal_of_id}`}>#{t.reversal_of_id}</Link>.</div>}
            <div className="grid two">
              <Card title="Classification" hint="Amount, date and account are fixed; reverse and re-record to change them.">
                <div className="form-grid">
                  <label className="field"><span>Category</span><select className="input" disabled={!!t.transfer_group} value={t.category} onChange={(e) => patch({ category: e.target.value })}>{[...cats, ...(t.transfer_group ? [t.category] : [])].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></label>
                  <label className="field"><span>Campaign</span><select className="input" value={t.campaign_id ?? ''} onChange={(e) => patch({ campaign_id: e.target.value ? Number(e.target.value) : null })}><option value="">Agency-level</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
                  <label className="field"><span>Reconciliation</span><select className="input" value={t.reconciliation} onChange={(e) => patch({ reconciliation: e.target.value })}>{['unreconciled', 'reconciled', 'flagged'].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></label>
                  <label className="field"><span>Counterparty</span><input className="input" defaultValue={t.counterparty_name ?? ''} onBlur={(e) => e.target.value !== (t.counterparty_name ?? '') && patch({ counterparty_name: e.target.value })} /></label>
                  <label className="field full"><span>Description</span><input className="input" defaultValue={t.description ?? ''} onBlur={(e) => e.target.value !== (t.description ?? '') && patch({ description: e.target.value })} /></label>
                  <label className="field full"><span>Notes</span><input className="input" defaultValue={t.notes ?? ''} onBlur={(e) => e.target.value !== (t.notes ?? '') && patch({ notes: e.target.value })} /></label>
                </div>
                <dl className="kv small" style={{ marginTop: 12 }}><dt>Reference</dt><dd>{t.reference ?? '—'}</dd><dt>Method</dt><dd>{t.method ?? '—'}</dd><dt>Recorded</dt><dd>{formatDate(t.created_at)}</dd></dl>
              </Card>
              <Card title={t.transfer_group ? 'Transfer legs' : 'Applied to'} actions={!t.transfer_group && !t.reversed_by_id && !t.reversal_of_id && applied < t.amount && <button className="btn sm" onClick={() => setAllocating(true)}>Apply remaining {formatINR(t.amount - applied)}</button>}>
                {t.transfer_group ? legs.map((l: Row) => <div key={l.id} className="row between"><Link to={`/finance/transactions/${l.id}`}>{l.direction === 'out' ? 'From' : 'To'} {l.account_name}</Link><Money p={l.amount} /></div>) : settlements.length ? (
                  <div className="list">{settlements.map((s: Row) => (
                    <div key={s.id} className="list-item">
                      <div className="grow">{s.invoice_id ? <Link to={`/finance/receivables/${s.invoice_id}`}>{s.number ?? s.invoice_label}</Link> : <Link to={`/finance/payables/${s.obligation_id}`}>{s.obligation_label}</Link>} <Badge value={s.kind} />{s.reversed_at && <Badge tone="bad">Reversed: {s.reversed_reason}</Badge>}</div>
                      <Money p={s.amount} />
                      {!s.reversed_at && <button className="btn ghost sm" onClick={async () => {
                        const reason = await confirmAction({ title: 'Un-apply this amount?', message: 'The money stays recorded; only the link to this receivable/payable is removed.', confirm: 'Un-apply', reason: true });
                        if (reason !== false && (await attempt(() => api(`/api/finance/settlements/${s.id}/reverse`, { body: { reason } }), 'Un-applied'))) (q.reload(), refreshFinance());
                      }}>Un-apply</button>}
                    </div>
                  ))}</div>
                ) : <Empty title="Not applied to any receivable or payable" />}
              </Card>
            </div>
            <Card title="Receipt / supporting document" hint="Bank advice, invoice or payment screenshot. Stored privately.">
              {t.receipt_document_id ? <Link to={`/documents/${t.receipt_document_id}`}>Open attached document</Link> : (
                <input type="file" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const ok = await attempt(async () => {
                    const doc = await api('/api/e/documents', { body: { title: `Receipt — ${t.description ?? `transaction #${t.id}`}`, kind: 'receipt', entity_type: 'transactions', entity_id: t.id } });
                    await api(`/api/documents/${doc.row.id}/file`, { raw: file, headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': file.name } });
                    await api(`/api/finance/transactions/${t.id}`, { method: 'PATCH', body: { receipt_document_id: doc.row.id } });
                  }, 'Receipt attached');
                  if (ok) q.reload();
                }} />
              )}
            </Card>
            <Card title="Activity"><Activity entity="transactions" id={t.id} /></Card>
            <Modal open={allocating} onClose={() => setAllocating(false)} title="Apply to receivables / payables">
              {allocating && <AllocateExisting t={t} remaining={t.amount - applied} onDone={() => (setAllocating(false), q.reload(), refreshFinance())} />}
            </Modal>
          </div>
        );
      }}
    </Async>
  );
}

function AllocateExisting({ t, remaining, onDone }: { t: Row; remaining: number; onDone: () => void }) {
  const open = useApi<{ rows: Row[] }>(t.direction === 'in' ? '/api/finance/receivables?open=1' : '/api/finance/payables?open=1');
  const [alloc, setAlloc] = useState<Record<number, number | null>>({});
  const total = Object.values(alloc).reduce((s: number, a) => s + (a ?? 0), 0);
  return (
    <div className="stack">
      <p className="small">Remaining to apply: <strong>{formatINR(remaining)}</strong> · selected {formatINR(total)}</p>
      <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
        <table className="table"><tbody>{(open.data?.rows ?? []).map((r) => (
          <tr key={r.id}><td>{r.label ?? r.description}<div className="small muted">{r.payer ?? r.payee}{r.campaign_name ? ` · ${r.campaign_name}` : ''}</div></td><td className="num"><Money p={r.outstanding} /></td><td style={{ width: 160 }}><MoneyField value={alloc[r.id] ?? null} onChange={(p) => setAlloc({ ...alloc, [r.id]: p })} /></td></tr>
        ))}</tbody></table>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" disabled={!total || total > remaining} onClick={async () => {
          const allocations = Object.entries(alloc).filter(([, a]) => a).map(([id, amount]) => ({ [t.direction === 'in' ? 'invoice_id' : 'obligation_id']: Number(id), amount }));
          if (await attempt(() => api(`/api/finance/transactions/${t.id}/allocate`, { body: { allocations } }), 'Applied')) onDone();
        }}>Apply</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- receivables

const recCols: Col[] = [
  { key: 'label', label: 'Milestone', render: (r) => <span>{r.label} <DemoTag row={r} /></span> },
  { key: 'number', label: 'Invoice no.', render: (r) => r.number ?? <span className="muted">Not invoiced</span> },
  { key: 'payer', label: 'Payer', filter: true },
  { key: 'campaign_name', label: 'Campaign', filter: true },
  { key: 'kind', label: 'Type', filter: true, options: ['brand_billing', 'commission', 'other'], render: (r) => <Badge value={r.kind} /> },
  { key: 'status', label: 'Status', filter: true, options: ['scheduled', 'issued', 'cancelled'], render: (r) => <Badge value={r.status} /> },
  { key: 'confidence', label: 'Confidence', filter: true, options: ['confirmed', 'expected', 'at_risk', 'delayed'], render: (r) => <Badge value={r.confidence} /> },
  { key: 'due_date', label: 'Due', render: (r) => <span className={r.days_overdue ? 'neg nowrap' : 'nowrap'}>{formatDate(r.due_date)}{r.days_overdue ? ` (${r.days_overdue}d)` : ''}</span> },
  { key: 'expected_date', label: 'Expected', render: (r) => <span className="nowrap">{formatDate(r.expected_date)}</span> },
  { key: 'total', label: 'Total', num: true, render: (r) => <Money p={r.total} />, csv: (r) => paiseToRupeesString(r.total) },
  { key: 'paid', label: 'Received', num: true, render: (r) => <Money p={r.paid} />, csv: (r) => paiseToRupeesString(r.paid) },
  { key: 'tds', label: 'TDS', num: true, hidden: true, render: (r) => <Money p={r.tds} /> },
  { key: 'outstanding', label: 'Outstanding', num: true, render: (r) => <Money p={r.outstanding} />, csv: (r) => paiseToRupeesString(r.outstanding) },
  { key: 'payment_state', label: 'Payment', filter: true, render: (r) => <Badge value={r.payment_state} /> },
];

function Receivables() {
  const q = useApi<{ rows: Row[]; ageing: Row[] }>('/api/finance/receivables');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const fin = useCan('finance');
  return (
    <div className="stack">
      <PageHead title="Receivables & invoices" sub="Who owes us money. Scheduled milestones are expected but not yet invoiced; nothing here is cash until received."
        actions={<><a className="btn" href="/api/finance/receivables?format=csv">CSV</a>{fin && <button className="btn primary" onClick={() => setCreating(true)}>New receivable</button>}</>} />
      <Async q={q}>
        {(d) => (
          <div className="stack">
            <AgeingBar rows={d.ageing} label="Outstanding by days overdue" />
            <DataTable rows={d.rows} columns={recCols} viewKey="receivables" onRowClick={(r) => nav(`/finance/receivables/${r.id}`)} initialSort={['expected_date', 'asc']}
              footer={(rs) => <tr><td colSpan={9}>Total</td><td className="num"><Money p={rs.reduce((s, r) => s + r.total, 0)} /></td><td className="num"><Money p={rs.reduce((s, r) => s + r.paid, 0)} /></td><td className="num"><Money p={rs.reduce((s, r) => s + r.outstanding, 0)} /></td><td /></tr>} />
          </div>
        )}
      </Async>
      <Modal open={creating} onClose={() => setCreating(false)} title="New receivable / payment milestone">
        <EntityForm entity="invoices" onSaved={(r) => (setCreating(false), refreshFinance(), nav(`/finance/receivables/${r.id}`))} />
      </Modal>
    </div>
  );
}

function AgeingBar({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
      {rows.map((a) => <Stat key={a.bucket} label={a.bucket} value={<Money p={a.total} compact />} foot={`${a.count} item${a.count === 1 ? '' : 's'} · ${label}`} />)}
    </div>
  );
}

function ReceivablePage() {
  const { id } = useParams();
  const all = useApi<{ rows: Row[] }>('/api/finance/receivables');
  const s = useApi<{ rows: Row[] }>(`/api/finance/settlements?invoice_id=${id}`);
  const [modal, setModal] = useState<null | 'pay' | 'adjust' | 'edit'>(null);
  const fin = useCan('finance');
  const r = all.data?.rows.find((x) => String(x.id) === id);
  if (!r) return all.error ? <Card>{all.error.message}</Card> : all.data ? <Card>Receivable not found.</Card> : <div className="skeleton" style={{ height: 120 }} />;
  const reload = () => (all.reload(), s.reload(), refreshFinance());
  return (
    <div className="stack">
      <PageHead title={<>{r.label} — {r.payer ?? '—'} <DemoTag row={r} /></>} sub={<>{r.number ?? 'Scheduled milestone (not yet invoiced)'} · <Badge value={r.status} /> <Badge value={r.payment_state} /> <Badge value={r.confidence} /></>}
        actions={fin && r.status !== 'cancelled' && <>
          {r.outstanding > 0 && <button className="btn primary" onClick={() => setModal('pay')}>Record receipt</button>}
          {r.status === 'scheduled' && <button className="btn" onClick={async () => {
            const ok = await confirmAction({ title: 'Issue invoice?', message: 'Assigns the next invoice number (SM/FY/####) and today’s date. This counts toward gross billings.', confirm: 'Issue' });
            if (ok !== false && (await attempt(() => api(`/api/finance/invoices/${r.id}/issue`, { body: {} }), 'Invoice issued'))) reload();
          }}>Issue invoice</button>}
          {r.outstanding > 0 && <button className="btn" onClick={() => setModal('adjust')}>TDS / write-off</button>}
          <button className="btn" onClick={() => setModal('edit')}>Edit</button>
          {!r.paid && <button className="btn danger" onClick={async () => {
            const reason = await confirmAction({ title: 'Cancel this receivable?', message: 'It stays in history marked cancelled and stops counting as expected income.', confirm: 'Cancel receivable', danger: true, reason: true });
            if (reason !== false && (await attempt(() => api(`/api/finance/invoices/${r.id}/cancel`, { body: { reason } }), 'Cancelled'))) reload();
          }}>Cancel</button>}
        </>} />
      <div className="grid">
        <Stat label="Total (incl. tax)" value={<Money p={r.total} />} foot={`Subtotal ${formatINR(r.subtotal)} + tax ${formatINR(r.tax)}`} />
        <Stat label="Received (cash)" value={<Money p={r.paid} />} />
        <Stat label="TDS / written off" value={<Money p={r.tds + r.written_off} />} />
        <Stat label="Outstanding" value={<Money p={r.outstanding} />} foot={r.days_overdue ? `${r.days_overdue} days overdue` : `Expected ${formatDate(r.expected_date)}`} />
      </div>
      <div className="grid two">
        <Card title="Details"><Details entity="invoices" row={{ ...r, brand_id_label: r.brand_name, campaign_id_label: r.campaign_name, influencer_id_label: r.influencer_name }} /></Card>
        <Card title="Payment history">
          <Async q={s}>{(d) => d.rows.length ? <SettlementList rows={d.rows} onChange={reload} /> : <Empty title="No payments yet" />}</Async>
        </Card>
      </div>
      <Card title="Notes & follow-ups"><Timeline entity="invoices" id={r.id} /></Card>
      <MoneyModals modal={modal === 'pay' ? 'in' : null} onClose={() => (setModal(null), reload())} preset={{ target: r, amount: r.outstanding, category: r.kind === 'commission' ? 'commission_income' : 'brand_payment', counterparty_name: r.payer, campaign_id: r.campaign_id, description: `${r.label}${r.number ? ` (${r.number})` : ''}` }} />
      <Modal open={modal === 'adjust'} onClose={() => setModal(null)} title="Record TDS or write-off" size="narrow">{modal === 'adjust' && <Adjust target={{ invoice_id: r.id }} kinds={['tds', 'write_off']} max={r.outstanding} onDone={() => (setModal(null), reload())} />}</Modal>
      <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit receivable">{modal === 'edit' && <EntityForm entity="invoices" record={r} onSaved={() => (setModal(null), reload())} />}</Modal>
    </div>
  );
}

function SettlementList({ rows, onChange }: { rows: Row[]; onChange: () => void }) {
  const fin = useCan('finance');
  return (
    <div className="list">
      {rows.map((s) => (
        <div key={s.id} className="list-item">
          <div className="grow">
            <div><Badge value={s.kind} /> {formatDate(s.settled_on)} {s.transaction_id && <Link to={`/finance/transactions/${s.transaction_id}`}>{s.account_name} · {s.reference ?? `#${s.transaction_id}`}</Link>}</div>
            <div className="small muted">{s.reason ?? ''}{s.created_by_name ? ` · by ${s.created_by_name}` : ''}{s.reversed_at ? ` · reversed: ${s.reversed_reason}` : ''}</div>
          </div>
          <span className={s.reversed_at ? 'muted' : ''} style={s.reversed_at ? { textDecoration: 'line-through' } : undefined}><Money p={s.amount} /></span>
          {fin && !s.reversed_at && !s.transaction_id && <button className="btn ghost sm" onClick={async () => {
            const reason = await confirmAction({ title: 'Reverse this adjustment?', confirm: 'Reverse', reason: true });
            if (reason !== false && (await attempt(() => api(`/api/finance/settlements/${s.id}/reverse`, { body: { reason } }), 'Reversed'))) onChange();
          }}>Reverse</button>}
        </div>
      ))}
    </div>
  );
}

function Adjust({ target, kinds, max, onDone }: { target: Row; kinds: string[]; max: number; onDone: () => void }) {
  const today = useToday();
  const [v, setV] = useState<Row>({ kind: kinds[0], amount: null, settled_on: today, reason: '' });
  const [err, setErr] = useState('');
  const labels: Record<string, string> = { tds: 'TDS (withheld/deducted)', write_off: 'Write-off (bad debt)', waiver: 'Waived (not payable)' };
  return (
    <div className="stack">
      <p className="small muted">Non-cash settlement — bank balances don't change. Max {formatINR(max)}.</p>
      {err && <div className="alert bad">{err}</div>}
      <label className="field"><span>Type</span><select className="input" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{kinds.map((k) => <option key={k} value={k}>{labels[k]}</option>)}</select></label>
      <label className="field"><span>Amount</span><MoneyField value={v.amount} onChange={(p) => setV({ ...v, amount: p })} /></label>
      <label className="field"><span>Date</span><input type="date" className="input" max={today} value={v.settled_on} onChange={(e) => setV({ ...v, settled_on: e.target.value })} /></label>
      <label className="field"><span>Reason *</span><input className="input" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></label>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={async () => {
        try {
          await api('/api/finance/settlements', { body: { ...target, ...v } });
          toast('Recorded');
          onDone();
        } catch (e) {
          setErr((e as Error).message);
        }
      }}>Record</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- payables

export function PayableTable({ rows }: { rows: Row[] }) {
  const nav = useNavigate();
  const cols: Col[] = [
    { key: 'description', label: 'Payable', render: (r) => <span>{r.description} <DemoTag row={r} /></span> },
    { key: 'payee', label: 'Payee', filter: true },
    { key: 'category', label: 'Category', filter: true, render: (r) => humanize(r.category) },
    { key: 'campaign_name', label: 'Campaign', filter: true },
    { key: 'status', label: 'Status', filter: true, render: (r) => <Badge value={r.status} /> },
    { key: 'due_date', label: 'Due', render: (r) => <span className={r.days_overdue ? 'neg nowrap' : 'nowrap'}>{formatDate(r.due_date)}{r.days_overdue ? ` (${r.days_overdue}d late)` : ''}</span> },
    { key: 'amount', label: 'Amount', num: true, render: (r) => <Money p={r.amount} />, csv: (r) => paiseToRupeesString(r.amount) },
    { key: 'paid', label: 'Paid', num: true, render: (r) => <Money p={r.paid + r.tds} />, csv: (r) => paiseToRupeesString(r.paid) },
    { key: 'outstanding', label: 'Outstanding', num: true, render: (r) => <Money p={r.outstanding} />, csv: (r) => paiseToRupeesString(r.outstanding) },
    { key: 'earmarked', label: 'Earmarked', num: true, render: (r) => (r.earmarked ? <Money p={r.earmarked} /> : <span className="muted">—</span>) },
    { key: 'payment_state', label: 'Payment', filter: true, render: (r) => <Badge value={r.payment_state} /> },
  ];
  return <DataTable rows={rows} columns={cols} viewKey="payables" onRowClick={(r) => nav(`/finance/payables/${r.id}`)} initialSort={['due_date', 'asc']}
    footer={(rs) => <tr><td colSpan={6}>Total</td><td className="num"><Money p={rs.reduce((s, r) => s + r.amount, 0)} /></td><td className="num"><Money p={rs.reduce((s, r) => s + r.paid + r.tds, 0)} /></td><td className="num"><Money p={rs.reduce((s, r) => s + r.outstanding, 0)} /></td><td className="num"><Money p={rs.reduce((s, r) => s + r.earmarked, 0)} /></td><td /></tr>} />;
}

function Payables() {
  const q = useApi<{ rows: Row[]; ageing: Row[] }>('/api/finance/payables');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const fin = useCan('finance');
  return (
    <div className="stack">
      <PageHead title="Payables & obligations" sub="Whom we owe: creators, editors, vendors, operating costs, taxes and loans" actions={<><a className="btn" href="/api/finance/payables?format=csv">CSV</a>{fin && <button className="btn primary" onClick={() => setCreating(true)}>New payable</button>}</>} />
      <Async q={q}>{(d) => <div className="stack"><AgeingBar rows={d.ageing} label="overdue" /><PayableTable rows={d.rows} /></div>}</Async>
      <Modal open={creating} onClose={() => setCreating(false)} title="New payable">
        <EntityForm entity="obligations" onSaved={(r) => (setCreating(false), refreshFinance(), nav(`/finance/payables/${r.id}`))} />
      </Modal>
    </div>
  );
}

function PayablePage() {
  const { id } = useParams();
  const all = useApi<{ rows: Row[] }>('/api/finance/payables');
  const s = useApi<{ rows: Row[] }>(`/api/finance/settlements?obligation_id=${id}`);
  const [modal, setModal] = useState<null | 'pay' | 'adjust' | 'edit' | 'earmark'>(null);
  const fin = useCan('finance');
  const o = all.data?.rows.find((x) => String(x.id) === id);
  if (!o) return all.error ? <Card>{all.error.message}</Card> : all.data ? <Card>Payable not found.</Card> : <div className="skeleton" style={{ height: 120 }} />;
  const reload = () => (all.reload(), s.reload(), refreshFinance());
  return (
    <div className="stack">
      <PageHead title={<>{o.description} <DemoTag row={o} /></>} sub={<>{o.payee ?? '—'} · {humanize(o.category)} · <Badge value={o.status} /> <Badge value={o.payment_state} />{o.repeat !== 'none' && <Badge tone="info">Repeats {o.repeat}</Badge>}</>}
        actions={fin && o.status !== 'cancelled' && <>
          {o.outstanding > 0 && <button className="btn primary" onClick={() => setModal('pay')}>Record payment</button>}
          {o.outstanding > 0 && <button className="btn" onClick={() => setModal('earmark')}>Earmark cash</button>}
          {o.outstanding > 0 && <button className="btn" onClick={() => setModal('adjust')}>TDS / waive</button>}
          <button className="btn" onClick={() => setModal('edit')}>Edit</button>
          {!o.paid && <button className="btn danger" onClick={async () => {
            const reason = await confirmAction({ title: 'Cancel this payable?', message: 'It stays in history marked cancelled. Earmarks on it are released.', confirm: 'Cancel payable', danger: true, reason: true });
            if (reason !== false && (await attempt(() => api(`/api/finance/obligations/${o.id}/cancel`, { body: { reason } }), 'Cancelled'))) reload();
          }}>Cancel</button>}
        </>} />
      <div className="grid">
        <Stat label="Amount" value={<Money p={o.amount} />} />
        <Stat label="Paid (cash)" value={<Money p={o.paid} />} foot={o.tds ? `+ ${formatINR(o.tds)} TDS deducted` : undefined} />
        <Stat label="Outstanding" value={<Money p={o.outstanding} />} foot={o.days_overdue ? `${o.days_overdue} days overdue` : `Due ${formatDate(o.due_date)}`} />
        <Stat label="Earmarked" value={<Money p={o.earmarked} />} foot={o.unfunded ? `${formatINR(o.unfunded)} not yet earmarked` : 'Fully earmarked'} />
      </div>
      <div className="grid two">
        <Card title="Details"><Details entity="obligations" row={{ ...o, campaign_id_label: o.campaign_name, influencer_id_label: o.influencer_name, editor_id_label: o.editor_name }} /></Card>
        <Card title="Payment history"><Async q={s}>{(d) => d.rows.length ? <SettlementList rows={d.rows} onChange={reload} /> : <Empty title="No payments yet" />}</Async></Card>
      </div>
      <MoneyModals modal={modal === 'pay' ? 'out' : null} onClose={() => (setModal(null), reload())} preset={{ target: o, amount: o.outstanding, category: ({ creator_payout: 'creator_payout', editor_payout: 'editor_payout', vendor_payment: 'vendor_payment', asset_purchase: 'asset_purchase', tax: 'tax_payment', loan_repayment: 'loan_repayment', founder_withdrawal: 'founder_withdrawal' } as Row)[o.category] ?? 'operating_expense', counterparty_name: o.payee, campaign_id: o.campaign_id, description: o.description }} />
      <Modal open={modal === 'adjust'} onClose={() => setModal(null)} title="TDS deducted or waived" size="narrow">{modal === 'adjust' && <Adjust target={{ obligation_id: o.id }} kinds={['tds', 'waiver']} max={o.outstanding} onDone={() => (setModal(null), reload())} />}</Modal>
      <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit payable">{modal === 'edit' && <EntityForm entity="obligations" record={o} onSaved={() => (setModal(null), reload())} />}</Modal>
      <Modal open={modal === 'earmark'} onClose={() => setModal(null)} title="Earmark cash for this payable" size="narrow">{modal === 'earmark' && <EarmarkForm preset={{ target_type: 'obligation', obligation_id: o.id, amount: o.unfunded }} onDone={() => (setModal(null), reload())} />}</Modal>
    </div>
  );
}

// ---------------------------------------------------------------- allocations

function EarmarkForm({ preset, onDone }: { preset?: Row; onDone: () => void }) {
  const [v, setV] = useState<Row>({ target_type: 'reserve', amount: null, protected: true, reason: '', ...preset });
  const campaigns = useOptions('campaigns');
  const payables = useApi<{ rows: Row[] }>(v.target_type === 'obligation' && !preset?.obligation_id ? '/api/finance/payables?open=1' : null);
  const [err, setErr] = useState('');
  return (
    <div className="stack">
      <div className="alert info small">An earmark is an internal allocation of cash you already hold. No money moves between accounts.</div>
      {err && <div className="alert bad">{err}</div>}
      {!preset?.obligation_id && (
        <label className="field"><span>Earmark for</span><select className="input" value={v.target_type} onChange={(e) => setV({ ...v, target_type: e.target.value })}><option value="reserve">A reserve (tax, operations, contingency)</option><option value="obligation">A specific payable</option><option value="campaign">A campaign's costs</option></select></label>
      )}
      {v.target_type === 'reserve' && <label className="field"><span>Reserve name</span><input className="input" placeholder="e.g. GST reserve" value={v.label ?? ''} onChange={(e) => setV({ ...v, label: e.target.value })} /></label>}
      {v.target_type === 'reserve' && <label className="check"><input type="checkbox" checked={!!v.protected} onChange={(e) => setV({ ...v, protected: e.target.checked })} /> Protected — conservative forecasts treat it as untouchable</label>}
      {v.target_type === 'campaign' && <label className="field"><span>Campaign</span><select className="input" value={v.campaign_id ?? ''} onChange={(e) => setV({ ...v, campaign_id: Number(e.target.value) })}><option value="">Choose…</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
      {v.target_type === 'obligation' && !preset?.obligation_id && <label className="field"><span>Payable</span><select className="input" value={v.obligation_id ?? ''} onChange={(e) => setV({ ...v, obligation_id: Number(e.target.value) })}><option value="">Choose…</option>{payables.data?.rows.map((o) => <option key={o.id} value={o.id}>{o.description} — {o.payee} ({formatINR(o.unfunded)} unfunded)</option>)}</select></label>}
      <label className="field"><span>Amount</span><MoneyField value={v.amount} onChange={(p) => setV({ ...v, amount: p })} /></label>
      <label className="field"><span>Note</span><input className="input" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></label>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={async () => {
        try {
          await api('/api/finance/earmarks', { body: v });
          toast('Earmarked');
          refreshFinance();
          onDone();
        } catch (e) {
          setErr((e as Error).message);
        }
      }}>Earmark</button></div>
    </div>
  );
}

function Allocations() {
  const pos = useApi<Row>('/api/finance/position?horizon=all');
  const hist = useApi<{ rows: Row[] }>('/api/finance/earmarks?history=1');
  const camps = useApi<{ rows: Row[] }>('/api/finance/campaigns');
  const [creating, setCreating] = useState(false);
  const change = async (e: Row, release: boolean) => {
    const reason = await confirmAction({ title: release ? 'Release this earmark?' : 'Change earmark amount', message: release ? 'The cash becomes unallocated. The history is kept.' : 'The old earmark is closed and a new one created, so history is preserved.', confirm: release ? 'Release' : 'Continue', reason: true });
    if (reason === false) return;
    let amount: number | null = null;
    if (!release) {
      const text = window.prompt('New amount in ₹', String(e.amount / 100));
      if (!text) return;
      amount = Math.round(Number(text.replace(/[,₹\s]/g, '')) * 100);
      if (!Number.isFinite(amount) || amount <= 0) return toast('Invalid amount', 'error');
    }
    if (await attempt(() => api(`/api/finance/earmarks/${e.id}/change`, { body: { amount, reason } }), 'Updated')) (hist.reload(), pos.reload(), refreshFinance());
  };
  return (
    <div className="stack">
      <PageHead title="Cash allocations" sub="Earmark cash for obligations and reserves. Bank money is pooled: a campaign's cash is only 'its own' where an allocation says so." actions={<button className="btn primary" onClick={() => setCreating(true)}>New earmark</button>} />
      <Async q={pos}>
        {(p) => (
          <div className="grid">
            <Stat label="Actual cash" value={<Money p={p.cash} />} />
            <Stat label="Earmarked for payables" value={<Money p={p.earmarks.obligations} />} />
            <Stat label="Earmarked for campaigns" value={<Money p={p.earmarks.campaigns} />} />
            <Stat label="Reserves" value={<Money p={p.earmarks.reserves} />} />
            <Stat label="Unallocated" value={<Money p={p.unallocated} />} foot={p.unallocated < 0 ? 'Over-allocated: earmarks exceed cash' : undefined} />
          </div>
        )}
      </Async>
      <Card title="Active earmarks" flush>
        <Async q={hist}>{(d) => {
          const active = d.rows.filter((e) => e.status === 'active');
          return active.length ? (
            <table className="table">
              <thead><tr><th>For</th><th>Type</th><th>Note</th><th>Created</th><th className="num">Amount</th><th className="num">Effective</th><th /></tr></thead>
              <tbody>{active.map((e) => (
                <tr key={e.id}>
                  <td>{e.target_type === 'reserve' ? <>{e.label} {e.protected && <Badge tone="info">Protected</Badge>}</> : e.target_type === 'obligation' ? <Link to={`/finance/payables/${e.obligation_id}`}>{e.obligation_label}</Link> : <Link to={`/campaigns/${e.campaign_id}`}>{e.campaign_name}</Link>}</td>
                  <td>{humanize(e.target_type)}</td><td className="small">{e.reason}</td><td className="small">{formatDate(e.created_at)} · {e.created_by_name}</td>
                  <td className="num"><Money p={e.amount} /></td><td className="num"><Money p={e.effective} /></td>
                  <td className="nowrap"><button className="btn ghost sm" onClick={() => change(e, false)}>Change</button><button className="btn ghost sm" onClick={() => change(e, true)}>Release</button></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty title="No earmarks yet" hint="Set aside cash for upcoming creator payouts, GST, or an operations buffer." />;
        }}</Async>
      </Card>
      <Card title="Campaigns with funding gaps" hint="Unpaid campaign costs not covered by earmarks" flush>
        <Async q={camps}>{(d) => {
          const gaps = d.rows.filter((c) => c.funding_gap > 0);
          return gaps.length ? (
            <table className="table">
              <thead><tr><th>Campaign</th><th className="num">Collected</th><th className="num">Paid out</th><th className="num">Unpaid costs</th><th className="num">Earmarked</th><th className="num">Funding gap</th></tr></thead>
              <tbody>{gaps.map((c) => <tr key={c.campaign_id}><td><Link to={`/campaigns/${c.campaign_id}`}>{c.name}</Link></td><td className="num"><Money p={c.collected} /></td><td className="num"><Money p={c.paid_cost} /></td><td className="num"><Money p={c.unpaid_cost} /></td><td className="num"><Money p={c.earmarked} /></td><td className="num neg"><Money p={c.funding_gap} /></td></tr>)}</tbody>
            </table>
          ) : <Empty title="Every campaign's unpaid costs are earmarked" />;
        }}</Async>
      </Card>
      <Card title="Allocation history" flush>
        <Async q={hist}>{(d) => (
          <table className="table">
            <thead><tr><th>Date</th><th>Earmark</th><th>Status</th><th>Change</th><th className="num">Amount</th></tr></thead>
            <tbody>{d.rows.map((e) => <tr key={e.id}><td className="small">{formatDate(e.created_at)}</td><td>{e.label ?? e.obligation_label ?? e.campaign_name}{e.supersedes_id ? <span className="small muted"> · replaces #{e.supersedes_id}</span> : ''}</td><td><Badge value={e.status} /></td><td className="small">{e.end_reason ?? e.reason ?? ''}</td><td className="num"><Money p={e.amount} /></td></tr>)}</tbody>
          </table>
        )}</Async>
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="New earmark" size="narrow">{creating && <EarmarkForm onDone={() => (setCreating(false), hist.reload(), pos.reload())} />}</Modal>
    </div>
  );
}

// ---------------------------------------------------------------- forecast

interface ScenarioState { scenario: 'base' | 'conservative' | 'custom'; horizonDays: number; custom: Row; receivableOverrides: Record<number, Row>; obligationOverrides: Record<number, Row> }

function useScenario(initial: Partial<ScenarioState> = {}) {
  return useState<ScenarioState>({ scenario: 'base', horizonDays: 90, custom: { include: ['confirmed', 'expected', 'delayed'], receiptDelayDays: 0, overdueReceiptDays: 7, includePlanned: true, includeOnHold: false, sameDay: 'inflows_first', protectReserves: false }, receivableOverrides: {}, obligationOverrides: {}, ...initial });
}

function ScenarioControls({ s, set }: { s: ScenarioState; set: (s: ScenarioState) => void }) {
  return (
    <div className="stack tight">
      <div className="row">
        <div className="seg" role="group" aria-label="Scenario">{(['base', 'conservative', 'custom'] as const).map((k) => <button key={k} className={s.scenario === k ? 'on' : ''} onClick={() => set({ ...s, scenario: k })}>{humanize(k)}</button>)}</div>
        <select className="input" style={{ width: 'auto' }} value={s.horizonDays} onChange={(e) => set({ ...s, horizonDays: Number(e.target.value) })} aria-label="Horizon">{[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>Next {d} days</option>)}</select>
      </div>
      {s.scenario === 'custom' && (
        <div className="card row" style={{ padding: 12 }}>
          {['confirmed', 'expected', 'at_risk', 'delayed'].map((c) => <label key={c} className="check small"><input type="checkbox" checked={s.custom.include.includes(c)} onChange={(e) => set({ ...s, custom: { ...s.custom, include: e.target.checked ? [...s.custom.include, c] : s.custom.include.filter((x: string) => x !== c) } })} /> Count {humanize(c).toLowerCase()}</label>)}
          <label className="row small">Delay all receipts <input className="input" type="number" min={0} style={{ width: 70 }} value={s.custom.receiptDelayDays} onChange={(e) => set({ ...s, custom: { ...s.custom, receiptDelayDays: Number(e.target.value) } })} /> days</label>
          <label className="row small">Overdue arrive in <input className="input" type="number" min={0} style={{ width: 70 }} value={s.custom.overdueReceiptDays} onChange={(e) => set({ ...s, custom: { ...s.custom, overdueReceiptDays: Number(e.target.value) } })} /> days</label>
          <label className="check small"><input type="checkbox" checked={s.custom.includePlanned} onChange={(e) => set({ ...s, custom: { ...s.custom, includePlanned: e.target.checked } })} /> Planned costs</label>
          <label className="check small"><input type="checkbox" checked={s.custom.includeOnHold} onChange={(e) => set({ ...s, custom: { ...s.custom, includeOnHold: e.target.checked } })} /> On-hold payables</label>
          <label className="check small"><input type="checkbox" checked={s.custom.protectReserves} onChange={(e) => set({ ...s, custom: { ...s.custom, protectReserves: e.target.checked } })} /> Protect reserves</label>
          <select className="input" style={{ width: 'auto' }} value={s.custom.sameDay} onChange={(e) => set({ ...s, custom: { ...s.custom, sameDay: e.target.value } })} aria-label="Same-day order"><option value="inflows_first">Same day: money in first</option><option value="outflows_first">Same day: payments first</option></select>
        </div>
      )}
    </div>
  );
}

function ForecastView({ f }: { f: Row }) {
  const svg = (w: number) => lineChart({
    width: w,
    labels: f.daily.map((x: Row) => formatDate(x.date, { year: false })),
    series: [{ name: 'Projected balance', color: SERIES_CSS[0], values: f.daily.map((x: Row) => x.closing) }],
    reference: f.floor ? { value: f.floor, label: 'Reserve floor' } : { value: 0, label: 'Zero' },
    yFormat: (n) => formatINR(n, { compact: true }),
    interactive: true,
    theme: THEME_CSS,
    height: 260,
    title: 'Projected balance',
  });
  return (
    <div className="stack">
      <div className="grid">
        <Stat label="Opening cash" value={<Money p={f.openingCash} />} foot={`Today, ${formatDate(f.today)}`} />
        <Stat label="Expected in" value={<Money p={f.totals.inflows} />} />
        <Stat label="Due out" value={<Money p={f.totals.outflows} />} />
        <Stat label="Lowest balance" value={<Money p={f.minBalance} />} foot={formatDate(f.minBalanceDate)} />
        <Stat label="Earliest shortfall" value={f.earliestShortfall ? <span className="neg">{formatDate(f.earliestShortfall.date)}</span> : <span className="pos">None</span>} foot={f.earliestShortfall ? f.earliestShortfall.label : `Within ${formatDate(f.horizonEnd)}`} />
        <Stat label="Funding required" value={<Money p={f.fundingRequired} />} foot={f.recoveryDate ? `Recovers ${formatDate(f.recoveryDate)}` : f.earliestShortfall ? 'No recovery in window' : undefined} />
      </div>
      <Card title="Projected balance">
        <Chart svg={svg} label="Projected balance" table={{ columns: ['Date', 'In', 'Out', 'Closing'], rows: f.daily.filter((x: Row) => x.inflow || x.outflow).map((x: Row) => [formatDate(x.date), formatINR(x.inflow), formatINR(x.outflow), formatINR(x.closing)]) }} />
      </Card>
      <Card title="Assumptions" hint="Every forecast states what it assumes">
        <ul style={{ margin: 0, paddingLeft: 18 }}>{f.assumptions.map((a: string) => <li key={a} className="small">{a}</li>)}</ul>
      </Card>
    </div>
  );
}

function EventsTable({ f, s, set }: { f: Row; s?: ScenarioState; set?: (s: ScenarioState) => void }) {
  return (
    <Card title="Payment by payment" hint="Can each payment be made on its due date?" flush>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Date</th><th>Item</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance after</th><th>Payable on date?</th>{set && <th>What if</th>}</tr></thead>
          <tbody>
            {f.events.map((e: Row, i: number) => (
              <tr key={i}>
                <td className="nowrap">{formatDate(e.date)}{e.originalDate && e.originalDate !== e.date && <div className="small muted">was {formatDate(e.originalDate)}</div>}</td>
                <td>{e.source === 'receivable' ? <Link to={`/finance/receivables/${e.sourceId}`}>{e.label}</Link> : e.source === 'obligation' && e.sourceId > 0 ? <Link to={`/finance/payables/${e.sourceId}`}>{e.label}</Link> : <strong>{e.label}</strong>}{e.note && <div className="small muted">{e.note}</div>}{e.projected && <Badge tone="info">Projected</Badge>}</td>
                <td className="num">{e.direction === 'in' ? <Money p={e.amount} /> : ''}</td>
                <td className="num">{e.direction === 'out' ? <Money p={e.amount} /> : ''}</td>
                <td className="num"><Money p={e.balanceAfter} /></td>
                <td>{e.direction === 'out' && (e.payable === 'yes' ? <Badge tone="good">Yes</Badge> : <Badge tone="bad">{e.payable === 'partial' ? 'Partly' : 'No'} · short {formatINR(e.shortBy)}</Badge>)}</td>
                {set && s && <td>{e.source === 'receivable' && (
                  <select className="input" style={{ width: 'auto', height: 28 }} value={s.receivableOverrides[e.sourceId]?.exclude ? 'x' : String(s.receivableOverrides[e.sourceId]?.delayDays ?? 0)} onChange={(ev) => set({ ...s, scenario: s.scenario, receivableOverrides: { ...s.receivableOverrides, [e.sourceId]: ev.target.value === 'x' ? { exclude: true } : { delayDays: Number(ev.target.value) } } })} aria-label="Delay this receipt">
                    <option value="0">On time</option><option value="7">Delay 7 days</option><option value="15">Delay 15 days</option><option value="30">Delay 30 days</option><option value="60">Delay 60 days</option><option value="x">Doesn't arrive</option>
                  </select>
                )}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!f.events.length && <Empty title="No scheduled money movements in this window" />}
      </div>
      {f.excluded.length > 0 && (
        <details style={{ padding: 12 }}>
          <summary className="small">{f.excluded.length} items not counted in this scenario</summary>
          <ul className="small">{f.excluded.map((x: Row, i: number) => <li key={i}>{x.label} — {formatINR(x.amount)}: {x.reason}{x.source === 'receivable' && set && s && s.receivableOverrides[x.id] ? <> · <button className="btn ghost sm" onClick={() => { const o = { ...s.receivableOverrides }; delete o[x.id]; set({ ...s, receivableOverrides: o }); }}>Undo</button></> : null}</li>)}</ul>
        </details>
      )}
    </Card>
  );
}

function Forecast() {
  const [sp] = useSearchParams();
  const [s, set] = useScenario({ scenario: sp.get('scenario') === 'conservative' ? 'conservative' : 'base' });
  const [f, setF] = useState<Row | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api('/api/finance/forecast', { body: s }).then((r) => (setF(r), setErr(''))).catch((e) => setErr(e.message));
  }, [s]);
  return (
    <div className="stack">
      <PageHead title="Cash-flow forecast" sub="Actual cash + expected receipts − obligations, day by day. Delay any receipt to see the effect." actions={<Link className="btn primary" to="/finance/simulate">Can we afford a purchase?</Link>} />
      <ScenarioControls s={s} set={set} />
      {err && <div className="alert bad">{err}</div>}
      {f ? <div className="stack"><ForecastView f={f} /><EventsTable f={f} s={s} set={set} /></div> : <div className="skeleton" style={{ height: 300 }} />}
    </div>
  );
}

// ---------------------------------------------------------------- purchase simulation

function Simulate() {
  const today = useToday();
  const [s, set] = useScenario();
  const [p, setP] = useState<Row>({ label: '', amount: null, date: today });
  const [res, setRes] = useState<Row | null>(null);
  const [err, setErr] = useState('');
  const history = useApi<{ rows: Row[] }>('/api/finance/simulations');
  const run = async () => {
    setErr('');
    try {
      setRes(await api('/api/finance/simulate', { body: { ...s, ...p } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    if (res) void run();
  }, [s]);
  const decide = async (decision: 'simulated' | 'proceed' | 'override' | 'cancelled') => {
    let reason = '';
    if (decision === 'override') {
      const r = await confirmAction({ title: 'Override the cash warning?', message: <><p>{res!.warning}</p><p className="small" style={{ marginTop: 8 }}>The warning and your reason are kept on record. Existing obligations are not changed — they still need to be paid.</p></>, confirm: 'Override and proceed', danger: true, reason: 'Reason for overriding' });
      if (r === false) return;
      reason = r;
    }
    if (await attempt(() => api('/api/finance/simulations', { body: { ...s, ...p, decision, reason } }), decision === 'simulated' ? 'Saved' : decision === 'cancelled' ? 'Recorded as not proceeding' : 'Decision recorded; a payable for the purchase was added to forecasts')) {
      history.reload();
      if (decision !== 'simulated') setRes(null);
      refreshFinance();
    }
  };
  return (
    <div className="stack">
      <PageHead title="Can we afford this purchase?" sub="Simulates the purchase against actual cash, expected receipts and every obligation. Nothing is recorded unless you decide to proceed." />
      <Card>
        <div className="form-grid">
          <label className="field"><span>What</span><input className="input" placeholder="e.g. Sony 24-70 GM lens" value={p.label} onChange={(e) => setP({ ...p, label: e.target.value })} /></label>
          <label className="field"><span>Amount</span><MoneyField value={p.amount} onChange={(a) => setP({ ...p, amount: a })} /></label>
          <label className="field"><span>Purchase date</span><input className="input" type="date" value={p.date} min={today} onChange={(e) => setP({ ...p, date: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 12 }}><ScenarioControls s={s} set={set} /><span className="grow" /><button className="btn primary" disabled={!p.amount} onClick={run}>Check</button></div>
      </Card>
      {err && <div className="alert bad">{err}</div>}
      {res && (
        <div className="stack">
          {res.safe ? <div className="alert good"><strong>Affordable in this scenario.</strong> Every obligation can still be paid on its due date. Lowest balance {formatINR(res.with.minBalance)} on {formatDate(res.with.minBalanceDate)}.</div>
            : <div className="alert bad"><strong>Cash warning.</strong> {res.warning}</div>}
          <div className="grid">
            <Stat label="Lowest balance without" value={<Money p={res.without.minBalance} />} foot={formatDate(res.without.minBalanceDate)} />
            <Stat label="Lowest balance with purchase" value={<Money p={res.with.minBalance} />} foot={formatDate(res.with.minBalanceDate)} />
            <Stat label="Funding required" value={<Money p={res.with.fundingRequired} />} foot={`vs ${formatINR(res.without.fundingRequired)} without`} />
            <Stat label="Payments affected" value={res.newlyAffected.length} foot={res.with.earliestShortfall ? `First shortfall ${formatDate(res.with.earliestShortfall.date)}` : 'None'} />
          </div>
          <Card title="Balance with vs without the purchase">
            <Chart label="Balance with and without" svg={(w) => lineChart({ width: w, 
              labels: res.with.daily.map((x: Row) => formatDate(x.date, { year: false })),
              series: [{ name: 'Without purchase', color: SERIES_CSS[0], values: res.without.daily.map((x: Row) => x.closing) }, { name: 'With purchase', color: SERIES_CSS[1], values: res.with.daily.map((x: Row) => x.closing) }],
              reference: res.with.floor ? { value: res.with.floor, label: 'Reserve floor' } : { value: 0, label: 'Zero' },
              yFormat: (n) => formatINR(n, { compact: true }), interactive: true, theme: THEME_CSS, height: 240,
            })} table={{ columns: ['Date', 'Without', 'With'], rows: res.with.daily.map((x: Row, i: number) => [formatDate(x.date), formatINR(res.without.daily[i].closing), formatINR(x.closing)]) }} />
          </Card>
          <div className="row">
            {res.safe ? <button className="btn primary" onClick={() => decide('proceed')}>Proceed — add payable</button> : <button className="btn danger" onClick={() => decide('override')}>Override and proceed…</button>}
            <button className="btn" onClick={() => decide('simulated')}>Save simulation only</button>
            <button className="btn" onClick={() => decide('cancelled')}>Not buying</button>
          </div>
          <EventsTable f={res.with} s={s} set={set} />
        </div>
      )}
      <Card title="Past simulations & decisions" flush>
        <Async q={history}>{(d) => d.rows.length ? (
          <table className="table">
            <thead><tr><th>Date</th><th>Purchase</th><th className="num">Amount</th><th>Result</th><th>Decision</th><th>Reason</th></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={r.id}><td className="small">{formatDate(r.created_at)}<div className="muted">{r.created_by_name}</div></td><td>{r.label}<div className="small muted">for {formatDate(r.purchase_date)}</div></td><td className="num"><Money p={r.amount} /></td><td className="small">{r.result?.safe ? <Badge tone="good">Safe</Badge> : <><Badge tone="bad">Warning</Badge> <span className="muted">{r.result?.warning}</span></>}</td><td><Badge value={r.decision} />{r.obligation_id && <div><Link className="small" to={`/finance/payables/${r.obligation_id}`}>Payable</Link></div>}</td><td className="small">{r.reason}</td></tr>)}</tbody>
          </table>
        ) : <Empty title="No simulations yet" />}</Async>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- calendar, margins, reports, accounts

function CashCalendar() {
  const today = useToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const from = monthStart(`${month}-01`);
  const q = useApi<{ events: Row[] }>(`/api/finance/calendar?from=${addDays(from, -7)}&to=${addDays(from, 42)}`);
  const events = (q.data?.events ?? []).map((e) => ({ date: e.date, label: `${e.kind.endsWith('in') ? '+' : '−'}${formatINR(e.amount, { compact: true })} ${e.label}`, kind: e.kind.endsWith('in') ? 'in' : 'out', link: e.link, title: `${humanize(e.kind)}: ${e.label} ${formatINR(e.amount)}` }));
  return (
    <div className="stack">
      <PageHead title="Cash-flow calendar" sub="Actual transactions, expected receipts and payment due dates" />
      <div className="row small"><span className="dot" style={{ background: 'var(--good)' }} /> Money in (actual or expected) <span className="dot" style={{ background: 'var(--bad)' }} /> Money out (actual or due)</div>
      <Card><Calendar events={events} month={month} onMonth={setMonth} /></Card>
    </div>
  );
}

function CampaignMargins() {
  const q = useApi<{ rows: Row[] }>('/api/finance/campaigns');
  const nav = useNavigate();
  const cols: Col[] = [
    { key: 'name', label: 'Campaign' },
    { key: 'brand_name', label: 'Brand', filter: true },
    { key: 'stage', label: 'Stage', filter: true, render: (r) => <Badge value={r.stage} /> },
    { key: 'billing_model', label: 'Model', filter: true, render: (r) => humanize(r.billing_model) },
    { key: 'revenue', label: 'Revenue (ex-tax)', num: true, render: (r) => <Money p={r.revenue} /> },
    { key: 'planned_cost', label: 'Planned cost', num: true, render: (r) => <Money p={r.planned_cost} /> },
    { key: 'committed_cost', label: 'Committed cost', num: true, render: (r) => <span className={r.over_budget ? 'neg' : ''}><Money p={r.committed_cost} /></span> },
    { key: 'paid_cost', label: 'Paid', num: true, render: (r) => <Money p={r.paid_cost} /> },
    { key: 'agency_earnings', label: 'Agency earnings', num: true, render: (r) => <Money p={r.agency_earnings} /> },
    { key: 'contribution_margin', label: 'Contribution margin', num: true, render: (r) => <Money p={r.contribution_margin} /> },
    { key: 'margin_bps', label: 'Margin %', num: true, render: (r) => (r.margin_bps === null ? '—' : `${(r.margin_bps / 100).toFixed(1)}%`) },
    { key: 'collected', label: 'Collected', num: true, hidden: true, render: (r) => <Money p={r.collected} /> },
    { key: 'receivable_outstanding', label: 'To collect', num: true, render: (r) => <Money p={r.receivable_outstanding} /> },
    { key: 'unpaid_cost', label: 'To pay', num: true, render: (r) => <Money p={r.unpaid_cost} /> },
  ];
  return (
    <div className="stack">
      <PageHead title="Campaign margins" sub="Revenue and costs per campaign. Committed cost = payables + direct spend not linked to a payable, so payouts are never counted twice." actions={<a className="btn" href="/api/finance/campaigns?format=csv">CSV</a>} />
      <Async q={q}>{(d) => (
        <div className="stack">
          <Card title="Margin by campaign">
            <Chart label="Revenue, cost and margin by campaign" svg={(w) => barChart({ width: w,  categories: d.rows.map((r) => r.name.replace(/^.*— /, '')), series: [{ name: 'Revenue', color: SERIES_CSS[0], values: d.rows.map((r) => r.revenue) }, { name: 'Committed cost', color: SERIES_CSS[1], values: d.rows.map((r) => r.committed_cost) }, { name: 'Contribution margin', color: SERIES_CSS[2], values: d.rows.map((r) => r.contribution_margin) }], yFormat: (n) => formatINR(n, { compact: true }), interactive: true, theme: THEME_CSS, height: 260 })}
              table={{ columns: ['Campaign', 'Revenue', 'Committed cost', 'Margin'], rows: d.rows.map((r) => [r.name, formatINR(r.revenue), formatINR(r.committed_cost), formatINR(r.contribution_margin)]) }} />
          </Card>
          <DataTable rows={d.rows.map((r) => ({ ...r, id: r.campaign_id }))} columns={cols} viewKey="campaign-margins" onRowClick={(r) => nav(`/campaigns/${r.id}`)}
            footer={(rs) => <tr><td colSpan={4}>Total</td>{['revenue', 'planned_cost', 'committed_cost', 'paid_cost', 'agency_earnings', 'contribution_margin'].map((k) => <td key={k} className="num"><Money p={rs.reduce((s, r) => s + r[k], 0)} /></td>)}<td /><td className="num"><Money p={rs.reduce((s, r) => s + r.receivable_outstanding, 0)} /></td><td className="num"><Money p={rs.reduce((s, r) => s + r.unpaid_cost, 0)} /></td></tr>} />
        </div>
      )}</Async>
    </div>
  );
}

function FinanceReports() {
  const today = useToday();
  const [from, setFrom] = useState(financialYearStart(today));
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState('earnings');
  const qs = `from=${from}&to=${to}`;
  const e = useApi<Row>(kind === 'earnings' ? `/api/finance/earnings?${qs}` : null);
  const r = useApi<Row>(kind !== 'earnings' && kind !== 'statement' ? `/api/finance/reports/${kind}?${qs}` : null);
  const kinds = [['earnings', 'Earnings & results'], ['operating', 'Operating results'], ['cashflow', 'Cash flow'], ['receivables-ageing', 'Receivables ageing'], ['payables-ageing', 'Payables ageing'], ['expenses', 'Expenses'], ['campaign-budget', 'Budget vs actual'], ['statement', 'Payment statements']];
  return (
    <div className="stack">
      <PageHead title="Finance reports" sub="Cash, billings, earnings and profit are separate figures. PDF versions are in the Reports centre." actions={<Link className="btn" to="/reports">PDF reports</Link>} />
      <div className="row">
        <select className="input" style={{ width: 'auto' }} value={kind} onChange={(ev) => setKind(ev.target.value)} aria-label="Report">{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label className="row small">From <input type="date" className="input" style={{ width: 'auto' }} value={from} onChange={(ev) => setFrom(ev.target.value)} /></label>
        <label className="row small">To <input type="date" className="input" style={{ width: 'auto' }} value={to} onChange={(ev) => setTo(ev.target.value)} /></label>
        {kind !== 'earnings' && kind !== 'statement' && <a className="btn sm" href={`/api/finance/reports/${kind}?${qs}&format=csv`}>CSV</a>}
      </div>
      {kind === 'earnings' && <Async q={e}>{(d) => <EarningsView e={d} />}</Async>}
      {kind === 'statement' && <Statements />}
      {kind !== 'earnings' && kind !== 'statement' && (
        <Async q={r}>{(d) => (
          <Card title={d.title} flush>
            {kind === 'cashflow' && d.rows.length > 0 && <div style={{ padding: 16 }}><Chart label="Cash in and out by month" svg={(w) => barChart({ width: w,  categories: d.rows.map((x: Row) => x.period), series: [{ name: 'Cash in', color: SERIES_CSS[0], values: d.rows.map((x: Row) => x.cash_in) }, { name: 'Cash out', color: SERIES_CSS[1], values: d.rows.map((x: Row) => x.cash_out) }], yFormat: (n) => formatINR(n, { compact: true }), interactive: true, theme: THEME_CSS, height: 220 })} /></div>}
            <table className="table">
              <thead><tr>{d.columns.map((c: Row) => <th key={c.key} className={c.type === 'money' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>{d.rows.map((row: Row, i: number) => <tr key={i}>{d.columns.map((c: Row) => <td key={c.key} className={c.type === 'money' ? 'num' : ''}>{c.type === 'money' ? <Money p={row[c.key]} /> : typeof row[c.key] === 'string' ? humanize(row[c.key]) : row[c.key]}</td>)}</tr>)}</tbody>
            </table>
            {!d.rows.length && <Empty title="No data in this period" />}
          </Card>
        )}</Async>
      )}
    </div>
  );
}

function EarningsView({ e }: { e: Row }) {
  const line = (label: ReactNode, p: number, note?: string, strong?: boolean) => (
    <tr className={strong ? 'strong' : ''}><td>{label}{note && <div className="small muted">{note}</div>}</td><td className="num"><Money p={p} /></td></tr>
  );
  return (
    <div className="grid two">
      <Card title="Results for the period" flush>
        <table className="table"><tbody>
          {line('Gross billings to brands', e.gross_billings, 'Invoices issued, excl. GST — includes money passed to creators')}
          {line('Commission billed', e.commission_billed)}
          {line('Cash collected', e.cash_collected, 'Receipts from brands/creators incl. GST — cash, not earnings')}
          {line('Agency earnings', e.agency_earnings, `Recognised on ${e.basis.basis} basis`, true)}
          {line('Campaign contribution margin', e.contribution_margin, 'Revenue − direct campaign costs', true)}
          {line('Operating expenses', -e.opex, 'Paid in period')}
          {e.basis.assets === 'capitalise' ? line('Depreciation', -e.depreciation, 'Straight-line on assets with a useful life') : line('Asset purchases (expensed)', -e.capex)}
          {line('Operating result', e.operating_result, 'Contribution margin − operating costs', true)}
        </tbody></table>
      </Card>
      <div className="stack">
        <Card title="Shown separately" flush>
          <table className="table"><tbody>
            {line('Asset purchases (cash)', e.capex)}
            {line('Taxes paid (GST/TDS remittances)', e.taxes_paid)}
            {line('Founder contributions', e.financing.founder_contributions)}
            {line('Founder withdrawals', e.financing.founder_withdrawals)}
            {line('Loans received', e.financing.loans_received)}
            {line('Loan repayments', e.financing.loan_repayments)}
            {line('Other income', e.other_income)}
          </tbody></table>
          {e.unclassified > 0 && <div className="alert warn small" style={{ margin: 12 }}>{e.unclassified} uncategorised transactions are excluded. <Link to="/finance/transactions?category=uncategorised">Categorise them</Link>.</div>}
        </Card>
        <Card title="Calculation basis"><ul style={{ margin: 0, paddingLeft: 18 }}>{e.explanation.map((x: string) => <li key={x} className="small">{x}</li>)}</ul><p className="small muted" style={{ marginTop: 8 }}>Change the rules in Settings → Finance rules.</p></Card>
      </div>
      <Card title="What was recognised" flush>
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table className="table"><thead><tr><th>Date</th><th>Item</th><th className="num">Revenue</th><th className="num">Earnings</th><th className="num">Margin</th></tr></thead>
            <tbody>{e.items.map((i: Row, k: number) => <tr key={k}><td className="nowrap small">{formatDate(i.date)}</td><td>{i.type === 'campaign' ? <Link to={`/campaigns/${i.id}`}>{i.label}</Link> : <Link to={`/finance/receivables/${i.id}`}>{i.label}</Link>}</td><td className="num"><Money p={i.revenue} /></td><td className="num"><Money p={i.earnings} /></td><td className="num"><Money p={i.margin} /></td></tr>)}</tbody>
          </table>
          {!e.items.length && <Empty title="Nothing recognised in this period" />}
        </div>
      </Card>
      <Card title="Operating expenses paid" flush>
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table className="table"><tbody>{e.opex_items.map((t: Row) => <tr key={t.id}><td className="small nowrap">{formatDate(t.txn_date)}</td><td><Link to={`/finance/transactions/${t.id}`}>{t.description ?? t.category}</Link></td><td className="num"><Money p={t.direction === 'out' ? t.amount : -t.amount} /></td></tr>)}</tbody></table>
        </div>
      </Card>
    </div>
  );
}

function Statements() {
  const [type, setType] = useState<'influencer' | 'editor'>('influencer');
  const opts = useOptions(type === 'influencer' ? 'influencers' : 'editors');
  const [id, setId] = useState<number | null>(null);
  const q = useApi<Row>(id ? `/api/finance/reports/statement?payee_type=${type}&payee_id=${id}` : null);
  return (
    <div className="stack">
      <div className="row">
        <div className="seg">{(['influencer', 'editor'] as const).map((t) => <button key={t} className={type === t ? 'on' : ''} onClick={() => (setType(t), setId(null))}>{t === 'influencer' ? 'Creator' : 'Editor'}</button>)}</div>
        <select className="input" style={{ width: 'auto' }} value={id ?? ''} onChange={(e) => setId(Number(e.target.value))}><option value="">Choose…</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        {id && <a className="btn sm" href={`/api/finance/reports/statement?payee_type=${type}&payee_id=${id}&format=csv`}>CSV</a>}
      </div>
      {id && <Async q={q}>{(d) => (
        <div className="stack">
          <div className="grid"><Stat label="Total owed" value={<Money p={d.total_owed} />} /><Stat label="Paid" value={<Money p={d.total_paid} />} /><Stat label="TDS deducted" value={<Money p={d.total_tds} />} /><Stat label="Outstanding" value={<Money p={d.outstanding} />} /></div>
          <Card title="Obligations" flush><PayableTable rows={d.obligations} /></Card>
          <Card title="Payments" flush>
            <table className="table"><thead><tr><th>Date</th><th>For</th><th>Type</th><th>Reference</th><th className="num">Amount</th></tr></thead>
              <tbody>{d.payments.map((p: Row) => <tr key={p.id}><td>{formatDate(p.settled_on)}</td><td>{p.description}</td><td><Badge value={p.kind} /></td><td>{p.reference ?? '—'}</td><td className="num"><Money p={p.amount} /></td></tr>)}</tbody></table>
          </Card>
        </div>
      )}</Async>}
    </div>
  );
}

function Accounts() {
  const q = useApi<{ rows: Row[] }>('/api/finance/accounts');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  return (
    <div className="stack">
      <PageHead title="Bank, cash & wallet accounts" actions={<button className="btn primary" onClick={() => setCreating(true)}>New account</button>} />
      <Async q={q}>{(d) => (
        <DataTable rows={d.rows} viewKey="accounts" onRowClick={(r) => nav(`/finance/accounts/${r.id}`)} columns={[
          { key: 'name', label: 'Account' }, { key: 'type', label: 'Type', filter: true, render: (r) => humanize(r.type) }, { key: 'institution', label: 'Institution' },
          { key: 'active', label: 'Active', render: (r) => (r.active ? <Badge tone="good">Active</Badge> : <Badge value="inactive" />) },
          { key: 'unreconciled', label: 'Unreconciled', num: true }, { key: 'balance', label: 'Balance', num: true, render: (r) => <Money p={r.balance} /> },
        ]} />
      )}</Async>
      <Modal open={creating} onClose={() => setCreating(false)} title="New account"><EntityForm entity="accounts" onSaved={() => (setCreating(false), q.reload(), refreshFinance())} /></Modal>
    </div>
  );
}

function AccountPage() {
  const { id } = useParams();
  const q = useApi<{ row: Row }>(`/api/e/accounts/${id}`);
  const bal = useApi<{ rows: Row[] }>('/api/finance/accounts');
  const t = useApi<{ rows: Row[] }>(`/api/finance/transactions?account_id=${id}`);
  const [editing, setEditing] = useState(false);
  const nav = useNavigate();
  const b = bal.data?.rows.find((x) => String(x.id) === id);
  return (
    <Async q={q}>{({ row }) => (
      <div className="stack">
        <PageHead title={<>{row.name} <DemoTag row={row} /></>} sub={`${humanize(row.type)}${row.institution ? ` · ${row.institution}` : ''}${row.last4 ? ` · ••${row.last4}` : ''}`} actions={<><button className="btn" onClick={() => setEditing(true)}>Edit</button><ArchiveButton entity="accounts" row={row} onDone={() => nav('/finance/accounts')} /></>} />
        <div className="grid"><Stat hero label="Balance today" value={<Money p={b?.balance} />} /><Stat label="Opening balance" value={<Money p={row.opening_balance} />} foot={`as of ${formatDate(row.opening_date)}`} /><Stat label="Unreconciled" value={b?.unreconciled ?? '—'} /></div>
        <Async q={t}>{(d) => <DataTable rows={d.rows} columns={txnCols.filter((c) => c.key !== 'account_name')} viewKey="account-transactions" onRowClick={(r) => nav(`/finance/transactions/${r.id}`)} />}</Async>
        <Modal open={editing} onClose={() => setEditing(false)} title="Edit account"><EntityForm entity="accounts" record={row} onSaved={() => (setEditing(false), q.reload(), refreshFinance())} /></Modal>
      </div>
    )}</Async>
  );
}

