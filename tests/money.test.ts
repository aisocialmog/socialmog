// The same scenario as supabase/tests/money_test.sql, run through the
// TypeScript mirror (used by the preview). Both must give the same numbers.
import { describe, expect, it } from 'vitest'
import {
  accountBalances, amountInWords, balanceCheck, capitalAccounts, gstMonthly, gstSplit, invoiceNumber, invoiceTotals, overview,
  payoutAmounts, profitBy, tdsMonthly, upiLink,
  type AccountRec, type AllocationRec, type Books, type CapitalRec, type CategoryRec, type ExpenseRec, type InvoiceItemRec, type InvoiceRec, type PayoutRec, type ReceiptRec,
} from '../src/lib/money'

const T = '2026-11-09'
const ts = '2026-11-01T05:00:00Z'
const inv = (id: string, brand: string, status: InvoiceRec['status'], issue: string | null, due: string | null, pos: string, tds = 0): InvoiceRec => ({
  id, brand_id: brand, campaign_id: null, retainer_id: null, invoice_number: id, issue_date: issue, due_date: due, status, gst_enabled: true, gst_rate: 18, tds_rate: tds,
  place_of_supply_code: pos, service_period_start: null, service_period_end: null, notes: null, cancel_reason: null, created_at: ts, updated_at: ts, sent_at: null, is_archived: false })
const item = (invoice_id: string, quantity: number, rate: number): InvoiceItemRec => ({ id: `${invoice_id}-${quantity}-${rate}`, invoice_id, position: 1, description: 'x', hsn_sac: null, quantity, rate, is_archived: false })
const rc = (id: string, brand: string | null, account: string, on: string, amt: number, tds = 0, category: ReceiptRec['category'] = 'client_payment'): ReceiptRec =>
  ({ id, brand_id: brand, account_id: account, received_on: on, amount_received: amt, tds_deducted: tds, category, mode: 'neft', reference: id, notes: null, is_archived: false, created_at: ts, updated_at: ts })
const al = (receipt_id: string, invoice_id: string, amount: number): AllocationRec => ({ id: `${receipt_id}-${invoice_id}`, receipt_id, invoice_id, amount, is_archived: false })
const cats: CategoryRec[] = [
  ['equipment', 'direct'], ['software', 'overhead'], ['location', 'direct'], ['food', 'direct'], ['gst', 'gst_payment'], ['payout', 'direct'],
].map(([id, treatment], i) => ({ id, name: id, treatment: treatment as CategoryRec['treatment'], system_key: null, position: i, is_archived: false }))
const ex = (id: string, cat: string, brand: string | null, date: string, amount: number, gst: number, paid: string | null, extra: Partial<ExpenseRec> = {}): ExpenseRec => ({
  id, category_id: cat, vendor_id: null, brand_id: brand, campaign_id: null, deliverable_id: null, description: id, expense_date: date, amount, gst_amount: gst, tds_deducted: 0,
  bill_number: null, status: paid ? 'paid' : 'unpaid', paid_on: paid ? date : null, account_id: paid, notes: null, payout_id: null, recurring_id: null, recurring_period: null,
  is_archived: false, created_at: ts, updated_at: ts, ...extra })
const acct = (id: string, opening: number): AccountRec => ({ id, name: id, kind: 'bank', bank_name: null, last4: null, opening_balance: opening, opening_date: '2026-04-01', is_default: false, notes: null, is_archived: false })
const cap = (kind: CapitalRec['kind'], founder: string | null, account: string | null, amount: number): CapitalRec =>
  ({ id: `${kind}-${founder}-${amount}`, entry_date: '2026-10-01', kind, founder_id: founder, account_id: account, amount, notes: null, is_archived: false, created_at: ts, updated_at: ts })

function books(): Books {
  const invoices: InvoiceRec[] = [
    inv('smoke', 'mama', 'sent', '2026-10-05', '2026-10-20', ''),
    inv('i1', 'masala', 'sent', '2026-11-02', '2026-11-17', '27', 10),
    inv('i2', 'brew', 'sent', '2026-09-01', '2026-10-01', '29'),
    inv('i3', 'brew', 'sent', '2027-03-31', '2027-04-30', '29'),
    inv('i4', 'brew', 'cancelled', '2027-04-01', '2027-05-15', '29'),
  ]
  const items = [item('smoke', 4, 50000), item('i1', 2, 25000), item('i1', 1, 10000), item('i2', 1, 100000), item('i3', 1, 50000), item('i4', 1, 40000)]
  const receipts = [rc('r1', 'masala', 'icici', '2026-11-05', 30000), rc('r2', 'masala', 'icici', '2026-11-08', 34800, 6000), rc('r3', 'brew', 'icici', '2026-11-07', 150000),
    rc('adv', 'brew', 'icici', '2026-11-07', 10000), rc('int', null, 'icici', '2026-11-06', 1500, 0, 'other_income')]
  const allocations = [al('r1', 'i1', 30000), al('r2', 'i1', 40800), al('r3', 'i2', 118000), al('r3', 'i3', 32000)]
  const rmap = new Map(receipts.map(r => [r.id, r]))
  const totals = invoices.map(i => invoiceTotals(i, items, allocations.filter(a => a.invoice_id === i.id).map(a => ({ amount: a.amount, received_on: rmap.get(a.receipt_id)!.received_on })), '27', T, { brand: i.brand_id, campaign: null }))
  const payouts: PayoutRec[] = [
    { id: 'p1', creator_id: 'c1', vendor_id: null, campaign_creator_id: null, campaign_id: null, deliverable_id: null, brand_id: 'masala', description: null, amount: 42000, tds_rate: 10, gst_rate: 0,
      due_date: '2026-11-08', status: 'paid', approved_at: ts, approved_by: null, paid_on: '2026-11-08', account_id: 'icici', reference: 'UTR-P1', creator_invoice_no: null, notes: null, is_archived: false, created_at: ts, updated_at: ts },
    { id: 'p2', creator_id: null, vendor_id: 'v1', campaign_creator_id: null, campaign_id: null, deliverable_id: null, brand_id: 'masala', description: null, amount: 15000, tds_rate: 0, gst_rate: 0,
      due_date: '2026-11-20', status: 'pending', approved_at: null, approved_by: null, paid_on: null, account_id: null, reference: null, creator_invoice_no: null, notes: null, is_archived: false, created_at: ts, updated_at: ts },
  ]
  const expenses = [
    ex('e1', 'equipment', 'masala', '2026-11-03', 20000, 3600, 'icici'), ex('e2', 'software', null, '2026-11-04', 5000, 900, 'upi'),
    ex('e3', 'location', 'masala', '2026-11-10', 8000, 0, null), ex('e4', 'food', null, '2026-11-03', 2000, 0, 'icici'), ex('e5', 'gst', null, '2026-11-07', 5000, 0, 'icici'),
    ex('ad-sep', 'software', null, '2026-09-05', 4000, 720, 'icici'), ex('ad-oct', 'software', null, '2026-10-05', 4000, 720, 'icici'), ex('ad-nov', 'software', null, '2026-11-05', 4000, 720, 'icici'),
    ex('p1-exp', 'payout', 'masala', '2026-11-08', 42000, 0, 'icici', { payout_id: 'p1', tds_deducted: 4200 }),
  ]
  const capital = [cap('opening_capital', null, null, 500000), cap('opening_capital', null, null, 100000), cap('capital_added', 'f1', 'icici', 50000),
    cap('founder_withdrawal', 'f2', 'icici', 20000), cap('profit_transferred', null, null, 30000)]
  return { invoices: totals, receipts, allocations, expenses, categories: cats, payouts, capital, accounts: [acct('hdfc', 500000), acct('icici', 100000), acct('upi', 0)], transfers: [] }
}

describe('money engine matches the database', () => {
  const b = books()
  it('invoice numbers per financial year', () => {
    expect(invoiceNumber('SM', '2026-11-02', 1)).toBe('SM/26-27/001')
    expect(invoiceNumber('SM', '2027-03-31', 3)).toBe('SM/26-27/003')
    expect(invoiceNumber('SM', '2027-04-01', 1)).toBe('SM/27-28/001')
    expect(invoiceNumber('SM', '2026-05-01', 1234)).toBe('SM/26-27/1234')
  })
  it('GST split and invoice statuses', () => {
    expect(gstSplit(60000, true, 18, false)).toEqual({ gst: 10800, cgst: 5400, sgst: 5400, igst: 0 })
    expect(gstSplit(100000, true, 18, true)).toEqual({ gst: 18000, cgst: 0, sgst: 0, igst: 18000 })
    expect(gstSplit(1001, true, 18, false)).toEqual({ gst: 180.18, cgst: 90.09, sgst: 90.09, igst: 0 })
    const i1 = b.invoices.find(i => i.invoice_id === 'i1')!
    expect([i1.total, i1.tds_expected, i1.payment_status, i1.outstanding]).toEqual([70800, 6000, 'paid', 0])
    expect(b.invoices.find(i => i.invoice_id === 'i3')!.payment_status).toBe('partly_paid')
    expect(b.invoices.find(i => i.invoice_id === 'i4')!.outstanding).toBe(0)
  })
  it('payout net', () => expect(payoutAmounts(40000, 10)).toEqual({ tds: 4000, gst: 0, net: 36000 }))
  it('account balance = opening + in − out', () => {
    const icici = accountBalances(b).find(a => a.account_id === 'icici')!
    expect([icici.money_in, icici.money_out, icici.balance]).toEqual([276300, 102560, 273740])
  })
  it('November, both bases', () => {
    const o = overview(b, '2026-11-01', '2026-11-30', 'invoice', T)
    expect([o.revenue, o.cash_received, o.other_income, o.creator_payouts, o.direct_expenses, o.overhead_expenses, o.gross_profit, o.net_profit])
      .toEqual([60000, 226300, 1500, 57000, 30000, 9000, -27000, -34500])
    const c = overview(b, '2026-11-01', '2026-11-30', 'cash', T)
    expect([c.revenue, c.creator_payouts, c.direct_expenses, c.overhead_expenses, c.net_profit]).toEqual([187118.64, 42000, 22000, 9000, 115618.64])
    expect(o.outstanding).toBe(263000)
    expect(o.age_0_30 + o.age_31_60 + o.age_61_plus).toBe(o.outstanding)
    expect(o.payouts_pending).toBe(15000)
  })
  it('GST, TDS and profit by brand', () => {
    const g = gstMonthly(b, '2026-11-01', '2026-11-30')[0]
    expect([g.output_gst, g.input_gst, g.gst_paid, g.net_gst]).toEqual([10800, 5220, 5000, 5580])
    expect(gstMonthly(b, '2026-09-01', '2026-11-30')).toHaveLength(3)
    const t = tdsMonthly(b, '2026-11-01', '2026-11-30')[0]
    expect([t.tds_by_clients, t.tds_we_deducted]).toEqual([6000, 4200])
    const m = profitBy(b, 'brand', '2026-11-01', '2026-11-30', 'invoice', { masala: 'Masala Co' }).find(r => r.name === 'Masala Co')!
    expect([m.revenue, m.creator_payouts, m.direct_expenses, m.profit]).toEqual([60000, 57000, 28000, -25000])
  })
  it('capital per founder, 50:50', () => {
    const c = capitalAccounts(b, [{ id: 'f1', name: 'Founder One', profit_share_pct: 50 }, { id: 'f2', name: 'Founder Two', profit_share_pct: 50 }])
    expect(c.map(x => [x.opening_capital, x.capital_added, x.withdrawals, x.profit_transferred, x.balance])).toEqual([[300000, 50000, 0, 15000, 365000], [300000, 0, 20000, 15000, 295000]])
  })
  it('the books balance — and a missing entry shows', () => {
    expect(balanceCheck(b)).toMatchObject({ difference: 0, is_balanced: true })
    const missing = { ...b, accounts: [...b.accounts, acct('petty', 25000)] }
    expect(balanceCheck(missing)).toMatchObject({ difference: -25000, is_balanced: false })
  })
})

describe('invoice paper helpers', () => {
  it('amount in words, Indian system', () => {
    expect(amountInWords(70800)).toBe('Rupees Seventy Thousand Eight Hundred Only')
    expect(amountInWords(12345678.5)).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Fifty Paise Only')
    expect(amountInWords(100000)).toBe('Rupees One Lakh Only')
  })
  it('UPI link', () => expect(upiLink('socialmog@hdfcbank', 'Social Mog', 70800, 'SM/26-27/001')).toBe('upi://pay?pa=socialmog%40hdfcbank&pn=Social+Mog&am=70800.00&cu=INR&tn=SM%2F26-27%2F001'))
})
