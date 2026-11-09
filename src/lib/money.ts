// Money rules, mirrored from supabase/migrations/…_money_module.sql.
// The database calculates every total in views; this file does the same
// sums for the local preview (no Supabase) and for the screens' live
// previews while you type. tests/money.test.ts checks both agree.
import { fyStart, type ISODate } from './format'

// ─── Labels ─────────────────────────────────────────────────
export type DocStatus = 'draft' | 'sent' | 'cancelled'
export type PayStatus = 'draft' | 'sent' | 'partly_paid' | 'paid' | 'overdue' | 'cancelled'
export const PAY_STATUSES: PayStatus[] = ['draft', 'sent', 'partly_paid', 'paid', 'overdue', 'cancelled']
export const PAY_STATUS_LABEL: Record<PayStatus, string> = { draft: 'Draft', sent: 'Sent', partly_paid: 'Partly paid', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled' }
export const PAY_STATUS_TONE: Record<PayStatus, 'quiet' | 'accent' | 'warm' | 'alert' | 'ink'> = { draft: 'quiet', sent: 'ink', partly_paid: 'warm', paid: 'accent', overdue: 'alert', cancelled: 'quiet' }

export type AccountKind = 'bank' | 'upi' | 'cash' | 'wallet'
export const ACCOUNT_KINDS: AccountKind[] = ['bank', 'upi', 'cash', 'wallet']
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = { bank: 'Bank', upi: 'UPI', cash: 'Cash', wallet: 'Wallet' }

export type PayMode = 'upi' | 'neft' | 'rtgs' | 'imps' | 'cheque' | 'cash' | 'card' | 'other'
export const PAY_MODES: PayMode[] = ['upi', 'neft', 'rtgs', 'imps', 'cheque', 'cash', 'card', 'other']
export const PAY_MODE_LABEL: Record<PayMode, string> = { upi: 'UPI', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', cheque: 'Cheque', cash: 'Cash', card: 'Card', other: 'Other' }

export type Treatment = 'direct' | 'overhead' | 'gst_payment' | 'tds_payment'
export const TREATMENT_LABEL: Record<Treatment, string> = {
  direct: 'Direct cost (gross profit)', overhead: 'Overhead (net profit)', gst_payment: 'GST paid to government', tds_payment: 'TDS deposited',
}

export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'cancelled'
export const PAYOUT_STATUSES: PayoutStatus[] = ['pending', 'approved', 'paid', 'cancelled']
export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = { pending: 'Pending', approved: 'Approved', paid: 'Paid', cancelled: 'Cancelled' }
export const PAYOUT_STATUS_TONE: Record<PayoutStatus, 'quiet' | 'accent' | 'warm' | 'ink'> = { pending: 'warm', approved: 'ink', paid: 'accent', cancelled: 'quiet' }

export type CapitalKind = 'opening_capital' | 'capital_added' | 'founder_withdrawal' | 'profit_transferred'
export const CAPITAL_KINDS: CapitalKind[] = ['opening_capital', 'capital_added', 'founder_withdrawal', 'profit_transferred']
export const CAPITAL_KIND_LABEL: Record<CapitalKind, string> = {
  opening_capital: 'Opening capital', capital_added: 'Capital added', founder_withdrawal: 'Founder withdrawal', profit_transferred: 'Profit transferred to capital',
}
/** Capital added / withdrawals move money in or out of an account; the other two don't. */
export const capitalNeedsAccount = (k: CapitalKind) => k === 'capital_added' || k === 'founder_withdrawal'

export type Basis = 'invoice' | 'cash'
export const BASIS_LABEL: Record<Basis, string> = { invoice: 'Invoice basis', cash: 'Payments basis' }

/** GST state codes (first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
}

// ─── Arithmetic (paise-exact, like numeric(14,2)) ───────────
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const sum = <T,>(xs: T[], f: (x: T) => number) => round2(xs.reduce((s, x) => s + f(x), 0))
const n = (v: unknown) => Number(v ?? 0) || 0

/** GST on an invoice: subtotal × rate when on, split CGST/SGST (same state) or IGST. */
export function gstSplit(subtotal: number, enabled: boolean, rate: number, interstate: boolean) {
  const gst = enabled ? round2(subtotal * rate / 100) : 0
  const cgst = interstate ? 0 : round2(gst / 2)
  return { gst, cgst, sgst: interstate ? 0 : round2(gst - cgst), igst: interstate ? gst : 0 }
}
export const isInterstate = (placeOfSupply: string | null | undefined, ourState: string | null | undefined) =>
  !!placeOfSupply && !!ourState && placeOfSupply !== ourState

/** SM/26-27/001 — financial year of the issue date, 3 digits until 999. */
export function invoiceNumber(prefix: string, issueDate: ISODate, seq: number) {
  const y = Number(fyStart(issueDate).slice(0, 4))
  const fy = `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`
  return `${prefix}/${fy}/${seq < 1000 ? String(seq).padStart(3, '0') : seq}`
}

export function payoutAmounts(amount: number, tdsRate: number, gstRate = 0) {
  const tds = round2(amount * tdsRate / 100), gst = round2(amount * gstRate / 100)
  return { tds, gst, net: round2(amount + gst - tds) }
}

const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5)

// ─── Records (the shape of the tables) ──────────────────────
export interface InvoiceRec {
  id: string; brand_id: string; campaign_id: string | null; retainer_id: string | null; invoice_number: string | null
  issue_date: ISODate | null; due_date: ISODate | null; status: DocStatus; gst_enabled: boolean; gst_rate: number; tds_rate: number
  place_of_supply_code: string | null; service_period_start: ISODate | null; service_period_end: ISODate | null
  notes: string | null; cancel_reason: string | null; created_at: string; updated_at: string; sent_at: string | null; is_archived: boolean
}
export interface InvoiceItemRec { id: string; invoice_id: string; position: number; description: string; hsn_sac: string | null; quantity: number; rate: number; is_archived: boolean }
export interface ReceiptRec {
  id: string; brand_id: string | null; account_id: string; received_on: ISODate; amount_received: number; tds_deducted: number
  category: 'client_payment' | 'other_income'; mode: PayMode | null; reference: string | null; notes: string | null; is_archived: boolean; created_at: string; updated_at: string
}
export interface AllocationRec { id: string; receipt_id: string; invoice_id: string; amount: number; is_archived: boolean }
export interface CategoryRec { id: string; name: string; treatment: Treatment; system_key: string | null; position: number; is_archived: boolean }
export interface ExpenseRec {
  id: string; category_id: string; vendor_id: string | null; brand_id: string | null; campaign_id: string | null; deliverable_id: string | null
  description: string; expense_date: ISODate; amount: number; gst_amount: number; tds_deducted: number; bill_number: string | null
  status: 'unpaid' | 'paid'; paid_on: ISODate | null; account_id: string | null; notes: string | null
  payout_id: string | null; recurring_id: string | null; recurring_period: ISODate | null; is_archived: boolean; created_at: string; updated_at: string
}
export interface PayoutRec {
  id: string; creator_id: string | null; vendor_id: string | null; campaign_creator_id: string | null; campaign_id: string | null
  deliverable_id: string | null; brand_id: string | null; description: string | null; amount: number; tds_rate: number; gst_rate: number
  due_date: ISODate | null; status: PayoutStatus; approved_at: string | null; approved_by: string | null; paid_on: ISODate | null
  account_id: string | null; reference: string | null; creator_invoice_no: string | null; notes: string | null; is_archived: boolean; created_at: string; updated_at: string
}
export interface CapitalRec { id: string; entry_date: ISODate; kind: CapitalKind; founder_id: string | null; account_id: string | null; amount: number; notes: string | null; is_archived: boolean; created_at: string; updated_at: string }
export interface AccountRec { id: string; name: string; kind: AccountKind; bank_name: string | null; last4: string | null; opening_balance: number; opening_date: ISODate; is_default: boolean; notes: string | null; is_archived: boolean }
export interface TransferRec { id: string; from_account_id: string; to_account_id: string; transfer_date: ISODate; amount: number; notes: string | null; is_archived: boolean }
export interface FounderRec { id: string; name: string; profit_share_pct: number | null }

// ─── invoice_totals ─────────────────────────────────────────
export interface InvoiceTotals {
  invoice_id: string; brand_id: string; campaign_id: string | null; retainer_id: string | null; invoice_number: string | null
  issue_date: ISODate | null; due_date: ISODate | null; document_status: DocStatus
  subtotal: number; gst_total: number; is_interstate: boolean; total: number; paid: number; outstanding: number; last_paid_on: ISODate | null
  payment_status: PayStatus; days_overdue: number; cgst: number; sgst: number; igst: number
  gst_enabled: boolean; gst_rate: number; tds_rate: number; tds_expected: number; net_expected: number; age_days: number | null; lines: number
  place_of_supply_code: string | null; service_period_start: ISODate | null; service_period_end: ISODate | null
  sent_at: string | null; cancel_reason: string | null; notes: string | null; created_at: string; updated_at: string
  brand_name: string; campaign_name: string | null
}
export function invoiceTotals(inv: InvoiceRec, items: InvoiceItemRec[], allocs: { amount: number; received_on: ISODate }[],
  ourState: string | null, today: ISODate, names: { brand: string; campaign: string | null }): InvoiceTotals {
  const live = items.filter(i => !i.is_archived && i.invoice_id === inv.id)
  const sub = sum(live, i => round2(n(i.quantity) * n(i.rate)))
  const inter = isInterstate(inv.place_of_supply_code, ourState)
  const g = gstSplit(sub, inv.gst_enabled, n(inv.gst_rate), inter)
  const total = round2(sub + g.gst)
  const paid = sum(allocs, a => n(a.amount))
  const last = allocs.map(a => a.received_on).sort().at(-1) ?? null
  const status: PayStatus = inv.status === 'cancelled' ? 'cancelled' : inv.status === 'draft' ? 'draft'
    : total > 0 && paid >= total ? 'paid' : inv.due_date && inv.due_date < today ? 'overdue' : paid > 0 ? 'partly_paid' : 'sent'
  const tdsExp = round2(sub * n(inv.tds_rate) / 100)
  return {
    invoice_id: inv.id, brand_id: inv.brand_id, campaign_id: inv.campaign_id, retainer_id: inv.retainer_id, invoice_number: inv.invoice_number,
    issue_date: inv.issue_date, due_date: inv.due_date, document_status: inv.status,
    subtotal: sub, gst_total: g.gst, is_interstate: inter, total, paid,
    outstanding: inv.status === 'sent' ? Math.max(round2(total - paid), 0) : 0, last_paid_on: last, payment_status: status,
    days_overdue: inv.status === 'sent' && paid < total && inv.due_date ? Math.max(daysBetween(inv.due_date, today), 0) : 0,
    cgst: g.cgst, sgst: g.sgst, igst: g.igst, gst_enabled: inv.gst_enabled, gst_rate: n(inv.gst_rate), tds_rate: n(inv.tds_rate),
    tds_expected: tdsExp, net_expected: round2(total - tdsExp),
    age_days: inv.status === 'sent' && inv.issue_date ? daysBetween(inv.issue_date, today) : null, lines: live.length,
    place_of_supply_code: inv.place_of_supply_code, service_period_start: inv.service_period_start, service_period_end: inv.service_period_end,
    sent_at: inv.sent_at, cancel_reason: inv.cancel_reason, notes: inv.notes, created_at: inv.created_at, updated_at: inv.updated_at,
    brand_name: names.brand, campaign_name: names.campaign,
  }
}

// ─── The books: every P&L line and balance from raw records ──
export interface Books {
  invoices: InvoiceTotals[]; receipts: ReceiptRec[]; allocations: AllocationRec[]; expenses: ExpenseRec[]
  categories: CategoryRec[]; payouts: PayoutRec[]; capital: CapitalRec[]; accounts: AccountRec[]; transfers: TransferRec[]
}
export type PnlLine = { basis: Basis; line: 'revenue' | 'other_income' | 'creator_payout' | 'direct_expense' | 'overhead_expense'; entry_date: ISODate; amount: number; brand_id: string | null; campaign_id: string | null; source_id: string }

export function pnlLines(b: Books): PnlLine[] {
  const out: PnlLine[] = []
  const sent = b.invoices.filter(i => i.document_status === 'sent')
  const byId = new Map(sent.map(i => [i.invoice_id, i]))
  const rcpt = new Map(b.receipts.filter(r => !r.is_archived).map(r => [r.id, r]))
  const cat = new Map(b.categories.map(c => [c.id, c]))
  for (const i of sent) out.push({ basis: 'invoice', line: 'revenue', entry_date: i.issue_date!, amount: i.subtotal, brand_id: i.brand_id, campaign_id: i.campaign_id, source_id: i.invoice_id })
  for (const a of b.allocations.filter(a => !a.is_archived)) {
    const r = rcpt.get(a.receipt_id), i = byId.get(a.invoice_id)
    if (r && i && i.total) out.push({ basis: 'cash', line: 'revenue', entry_date: r.received_on, amount: round2(n(a.amount) * i.subtotal / i.total), brand_id: i.brand_id, campaign_id: i.campaign_id, source_id: r.id })
  }
  for (const r of rcpt.values()) if (r.category === 'other_income')
    for (const basis of ['invoice', 'cash'] as Basis[]) out.push({ basis, line: 'other_income', entry_date: r.received_on, amount: n(r.amount_received), brand_id: r.brand_id, campaign_id: null, source_id: r.id })
  for (const p of b.payouts.filter(p => !p.is_archived && p.status !== 'cancelled')) {
    out.push({ basis: 'invoice', line: 'creator_payout', entry_date: p.paid_on ?? p.due_date ?? p.created_at.slice(0, 10), amount: n(p.amount), brand_id: p.brand_id, campaign_id: p.campaign_id, source_id: p.id })
    if (p.status === 'paid' && p.paid_on) out.push({ basis: 'cash', line: 'creator_payout', entry_date: p.paid_on, amount: n(p.amount), brand_id: p.brand_id, campaign_id: p.campaign_id, source_id: p.id })
  }
  for (const e of b.expenses.filter(e => !e.is_archived && !e.payout_id)) {
    const t = cat.get(e.category_id)?.treatment
    if (t !== 'direct' && t !== 'overhead') continue
    const line = t === 'direct' ? 'direct_expense' : 'overhead_expense'
    out.push({ basis: 'invoice', line, entry_date: e.expense_date, amount: n(e.amount), brand_id: e.brand_id, campaign_id: e.campaign_id, source_id: e.id })
    if (e.status === 'paid' && e.paid_on) out.push({ basis: 'cash', line, entry_date: e.paid_on, amount: n(e.amount), brand_id: e.brand_id, campaign_id: e.campaign_id, source_id: e.id })
  }
  return out
}

export interface Overview {
  revenue_invoiced: number; revenue: number; cash_received: number; other_income: number
  creator_payouts: number; direct_expenses: number; overhead_expenses: number; expenses: number
  gross_profit: number; net_profit: number; gross_margin_pct: number | null; net_margin_pct: number | null
  gst_output: number; gst_input: number; outstanding: number; overdue: number; outstanding_invoices: number
  age_0_30: number; age_31_60: number; age_61_plus: number
  payouts_pending: number; payouts_pending_count: number; payouts_overdue_count: number; unpaid_expenses: number
}
const inRange = (d: ISODate | null | undefined, from: ISODate, to: ISODate) => !!d && d >= from && d <= to
const pct = (x: number, of: number) => of > 0 ? Math.round(x / of * 1000) / 10 : null

export function overview(b: Books, from: ISODate, to: ISODate, basis: Basis, today: ISODate): Overview {
  const lines = pnlLines(b).filter(l => l.basis === basis && inRange(l.entry_date, from, to))
  const by = (k: PnlLine['line']) => sum(lines.filter(l => l.line === k), l => l.amount)
  const rev = by('revenue'), oth = by('other_income'), po = by('creator_payout'), dir = by('direct_expense'), ovh = by('overhead_expense')
  const sent = b.invoices.filter(i => i.document_status === 'sent')
  const pend = b.payouts.filter(p => !p.is_archived && (p.status === 'pending' || p.status === 'approved'))
  const gross = round2(rev - po - dir), net = round2(gross - ovh + oth)
  return {
    revenue_invoiced: sum(sent.filter(i => inRange(i.issue_date, from, to)), i => i.subtotal), revenue: rev,
    cash_received: sum(b.receipts.filter(r => !r.is_archived && inRange(r.received_on, from, to)), r => n(r.amount_received)),
    other_income: oth, creator_payouts: po, direct_expenses: dir, overhead_expenses: ovh, expenses: round2(dir + ovh),
    gross_profit: gross, net_profit: net, gross_margin_pct: pct(gross, rev), net_margin_pct: pct(net, rev),
    gst_output: sum(sent.filter(i => inRange(i.issue_date, from, to)), i => i.gst_total),
    gst_input: sum(b.expenses.filter(e => !e.is_archived && inRange(e.expense_date, from, to)), e => n(e.gst_amount)),
    outstanding: sum(sent, i => i.outstanding), overdue: sum(sent.filter(i => i.payment_status === 'overdue'), i => i.outstanding),
    outstanding_invoices: sent.filter(i => i.outstanding > 0).length,
    age_0_30: sum(sent.filter(i => (i.age_days ?? 0) <= 30), i => i.outstanding),
    age_31_60: sum(sent.filter(i => (i.age_days ?? 0) >= 31 && (i.age_days ?? 0) <= 60), i => i.outstanding),
    age_61_plus: sum(sent.filter(i => (i.age_days ?? 0) > 60), i => i.outstanding),
    payouts_pending: sum(pend, p => payoutAmounts(n(p.amount), n(p.tds_rate), n(p.gst_rate)).net), payouts_pending_count: pend.length,
    payouts_overdue_count: pend.filter(p => p.due_date && p.due_date < today).length,
    unpaid_expenses: sum(b.expenses.filter(e => !e.is_archived && e.status === 'unpaid'), e => round2(n(e.amount) + n(e.gst_amount))),
  }
}

export interface ProfitRow { id: string | null; name: string; brand_name: string | null; revenue: number; creator_payouts: number; direct_expenses: number; profit: number; margin_pct: number | null }
export function profitBy(b: Books, group: 'brand' | 'campaign', from: ISODate, to: ISODate, basis: Basis, names: Record<string, string>, brandOf: Record<string, string> = {}): ProfitRow[] {
  const g = new Map<string | null, { rev: number; po: number; dir: number }>()
  for (const l of pnlLines(b)) {
    if (l.basis !== basis || !inRange(l.entry_date, from, to) || !['revenue', 'creator_payout', 'direct_expense'].includes(l.line)) continue
    const k = group === 'campaign' ? l.campaign_id : l.brand_id
    const x = g.get(k) ?? { rev: 0, po: 0, dir: 0 }
    if (l.line === 'revenue') x.rev = round2(x.rev + l.amount); else if (l.line === 'creator_payout') x.po = round2(x.po + l.amount); else x.dir = round2(x.dir + l.amount)
    g.set(k, x)
  }
  return [...g.entries()].map(([id, x]) => ({
    id, name: id ? names[id] ?? '—' : group === 'campaign' ? 'Not linked to a campaign' : 'Not linked to a brand',
    brand_name: group === 'campaign' && id ? names[brandOf[id]] ?? null : null,
    revenue: x.rev, creator_payouts: x.po, direct_expenses: x.dir, profit: round2(x.rev - x.po - x.dir), margin_pct: pct(round2(x.rev - x.po - x.dir), x.rev),
  })).sort((a, b) => b.profit - a.profit)
}

// ─── Accounts ───────────────────────────────────────────────
export interface AccountBalance { account_id: string; name: string; kind: AccountKind; opening_balance: number; opening_date: ISODate; money_in: number; money_out: number; balance: number; is_default: boolean; last_movement: ISODate | null }
export interface StatementLine { entry_date: ISODate; source_table: string; source_id: string | null; description: string; money_in: number; money_out: number }

export function accountStatement(b: Books, accountId: string, names: { brands: Record<string, string>; accounts: Record<string, string>; founders: Record<string, string> }, showCapital: boolean): StatementLine[] {
  const a = b.accounts.find(x => x.id === accountId)
  if (!a) return []
  const out: StatementLine[] = []
  if (n(a.opening_balance) !== 0) out.push({ entry_date: a.opening_date, source_table: 'opening', source_id: a.id, description: 'Opening balance', money_in: Math.max(n(a.opening_balance), 0), money_out: Math.max(-n(a.opening_balance), 0) })
  for (const r of b.receipts.filter(r => !r.is_archived && r.account_id === accountId))
    out.push({ entry_date: r.received_on, source_table: 'receipts', source_id: r.id, description: (r.category === 'other_income' ? 'Other income' : `Payment from ${names.brands[r.brand_id ?? ''] ?? 'a brand'}`) + (r.reference ? ` · ${r.reference}` : ''), money_in: n(r.amount_received), money_out: 0 })
  for (const e of b.expenses.filter(e => !e.is_archived && e.status === 'paid' && e.account_id === accountId))
    out.push({ entry_date: e.paid_on!, source_table: 'expenses', source_id: e.id, description: e.description, money_in: 0, money_out: round2(n(e.amount) + n(e.gst_amount) - n(e.tds_deducted)) })
  for (const x of b.transfers.filter(x => !x.is_archived)) {
    if (x.to_account_id === accountId) out.push({ entry_date: x.transfer_date, source_table: 'account_transfers', source_id: x.id, description: `Transfer from ${names.accounts[x.from_account_id]}`, money_in: n(x.amount), money_out: 0 })
    if (x.from_account_id === accountId) out.push({ entry_date: x.transfer_date, source_table: 'account_transfers', source_id: x.id, description: `Transfer to ${names.accounts[x.to_account_id]}`, money_in: 0, money_out: n(x.amount) })
  }
  const cap = b.capital.filter(c => !c.is_archived && c.account_id === accountId)
  if (showCapital) for (const c of cap) out.push({ entry_date: c.entry_date, source_table: 'capital_entries', source_id: c.id, description: `${c.kind === 'capital_added' ? 'Capital added' : 'Founder withdrawal'} — ${c.founder_id ? names.founders[c.founder_id] : 'Company'}`, money_in: c.kind === 'capital_added' ? n(c.amount) : 0, money_out: c.kind === 'founder_withdrawal' ? n(c.amount) : 0 })
  else if (cap.length) out.push({ entry_date: cap.map(c => c.entry_date).sort().at(-1)!, source_table: 'capital_entries', source_id: null, description: 'Capital movements (founders see the detail)', money_in: sum(cap.filter(c => c.kind === 'capital_added'), c => n(c.amount)), money_out: sum(cap.filter(c => c.kind === 'founder_withdrawal'), c => n(c.amount)) })
  return out.sort((x, y) => x.entry_date.localeCompare(y.entry_date) || x.source_table.localeCompare(y.source_table))
}

export function accountBalances(b: Books): AccountBalance[] {
  const names = { brands: {}, accounts: Object.fromEntries(b.accounts.map(a => [a.id, a.name])), founders: {} }
  return b.accounts.filter(a => !a.is_archived).map(a => {
    const lines = accountStatement(b, a.id, names, true).filter(l => l.source_table !== 'opening')
    const mi = sum(lines, l => l.money_in), mo = sum(lines, l => l.money_out)
    return { account_id: a.id, name: a.name, kind: a.kind, opening_balance: n(a.opening_balance), opening_date: a.opening_date, money_in: mi, money_out: mo,
      balance: round2(n(a.opening_balance) + mi - mo), is_default: a.is_default, last_movement: lines.map(l => l.entry_date).sort().at(-1) ?? null }
  }).sort((x, y) => Number(y.is_default) - Number(x.is_default) || x.name.localeCompare(y.name))
}

// ─── Capital per founder & the balance check ────────────────
export interface CapitalAccount { founder_id: string; name: string; profit_share_pct: number; opening_capital: number; capital_added: number; withdrawals: number; profit_transferred: number; balance: number }
export function capitalAccounts(b: Books, founders: FounderRec[]): CapitalAccount[] {
  return founders.map(f => {
    const pctShare = n(f.profit_share_pct)
    const share = (c: CapitalRec) => c.founder_id === f.id ? n(c.amount) : c.founder_id == null ? round2(n(c.amount) * pctShare / 100) : 0
    const live = b.capital.filter(c => !c.is_archived)
    const k = (kind: CapitalKind) => sum(live.filter(c => c.kind === kind), share)
    const o = k('opening_capital'), a = k('capital_added'), w = k('founder_withdrawal'), p = k('profit_transferred')
    return { founder_id: f.id, name: f.name, profit_share_pct: pctShare, opening_capital: o, capital_added: a, withdrawals: w, profit_transferred: p, balance: round2(o + a - w + p) }
  }).sort((x, y) => x.name.localeCompare(y.name))
}

export interface BalanceCheck {
  capital: number; retained_profit: number; left_side: number
  accounts: number; receivables: number; tds_credit: number; owed_to_us: number
  payouts_owed: number; expenses_owed: number; advances: number; gst_payable: number; tds_payable: number; we_owe: number
  right_side: number; difference: number; is_balanced: boolean
}
export function balanceCheck(b: Books): BalanceCheck {
  const live = b.capital.filter(c => !c.is_archived)
  const cap = sum(live, c => c.kind === 'founder_withdrawal' ? -n(c.amount) : n(c.amount))
  const transferred = sum(live.filter(c => c.kind === 'profit_transferred'), c => n(c.amount))
  const profit = sum(pnlLines(b).filter(l => l.basis === 'invoice'), l => l.line === 'revenue' || l.line === 'other_income' ? l.amount : -l.amount)
  const acc = sum(accountBalances(b), a => a.balance)
  const sent = b.invoices.filter(i => i.document_status === 'sent')
  const rec = sum(sent, i => i.outstanding)
  const rc = b.receipts.filter(r => !r.is_archived)
  const tdsc = sum(rc.filter(r => r.category === 'client_payment'), r => n(r.tds_deducted))
  const po = sum(b.payouts.filter(p => !p.is_archived && (p.status === 'pending' || p.status === 'approved')), p => n(p.amount))
  const ex = b.expenses.filter(e => !e.is_archived)
  const exOwed = sum(ex.filter(e => e.status === 'unpaid'), e => round2(n(e.amount) + n(e.gst_amount)))
  const applied = (rid: string) => sum(b.allocations.filter(a => !a.is_archived && a.receipt_id === rid), a => n(a.amount))
  const adv = sum(rc.filter(r => r.category === 'client_payment'), r => round2(n(r.amount_received) + n(r.tds_deducted) - applied(r.id)))
  const tre = (t: Treatment) => sum(ex.filter(e => b.categories.find(c => c.id === e.category_id)?.treatment === t), e => round2(n(e.amount) + n(e.gst_amount)))
  const gst = round2(sum(sent, i => i.gst_total) - sum(ex, e => n(e.gst_amount)) - tre('gst_payment'))
  const tds = round2(sum(ex.filter(e => e.status === 'paid'), e => n(e.tds_deducted)) - tre('tds_payment'))
  const left = round2(cap + profit - transferred), weOwe = round2(po + exOwed + adv + gst + tds), right = round2(acc + rec + tdsc - weOwe)
  return { capital: cap, retained_profit: round2(profit - transferred), left_side: left, accounts: acc, receivables: rec, tds_credit: tdsc, owed_to_us: round2(rec + tdsc),
    payouts_owed: po, expenses_owed: exOwed, advances: adv, gst_payable: gst, tds_payable: tds, we_owe: weOwe, right_side: right,
    difference: round2(left - right), is_balanced: Math.abs(left - right) < 1 }
}

// ─── GST & TDS by month ─────────────────────────────────────
export interface GstMonth { month: ISODate; invoices: number; taxable_value: number; cgst: number; sgst: number; igst: number; output_gst: number; input_gst: number; gst_paid: number; net_gst: number }
export interface TdsMonth { month: ISODate; tds_by_clients: number; tds_we_deducted: number; tds_deposited: number }
export function monthsBetween(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}-01`); m++; if (m > 12) { m = 1; y++ } }
  return out
}
const sameMonth = (d: ISODate | null | undefined, m: ISODate) => !!d && d.slice(0, 7) === m.slice(0, 7)
export function gstMonthly(b: Books, from: ISODate, to: ISODate): GstMonth[] {
  const sent = b.invoices.filter(i => i.document_status === 'sent'), ex = b.expenses.filter(e => !e.is_archived)
  return monthsBetween(from, to).map(m => {
    const inv = sent.filter(i => sameMonth(i.issue_date, m)), e = ex.filter(x => sameMonth(x.expense_date, m))
    const out = sum(inv, i => i.gst_total), inp = sum(e, x => n(x.gst_amount))
    return { month: m, invoices: inv.length, taxable_value: sum(inv, i => i.subtotal), cgst: sum(inv, i => i.cgst), sgst: sum(inv, i => i.sgst), igst: sum(inv, i => i.igst),
      output_gst: out, input_gst: inp, gst_paid: sum(e.filter(x => b.categories.find(c => c.id === x.category_id)?.treatment === 'gst_payment'), x => round2(n(x.amount) + n(x.gst_amount))), net_gst: round2(out - inp) }
  })
}
export function tdsMonthly(b: Books, from: ISODate, to: ISODate): TdsMonth[] {
  const ex = b.expenses.filter(e => !e.is_archived)
  return monthsBetween(from, to).map(m => ({
    month: m,
    tds_by_clients: sum(b.receipts.filter(r => !r.is_archived && sameMonth(r.received_on, m)), r => n(r.tds_deducted)),
    tds_we_deducted: sum(ex.filter(e => e.status === 'paid' && sameMonth(e.paid_on, m)), e => n(e.tds_deducted)),
    tds_deposited: sum(ex.filter(e => b.categories.find(c => c.id === e.category_id)?.treatment === 'tds_payment' && sameMonth(e.expense_date, m)), e => round2(n(e.amount) + n(e.gst_amount))),
  }))
}

// ─── Invoice PDF helpers ────────────────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function words99(x: number) { return x < 20 ? ONES[x] : `${TENS[Math.floor(x / 10)]}${x % 10 ? ' ' + ONES[x % 10] : ''}` }
function words999(x: number) { const h = Math.floor(x / 100), r = x % 100; return [h ? `${ONES[h]} Hundred` : '', r ? words99(r) : ''].filter(Boolean).join(' ') }
/** Indian system: 1,23,45,678 → One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount) + 1e-9), paise = Math.round((Math.abs(amount) - rupees) * 100)
  const parts: string[] = []
  const crore = Math.floor(rupees / 1e7), lakh = Math.floor(rupees % 1e7 / 1e5), thousand = Math.floor(rupees % 1e5 / 1e3), rest = rupees % 1e3
  if (crore) parts.push(`${crore >= 100 ? words999(crore) : words99(crore)} Crore`)
  if (lakh) parts.push(`${words99(lakh)} Lakh`)
  if (thousand) parts.push(`${words99(thousand)} Thousand`)
  if (rest) parts.push(words999(rest))
  const r = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero'
  return `${r}${paise ? ` and ${words99(paise)} Paise` : ''} Only`
}

/** UPI deep link for the QR on the invoice (any UPI app can scan it). */
export function upiLink(upiId: string, payee: string, amount: number, note: string) {
  const q = new URLSearchParams({ pa: upiId, pn: payee, am: amount.toFixed(2), cu: 'INR', tn: note })
  return `upi://pay?${q.toString()}`
}

export const ageBucket = (days: number | null) => days == null ? null : days <= 30 ? '0–30 days' : days <= 60 ? '31–60 days' : '60+ days'

/** [code, name] pairs in code order, for pickers. */
export const GST_STATE_LIST = Object.entries(GST_STATES).sort((a, b) => a[0].localeCompare(b[0]))
