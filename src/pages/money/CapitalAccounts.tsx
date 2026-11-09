// Capital (founders only) with the company balance check, and Accounts.
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { moneyApi, type AccountInput, type CapitalInput, type CapitalRow } from '../../data/money'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, formatINR, istToday } from '../../lib/format'
import { ACCOUNT_KIND_LABEL, ACCOUNT_KINDS, CAPITAL_KIND_LABEL, CAPITAL_KINDS, capitalNeedsAccount, round2, type AccountKind, type BalanceCheck, type CapitalKind } from '../../lib/money'
import { Icon } from '../../components/ui/Icon'
import { Card, EmptyState, MoreMenu, Pill, SectionTitle } from '../../components/ui/kit'
import { Modal } from '../../components/ui/Modal'
import { FormError } from '../auth/AuthLayout'
import { BalanceBadge } from './MoneyOverview'
import { DataTable, Facts, Loading, MoneyHeader, MoneyHistory, MoneyTabs, NotFound, ReasonModal, Select, dateCell, money, useAsyncAction, useIsFounder } from './MoneyBits'

function FoundersOnly() {
  return <div className="space-y-6"><MoneyHeader title="Capital" kanji="資" /><MoneyTabs /><div className="shoji"><EmptyState line="Capital and founder withdrawals are for founders only." /></div></div>
}

export function CapitalPage() {
  const founder = useIsFounder()
  const list = useAsync(() => founder ? moneyApi.capital() : Promise.resolve([]), [founder])
  const per = useAsync(() => founder ? moneyApi.capitalAccounts() : Promise.resolve([]), [founder])
  const check = useAsync(() => founder ? moneyApi.balanceCheck() : Promise.resolve(null), [founder])
  const [kind, setKind] = useState<'all' | CapitalKind>('all')
  const [who, setWho] = useState('all')
  const [adding, setAdding] = useState(false)
  if (!founder) return <FoundersOnly />
  const reload = () => { list.reload(); per.reload(); check.reload() }
  const rows = (list.data ?? []).filter(c => kind === 'all' || c.kind === kind).filter(c => who === 'all' || (c.founder_id ?? 'company') === who)
  return (
    <div className="space-y-6">
      <MoneyHeader title="Capital" kanji="資" sub="Founders only — managers never see these entries." actions={<button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> Add entry</button>} />
      <MoneyTabs />
      <section aria-label="Capital per founder" className="grid sm:grid-cols-2 gap-4">
        {(per.data ?? []).map(c => (
          <Card key={c.founder_id} className="shoji-pad">
            <p className="eyebrow">{c.name} · {c.profit_share_pct}% profit share</p>
            <p className="font-mincho text-3xl text-ink num mt-1.5">{formatINR(c.balance)}</p>
            <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted">Opening capital</dt><dd className="text-right num">{formatINR(c.opening_capital)}</dd>
              <dt className="text-muted">Capital added</dt><dd className="text-right num">+{formatINR(c.capital_added)}</dd>
              <dt className="text-muted">Withdrawals</dt><dd className="text-right num">−{formatINR(c.withdrawals)}</dd>
              <dt className="text-muted">Profit transferred</dt><dd className="text-right num">+{formatINR(c.profit_transferred)}</dd>
            </dl>
          </Card>
        ))}
      </section>
      <p className="text-xs text-muted -mt-2">Entries for “Company” are split by profit share. Change the shares in Money → Settings.</p>
      {check.data && <BalanceCheckCard c={check.data} />}
      {!list.data ? <Loading label="Loading capital" /> : (
        <DataTable rows={rows} rowKey={c => c.id} rowLink={c => `/money/capital/${c.id}`} csvName="capital" empty="No capital entries yet. Start with the opening capital."
          search={c => `${c.founder_name} ${CAPITAL_KIND_LABEL[c.kind]} ${c.notes ?? ''} ${c.account_name ?? ''}`} searchPlaceholder="Search founder, type, notes"
          dateOf={c => c.entry_date} defaultSort={{ key: 'date', dir: -1 }}
          filters={<>
            <Select id="cap-kind" label="Type" value={kind} onChange={setKind} options={[['all', 'Any type'], ...CAPITAL_KINDS.map(k => [k, CAPITAL_KIND_LABEL[k]] as [CapitalKind, string])]} />
            <Select id="cap-who" label="Founder" value={who} onChange={setWho} options={[['all', 'Everyone'], ['company', 'Company'], ...(per.data ?? []).map(f => [f.founder_id, f.name] as [string, string])]} />
          </>}
          cols={[
            { key: 'date', header: 'Date', cell: c => dateCell(c.entry_date), sort: c => c.entry_date, csv: c => formatDate(c.entry_date) },
            { key: 'kind', header: 'Type', cell: c => CAPITAL_KIND_LABEL[c.kind], sort: c => c.kind, csv: c => CAPITAL_KIND_LABEL[c.kind] },
            { key: 'who', header: 'Founder', cell: c => c.founder_name, sort: c => c.founder_name, csv: c => c.founder_name },
            { key: 'acct', header: 'Account', hideSm: true, cell: c => c.account_name ?? '—', csv: c => c.account_name },
            { key: 'amount', header: 'Amount', align: 'right', cell: c => <span>{c.signed_amount < 0 ? '−' : '+'}{formatINR(c.amount)}</span>, sort: c => c.signed_amount, csv: c => c.signed_amount },
          ]}
          extraCsv={[{ header: 'Notes', value: c => c.notes }]} />
      )}
      {adding && <CapitalForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />}
    </div>
  )
}

function BalanceCheckCard({ c }: { c: BalanceCheck }) {
  const row = (k: string, v: number, sign = '') => <div className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="num text-ink">{sign}{formatINR(v)}</dd></div>
  return (
    <Card className="shoji-pad">
      <div id="check" className="scroll-mt-24" />
      <SectionTitle kanji="衡">Company position</SectionTitle>
      <div className="grid md:grid-cols-2 gap-6 text-sm">
        <dl className="space-y-1.5">
          {row('Capital (all founders)', c.capital)}
          {row('Retained profit', c.retained_profit)}
          <div className="flex justify-between gap-3 border-t border-line/25 pt-1.5 font-medium"><dt className="text-ink">Capital + retained profit</dt><dd className="num text-ink">{formatINR(c.left_side)}</dd></div>
        </dl>
        <dl className="space-y-1.5">
          {row('Money in all accounts', c.accounts)}
          {row('Owed to us: unpaid invoices', c.receivables, '+')}
          {row('Owed to us: TDS clients deducted', c.tds_credit, '+')}
          {row('We owe: payouts not yet paid', c.payouts_owed, '−')}
          {row('We owe: unpaid expenses', c.expenses_owed, '−')}
          {row('We owe: brand advances not applied', c.advances, '−')}
          {row('We owe: GST (output − input − paid)', c.gst_payable, '−')}
          {row('We owe: TDS to deposit', c.tds_payable, '−')}
          <div className="flex justify-between gap-3 border-t border-line/25 pt-1.5 font-medium"><dt className="text-ink">Net position</dt><dd className="num text-ink">{formatINR(c.right_side)}</dd></div>
        </dl>
      </div>
      <BalanceBadge ok={c.is_balanced} diff={c.difference} />
      {!c.is_balanced && <p className="text-xs text-muted mt-2">Difference: {formatINR(c.difference)}. If it equals an account’s opening balance, add the matching opening capital. Retained profit uses the invoice basis, all time.</p>}
    </Card>
  )
}

function CapitalForm({ row, onClose, onSaved }: { row?: CapitalRow; onClose: () => void; onSaved: () => void }) {
  const founders = useAsync(() => moneyApi.founders(), [])
  const accounts = useAsync(() => moneyApi.accountRecords(), [])
  const [c, setC] = useState<CapitalInput>(row ? { entry_date: row.entry_date, kind: row.kind, founder_id: row.founder_id, account_id: row.account_id, amount: row.amount, notes: row.notes }
    : { entry_date: istToday(), kind: 'capital_added', founder_id: null, account_id: null, amount: 0, notes: null })
  const [reason, setReason] = useState('')
  const act = useAsyncAction()
  const needs = capitalNeedsAccount(c.kind)
  return (
    <Modal title={row ? 'Edit capital entry' : 'Add a capital entry'} onClose={onClose}>
      <form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (await act.run(() => moneyApi.saveCapital({ ...c, amount: Number(c.amount), account_id: needs ? c.account_id : null }, row?.id, row ? reason : undefined))) onSaved() }}>
        <label className="block"><span className="text-sm text-ink">Type</span><select className="field mt-1.5" value={c.kind} onChange={e => setC({ ...c, kind: e.target.value as CapitalKind })}>{CAPITAL_KINDS.map(k => <option key={k} value={k}>{CAPITAL_KIND_LABEL[k]}</option>)}</select></label>
        <p className="text-xs text-muted">{c.kind === 'opening_capital' ? 'What each founder had in the business on the start date. The money itself is the accounts’ opening balances.' : c.kind === 'profit_transferred' ? 'Moves retained profit into capital. No money moves between accounts.' : c.kind === 'capital_added' ? 'A founder puts money in — it lands in an account.' : 'A founder takes money out of an account.'}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-sm text-ink">Founder</span><select className="field mt-1.5" value={c.founder_id ?? ''} onChange={e => setC({ ...c, founder_id: e.target.value || null })}>
            <option value="">Company (split by share)</option>{(founders.data ?? []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Amount (₹)</span><input type="number" min="0.01" step="0.01" required className="field mt-1.5 num" value={c.amount || ''} onChange={e => setC({ ...c, amount: e.target.value as unknown as number })} /></label>
          <label className="block"><span className="text-sm text-ink">Date</span><input type="date" required className="field mt-1.5" value={c.entry_date} onChange={e => setC({ ...c, entry_date: e.target.value })} /></label>
          {needs && <label className="block"><span className="text-sm text-ink">{c.kind === 'capital_added' ? 'Into account' : 'From account'}</span><select className="field mt-1.5" required value={c.account_id ?? ''} onChange={e => setC({ ...c, account_id: e.target.value || null })}>
            <option value="">Choose</option>{(accounts.data ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        </div>
        <label className="block"><span className="text-sm text-ink">Notes</span><input className="field mt-1.5" value={c.notes ?? ''} onChange={e => setC({ ...c, notes: e.target.value || null })} /></label>
        {row && <label className="block"><span className="text-sm text-ink">Reason for the change</span><input className="field mt-1.5" required minLength={3} value={reason} onChange={e => setReason(e.target.value)} /></label>}
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy}>Save</button></div>
      </form>
    </Modal>
  )
}

export function CapitalDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const founder = useIsFounder()
  const { data, loading, reload } = useAsync(() => founder ? moneyApi.capital() : Promise.resolve([]), [founder])
  const [modal, setModal] = useState<null | 'edit' | 'archive'>(null)
  if (!founder) return <FoundersOnly />
  const c = data?.find(x => x.id === id)
  if (loading && !data) return <Loading label="Opening the entry" />
  if (!c) return <NotFound what="capital entry" />
  return (
    <div className="space-y-6">
      <MoneyHeader title={`${CAPITAL_KIND_LABEL[c.kind]} — ${formatINR(c.amount)}`} kanji="資" sub={`${c.founder_name} · ${formatDate(c.entry_date)}`}
        actions={<><button className="btn-ghost" onClick={() => setModal('edit')}><Icon name="edit" /> Edit</button><MoreMenu items={[{ label: 'Archive…', onSelect: () => setModal('archive'), danger: true }]} /></>} />
      <MoneyTabs />
      <div className="grid lg:grid-cols-[1fr_24rem] gap-6 items-start">
        <Card className="shoji-pad"><Facts rows={[['Type', CAPITAL_KIND_LABEL[c.kind]], ['Founder', c.founder_name], ['Amount', money(c.amount)], ['Date', formatDate(c.entry_date)],
          ['Account', c.account_id ? <Link className="underline underline-offset-4" to={`/money/accounts/${c.account_id}`}>{c.account_name}</Link> : 'No money moved between accounts'], ['Notes', c.notes]]} /></Card>
        <MoneyHistory table="capital_entries" id={id} version={c.updated_at} />
      </div>
      {modal === 'edit' && <CapitalForm row={c} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} />}
      {modal === 'archive' && <ReasonModal title="Archive this entry" action="Archive" danger onClose={() => setModal(null)} onConfirm={async r => { await moneyApi.archiveCapital(id, r); nav('/money/capital') }} />}
    </div>
  )
}

// ─── Accounts ───────────────────────────────────────────────
export function AccountsPage() {
  const founder = useIsFounder()
  const { data, reload } = useAsync(() => moneyApi.accounts(), [])
  const [modal, setModal] = useState<null | 'new' | 'transfer'>(null)
  const total = round2((data ?? []).reduce((s, a) => s + a.balance, 0))
  return (
    <div className="space-y-6">
      <MoneyHeader title="Accounts" kanji="口" sub={`${formatINR(total)} across ${(data ?? []).length} accounts`}
        actions={<><button className="btn-ghost" onClick={() => setModal('transfer')}>Move money</button><button className="btn-primary" onClick={() => setModal('new')}><Icon name="plus" /> New account</button></>} />
      <MoneyTabs />
      {!data ? <Loading label="Loading accounts" /> : (
        <DataTable rows={data} rowKey={a => a.account_id} rowLink={a => `/money/accounts/${a.account_id}`} csvName="accounts" empty="No accounts yet — add your bank account first."
          search={a => `${a.name} ${a.kind}`} searchPlaceholder="Search accounts"
          cols={[
            { key: 'name', header: 'Account', cell: a => <>{a.name}{a.is_default && <span className="ml-2"><Pill>Default</Pill></span>}</>, sort: a => a.name, csv: a => a.name },
            { key: 'kind', header: 'Type', cell: a => ACCOUNT_KIND_LABEL[a.kind], sort: a => a.kind, csv: a => ACCOUNT_KIND_LABEL[a.kind] },
            { key: 'opening', header: 'Opening', align: 'right', hideSm: true, cell: a => <>{formatINR(a.opening_balance)}<span className="block text-xs text-muted">{formatDate(a.opening_date)}</span></>, sort: a => a.opening_balance, csv: a => a.opening_balance },
            { key: 'in', header: 'Money in', align: 'right', hideSm: true, cell: a => formatINR(a.money_in), sort: a => a.money_in, csv: a => a.money_in },
            { key: 'out', header: 'Money out', align: 'right', hideSm: true, cell: a => formatINR(a.money_out), sort: a => a.money_out, csv: a => a.money_out },
            { key: 'bal', header: 'Balance', align: 'right', cell: a => formatINR(a.balance), sort: a => a.balance, csv: a => a.balance },
          ]}
          footer={() => <span className="text-muted">Balance = opening balance + money in − money out.{!founder && ' Capital movements are included as totals.'}</span>} />
      )}
      {modal === 'new' && <AccountForm onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} />}
      {modal === 'transfer' && <TransferForm onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} />}
    </div>
  )
}

function AccountForm({ id, initial, onClose, onSaved }: { id?: string; initial?: AccountInput; onClose: () => void; onSaved: () => void }) {
  const founder = useIsFounder()
  const [a, setA] = useState<AccountInput>(initial ?? { name: '', kind: 'bank', bank_name: null, last4: null, opening_balance: 0, opening_date: istToday(), is_default: false, notes: null })
  const [reason, setReason] = useState('')
  const act = useAsyncAction()
  const sensitive = !!initial && (Number(a.opening_balance) !== Number(initial.opening_balance) || a.opening_date !== initial.opening_date || a.kind !== initial.kind)
  return (
    <Modal title={id ? 'Edit account' : 'New account'} onClose={onClose}>
      <form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (await act.run(() => moneyApi.saveAccount({ ...a, opening_balance: Number(a.opening_balance) || 0 }, id, sensitive ? reason : undefined))) onSaved() }}>
        <label className="block"><span className="text-sm text-ink">Name</span><input className="field mt-1.5" required value={a.name} onChange={e => setA({ ...a, name: e.target.value })} placeholder="e.g. HDFC Current, Founder 1 UPI, Cash" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-sm text-ink">Type</span><select className="field mt-1.5" value={a.kind} onChange={e => setA({ ...a, kind: e.target.value as AccountKind })}>{ACCOUNT_KINDS.map(k => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Last 4 digits</span><input className="field mt-1.5 num" maxLength={4} inputMode="numeric" value={a.last4 ?? ''} onChange={e => setA({ ...a, last4: e.target.value.replace(/\D/g, '') || null })} /></label>
          <label className="block"><span className="text-sm text-ink">Opening balance (₹)</span><input type="number" step="0.01" className="field mt-1.5 num" disabled={!founder} value={a.opening_balance} onChange={e => setA({ ...a, opening_balance: e.target.value as unknown as number })} /></label>
          <label className="block"><span className="text-sm text-ink">Opening date</span><input type="date" className="field mt-1.5" disabled={!founder} value={a.opening_date} onChange={e => setA({ ...a, opening_date: e.target.value })} /></label>
        </div>
        {!founder && <p className="text-xs text-muted">Only founders set opening balances.</p>}
        {founder && !id && Number(a.opening_balance) !== 0 && <p className="text-xs text-muted">Add the matching opening capital in Capital too, or the balance check will show the difference.</p>}
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={a.is_default} onChange={e => setA({ ...a, is_default: e.target.checked })} /> Default account for payments</label>
        {sensitive && <label className="block"><span className="text-sm text-ink">Reason for changing the opening balance</span><input className="field mt-1.5" required minLength={3} value={reason} onChange={e => setReason(e.target.value)} /></label>}
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy}>Save</button></div>
      </form>
    </Modal>
  )
}

function TransferForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const accounts = useAsync(() => moneyApi.accountRecords(), [])
  const [t, setT] = useState({ from_account_id: '', to_account_id: '', transfer_date: istToday(), amount: 0, notes: '' })
  const act = useAsyncAction()
  return (
    <Modal title="Move money between accounts" onClose={onClose}>
      <form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (await act.run(() => moneyApi.saveTransfer({ ...t, amount: Number(t.amount), notes: t.notes || null }))) onSaved() }}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-sm text-ink">From</span><select className="field mt-1.5" required value={t.from_account_id} onChange={e => setT({ ...t, from_account_id: e.target.value })}><option value="">Choose</option>{(accounts.data ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">To</span><select className="field mt-1.5" required value={t.to_account_id} onChange={e => setT({ ...t, to_account_id: e.target.value })}><option value="">Choose</option>{(accounts.data ?? []).filter(a => a.id !== t.from_account_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Amount (₹)</span><input type="number" min="0.01" step="0.01" required className="field mt-1.5 num" value={t.amount || ''} onChange={e => setT({ ...t, amount: e.target.value as unknown as number })} /></label>
          <label className="block"><span className="text-sm text-ink">Date</span><input type="date" required className="field mt-1.5" value={t.transfer_date} onChange={e => setT({ ...t, transfer_date: e.target.value })} /></label>
        </div>
        <label className="block"><span className="text-sm text-ink">Notes</span><input className="field mt-1.5" value={t.notes} onChange={e => setT({ ...t, notes: e.target.value })} placeholder="e.g. Cash withdrawal for shoot" /></label>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy}>Move money</button></div>
      </form>
    </Modal>
  )
}

const LINK: Record<string, string> = { receipts: '/money/payments/', expenses: '/money/expenses/', capital_entries: '/money/capital/' }
export function AccountDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const founder = useIsFounder()
  const accts = useAsync(() => moneyApi.accounts(), [])
  const recs = useAsync(() => moneyApi.accountRecords(), [])
  const st = useAsync(() => moneyApi.statement(id), [id])
  const [modal, setModal] = useState<null | 'edit' | 'archive'>(null)
  const a = accts.data?.find(x => x.account_id === id), rec = recs.data?.find(x => x.id === id)
  if (accts.loading && !accts.data) return <Loading label="Opening the account" />
  if (!a || !rec) return <NotFound what="account" />
  let run = 0
  const lines = (st.data ?? []).map(l => { run = round2(run + l.money_in - l.money_out); return { ...l, running: run } })
  return (
    <div className="space-y-6">
      <MoneyHeader title={a.name} kanji="口" sub={`${ACCOUNT_KIND_LABEL[a.kind]}${rec.last4 ? ` ··${rec.last4}` : ''} · balance ${formatINR(a.balance)}`}
        actions={<><button className="btn-ghost" onClick={() => setModal('edit')}><Icon name="edit" /> Edit</button><MoreMenu items={[{ label: 'Archive account…', onSelect: () => setModal('archive'), danger: true }]} /></>} />
      <MoneyTabs />
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="shoji p-4"><p className="eyebrow">Opening</p><p className="text-xl text-ink num mt-1">{formatINR(a.opening_balance)}</p><p className="text-xs text-muted">{formatDate(a.opening_date)}</p></div>
        <div className="shoji p-4"><p className="eyebrow">Money in</p><p className="text-xl text-ink num mt-1">{formatINR(a.money_in)}</p></div>
        <div className="shoji p-4"><p className="eyebrow">Money out</p><p className="text-xl text-ink num mt-1">{formatINR(a.money_out)}</p></div>
        <div className="shoji p-4"><p className="eyebrow">Balance now</p><p className="text-xl text-ink num mt-1">{formatINR(a.balance)}</p></div>
      </div>
      <div className="grid lg:grid-cols-[1fr_22rem] gap-6 items-start">
        <DataTable rows={lines} rowKey={l => `${l.source_table}-${l.source_id}-${l.entry_date}-${l.description}`} rowLink={l => l.source_id && LINK[l.source_table] && (founder || l.source_table !== 'capital_entries') ? LINK[l.source_table] + l.source_id : ''}
          csvName={`statement-${a.name.replace(/\W+/g, '-')}`} empty="No movements yet." search={l => l.description} searchPlaceholder="Search the statement"
          cols={[
            { key: 'date', header: 'Date', cell: l => dateCell(l.entry_date), csv: l => formatDate(l.entry_date) },
            { key: 'what', header: 'Details', cell: l => l.description, csv: l => l.description },
            { key: 'in', header: 'In', align: 'right', cell: l => l.money_in ? formatINR(l.money_in) : '', csv: l => l.money_in },
            { key: 'out', header: 'Out', align: 'right', cell: l => l.money_out ? formatINR(l.money_out) : '', csv: l => l.money_out },
            { key: 'bal', header: 'Balance', align: 'right', cell: l => formatINR(l.running), csv: l => l.running },
          ]} />
        <MoneyHistory table="money_accounts" id={id} />
      </div>
      {modal === 'edit' && <AccountForm id={id} initial={{ name: rec.name, kind: rec.kind, bank_name: rec.bank_name, last4: rec.last4, opening_balance: rec.opening_balance, opening_date: rec.opening_date, is_default: rec.is_default, notes: rec.notes }}
        onClose={() => setModal(null)} onSaved={() => { setModal(null); accts.reload(); recs.reload(); st.reload() }} />}
      {modal === 'archive' && <ReasonModal title={`Archive ${a.name}`} action="Archive" danger note={a.balance !== 0 ? `It still holds ${formatINR(a.balance)} — move that out first, or the total will drop.` : undefined}
        onClose={() => setModal(null)} onConfirm={async r => { await moneyApi.archiveAccount(id, r); nav('/money/accounts') }} />}
    </div>
  )
}
