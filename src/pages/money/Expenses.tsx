// Expenses: list, add/edit (edits need a reason), bill/receipt photos,
// recurring expenses that create themselves each month.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { moneyApi, type ExpenseInput, type ExpenseRow, type RecurringInput, type RecurringRow } from '../../data/money'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, formatINR, istToday } from '../../lib/format'
import { round2, TREATMENT_LABEL } from '../../lib/money'
import { Icon } from '../../components/ui/Icon'
import { Card, MoreMenu, Pill, SectionTitle } from '../../components/ui/kit'
import { Modal } from '../../components/ui/Modal'
import { RecordFiles } from '../../components/files/RecordFiles'
import { FormError } from '../auth/AuthLayout'
import { DataTable, Facts, Loading, MoneyHeader, MoneyHistory, MoneyTabs, NotFound, ReasonModal, Select, dateCell, money, useAsyncAction } from './MoneyBits'

export function ExpensesPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [made, setMade] = useState(0)
  const { data, error, reload } = useAsync(async () => { const n = await moneyApi.runRecurring().catch(() => 0); setMade(n); return moneyApi.expenses() }, [])
  const cats = useAsync(() => moneyApi.categories(), [])
  const [status, setStatus] = useState<'all' | 'paid' | 'unpaid'>((params.get('status') as 'unpaid') ?? 'all')
  const [cat, setCat] = useState('all')
  const [kind, setKind] = useState<'all' | 'direct' | 'overhead' | 'tax' | 'payout'>('all')
  const [view, setView] = useState<'list' | 'recurring'>('list')
  const adding = params.get('new') === '1'
  const rows = (data ?? []).filter(e => status === 'all' || e.status === status).filter(e => cat === 'all' || e.category_id === cat)
    .filter(e => kind === 'all' || (kind === 'payout' ? !!e.payout_id : kind === 'tax' ? e.treatment.endsWith('_payment') : e.treatment === kind))
  return (
    <div className="space-y-6">
      <MoneyHeader title="Expenses" kanji="出" sub={made > 0 ? `${made} recurring expense${made > 1 ? 's' : ''} just added for this month` : `${rows.length} expenses`}
        actions={<button className="btn-primary" onClick={() => { params.set('new', '1'); setParams(params) }}><Icon name="plus" /> Add expense</button>} />
      <MoneyTabs />
      <div role="tablist" aria-label="View" className="inline-flex rounded-shoji border border-line/30 p-0.5 bg-card">
        {(['list', 'recurring'] as const).map(v => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`px-3.5 h-9 rounded-[5px] text-sm ${view === v ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>{v === 'list' ? 'All expenses' : 'Recurring'}</button>)}
      </div>
      {error && <FormError>{error}</FormError>}
      {view === 'recurring' ? <Recurring onChange={reload} /> : !data ? <Loading label="Loading expenses" /> : (
        <DataTable rows={rows} rowKey={e => e.id} rowLink={e => `/money/expenses/${e.id}`} csvName="expenses" empty="No expenses yet."
          search={e => `${e.description} ${e.category_name} ${e.vendor_name ?? ''} ${e.brand_name ?? ''} ${e.campaign_name ?? ''} ${e.deliverable_title ?? ''} ${e.bill_number ?? ''}`}
          searchPlaceholder="Search description, vendor, brand, bill no." dateOf={e => e.expense_date} defaultSort={{ key: 'date', dir: -1 }}
          filters={<>
            <Select id="ex-status" label="Paid?" value={status} onChange={setStatus} options={[['all', 'Paid & unpaid'], ['paid', 'Paid'], ['unpaid', 'Unpaid']]} />
            <Select id="ex-kind" label="Kind" value={kind} onChange={setKind} options={[['all', 'Any kind'], ['direct', 'Direct costs'], ['overhead', 'Overheads'], ['payout', 'From payouts'], ['tax', 'Tax payments']]} />
            <Select id="ex-cat" label="Category" value={cat} onChange={setCat} options={[['all', 'Any category'], ...(cats.data ?? []).map(c => [c.id, c.name] as [string, string])]} />
          </>}
          cols={[
            { key: 'date', header: 'Date', cell: e => dateCell(e.expense_date), sort: e => e.expense_date, csv: e => formatDate(e.expense_date) },
            { key: 'what', header: 'Expense', cell: e => <><span className="text-ink">{e.description}</span><span className="block text-xs text-muted">{[e.category_name, e.vendor_name, e.deliverable_title ?? e.campaign_name ?? e.brand_name].filter(Boolean).join(' · ')}</span></>, sort: e => e.description, csv: e => e.description },
            { key: 'status', header: 'Paid', cell: e => e.status === 'paid' ? <span className="text-sm">{e.account_name}</span> : <Pill tone="warm">Unpaid</Pill>, sort: e => e.status, csv: e => e.status === 'paid' ? `Paid — ${e.account_name}` : 'Unpaid' },
            { key: 'bill', header: 'Bill', hideSm: true, cell: e => e.bills ? <span className="text-xs text-muted">{e.bills} file{e.bills > 1 ? 's' : ''}</span> : <span className="text-xs text-muted">—</span> },
            { key: 'gst', header: 'GST input', align: 'right', hideSm: true, cell: e => e.gst_amount ? formatINR(e.gst_amount) : '—', sort: e => e.gst_amount, csv: e => e.gst_amount },
            { key: 'amount', header: 'Amount', align: 'right', cell: e => formatINR(e.amount), sort: e => e.amount, csv: e => e.amount },
          ]}
          extraCsv={[{ header: 'Category', value: e => e.category_name }, { header: 'Treatment', value: e => TREATMENT_LABEL[e.treatment] }, { header: 'Total incl. GST', value: e => e.total },
            { header: 'TDS deducted', value: e => e.tds_deducted }, { header: 'Vendor', value: e => e.vendor_name }, { header: 'Brand', value: e => e.brand_name }, { header: 'Campaign', value: e => e.campaign_name },
            { header: 'Production item', value: e => e.deliverable_title }, { header: 'Bill no.', value: e => e.bill_number }, { header: 'Paid on', value: e => e.paid_on ? formatDate(e.paid_on) : '' }]}
          footer={shown => <span className="text-muted">Amount {formatINR(round2(shown.reduce((s, e) => s + e.amount, 0)))} · GST input <span className="num">{formatINR(round2(shown.reduce((s, e) => s + e.gst_amount, 0)))}</span> · unpaid <span className="num text-ink">{formatINR(round2(shown.filter(e => e.status === 'unpaid').reduce((s, e) => s + e.total, 0)))}</span></span>} />
      )}
      {adding && <ExpenseForm prefill={{ deliverable_id: params.get('item'), campaign_id: params.get('campaign') }} onClose={() => { params.delete('new'); setParams(params, { replace: true }) }}
        onSaved={id => nav(`/money/expenses/${id}`)} />}
    </div>
  )
}

const emptyExpense = (): ExpenseInput => ({ expense_date: istToday(), description: '', amount: 0, gst_amount: 0, tds_deducted: 0, category_id: '', status: 'paid', account_id: null, paid_on: null,
  vendor_id: null, brand_id: null, campaign_id: null, deliverable_id: null, bill_number: null, notes: null })

export function ExpenseForm({ row, prefill, onClose, onSaved }: { row?: ExpenseRow; prefill?: { deliverable_id?: string | null; campaign_id?: string | null }; onClose: () => void; onSaved: (id: string) => void }) {
  const cats = useAsync(() => moneyApi.categories(), [])
  const accounts = useAsync(() => moneyApi.accountRecords(), [])
  const brands = useAsync(() => moneyApi.brandOptions(), [])
  const camps = useAsync(() => moneyApi.campaignOptions(), [])
  const items = useAsync(() => moneyApi.deliverableOptions(), [])
  const vendors = useAsync(() => moneyApi.vendorOptions(), [])
  const [e, setE] = useState<ExpenseInput>(() => row ? {
    expense_date: row.expense_date, description: row.description, amount: row.amount, gst_amount: row.gst_amount, tds_deducted: row.tds_deducted, category_id: row.category_id, status: row.status,
    account_id: row.account_id, paid_on: row.paid_on, vendor_id: row.vendor_id, brand_id: row.brand_id, campaign_id: row.campaign_id, deliverable_id: row.deliverable_id, bill_number: row.bill_number, notes: row.notes,
  } : { ...emptyExpense(), deliverable_id: prefill?.deliverable_id ?? null, campaign_id: prefill?.campaign_id ?? null })
  const [bill, setBill] = useState<File | null>(null)
  const [reason, setReason] = useState('')
  const act = useAsyncAction()
  useEffect(() => { if (!e.category_id && cats.data?.length) setE(x => ({ ...x, category_id: cats.data!.find(c => !c.system_key)?.id ?? cats.data![0].id })) }, [cats.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!row && !e.account_id && accounts.data?.length) setE(x => ({ ...x, account_id: (accounts.data!.find(a => a.is_default) ?? accounts.data![0]).id })) }, [accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {   // linking a production item or campaign fills the brand
    const d = items.data?.find(x => x.id === e.deliverable_id), c = camps.data?.find(x => x.id === e.campaign_id)
    const b = d?.brand_id ?? c?.brand_id
    if (b && !e.brand_id) setE(x => ({ ...x, brand_id: b }))
  }, [items.data, camps.data, e.deliverable_id, e.campaign_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<ExpenseInput>) => setE({ ...e, ...p })
  const usable = (cats.data ?? []).filter(c => c.system_key !== 'creator_payout' || row?.category_id === c.id)
  return (
    <Modal title={row ? 'Edit expense' : 'Add an expense'} wide onClose={onClose}>
      <form className="space-y-4" onSubmit={async ev => {
        ev.preventDefault()
        let id = row?.id ?? ''
        const ok = await act.run(async () => {
          id = await moneyApi.saveExpense({ ...e, amount: Number(e.amount), gst_amount: Number(e.gst_amount) || 0, tds_deducted: Number(e.tds_deducted) || 0, account_id: e.status === 'paid' ? e.account_id : null, paid_on: e.status === 'paid' ? e.paid_on : null }, row?.id, row ? reason : undefined)
          if (bill) await moneyApi.uploadBill(id, bill, 'bill')
        })
        if (ok) onSaved(id)
      }}>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block sm:col-span-2"><span className="text-sm text-ink">What was it for?</span><input className="field mt-1.5" required value={e.description} onChange={x => set({ description: x.target.value })} placeholder="e.g. Ring light rental — 2 days" /></label>
          <label className="block"><span className="text-sm text-ink">Date</span><input type="date" required className="field mt-1.5" value={e.expense_date} onChange={x => set({ expense_date: x.target.value })} /></label>
          <label className="block"><span className="text-sm text-ink">Category</span>
            <select className="field mt-1.5" required value={e.category_id} onChange={x => set({ category_id: x.target.value })}>{usable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Amount before GST (₹)</span><input type="number" step="0.01" min="0" required className="field mt-1.5 num" value={e.amount || ''} onChange={x => set({ amount: x.target.value as unknown as number })} /></label>
          <label className="block"><span className="text-sm text-ink">GST on the bill (₹) <span className="text-muted">— input credit</span></span><input type="number" step="0.01" min="0" className="field mt-1.5 num" value={e.gst_amount || ''} onChange={x => set({ gst_amount: x.target.value as unknown as number })} /></label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink"><input type="radio" name="ex-paid" checked={e.status === 'paid'} onChange={() => set({ status: 'paid' })} /> Paid</label>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="radio" name="ex-paid" checked={e.status === 'unpaid'} onChange={() => set({ status: 'unpaid' })} /> Not paid yet (we owe it)</label>
            <span className="text-sm text-muted ml-auto num">Total {formatINR(round2((Number(e.amount) || 0) + (Number(e.gst_amount) || 0)))}</span>
          </div>
          {e.status === 'paid' && <>
            <label className="block"><span className="text-sm text-ink">Paid from</span><select className="field mt-1.5" required value={e.account_id ?? ''} onChange={x => set({ account_id: x.target.value || null })}>
              <option value="">Choose an account</option>{(accounts.data ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label className="block"><span className="text-sm text-ink">Paid on</span><input type="date" className="field mt-1.5" value={e.paid_on ?? e.expense_date} onChange={x => set({ paid_on: x.target.value || null })} /></label>
          </>}
          <label className="block"><span className="text-sm text-ink">Production item <span className="text-muted">(optional)</span></span><select className="field mt-1.5" value={e.deliverable_id ?? ''} onChange={x => set({ deliverable_id: x.target.value || null })}>
            <option value="">None</option>{(items.data ?? []).filter(d => !e.brand_id || d.brand_id === e.brand_id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Campaign <span className="text-muted">(optional)</span></span><select className="field mt-1.5" value={e.campaign_id ?? ''} onChange={x => set({ campaign_id: x.target.value || null })}>
            <option value="">None</option>{(camps.data ?? []).filter(c => !e.brand_id || c.brand_id === e.brand_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Brand <span className="text-muted">(optional)</span></span><select className="field mt-1.5" value={e.brand_id ?? ''} onChange={x => set({ brand_id: x.target.value || null, campaign_id: null, deliverable_id: null })}>
            <option value="">None — company cost</option>{(brands.data ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Vendor <span className="text-muted">(optional)</span></span><select className="field mt-1.5" value={e.vendor_id ?? ''} onChange={x => set({ vendor_id: x.target.value || null })}>
            <option value="">None</option>{(vendors.data ?? []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Bill number</span><input className="field mt-1.5" value={e.bill_number ?? ''} onChange={x => set({ bill_number: x.target.value || null })} /></label>
          <label className="block"><span className="text-sm text-ink">TDS we deducted (₹)</span><input type="number" step="0.01" min="0" className="field mt-1.5 num" value={e.tds_deducted || ''} onChange={x => set({ tds_deducted: x.target.value as unknown as number })} /></label>
          {!row && <label className="block sm:col-span-2"><span className="text-sm text-ink">Bill / receipt photo <span className="text-muted">(optional)</span></span>
            <input type="file" accept="image/*,application/pdf" capture="environment" className="block mt-1.5 text-sm text-muted file:mr-3 file:rounded-shoji file:border file:border-line/40 file:bg-transparent file:text-ink file:px-3 file:py-1.5" onChange={x => setBill(x.target.files?.[0] ?? null)} /></label>}
          <label className="block sm:col-span-2"><span className="text-sm text-ink">Notes</span><input className="field mt-1.5" value={e.notes ?? ''} onChange={x => set({ notes: x.target.value || null })} /></label>
          {row && <label className="block sm:col-span-2"><span className="text-sm text-ink">Reason for the change</span><input className="field mt-1.5" required minLength={3} value={reason} onChange={x => setReason(x.target.value)} placeholder="e.g. Bill amount was ₹1,800, not ₹1,500" /></label>}
        </div>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy}>{act.busy ? 'Saving…' : row ? 'Save changes' : 'Add expense'}</button></div>
      </form>
    </Modal>
  )
}

export function ExpenseDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { data: e, loading, reload } = useAsync(() => moneyApi.expense(id), [id])
  const accounts = useAsync(() => moneyApi.accountRecords(), [])
  const [modal, setModal] = useState<null | 'edit' | 'archive' | 'pay'>(null)
  if (loading && !e) return <Loading label="Opening the expense" />
  if (!e) return <NotFound what="expense" />
  const fromPayout = !!e.payout_id
  return (
    <div className="space-y-6">
      <MoneyHeader title={e.description} kanji="出" sub={`${formatDate(e.expense_date)} · ${e.category_name}`}
        actions={<>
          {e.status === 'unpaid' && !fromPayout && <button className="btn-primary" onClick={() => setModal('pay')}>Mark paid</button>}
          {!fromPayout && <button className="btn-ghost" onClick={() => setModal('edit')}><Icon name="edit" /> Edit</button>}
          {!fromPayout && <MoreMenu items={[{ label: 'Archive expense…', onSelect: () => setModal('archive'), danger: true }]} />}
        </>} />
      <MoneyTabs />
      {fromPayout && <p className="shoji p-4 text-sm text-ink">Created automatically when the payout was paid. <Link className="underline underline-offset-4" to={`/money/payouts/${e.payout_id}`}>Change it on the payout</Link>.</p>}
      {e.recurring_id && <p className="text-sm text-muted">Made by a recurring expense for {formatDate(e.recurring_period).slice(3)}.</p>}
      <div className="grid lg:grid-cols-[1fr_24rem] gap-6 items-start">
        <div className="space-y-4">
          <Card className="shoji-pad"><Facts rows={[
            ['Amount before GST', money(e.amount)], ['GST input', e.gst_amount ? money(e.gst_amount) : null], ['Total', money(e.total)],
            ['TDS deducted', e.tds_deducted ? <>{formatINR(e.tds_deducted)} <span className="text-muted">· {formatINR(e.paid_out)} actually paid out</span></> : null],
            ['Status', e.status === 'paid' ? `Paid ${formatDate(e.paid_on)} from ${e.account_name}` : <Pill tone="warm">Unpaid</Pill>],
            ['Counts as', TREATMENT_LABEL[e.treatment]], ['Vendor', e.vendor_name], ['Bill number', e.bill_number],
            ['Brand', e.brand_id ? <Link className="underline underline-offset-4" to={`/brands/${e.brand_id}`}>{e.brand_name}</Link> : null],
            ['Campaign', e.campaign_id ? <Link className="underline underline-offset-4" to={`/campaigns/${e.campaign_id}`}>{e.campaign_name}</Link> : null],
            ['Production item', e.deliverable_id ? <Link className="underline underline-offset-4" to={`/production/${e.deliverable_id}`}>{e.deliverable_title}</Link> : null],
            ['Notes', e.notes],
          ]} /></Card>
          <section aria-label="Bills and receipts">
            <SectionTitle kanji="票">Bill / receipt</SectionTitle>
            <RecordFiles load={() => moneyApi.bills(id)} upload={(f, k) => moneyApi.uploadBill(id, f, k).then(reload)} archive={x => moneyApi.archiveBill(x).then(reload)}
              signedUrl={(p, n) => moneyApi.signedUrl(p, n)} kinds={[{ value: 'bill', label: 'Bill' }, { value: 'screenshot', label: 'Payment screenshot' }, { value: 'other', label: 'Other' }]} defaultKind="bill"
              hint="A photo or PDF of the bill. On a phone you can take the photo straight away." />
          </section>
        </div>
        <MoneyHistory table="expenses" id={id} version={e.updated_at} />
      </div>
      {modal === 'edit' && <ExpenseForm row={e} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} />}
      {modal === 'archive' && <ReasonModal title="Archive this expense" action="Archive" danger onClose={() => setModal(null)} onConfirm={async r => { await moneyApi.archiveExpense(id, r); nav('/money/expenses') }} />}
      {modal === 'pay' && <PayExpense accounts={accounts.data ?? []} onClose={() => setModal(null)} onPay={async (a, d) => { await moneyApi.markExpensePaid(id, a, d); setModal(null); reload() }} />}
    </div>
  )
}

function PayExpense({ accounts, onClose, onPay }: { accounts: { id: string; name: string; is_default: boolean }[]; onClose: () => void; onPay: (account: string, date: string) => Promise<void> }) {
  const [a, setA] = useState(accounts.find(x => x.is_default)?.id ?? accounts[0]?.id ?? '')
  const [d, setD] = useState(istToday())
  const act = useAsyncAction()
  return (
    <Modal title="Mark expense paid" onClose={onClose}>
      <form className="space-y-4" onSubmit={async e => { e.preventDefault(); await act.run(() => onPay(a, d)) }}>
        <label className="block"><span className="text-sm text-ink">Paid from</span><select className="field mt-1.5" value={a} onChange={e => setA(e.target.value)}>{accounts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="block"><span className="text-sm text-ink">Paid on</span><input type="date" className="field mt-1.5" value={d} onChange={e => setD(e.target.value)} /></label>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy}>Mark paid</button></div>
      </form>
    </Modal>
  )
}

// ─── Recurring ──────────────────────────────────────────────
function Recurring({ onChange }: { onChange: () => void }) {
  const { data, reload } = useAsync(() => moneyApi.recurring(), [])
  const [edit, setEdit] = useState<RecurringRow | 'new' | null>(null)
  const monthly = useMemo(() => round2((data ?? []).filter(r => !r.is_paused).reduce((s, r) => s + r.amount + r.gst_amount, 0)), [data])
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="巡" aside={<button className="btn-ghost h-9" onClick={() => setEdit('new')}><Icon name="plus" /> Add recurring</button>}>Recurring expenses</SectionTitle>
      <p className="text-sm text-muted mb-4">Subscriptions and rent that repeat each month. Each one creates its expense on its day (paid from its account if it’s an auto-debit). <span className="text-ink num">{formatINR(monthly)}</span> a month in total.</p>
      {!(data ?? []).length ? <p className="text-sm text-muted">None yet.</p> : (
        <ul className="divide-y divide-line/15">
          {(data ?? []).map(r => (
            <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><p className="text-ink">{r.description}{r.is_paused && <span className="ml-2"><Pill>Paused</Pill></span>}</p>
                <p className="text-xs text-muted">{r.category_name} · day {r.day_of_month} of each month · {r.mark_paid ? `auto-paid from ${r.account_name}` : 'added as unpaid'} · from {formatDate(r.start_date)}{r.end_date ? ` to ${formatDate(r.end_date)}` : ''}{r.created ? ` · ${r.created} created, last ${formatDate(r.last_created)}` : ''}</p></div>
              <div className="flex items-center gap-2"><span className="num text-ink">{formatINR(r.amount + r.gst_amount)}</span><button className="icon-btn" aria-label={`Edit ${r.description}`} onClick={() => setEdit(r)}><Icon name="edit" /></button></div>
            </li>
          ))}
        </ul>
      )}
      {edit && <RecurringForm row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await moneyApi.runRecurring(); reload(); onChange() }} />}
    </Card>
  )
}

function RecurringForm({ row, onClose, onSaved }: { row: RecurringRow | null; onClose: () => void; onSaved: () => void }) {
  const cats = useAsync(() => moneyApi.categories(), [])
  const accounts = useAsync(() => moneyApi.accountRecords(), [])
  const [r, setR] = useState<RecurringInput>(row ? { description: row.description, category_id: row.category_id, vendor_id: row.vendor_id, amount: row.amount, gst_amount: row.gst_amount, account_id: row.account_id, mark_paid: row.mark_paid, day_of_month: row.day_of_month, start_date: row.start_date, end_date: row.end_date, is_paused: row.is_paused, notes: row.notes }
    : { description: '', category_id: '', vendor_id: null, amount: 0, gst_amount: 0, account_id: null, mark_paid: true, day_of_month: 1, start_date: istToday().slice(0, 8) + '01', end_date: null, is_paused: false, notes: null })
  const act = useAsyncAction()
  useEffect(() => { if (!r.category_id && cats.data?.length) setR(x => ({ ...x, category_id: cats.data!.find(c => c.name.startsWith('Software'))?.id ?? cats.data![0].id })) }, [cats.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!r.account_id && accounts.data?.length) setR(x => ({ ...x, account_id: (accounts.data!.find(a => a.is_default) ?? accounts.data![0]).id })) }, [accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<RecurringInput>) => setR({ ...r, ...p })
  return (
    <Modal title={row ? 'Edit recurring expense' : 'Add a recurring expense'} onClose={onClose}>
      <form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (await act.run(() => moneyApi.saveRecurring({ ...r, amount: Number(r.amount), gst_amount: Number(r.gst_amount) || 0, day_of_month: Number(r.day_of_month), account_id: r.account_id || null }, row?.id))) onSaved() }}>
        <label className="block"><span className="text-sm text-ink">Name</span><input className="field mt-1.5" required value={r.description} onChange={e => set({ description: e.target.value })} placeholder="e.g. Adobe Creative Cloud" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-sm text-ink">Amount before GST (₹)</span><input type="number" min="0" step="0.01" required className="field mt-1.5 num" value={r.amount || ''} onChange={e => set({ amount: e.target.value as unknown as number })} /></label>
          <label className="block"><span className="text-sm text-ink">GST (₹)</span><input type="number" min="0" step="0.01" className="field mt-1.5 num" value={r.gst_amount || ''} onChange={e => set({ gst_amount: e.target.value as unknown as number })} /></label>
          <label className="block"><span className="text-sm text-ink">Category</span><select className="field mt-1.5" value={r.category_id} onChange={e => set({ category_id: e.target.value })}>{(cats.data ?? []).filter(c => !c.system_key).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="block"><span className="text-sm text-ink">Day of the month</span><input type="number" min="1" max="28" required className="field mt-1.5 num" value={r.day_of_month} onChange={e => set({ day_of_month: e.target.value as unknown as number })} /></label>
          <label className="block"><span className="text-sm text-ink">Starts</span><input type="date" required className="field mt-1.5" value={r.start_date} onChange={e => set({ start_date: e.target.value })} /></label>
          <label className="block"><span className="text-sm text-ink">Ends <span className="text-muted">(optional)</span></span><input type="date" className="field mt-1.5" value={r.end_date ?? ''} onChange={e => set({ end_date: e.target.value || null })} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={r.mark_paid} onChange={e => set({ mark_paid: e.target.checked })} /> Auto-debit: record it as paid</label>
        {r.mark_paid && <label className="block"><span className="text-sm text-ink">Paid from</span><select className="field mt-1.5" value={r.account_id ?? ''} onChange={e => set({ account_id: e.target.value || null })}>{(accounts.data ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        {row && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={r.is_paused} onChange={e => set({ is_paused: e.target.checked })} /> Paused</label>}
        <p className="text-xs text-muted">Past months from the start date are filled in once when you save.</p>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-between gap-2">
          {row ? <button type="button" className="btn-ghost" onClick={async () => { if (await act.run(() => moneyApi.archiveRecurring(row.id))) onSaved() }}>Stop &amp; remove</button> : <span />}
          <div className="flex gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy}>Save</button></div>
        </div>
      </form>
    </Modal>
  )
}
