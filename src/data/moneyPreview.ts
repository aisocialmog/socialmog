// In-memory stand-in used ONLY by the local design preview (no Supabase).
// Sample books for the two sample brands; every figure is computed by
// src/lib/money.ts — the same rules as the database views.
import { istToday } from '../lib/format'
import {
  accountBalances, accountStatement, balanceCheck, capitalAccounts, capitalNeedsAccount, gstMonthly, invoiceNumber, invoiceTotals, overview,
  payoutAmounts, profitBy, round2, tdsMonthly,
  type AccountRec, type AllocationRec, type Basis, type Books, type CapitalRec, type CategoryRec, type ExpenseRec, type FounderRec,
  type InvoiceItemRec, type InvoiceRec, type PayoutRec, type PayoutStatus, type ReceiptRec, type TransferRec, type Treatment,
} from '../lib/money'
import type {
  AccountInput, Allocation, BrandBilling, CapitalInput, CapitalRow, ExpenseInput, ExpenseRow, InvoiceInput, InvoiceItem, MoneyActivity, OrgSettings,
  PaymentInput, PaymentRow, PayoutInput, PayoutRow, RecurringInput, RecurringRow,
} from './money'

const ME = '00000000-0000-0000-0000-000000000000'
const T = istToday()
const add = (n: number) => { const d = new Date(T + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const monthStart = (iso: string) => iso.slice(0, 8) + '01'
const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const delay = <V,>(v: V) => new Promise<V>(r => setTimeout(() => r(structuredClone(v)), 70))
const fail = (m: string) => Promise.reject(new Error(m))
const FY = (() => { const [y, m] = T.split('-').map(Number); return `${m >= 4 ? y : y - 1}-04-01` })()

const BRANDS: Record<string, BrandBilling> = {
  b1: { id: 'b1', name: 'Chai Sutra (sample)', billing_name: 'Chai Sutra Beverages Pvt Ltd', gstin: '27AAACC1234D1ZC', pan: 'AAACC1234D', billing_address: '4th floor, Kamala Mills, Lower Parel', city: 'Mumbai', state: 'Maharashtra', state_code: '27', payment_terms_days: 15, billing_contact: 'Rohan Shah', billing_email: 'accounts@chaisutra.example' },
  b2: { id: 'b2', name: 'Neelam Naturals (sample)', billing_name: null, gstin: null, pan: null, billing_address: null, city: 'Jaipur', state: 'Rajasthan', state_code: '08', payment_terms_days: null, billing_contact: 'Ananya Rathore', billing_email: 'ananya@neelamnaturals.example' },
}
const CAMPAIGNS: Record<string, { name: string; brand_id: string }> = {
  ca1: { name: 'Diwali Chai Reels (sample)', brand_id: 'b1' }, ca2: { name: 'Winter skin launch (sample)', brand_id: 'b2' }, ca3: { name: 'November always-on content (sample)', brand_id: 'b1' },
}
const CREATORS: Record<string, string> = { c1: 'Aarohi Sinha (sample)', c2: 'Kabir Menon (sample)', c3: 'Sana Qureshi (sample)', c4: 'Rohit Verma "Desi Dad" (sample)', c5: 'Meenal Jha (sample)' }
const VENDORS: Record<string, { name: string; skill: string; upi: string | null }> = { v1: { name: 'Lens & Light Studio', skill: 'DOP', upi: 'lenslight@okhdfc' }, v2: { name: 'Farid (freelance editor)', skill: 'Editor', upi: 'farid.edits@okicici' } }
const ITEMS: Record<string, { title: string; brand_id: string; campaign_id: string | null }> = {
  p1: { title: 'Chai Sutra — brand film', brand_id: 'b1', campaign_id: null }, p2: { title: 'Diwali leftovers reel', brand_id: 'b1', campaign_id: 'ca1' },
  p4: { title: 'Night cream routine', brand_id: 'b2', campaign_id: null }, p7: { title: 'Founder interview photo shoot', brand_id: 'b2', campaign_id: null },
}
const CC = [
  { id: 'cc1', creator_id: 'c1', campaign_id: 'ca1', agreed_fee: 30000 }, { id: 'cc2', creator_id: 'c3', campaign_id: 'ca1', agreed_fee: 56000 },
]
const RETAINERS = [{ id: 'r1', brand_id: 'b1', title: 'Always-on social', monthly_fee: 85000, scope: '8 reels, 12 stories' }]
const UPI: Record<string, string> = { c1: 'aarohi.sample@okaxis', c3: 'sana.sample@okhdfcbank', v1: 'lenslight@okhdfc', v2: 'farid.edits@okicici' }

let settings: OrgSettings = {
  company_name: 'Social Mog', legal_name: '[Legal name]', gstin: null, pan: null, state: 'Maharashtra', state_code: '27',
  address: '[Office address]', email: 'hello@socialmog.example', phone: null, logo_path: null, invoice_prefix: 'SM',
  default_gst_rate: 18, default_payment_terms_days: 30, default_creator_tds_rate: 10,
  bank_account_name: 'Social Mog', bank_name: 'HDFC Bank', bank_account_number: '50200000000000', bank_ifsc: 'HDFC0000000', bank_branch: '[Branch]',
  upi_id: 'socialmog@hdfcbank', invoice_terms: 'Payment due by the date above. Please quote the invoice number with your payment.',
}
const founders: FounderRec[] = [{ id: ME, name: '[Founder 1 name]', profit_share_pct: 50 }, { id: 'f2', name: '[Founder 2 name]', profit_share_pct: 50 }]

const accounts: AccountRec[] = [
  { id: 'a1', name: 'HDFC Current', kind: 'bank', bank_name: 'HDFC Bank', last4: '4417', opening_balance: 450000, opening_date: FY, is_default: true, notes: null, is_archived: false },
  { id: 'a2', name: 'Founder 1 UPI', kind: 'upi', bank_name: null, last4: null, opening_balance: 15000, opening_date: FY, is_default: false, notes: 'Small shoot spends', is_archived: false },
  { id: 'a3', name: 'Petty cash', kind: 'cash', bank_name: null, last4: null, opening_balance: 10000, opening_date: FY, is_default: false, notes: null, is_archived: false },
]
const transfers: TransferRec[] = [{ id: 't1', from_account_id: 'a1', to_account_id: 'a3', transfer_date: add(-20), amount: 5000, notes: 'Cash for shoot days', is_archived: false }]
const capital: CapitalRec[] = [
  { id: 'k1', entry_date: FY, kind: 'opening_capital', founder_id: null, account_id: null, amount: 475000, notes: 'Money in the accounts on 1 April', is_archived: false, created_at: FY + 'T05:00:00Z', updated_at: now() },
  { id: 'k2', entry_date: add(-60), kind: 'capital_added', founder_id: ME, account_id: 'a1', amount: 100000, notes: 'For the new camera kit', is_archived: false, created_at: now(), updated_at: now() },
  { id: 'k3', entry_date: add(-12), kind: 'founder_withdrawal', founder_id: 'f2', account_id: 'a1', amount: 25000, notes: null, is_archived: false, created_at: now(), updated_at: now() },
]
const cat = (id: string, name: string, treatment: Treatment, position: number, system_key: string | null = null): CategoryRec => ({ id, name, treatment, system_key, position, is_archived: false })
const categories: CategoryRec[] = [
  cat('k-cp', 'Creator payout', 'direct', 1, 'creator_payout'), cat('k-fl', 'Freelancer', 'direct', 2, 'freelancer'), cat('k-eq', 'Equipment', 'direct', 3),
  cat('k-tr', 'Travel', 'direct', 4), cat('k-lo', 'Location', 'direct', 5), cat('k-pr', 'Props', 'direct', 6), cat('k-sw', 'Software/subscriptions', 'overhead', 7),
  cat('k-ad', 'Ads spend', 'direct', 8), cat('k-fo', 'Food', 'direct', 9), cat('k-of', 'Office', 'overhead', 10), cat('k-sa', 'Salary', 'overhead', 11),
  cat('k-gst', 'GST paid to government', 'gst_payment', 12, 'gst_payment'), cat('k-tds', 'TDS deposited', 'tds_payment', 13, 'tds_payment'), cat('k-ot', 'Other', 'overhead', 14),
]
const I = (id: string, brand: string, status: InvoiceRec['status'], issue: string | null, extra: Partial<InvoiceRec> = {}): InvoiceRec => {
  const terms = BRANDS[brand].payment_terms_days ?? settings.default_payment_terms_days
  return { id, brand_id: brand, campaign_id: null, retainer_id: null, invoice_number: null, issue_date: issue, due_date: issue ? add(dayDiff(issue) + terms) : null, status,
    gst_enabled: true, gst_rate: 18, tds_rate: 0, place_of_supply_code: BRANDS[brand].state_code, service_period_start: null, service_period_end: null, notes: null,
    cancel_reason: null, created_at: (issue ?? T) + 'T05:00:00Z', updated_at: now(), sent_at: issue ? issue + 'T06:00:00Z' : null, is_archived: false, ...extra }
}
function dayDiff(iso: string) { return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(T + 'T00:00:00Z')) / 864e5) }
const lastMonth = monthStart(add(-31)), twoMonths = monthStart(add(-62))
const invoices: InvoiceRec[] = [
  I('i1', 'b1', 'sent', add(-58), { retainer_id: 'r1', tds_rate: 10, service_period_start: twoMonths, service_period_end: add(-62).slice(0, 8) + '28' }),
  I('i2', 'b1', 'sent', add(-27), { retainer_id: 'r1', tds_rate: 10, service_period_start: lastMonth, service_period_end: add(-31).slice(0, 8) + '28' }),
  I('i3', 'b1', 'sent', add(-8), { campaign_id: 'ca1', tds_rate: 10, notes: 'PO-SAMPLE-4471' }),
  I('i4', 'b2', 'sent', add(-4), { campaign_id: 'ca2', notes: '50% advance on signing' }),
  I('i5', 'b2', 'draft', null, { campaign_id: 'ca2' }),
]
let seq = 0
for (const i of invoices.filter(i => i.status === 'sent').sort((a, b) => a.issue_date!.localeCompare(b.issue_date!))) i.invoice_number = invoiceNumber('SM', i.issue_date!, ++seq)
const sequences: Record<string, number> = { [invoiceNumber('SM', T, 1).split('/')[1]]: seq }
const L = (invoice_id: string, position: number, description: string, quantity: number, rate: number): InvoiceItemRec => ({ id: uid(), invoice_id, position, description, hsn_sac: '998361', quantity, rate, is_archived: false })
const items: InvoiceItemRec[] = [
  L('i1', 1, 'Always-on social — retainer (8 reels, 12 stories)', 1, 85000), L('i2', 1, 'Always-on social — retainer (8 reels, 12 stories)', 1, 85000),
  L('i3', 1, 'Creator fees — 2 creators, 6 deliverables', 1, 170000), L('i3', 2, 'Campaign management & reporting', 1, 50000),
  L('i4', 1, 'Winter skin launch — 50% advance', 1, 90000), L('i5', 1, 'Winter skin launch — balance 50%', 1, 90000),
]
const R = (id: string, brand: string | null, on: string, amt: number, tds: number, mode: ReceiptRec['mode'], ref: string | null, category: ReceiptRec['category'] = 'client_payment', notes: string | null = null): ReceiptRec =>
  ({ id, brand_id: brand, account_id: 'a1', received_on: on, amount_received: amt, tds_deducted: tds, category, mode, reference: ref, notes, is_archived: false, created_at: on + 'T08:00:00Z', updated_at: now() })
const receipts: ReceiptRec[] = [
  R('rc1', 'b1', add(-45), 91800, 8500, 'neft', 'HDFCN52260012345'),
  R('rc3', 'b1', add(-3), 120000, 0, 'neft', 'ICICN81230045678'), R('rc4', null, add(-15), 1240, 0, 'neft', null, 'other_income', 'Savings interest'),
]
const allocations: AllocationRec[] = [
  { id: uid(), receipt_id: 'rc1', invoice_id: 'i1', amount: 100300, is_archived: false },   { id: uid(), receipt_id: 'rc3', invoice_id: 'i3', amount: 120000, is_archived: false },
]
const E = (id: string, category_id: string, description: string, date: string, amount: number, gst: number, account: string | null, extra: Partial<ExpenseRec> = {}): ExpenseRec => ({
  id, category_id, vendor_id: null, brand_id: null, campaign_id: null, deliverable_id: null, description, expense_date: date, amount, gst_amount: gst, tds_deducted: 0, bill_number: null,
  status: account ? 'paid' : 'unpaid', paid_on: account ? date : null, account_id: account, notes: null, payout_id: null, recurring_id: null, recurring_period: null, is_archived: false,
  created_at: date + 'T09:00:00Z', updated_at: now(), ...extra })
const expenses: ExpenseRec[] = [
  E('e1', 'k-pr', 'Diya, brass kettle and rangoli props (sample)', add(-15), 8000, 1440, null, { campaign_id: 'ca1', brand_id: 'b1', deliverable_id: 'p2' }),
  E('e2', 'k-eq', 'Sony FX3 rental — 2 days', add(-18), 12000, 2160, 'a1', { brand_id: 'b1', deliverable_id: 'p1', bill_number: 'LL-2231', vendor_id: 'v1' }),
  E('e3', 'k-lo', 'Studio booking, Andheri', add(-17), 9000, 1620, 'a1', { brand_id: 'b1', deliverable_id: 'p1' }),
  E('e4', 'k-fo', 'Shoot lunch for crew', add(-17), 2400, 0, 'a3', { brand_id: 'b1', deliverable_id: 'p1' }),
  E('e5', 'k-tr', 'Cabs to location', add(-17), 1850, 0, 'a2', { brand_id: 'b1' }),
  E('e6', 'k-of', 'Co-working desk rent', add(-8), 18000, 3240, 'a1'),
  E('e7', 'k-gst', 'GST paid for last month', add(-20), 6000, 0, 'a1'),
]
const recurring: (RecurringInput & { id: string; is_archived: boolean })[] = [
  { id: 'rx1', description: 'Adobe Creative Cloud', category_id: 'k-sw', vendor_id: null, amount: 4500, gst_amount: 810, account_id: 'a1', mark_paid: true, day_of_month: 5, start_date: monthStart(add(-75)), end_date: null, is_paused: false, notes: null, is_archived: false },
  { id: 'rx2', description: 'Canva Teams', category_id: 'k-sw', vendor_id: null, amount: 1200, gst_amount: 216, account_id: 'a2', mark_paid: true, day_of_month: 12, start_date: monthStart(add(-40)), end_date: null, is_paused: false, notes: null, is_archived: false },
]
const P = (id: string, extra: Partial<PayoutRec>): PayoutRec => ({ id, creator_id: null, vendor_id: null, campaign_creator_id: null, campaign_id: null, deliverable_id: null, brand_id: null,
  description: null, amount: 0, tds_rate: 10, gst_rate: 0, due_date: null, status: 'pending', approved_at: null, approved_by: null, paid_on: null, account_id: null, reference: null,
  creator_invoice_no: null, notes: null, is_archived: false, created_at: add(-14) + 'T07:00:00Z', updated_at: now(), ...extra })
const payouts: PayoutRec[] = [
  P('po1', { creator_id: 'c1', campaign_creator_id: 'cc1', campaign_id: 'ca1', brand_id: 'b1', description: 'Diwali reels ×2 + story', amount: 30000, due_date: add(-4), status: 'paid', approved_at: now(), approved_by: ME, paid_on: add(-4), account_id: 'a1', reference: 'UTR 4521 8890 1123' }),
  P('po2', { creator_id: 'c3', campaign_creator_id: 'cc2', campaign_id: 'ca1', brand_id: 'b1', description: 'Festive look reel + carousel', amount: 56000, due_date: add(3), status: 'approved', approved_at: now(), approved_by: ME }),
  P('po3', { vendor_id: 'v2', deliverable_id: 'p1', brand_id: 'b1', description: 'Brand film edit', amount: 18000, due_date: add(-2) }),
  P('po4', { vendor_id: 'v1', deliverable_id: 'p1', brand_id: 'b1', description: 'DOP day rate — brand film', amount: 15000, tds_rate: 2, due_date: add(5) }),
]
type Log = MoneyActivity
const log: Log[] = []
function addLog(table: string, id: string, action: Log['action'], fields: string[] = [], ov: Record<string, unknown> | null = null, nv: Record<string, unknown> | null = null, reason: string | null = null) {
  log.unshift({ id: uid(), created_at: now(), action, table_name: table, record_id: id, changed_fields: fields, old_values: ov, new_values: nv, source: 'app', actor_id: ME, actor_name: '[Founder 1 name]', reason })
}
function diff<R extends object>(table: string, rec: R & { id: string }, patch: Partial<R>, reason: string | null) {
  const f = (Object.keys(patch) as (keyof R)[]).filter(k => JSON.stringify(rec[k]) !== JSON.stringify(patch[k]))
  if (!f.length) return
  const ov = Object.fromEntries(f.map(k => [k, rec[k]])), nv = Object.fromEntries(f.map(k => [k, patch[k]]))
  const action = f.includes('is_archived' as keyof R) ? (patch as Record<string, unknown>).is_archived ? 'archive' : 'restore' : f.includes('status' as keyof R) ? 'status_change' : 'update'
  addLog(table, rec.id, action, f as string[], ov, nv, reason)
  Object.assign(rec, patch, { updated_at: now() })
}
const needReason = (reason?: string) => { if (!reason?.trim()) throw new Error('Give a reason for this change — money edits are logged with why') }

// ── views ──
const totals = () => {
  const rmap = new Map(receipts.filter(r => !r.is_archived).map(r => [r.id, r]))
  return invoices.filter(i => !i.is_archived).map(i => invoiceTotals(i, items,
    allocations.filter(a => !a.is_archived && a.invoice_id === i.id && rmap.has(a.receipt_id)).map(a => ({ amount: a.amount, received_on: rmap.get(a.receipt_id)!.received_on })),
    settings.state_code, T, { brand: BRANDS[i.brand_id]?.name ?? '—', campaign: i.campaign_id ? CAMPAIGNS[i.campaign_id]?.name ?? null : null }))
}
function syncPayoutExpense(p: PayoutRec) {
  const ex = expenses.find(e => e.payout_id === p.id)
  if (p.status === 'paid' && !p.is_archived) {
    const a = payoutAmounts(p.amount, p.tds_rate, p.gst_rate)
    const payee = p.creator_id ? CREATORS[p.creator_id] : VENDORS[p.vendor_id!]?.name
    const what = p.deliverable_id ? ITEMS[p.deliverable_id]?.title : p.campaign_id ? CAMPAIGNS[p.campaign_id]?.name : null
    const row = E(ex?.id ?? uid(), p.creator_id ? 'k-cp' : 'k-fl', `Payout — ${payee}${what ? ` — ${what}` : ''}`, p.paid_on!, p.amount, a.gst, p.account_id,
      { tds_deducted: a.tds, payout_id: p.id, brand_id: p.brand_id, campaign_id: p.campaign_id, deliverable_id: p.deliverable_id, vendor_id: p.vendor_id, notes: p.reference, bill_number: p.creator_invoice_no })
    if (ex) Object.assign(ex, row, { is_archived: false }); else { expenses.push(row); addLog('expenses', row.id, 'create', [], null, { description: row.description, amount: row.amount }) }
  } else if (ex && !ex.is_archived) ex.is_archived = true
}
payouts.forEach(syncPayoutExpense)
function runRecurring() {
  let made = 0
  for (const t of recurring.filter(r => !r.is_archived && !r.is_paused && r.start_date <= T)) {
    let m = monthStart(t.start_date)
    while (m <= T) {
      const on = m.slice(0, 8) + String(t.day_of_month).padStart(2, '0')
      if (on >= t.start_date && on <= T && (!t.end_date || on <= t.end_date) && !expenses.some(e => e.recurring_id === t.id && e.recurring_period === m)) {
        const label = new Date(m + 'T00:00:00Z').toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
        expenses.push(E(uid(), t.category_id, `${t.description} — ${label}`, on, t.amount, t.gst_amount, t.mark_paid ? t.account_id : null,
          { recurring_id: t.id, recurring_period: m, vendor_id: t.vendor_id, notes: 'Created from a recurring expense' }))
        made++
      }
      const [y, mo] = m.split('-').map(Number); m = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01`
    }
  }
  return made
}
runRecurring()
const books = (): Books => ({ invoices: totals(), receipts, allocations, expenses, categories, payouts, capital, accounts, transfers })
const names = () => ({
  brands: Object.fromEntries(Object.values(BRANDS).map(b => [b.id, b.name])), accounts: Object.fromEntries(accounts.map(a => [a.id, a.name])),
  founders: Object.fromEntries(founders.map(f => [f.id, f.name])),
})
const accName = (id: string | null) => id ? accounts.find(a => a.id === id)?.name ?? null : null
function paymentRow(r: ReceiptRec): PaymentRow {
  const al = allocations.filter(a => !a.is_archived && a.receipt_id === r.id)
  const applied = round2(al.reduce((s, a) => s + a.amount, 0))
  const nums = al.map(a => ({ id: a.invoice_id, n: invoices.find(i => i.id === a.invoice_id)?.invoice_number ?? '' })).sort((a, b) => a.n.localeCompare(b.n))
  return { id: r.id, created_at: r.created_at, updated_at: r.updated_at, is_archived: r.is_archived, brand_id: r.brand_id, brand_name: r.brand_id ? BRANDS[r.brand_id]?.name ?? null : null,
    account_id: r.account_id, account_name: accName(r.account_id) ?? '', received_on: r.received_on, amount_received: r.amount_received, tds_deducted: r.tds_deducted,
    credited: round2(r.amount_received + r.tds_deducted), category: r.category, mode: r.mode, reference: r.reference, notes: r.notes, applied,
    unapplied: r.category === 'client_payment' ? round2(r.amount_received + r.tds_deducted - applied) : 0, invoice_numbers: nums.map(x => x.n), invoice_ids: nums.map(x => x.id) }
}
function expenseRow(e: ExpenseRec): ExpenseRow {
  const c = categories.find(c => c.id === e.category_id)!
  return { ...e, total: round2(e.amount + e.gst_amount), paid_out: round2(e.amount + e.gst_amount - e.tds_deducted), account_name: accName(e.account_id),
    category_name: c?.name ?? '—', treatment: c?.treatment ?? 'overhead', vendor_name: e.vendor_id ? VENDORS[e.vendor_id]?.name ?? null : null,
    brand_name: e.brand_id ? BRANDS[e.brand_id]?.name ?? null : null, campaign_name: e.campaign_id ? CAMPAIGNS[e.campaign_id]?.name ?? null : null,
    deliverable_title: e.deliverable_id ? ITEMS[e.deliverable_id]?.title ?? null : null, bills: bills.filter(b => b.expense_id === e.id && !b.is_archived).length }
}
function payoutRow(p: PayoutRec): PayoutRow {
  const a = payoutAmounts(p.amount, p.tds_rate, p.gst_rate)
  return { id: p.id, created_at: p.created_at, updated_at: p.updated_at, is_archived: p.is_archived, status: p.status, description: p.description,
    creator_id: p.creator_id, vendor_id: p.vendor_id, payee_kind: p.creator_id ? 'creator' : 'freelancer',
    payee_name: p.creator_id ? CREATORS[p.creator_id] ?? '—' : VENDORS[p.vendor_id!]?.name ?? '—', payee_photo_path: null,
    campaign_creator_id: p.campaign_creator_id, campaign_id: p.campaign_id, campaign_name: p.campaign_id ? CAMPAIGNS[p.campaign_id]?.name ?? null : null,
    deliverable_id: p.deliverable_id, deliverable_title: p.deliverable_id ? ITEMS[p.deliverable_id]?.title ?? null : null,
    brand_id: p.brand_id, brand_name: p.brand_id ? BRANDS[p.brand_id]?.name ?? null : null, gross: p.amount, tds_rate: p.tds_rate, tds: a.tds, gst_rate: p.gst_rate, gst: a.gst,
    net_payable: a.net, due_date: p.due_date, is_overdue: (p.status === 'pending' || p.status === 'approved') && !!p.due_date && p.due_date < T,
    approved_at: p.approved_at, approved_by_name: p.approved_by ? founders.find(f => f.id === p.approved_by)?.name ?? null : null, paid_on: p.paid_on,
    account_id: p.account_id, account_name: accName(p.account_id), reference: p.reference, creator_invoice_no: p.creator_invoice_no, notes: p.notes,
    expense_id: expenses.find(e => e.payout_id === p.id && !e.is_archived)?.id ?? null }
}
const capitalRow = (c: CapitalRec): CapitalRow => ({ id: c.id, created_at: c.created_at, updated_at: c.updated_at, is_archived: c.is_archived, entry_date: c.entry_date, kind: c.kind,
  founder_id: c.founder_id, founder_name: c.founder_id ? founders.find(f => f.id === c.founder_id)?.name ?? '—' : 'Company', account_id: c.account_id, account_name: accName(c.account_id),
  amount: c.amount, signed_amount: c.kind === 'founder_withdrawal' ? -c.amount : c.amount, notes: c.notes })
type Bill = { id: string; expense_id: string; file_name: string; kind: string; size_bytes: number | null; storage_path: string; created_at: string; is_archived: boolean }
const bills: Bill[] = [{ id: 'bf1', expense_id: 'e2', file_name: 'lens-light-invoice-2231.pdf', kind: 'bill', size_bytes: 182000, storage_path: 'preview/bill.pdf', created_at: add(-18) + 'T10:00:00Z', is_archived: false }]

function applyPayout(p: PayoutRec, patch: Partial<PayoutRec>, reason: string | null) {
  const next = { ...p, ...patch }
  if (next.campaign_creator_id) { const cc = CC.find(c => c.id === next.campaign_creator_id); if (cc) { next.creator_id ??= cc.creator_id; next.campaign_id ??= cc.campaign_id } }
  if (next.deliverable_id) { const d = ITEMS[next.deliverable_id]; if (d) { next.campaign_id ??= d.campaign_id; next.brand_id ??= d.brand_id } }
  if (next.campaign_id) next.brand_id ??= CAMPAIGNS[next.campaign_id]?.brand_id ?? null
  if (next.status === 'paid') { next.paid_on ??= T; if (!next.account_id) throw new Error('Pick the account the payout was paid from') }
  else if (p.status === 'paid') next.paid_on = null
  if (next.status === 'approved' && p.status !== 'approved') { next.approved_at = now(); next.approved_by = ME }
  diff('creator_payouts', p, next, reason)
  syncPayoutExpense(p)
}

export const moneyPreview = {
  settings: () => delay(settings),
  saveSettings: async (patch: Partial<OrgSettings>) => { settings = { ...settings, ...patch } },
  founders: () => delay(founders),
  saveShares: async (rows: { id: string; profit_share_pct: number }[]) => { for (const r of rows) { const f = founders.find(x => x.id === r.id); if (f) f.profit_share_pct = r.profit_share_pct } },

  accounts: () => delay(accountBalances(books())),
  accountRecords: () => delay(accounts.filter(a => !a.is_archived)),
  saveAccount: async (input: AccountInput, id?: string, reason?: string) => {
    if (id) {
      const a = accounts.find(x => x.id === id)!
      if (a.opening_balance !== input.opening_balance || a.opening_date !== input.opening_date || a.kind !== input.kind) needReason(reason)
      if (input.is_default) accounts.forEach(x => { x.is_default = false })
      diff('money_accounts', a, input, reason ?? null); return id
    }
    const a: AccountRec = { id: uid(), ...input, is_archived: false }
    if (input.is_default) accounts.forEach(x => { x.is_default = false })
    accounts.push(a); addLog('money_accounts', a.id, 'create', [], null, { ...input }); return a.id
  },
  archiveAccount: async (id: string, reason: string) => { needReason(reason); diff('money_accounts', accounts.find(a => a.id === id)!, { is_archived: true }, reason) },
  statement: (id: string) => delay(accountStatement(books(), id, names(), true)),
  saveTransfer: async (input: Omit<TransferRec, 'id' | 'is_archived'>) => {
    if (input.from_account_id === input.to_account_id) throw new Error('Pick two different accounts')
    const t = { id: uid(), ...input, is_archived: false }; transfers.push(t); addLog('account_transfers', t.id, 'create', [], null, { amount: t.amount })
  },

  invoices: () => delay(totals().sort((a, b) => b.created_at.localeCompare(a.created_at))),
  invoice: (id: string) => {
    const t = totals().find(x => x.invoice_id === id)
    if (!t) return delay(null)
    return delay({ totals: t, items: items.filter(i => i.invoice_id === id && !i.is_archived).sort((a, b) => a.position - b.position).map(i => ({ ...i, id: i.id, amount: round2(i.quantity * i.rate) })) })
  },
  invoicePayments: (id: string) => delay(allocations.filter(a => !a.is_archived && a.invoice_id === id).map(a => {
    const r = receipts.find(x => x.id === a.receipt_id)!
    return r.is_archived ? null : { receipt_id: r.id, received_on: r.received_on, amount: a.amount, reference: r.reference, mode: r.mode, account_name: accName(r.account_id) }
  }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.received_on.localeCompare(b.received_on))),
  brandBilling: (id: string) => delay(BRANDS[id] ?? null),
  saveInvoice: async (h: InvoiceInput, list: InvoiceItem[], id?: string, reason?: string) => {
    let inv = id ? invoices.find(i => i.id === id)! : undefined
    if (inv?.status === 'cancelled') throw new Error('This invoice is cancelled — its lines can’t change')
    if (inv && inv.status !== 'draft') needReason(reason)
    if (!inv) {
      inv = I(uid(), h.brand_id, 'draft', null, { ...h, issue_date: null, due_date: h.due_date, place_of_supply_code: h.place_of_supply_code ?? BRANDS[h.brand_id]?.state_code ?? null })
      invoices.push(inv); addLog('invoices', inv.id, 'create', [], null, { brand_id: h.brand_id })
    } else diff('invoices', inv, h, reason ?? null)
    const keep = new Set(list.map(l => l.id).filter(Boolean))
    for (const it of items.filter(x => x.invoice_id === inv!.id && !x.is_archived && !keep.has(x.id))) diff('invoice_items', it, { is_archived: true }, reason ?? null)
    list.forEach((l, i) => {
      const row = { position: i + 1, description: l.description, hsn_sac: l.hsn_sac, quantity: l.quantity, rate: l.rate }
      const ex = l.id ? items.find(x => x.id === l.id) : undefined
      if (ex) diff('invoice_items', ex, row, reason ?? null); else { const it = { id: uid(), invoice_id: inv!.id, is_archived: false, ...row }; items.push(it); if (inv!.status !== 'draft') addLog('invoice_items', it.id, 'create', [], null, row) }
    })
    return inv.id
  },
  sendInvoice: async (id: string, issueDate: string | null) => {
    const inv = invoices.find(i => i.id === id)!
    if (!items.some(i => i.invoice_id === id && !i.is_archived)) throw new Error('Add at least one line before sending the invoice')
    const issue = issueDate ?? T
    const fy = invoiceNumber(settings.invoice_prefix, issue, 1).split('/')[1]
    sequences[fy] = (sequences[fy] ?? 0) + 1
    diff('invoices', inv, { status: 'sent', issue_date: issue, due_date: inv.due_date ?? add(dayDiff(issue) + (BRANDS[inv.brand_id]?.payment_terms_days ?? settings.default_payment_terms_days)),
      invoice_number: invoiceNumber(settings.invoice_prefix, issue, sequences[fy]), sent_at: now() }, null)
  },
  cancelInvoice: async (id: string, reason: string) => {
    needReason(reason)
    if (allocations.some(a => !a.is_archived && a.invoice_id === id && !receipts.find(r => r.id === a.receipt_id)?.is_archived)) throw new Error('This invoice has payments against it — move or archive those payments first')
    diff('invoices', invoices.find(i => i.id === id)!, { status: 'cancelled', cancel_reason: reason }, reason)
  },
  archiveDraft: async (id: string) => { const i = invoices.find(x => x.id === id)!; if (i.status === 'draft') diff('invoices', i, { is_archived: true }, null) },
  retainersToInvoice: (month: string) => delay(RETAINERS.map(r => {
    const inv = invoices.find(i => !i.is_archived && i.status !== 'cancelled' && i.retainer_id === r.id && i.service_period_start === monthStart(month))
    return { retainer_id: r.id, brand_id: r.brand_id, brand_name: BRANDS[r.brand_id].name, title: r.title, monthly_fee: r.monthly_fee, invoice_id: inv?.id ?? null, invoice_number: inv?.invoice_number ?? null }
  })),
  createRetainerInvoice: async (retainerId: string, month: string) => {
    const r = RETAINERS.find(x => x.id === retainerId)!, m = monthStart(month)
    const ex = invoices.find(i => !i.is_archived && i.status !== 'cancelled' && i.retainer_id === r.id && i.service_period_start === m)
    const label = new Date(m + 'T00:00:00Z').toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    if (ex) return fail(`${label}’s invoice already exists (${ex.invoice_number ?? 'a draft'})`)
    const inv = I(uid(), r.brand_id, 'draft', null, { retainer_id: r.id, service_period_start: m, tds_rate: 10 })
    invoices.push(inv); items.push(L(inv.id, 1, `${r.title} — ${label} (${r.scope})`, 1, r.monthly_fee))
    addLog('invoices', inv.id, 'create', [], null, { retainer_id: r.id }); return inv.id
  },
  openInvoices: (brandId: string) => delay(totals().filter(t => t.brand_id === brandId && t.document_status === 'sent' && t.outstanding > 0).sort((a, b) => (a.issue_date ?? '').localeCompare(b.issue_date ?? ''))),

  payments: () => delay(receipts.filter(r => !r.is_archived).map(paymentRow).sort((a, b) => b.received_on.localeCompare(a.received_on))),
  payment: (id: string) => {
    const r = receipts.find(x => x.id === id)
    return delay(r ? { row: paymentRow(r), allocations: allocations.filter(a => !a.is_archived && a.receipt_id === id).map(a => ({ id: a.id, invoice_id: a.invoice_id, amount: a.amount, invoice_number: invoices.find(i => i.id === a.invoice_id)?.invoice_number ?? null })) } : null)
  },
  recordPayment: async (p: PaymentInput, list: Allocation[]) => {
    const tot = totals()
    const want = list.filter(a => a.amount > 0)
    if (round2(want.reduce((s, a) => s + a.amount, 0)) > round2(p.amount_received + p.tds_deducted)) throw new Error('You applied more than this payment (received + TDS)')
    for (const a of want) {
      const t = tot.find(x => x.invoice_id === a.invoice_id)!
      if (t.brand_id !== p.brand_id) throw new Error('That invoice belongs to another brand')
      if (a.amount > t.outstanding + 0.001) throw new Error(`Invoice ${t.invoice_number} has only ₹${t.outstanding} left to pay`)
    }
    const r = R(uid(), p.brand_id, p.received_on, p.amount_received, p.tds_deducted, p.mode, p.reference, p.category, p.notes); r.account_id = p.account_id
    receipts.push(r); addLog('receipts', r.id, 'create', [], null, { amount_received: r.amount_received })
    for (const a of want) { const x = { id: uid(), receipt_id: r.id, invoice_id: a.invoice_id, amount: a.amount, is_archived: false }; allocations.push(x); addLog('receipt_allocations', x.id, 'create', [], null, { invoice_id: a.invoice_id, amount: a.amount }) }
    return r.id
  },
  updatePayment: async (id: string, patch: Partial<PaymentInput>, list: Allocation[] | null, reason: string) => {
    needReason(reason)
    const r = receipts.find(x => x.id === id)!
    if (list) {
      for (const a of allocations.filter(x => x.receipt_id === id && !x.is_archived)) { const w = list.find(l => l.invoice_id === a.invoice_id)?.amount ?? 0; if (w !== a.amount) diff('receipt_allocations', a, w > 0 ? { amount: w } : { is_archived: true }, reason) }
      for (const l of list.filter(l => l.amount > 0 && !allocations.some(a => a.receipt_id === id && !a.is_archived && a.invoice_id === l.invoice_id))) allocations.push({ id: uid(), receipt_id: id, invoice_id: l.invoice_id, amount: l.amount, is_archived: false })
    }
    diff('receipts', r, patch, reason)
  },
  archivePayment: async (id: string, reason: string) => { needReason(reason); diff('receipts', receipts.find(r => r.id === id)!, { is_archived: true }, reason) },

  categories: (all = false) => delay(categories.filter(c => all || !c.is_archived).sort((a, b) => a.position - b.position)),
  saveCategory: async (input: { name: string; treatment: Treatment; is_archived?: boolean }, id?: string) => {
    if (id) Object.assign(categories.find(c => c.id === id)!, input); else categories.push(cat(uid(), input.name, input.treatment, 50))
  },
  expenses: () => { runRecurring(); return delay(expenses.filter(e => !e.is_archived).map(expenseRow).sort((a, b) => b.expense_date.localeCompare(a.expense_date))) },
  expense: (id: string) => { const e = expenses.find(x => x.id === id); return delay(e ? expenseRow(e) : null) },
  expensesFor: (link: { deliverable_id?: string; campaign_id?: string }) => delay(expenses.filter(e => !e.is_archived && (!link.deliverable_id || e.deliverable_id === link.deliverable_id) && (!link.campaign_id || e.campaign_id === link.campaign_id)).map(expenseRow)),
  saveExpense: async (input: ExpenseInput, id?: string, reason?: string) => {
    if (input.status === 'paid' && !input.account_id) throw new Error('Pick the account the expense was paid from')
    const fixed = { ...input, paid_on: input.status === 'paid' ? input.paid_on ?? input.expense_date : null }
    if (fixed.deliverable_id && ITEMS[fixed.deliverable_id]) { fixed.brand_id ??= ITEMS[fixed.deliverable_id].brand_id; fixed.campaign_id ??= ITEMS[fixed.deliverable_id].campaign_id }
    if (fixed.campaign_id) fixed.brand_id ??= CAMPAIGNS[fixed.campaign_id]?.brand_id ?? null
    if (id) {
      const e = expenses.find(x => x.id === id)!
      if (e.payout_id) throw new Error('This expense comes from a payout — edit the payout instead')
      needReason(reason); diff('expenses', e, fixed, reason ?? null); return id
    }
    const e = E(uid(), fixed.category_id, fixed.description, fixed.expense_date, fixed.amount, fixed.gst_amount, fixed.account_id, fixed)
    expenses.push(e); addLog('expenses', e.id, 'create', [], null, { description: e.description, amount: e.amount }); return e.id
  },
  markExpensePaid: async (id: string, account: string, paidOn: string) => diff('expenses', expenses.find(e => e.id === id)!, { status: 'paid', account_id: account, paid_on: paidOn }, null),
  archiveExpense: async (id: string, reason: string) => {
    const e = expenses.find(x => x.id === id)!
    if (e.payout_id) throw new Error('This expense comes from a payout — edit the payout instead')
    needReason(reason); diff('expenses', e, { is_archived: true }, reason)
  },
  recurring: () => delay(recurring.filter(r => !r.is_archived).map((r): RecurringRow => {
    const mine = expenses.filter(e => e.recurring_id === r.id && !e.is_archived).map(e => e.expense_date).sort()
    return { ...r, category_name: categories.find(c => c.id === r.category_id)?.name ?? '', account_name: accName(r.account_id), created: mine.length, last_created: mine.at(-1) ?? null }
  })),
  saveRecurring: async (input: RecurringInput, id?: string) => {
    if (input.mark_paid && !input.account_id) throw new Error('Pick the account it is paid from')
    if (id) Object.assign(recurring.find(r => r.id === id)!, input); else recurring.push({ id: uid(), ...input, is_archived: false })
  },
  archiveRecurring: async (id: string) => { recurring.find(r => r.id === id)!.is_archived = true },
  runRecurring: async () => runRecurring(),
  bills: (id: string) => delay(bills.filter(b => b.expense_id === id && !b.is_archived)),
  uploadBill: async (id: string, file: File, kind: string) => { bills.push({ id: uid(), expense_id: id, file_name: file.name, kind, size_bytes: file.size, storage_path: 'preview/' + file.name, created_at: now(), is_archived: false }) },
  archiveBill: async (id: string) => { bills.find(b => b.id === id)!.is_archived = true },

  payouts: () => delay(payouts.filter(p => !p.is_archived).map(payoutRow).sort((a, b) => b.created_at.localeCompare(a.created_at))),
  payout: (id: string) => { const p = payouts.find(x => x.id === id); return delay(p ? payoutRow(p) : null) },
  savePayout: async (input: PayoutInput, id?: string, reason?: string) => {
    if ([input.creator_id, input.vendor_id].filter(Boolean).length !== 1) throw new Error('Pick one creator or freelancer')
    if (id) {
      const p = payouts.find(x => x.id === id)!
      needReason(reason); applyPayout(p, input, reason ?? null); return id
    }
    const p = P(uid(), { ...input, created_at: now() })
    payouts.push(p); applyPayout(p, {}, null); addLog('creator_payouts', p.id, 'create', [], null, { amount: p.amount }); return p.id
  },
  approvePayout: async (id: string) => applyPayout(payouts.find(p => p.id === id)!, { status: 'approved' }, null),
  payPayout: async (id: string, x: { paid_on: string; account_id: string; reference: string | null }) => applyPayout(payouts.find(p => p.id === id)!, { status: 'paid', ...x }, null),
  setPayoutStatus: async (id: string, status: PayoutStatus, reason: string) => { needReason(reason); applyPayout(payouts.find(p => p.id === id)!, { status }, reason) },
  archivePayout: async (id: string, reason: string) => { needReason(reason); const p = payouts.find(x => x.id === id)!; diff('creator_payouts', p, { is_archived: true }, reason); syncPayoutExpense(p) },
  payeeOptions: () => delay([
    ...Object.entries(CREATORS).map(([id, name]) => ({ kind: 'creator' as const, id, name, hint: 'Creator' })),
    ...Object.entries(VENDORS).map(([id, v]) => ({ kind: 'vendor' as const, id, name: v.name, hint: `Freelancer · ${v.skill}` })),
  ]),
  campaignCreatorOptions: () => delay(CC.map(c => ({ id: c.id, creator_id: c.creator_id, creator_name: CREATORS[c.creator_id], campaign_id: c.campaign_id, campaign_name: CAMPAIGNS[c.campaign_id].name, agreed_fee: c.agreed_fee }))),
  payeeUpi: () => delay(UPI),

  brandOptions: () => delay(Object.values(BRANDS).map(b => ({ id: b.id, name: b.name, state_code: b.state_code, payment_terms_days: b.payment_terms_days }))),
  campaignOptions: () => delay(Object.entries(CAMPAIGNS).map(([id, c]) => ({ id, name: c.name, brand_id: c.brand_id }))),
  deliverableOptions: () => delay(Object.entries(ITEMS).map(([id, d]) => ({ id, name: d.title, brand_id: d.brand_id }))),
  vendorOptions: () => delay(Object.entries(VENDORS).map(([id, v]) => ({ id, name: v.name }))),

  capital: () => delay(capital.filter(c => !c.is_archived).map(capitalRow).sort((a, b) => b.entry_date.localeCompare(a.entry_date))),
  saveCapital: async (input: CapitalInput, id?: string, reason?: string) => {
    if (capitalNeedsAccount(input.kind) !== !!input.account_id) throw new Error(capitalNeedsAccount(input.kind) ? 'Pick the account the money moved through' : 'Opening capital and profit transfers don’t move money between accounts — leave the account empty')
    if (id) { needReason(reason); diff('capital_entries', capital.find(c => c.id === id)!, input, reason ?? null); return id }
    const c: CapitalRec = { id: uid(), ...input, is_archived: false, created_at: now(), updated_at: now() }
    capital.push(c); addLog('capital_entries', c.id, 'create', [], null, { kind: c.kind, amount: c.amount }); return c.id
  },
  archiveCapital: async (id: string, reason: string) => { needReason(reason); diff('capital_entries', capital.find(c => c.id === id)!, { is_archived: true }, reason) },
  capitalAccounts: () => delay(capitalAccounts(books(), founders)),
  balanceCheck: () => delay(balanceCheck(books())),

  overview: (from: string, to: string, basis: Basis) => delay(overview(books(), from, to, basis, T)),
  profitBy: (group: 'brand' | 'campaign', from: string, to: string, basis: Basis) => delay(profitBy(books(), group, from, to, basis,
    { ...Object.fromEntries(Object.values(BRANDS).map(b => [b.id, b.name])), ...Object.fromEntries(Object.entries(CAMPAIGNS).map(([id, c]) => [id, c.name])) },
    Object.fromEntries(Object.entries(CAMPAIGNS).map(([id, c]) => [id, c.brand_id])))),
  gstMonthly: (from: string, to: string) => delay(gstMonthly(books(), from, to)),
  gstRegister: (from: string, to: string) => delay(totals().filter(t => t.document_status === 'sent' && t.issue_date! >= from && t.issue_date! <= to).map(t => ({
    invoice_id: t.invoice_id, invoice_number: t.invoice_number!, issue_date: t.issue_date!, brand_name: t.brand_name, billing_name: BRANDS[t.brand_id]?.billing_name ?? null,
    brand_gstin: BRANDS[t.brand_id]?.gstin ?? null, place_of_supply_code: t.place_of_supply_code, brand_state: BRANDS[t.brand_id]?.state ?? null, is_interstate: t.is_interstate,
    gst_rate: t.gst_rate, taxable_value: t.subtotal, cgst: t.cgst, sgst: t.sgst, igst: t.igst, gst_total: t.gst_total, total: t.total,
  })).sort((a, b) => a.issue_date.localeCompare(b.issue_date))),
  tdsMonthly: (from: string, to: string) => delay(tdsMonthly(books(), from, to)),
  tdsRegister: (from: string, to: string) => delay([
    ...receipts.filter(r => !r.is_archived && r.tds_deducted > 0 && r.received_on >= from && r.received_on <= to).map(r => ({ direction: 'deducted_by_client' as const, entry_date: r.received_on, party: BRANDS[r.brand_id ?? '']?.name ?? '—', party_pan: BRANDS[r.brand_id ?? '']?.pan ?? null, reference: r.reference, tds: r.tds_deducted, gross: round2(r.amount_received + r.tds_deducted), source_table: 'receipts', source_id: r.id })),
    ...expenses.filter(e => !e.is_archived && e.status === 'paid' && e.tds_deducted > 0 && e.paid_on! >= from && e.paid_on! <= to).map(e => {
      const p = payouts.find(x => x.id === e.payout_id)
      return { direction: 'deducted_by_us' as const, entry_date: e.paid_on!, party: p?.creator_id ? CREATORS[p.creator_id] : VENDORS[p?.vendor_id ?? e.vendor_id ?? '']?.name ?? e.description, party_pan: null, reference: e.bill_number, tds: e.tds_deducted, gross: round2(e.amount + e.gst_amount), source_table: 'expenses', source_id: e.id }
    }),
  ].sort((a, b) => a.entry_date.localeCompare(b.entry_date))),

  activity: (table: string, id: string) => {
    const kids = new Set([id,
      ...(table === 'invoices' ? [...items.filter(i => i.invoice_id === id).map(i => i.id), ...allocations.filter(a => a.invoice_id === id).map(a => a.id)] : []),
      ...(table === 'receipts' ? allocations.filter(a => a.receipt_id === id).map(a => a.id) : []),
      ...(table === 'creator_payouts' ? expenses.filter(e => e.payout_id === id).map(e => e.id) : []),
    ])
    const seed: Log = { id: 'seed-' + id, created_at: now(), action: 'create', table_name: table, record_id: id, changed_fields: [], old_values: null, new_values: {}, source: 'app', actor_id: ME, actor_name: '[Founder 1 name]', reason: null }
    const mine = log.filter(l => kids.has(l.record_id))
    return delay(mine.some(l => l.action === 'create' && l.record_id === id) ? mine : [...mine, seed])
  },
}
