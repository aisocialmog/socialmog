// Payments received: against one or more invoices (with the client's TDS),
// or "other income". Invoice statuses update from these automatically.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { moneyApi, type Allocation, type PaymentInput, type PaymentRow } from '../../data/money'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, formatINR, istToday } from '../../lib/format'
import { PAY_MODE_LABEL, PAY_MODES, round2, type InvoiceTotals, type PayMode } from '../../lib/money'
import { Icon } from '../../components/ui/Icon'
import { Card, MoreMenu, Pill, SectionTitle } from '../../components/ui/kit'
import { Modal } from '../../components/ui/Modal'
import { FormError } from '../auth/AuthLayout'
import { DataTable, Facts, Loading, MoneyHeader, MoneyHistory, MoneyTabs, NotFound, ReasonModal, Select, dateCell, money, useAsyncAction } from './MoneyBits'

export function PaymentsPage() {
  const [params, setParams] = useSearchParams()
  const { data, error, reload } = useAsync(() => moneyApi.payments(), [])
  const [kind, setKind] = useState<'all' | 'client_payment' | 'other_income' | 'unapplied'>('all')
  const [account, setAccount] = useState('all')
  const recording = params.get('record') === '1'
  const accts = useMemo(() => [...new Map((data ?? []).map(p => [p.account_id, p.account_name])).entries()], [data])
  const rows = (data ?? []).filter(p => kind === 'all' || (kind === 'unapplied' ? p.unapplied > 0 : p.category === kind)).filter(p => account === 'all' || p.account_id === account)
  const close = () => { params.delete('record'); params.delete('brand'); params.delete('invoice'); setParams(params, { replace: true }) }
  return (
    <div className="space-y-6">
      <MoneyHeader title="Payments received" kanji="入" sub={`${rows.length} payments`}
        actions={<button className="btn-primary" onClick={() => { params.set('record', '1'); setParams(params) }}><Icon name="plus" /> Record payment</button>} />
      <MoneyTabs />
      {error && <FormError>{error}</FormError>}
      {!data ? <Loading label="Loading payments" /> : (
        <DataTable rows={rows} rowKey={p => p.id} rowLink={p => `/money/payments/${p.id}`} csvName="payments" empty="No payments recorded yet."
          search={p => `${p.brand_name ?? ''} ${p.reference ?? ''} ${p.invoice_numbers.join(' ')} ${p.notes ?? ''}`} searchPlaceholder="Search brand, UTR / reference, invoice number"
          dateOf={p => p.received_on} defaultSort={{ key: 'date', dir: -1 }}
          filters={<>
            <Select id="pay-kind" label="Type" value={kind} onChange={setKind} options={[['all', 'All money in'], ['client_payment', 'From brands'], ['other_income', 'Other income'], ['unapplied', 'Advances (not applied)']]} />
            <Select id="pay-acct" label="Account" value={account} onChange={setAccount} options={[['all', 'Any account'], ...accts]} />
          </>}
          cols={[
            { key: 'date', header: 'Date', cell: p => dateCell(p.received_on), sort: p => p.received_on, csv: p => formatDate(p.received_on) },
            { key: 'from', header: 'From', cell: p => <>{p.category === 'other_income' ? <span className="text-ink">Other income{p.notes ? ` — ${p.notes}` : ''}</span> : <span className="text-ink">{p.brand_name}</span>}
              {p.invoice_numbers.length > 0 && <span className="block text-xs text-muted num">{p.invoice_numbers.join(', ')}</span>}</>, sort: p => p.brand_name ?? 'zz', csv: p => p.brand_name ?? 'Other income' },
            { key: 'mode', header: 'Mode', hideSm: true, cell: p => <>{p.mode ? PAY_MODE_LABEL[p.mode] : '—'}{p.reference && <span className="block text-xs text-muted num">{p.reference}</span>}</>, csv: p => p.mode ? PAY_MODE_LABEL[p.mode] : '' },
            { key: 'account', header: 'Into', hideSm: true, cell: p => p.account_name, sort: p => p.account_name, csv: p => p.account_name },
            { key: 'tds', header: 'TDS', align: 'right', hideSm: true, cell: p => p.tds_deducted ? formatINR(p.tds_deducted) : '—', sort: p => p.tds_deducted, csv: p => p.tds_deducted },
            { key: 'amount', header: 'Received', align: 'right', cell: p => <>{formatINR(p.amount_received)}{p.unapplied > 0 && <span className="block text-xs text-muted">{formatINR(p.unapplied)} advance</span>}</>, sort: p => p.amount_received, csv: p => p.amount_received },
          ]}
          extraCsv={[{ header: 'Reference', value: p => p.reference }, { header: 'Invoices', value: p => p.invoice_numbers.join(' ') }, { header: 'Applied (INR)', value: p => p.applied }, { header: 'Not applied (INR)', value: p => p.unapplied }]}
          footer={shown => <span className="text-muted">Received {formatINR(round2(shown.reduce((s, p) => s + p.amount_received, 0)))} · client TDS <span className="num">{formatINR(round2(shown.reduce((s, p) => s + p.tds_deducted, 0)))}</span></span>} />
      )}
      {recording && <RecordPayment brandId={params.get('brand')} invoiceId={params.get('invoice')} onClose={close} onSaved={() => { close(); reload() }} />}
    </div>
  )
}

/** Fill invoices oldest first with the money available. */
export function autoApply(open: InvoiceTotals[], available: number): Record<string, number> {
  let left = round2(available)
  const out: Record<string, number> = {}
  for (const i of open) { const a = Math.min(left, i.outstanding); if (a > 0) { out[i.invoice_id] = round2(a); left = round2(left - a) } }
  return out
}

function RecordPayment({ brandId, invoiceId, onClose, onSaved }: { brandId: string | null; invoiceId: string | null; onClose: () => void; onSaved: () => void }) {
  const brands = useAsync(() => moneyApi.brandOptions(), [])
  const accounts = useAsync(() => moneyApi.accountRecords(), [])
  const [p, setP] = useState<PaymentInput>({ brand_id: brandId, account_id: '', received_on: istToday(), amount_received: 0, tds_deducted: 0, mode: 'neft', reference: null, notes: null, category: 'client_payment' })
  const open = useAsync(() => p.brand_id && p.category === 'client_payment' ? moneyApi.openInvoices(p.brand_id) : Promise.resolve([]), [p.brand_id, p.category])
  const [alloc, setAlloc] = useState<Record<string, number>>({})
  const act = useAsyncAction()
  useEffect(() => { if (!p.account_id && accounts.data?.length) setP(x => ({ ...x, account_id: (accounts.data!.find(a => a.is_default) ?? accounts.data![0]).id })) }, [accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {   // coming from an invoice: pre-fill what it still owes (less the TDS the brand will keep)
    const inv = open.data?.find(i => i.invoice_id === invoiceId)
    if (inv && !p.amount_received) {
      const tds = Math.min(round2(inv.tds_expected), inv.outstanding)
      setP(x => ({ ...x, amount_received: round2(inv.outstanding - tds), tds_deducted: tds })); setAlloc({ [inv.invoice_id]: inv.outstanding })
    }
  }, [open.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const credited = round2((Number(p.amount_received) || 0) + (Number(p.tds_deducted) || 0))
  const applied = round2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0))
  const set = (x: Partial<PaymentInput>) => setP({ ...p, ...x })
  const over = applied > credited
  return (
    <Modal title="Record a payment" wide onClose={onClose}>
      <form className="space-y-4" onSubmit={async e => {
        e.preventDefault()
        const list: Allocation[] = Object.entries(alloc).map(([invoice_id, amount]) => ({ invoice_id, amount: Number(amount) })).filter(a => a.amount > 0)
        if (await act.run(() => moneyApi.recordPayment({ ...p, amount_received: Number(p.amount_received), tds_deducted: Number(p.tds_deducted) }, p.category === 'client_payment' ? list : []))) onSaved()
      }}>
        <div role="radiogroup" aria-label="Type of money in" className="inline-flex rounded-shoji border border-line/30 p-0.5 bg-card">
          {([['client_payment', 'From a brand'], ['other_income', 'Other income']] as const).map(([k, l]) => (
            <button type="button" key={k} role="radio" aria-checked={p.category === k} onClick={() => { set({ category: k, brand_id: k === 'other_income' ? null : p.brand_id, tds_deducted: 0 }); setAlloc({}) }}
              className={`px-3 h-9 rounded-[5px] text-sm ${p.category === k ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>{l}</button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {p.category === 'client_payment' && <label className="block sm:col-span-2"><span className="text-sm text-ink">Brand</span>
            <select className="field mt-1.5" required value={p.brand_id ?? ''} onChange={e => { set({ brand_id: e.target.value || null }); setAlloc({}) }}>
              <option value="">Choose a brand</option>{(brands.data ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></label>}
          <label className="block"><span className="text-sm text-ink">Amount received (₹)</span><input type="number" min="0.01" step="0.01" required className="field mt-1.5 num" value={p.amount_received || ''} onChange={e => set({ amount_received: e.target.value as unknown as number })} /></label>
          {p.category === 'client_payment' && <label className="block"><span className="text-sm text-ink">TDS deducted by the brand (₹)</span><input type="number" min="0" step="0.01" className="field mt-1.5 num" value={p.tds_deducted || ''} onChange={e => set({ tds_deducted: e.target.value as unknown as number })} /></label>}
          <label className="block"><span className="text-sm text-ink">Date received</span><input type="date" required className="field mt-1.5" value={p.received_on} onChange={e => set({ received_on: e.target.value })} /></label>
          <label className="block"><span className="text-sm text-ink">Into account</span>
            <select className="field mt-1.5" required value={p.account_id} onChange={e => set({ account_id: e.target.value })}>{(accounts.data ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Mode</span>
            <select className="field mt-1.5" value={p.mode ?? ''} onChange={e => set({ mode: (e.target.value || null) as PayMode | null })}>{PAY_MODES.map(m => <option key={m} value={m}>{PAY_MODE_LABEL[m]}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">UTR / cheque / reference</span><input className="field mt-1.5" value={p.reference ?? ''} onChange={e => set({ reference: e.target.value || null })} /></label>
          <label className="block sm:col-span-2"><span className="text-sm text-ink">Notes</span><input className="field mt-1.5" value={p.notes ?? ''} onChange={e => set({ notes: e.target.value || null })} placeholder={p.category === 'other_income' ? 'e.g. Savings interest, refund from vendor' : ''} /></label>
        </div>
        {p.category === 'client_payment' && p.brand_id && (
          <fieldset className="shoji p-4">
            <legend className="px-1 text-sm text-ink">Apply to invoices</legend>
            {!(open.data ?? []).length ? <p className="text-sm text-muted">No unpaid invoices for this brand — the payment will be kept as an advance.</p> : <>
              <div className="flex justify-end mb-2"><button type="button" className="text-sm underline underline-offset-4 text-muted hover:text-ink" onClick={() => setAlloc(autoApply(open.data ?? [], credited))}>Apply oldest first</button></div>
              <ul className="space-y-2">
                {(open.data ?? []).map(i => (
                  <li key={i.invoice_id} className="grid grid-cols-[1fr_9rem] gap-3 items-center">
                    <span className="text-sm"><span className="text-ink num">{i.invoice_number}</span><span className="block text-xs text-muted">{formatDate(i.issue_date)} · owes {formatINR(i.outstanding)}{i.tds_expected ? ` · TDS ${i.tds_rate}% = ${formatINR(i.tds_expected)}` : ''}</span></span>
                    <label><span className="sr-only">Amount applied to {i.invoice_number}</span>
                      <input type="number" min="0" max={i.outstanding} step="0.01" className="field num" value={alloc[i.invoice_id] ?? ''} onChange={e => setAlloc(a => ({ ...a, [i.invoice_id]: e.target.value as unknown as number }))} /></label>
                  </li>
                ))}
              </ul>
            </>}
            <p className={`text-sm mt-3 ${over ? 'text-ink underline decoration-akane decoration-2 underline-offset-4' : 'text-muted'}`}>
              Received + TDS = <span className="num text-ink">{formatINR(credited)}</span> · applied <span className="num text-ink">{formatINR(applied)}</span>
              {credited - applied > 0 && !over && <> · <span className="text-ink">{formatINR(round2(credited - applied))}</span> stays as an advance</>}{over && ' — more than was received'}
            </p>
          </fieldset>
        )}
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy || over}>{act.busy ? 'Saving…' : 'Save payment'}</button></div>
      </form>
    </Modal>
  )
}

export function PaymentDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { data, loading, reload } = useAsync(() => moneyApi.payment(id), [id])
  const [modal, setModal] = useState<null | 'edit' | 'archive'>(null)
  if (loading && !data) return <Loading label="Opening the payment" />
  if (!data) return <NotFound what="payment" />
  const p = data.row
  return (
    <div className="space-y-6">
      <MoneyHeader title={`${formatINR(p.amount_received)} ${p.category === 'other_income' ? 'other income' : `from ${p.brand_name}`}`} kanji="入" sub={`Received ${formatDate(p.received_on)} into ${p.account_name}`}
        actions={<>{p.unapplied > 0 && <Pill tone="warm">{formatINR(p.unapplied)} advance</Pill>}<button className="btn-ghost" onClick={() => setModal('edit')}><Icon name="edit" /> Edit</button>
          <MoreMenu items={[{ label: 'Archive payment…', onSelect: () => setModal('archive'), danger: true }]} /></>} />
      <MoneyTabs />
      <div className="grid lg:grid-cols-[1fr_24rem] gap-6 items-start">
        <div className="space-y-4">
          <Card className="shoji-pad"><Facts rows={[
            ['Amount received', money(p.amount_received)], ['TDS deducted by the brand', p.tds_deducted ? money(p.tds_deducted) : null], ['Counts against invoices', money(p.credited)],
            ['Mode', p.mode ? PAY_MODE_LABEL[p.mode] : null], ['Reference', p.reference], ['Account', <Link className="underline underline-offset-4" to={`/money/accounts/${p.account_id}`}>{p.account_name}</Link>],
            ['Brand', p.brand_id ? <Link className="underline underline-offset-4" to={`/brands/${p.brand_id}`}>{p.brand_name}</Link> : null], ['Notes', p.notes],
          ]} /></Card>
          {p.category === 'client_payment' && <Card className="shoji-pad">
            <SectionTitle kanji="請">Applied to</SectionTitle>
            {!data.allocations.length ? <p className="text-sm text-muted">Not applied to any invoice — it’s an advance from the brand. Edit to apply it.</p> : (
              <ul className="divide-y divide-line/15 text-sm">{data.allocations.map(a => (
                <li key={a.id}><Link to={`/money/invoices/${a.invoice_id}`} className="flex justify-between py-2 hover:text-ink"><span className="num text-ink">{a.invoice_number}</span><span className="num">{formatINR(a.amount)}</span></Link></li>
              ))}</ul>
            )}
          </Card>}
        </div>
        <MoneyHistory table="receipts" id={id} version={p.updated_at} />
      </div>
      {modal === 'edit' && <EditPayment row={p} current={data.allocations} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} />}
      {modal === 'archive' && <ReasonModal title="Archive this payment" action="Archive" danger note="The invoices it paid will show as owed again. The payment stays in the history."
        onClose={() => setModal(null)} onConfirm={async r => { await moneyApi.archivePayment(id, r); nav('/money/payments') }} />}
    </div>
  )
}

function EditPayment({ row, current, onClose, onSaved }: { row: PaymentRow; current: Allocation[]; onClose: () => void; onSaved: () => void }) {
  const accounts = useAsync(() => moneyApi.accountRecords(), [])
  const open = useAsync(() => row.brand_id && row.category === 'client_payment' ? moneyApi.openInvoices(row.brand_id) : Promise.resolve([]), [row.brand_id])
  const [p, setP] = useState({ received_on: row.received_on, amount_received: row.amount_received, tds_deducted: row.tds_deducted, account_id: row.account_id, mode: row.mode, reference: row.reference, notes: row.notes })
  const [alloc, setAlloc] = useState<Record<string, number>>(Object.fromEntries(current.map(a => [a.invoice_id, a.amount])))
  const [reason, setReason] = useState('')
  const act = useAsyncAction()
  const rows = [...current.map(a => ({ invoice_id: a.invoice_id, label: (a as Allocation & { invoice_number?: string | null }).invoice_number ?? 'Invoice', max: Infinity })),
    ...(open.data ?? []).filter(i => !current.some(a => a.invoice_id === i.invoice_id)).map(i => ({ invoice_id: i.invoice_id, label: i.invoice_number ?? '', max: i.outstanding }))]
  return (
    <Modal title="Edit payment" wide onClose={onClose}>
      <form className="space-y-4" onSubmit={async e => {
        e.preventDefault()
        const list = row.category === 'client_payment' ? Object.entries(alloc).map(([invoice_id, amount]) => ({ invoice_id, amount: Number(amount) || 0 })) : null
        if (await act.run(() => moneyApi.updatePayment(row.id, { ...p, amount_received: Number(p.amount_received), tds_deducted: Number(p.tds_deducted) }, list, reason))) onSaved()
      }}>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block"><span className="text-sm text-ink">Amount received (₹)</span><input type="number" step="0.01" min="0.01" className="field mt-1.5 num" value={p.amount_received} onChange={e => setP({ ...p, amount_received: e.target.value as unknown as number })} /></label>
          {row.category === 'client_payment' && <label className="block"><span className="text-sm text-ink">TDS deducted (₹)</span><input type="number" step="0.01" min="0" className="field mt-1.5 num" value={p.tds_deducted} onChange={e => setP({ ...p, tds_deducted: e.target.value as unknown as number })} /></label>}
          <label className="block"><span className="text-sm text-ink">Date</span><input type="date" className="field mt-1.5" value={p.received_on} onChange={e => setP({ ...p, received_on: e.target.value })} /></label>
          <label className="block"><span className="text-sm text-ink">Account</span><select className="field mt-1.5" value={p.account_id} onChange={e => setP({ ...p, account_id: e.target.value })}>{(accounts.data ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Mode</span><select className="field mt-1.5" value={p.mode ?? ''} onChange={e => setP({ ...p, mode: (e.target.value || null) as PayMode | null })}>{PAY_MODES.map(m => <option key={m} value={m}>{PAY_MODE_LABEL[m]}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Reference</span><input className="field mt-1.5" value={p.reference ?? ''} onChange={e => setP({ ...p, reference: e.target.value || null })} /></label>
        </div>
        {row.category === 'client_payment' && rows.length > 0 && <fieldset className="shoji p-4"><legend className="px-1 text-sm text-ink">Applied to</legend>
          <ul className="space-y-2">{rows.map(r => (
            <li key={r.invoice_id} className="grid grid-cols-[1fr_9rem] gap-3 items-center"><span className="text-sm num text-ink">{r.label}</span>
              <label><span className="sr-only">Amount applied to {r.label}</span><input type="number" min="0" step="0.01" className="field num" value={alloc[r.invoice_id] ?? ''} onChange={e => setAlloc(a => ({ ...a, [r.invoice_id]: e.target.value as unknown as number }))} /></label></li>
          ))}</ul></fieldset>}
        <label className="block"><span className="text-sm text-ink">Reason for the change</span><input className="field mt-1.5" required minLength={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Wrong UTR typed in" /></label>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy}>Save changes</button></div>
      </form>
    </Modal>
  )
}
