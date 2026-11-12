// Money data access: Supabase when configured, otherwise the in-memory
// preview books (local design preview only). Every total comes from the
// database views (invoice_totals, payment_list, expense_list, payout_list,
// money_overview, balance_check …) — nothing here adds numbers up.
// Edits to money records carry a reason (`change_reason`); the database
// refuses them without one and writes it into the activity log.
import { supabase } from '../lib/supabase'
import type { ActivityEntry } from '../lib/activity'
import type {
  AccountBalance, AccountKind, AccountRec, BalanceCheck, Basis, CapitalAccount, CapitalKind, CategoryRec, FounderRec, GstMonth,
  InvoiceTotals, Overview, PayMode, PayoutStatus, ProfitRow, StatementLine, TdsMonth, Treatment,
} from '../lib/money'
import { safeFileName } from '../lib/brands'
import { moneyPreview as pv } from './moneyPreview'

export interface OrgSettings {
  company_name: string; legal_name: string | null; gstin: string | null; pan: string | null; state: string | null; state_code: string | null
  address: string | null; email: string | null; phone: string | null; logo_path: string | null; invoice_prefix: string
  default_gst_rate: number; default_payment_terms_days: number; default_creator_tds_rate: number
  bank_account_name: string | null; bank_name: string | null; bank_account_number: string | null; bank_ifsc: string | null; bank_branch: string | null
  upi_id: string | null; invoice_terms: string | null; invoice_number_digits?: number
}
export interface InvoiceItem { id?: string; position: number; description: string; hsn_sac: string | null; quantity: number; rate: number }
export interface InvoiceInput {
  brand_id: string; campaign_id: string | null; due_date: string | null; issue_date: string | null; gst_enabled: boolean; gst_rate: number; tds_rate: number
  place_of_supply_code: string | null; service_period_start: string | null; service_period_end: string | null; notes: string | null
}
export interface InvoiceDetail { totals: InvoiceTotals; items: (InvoiceItem & { id: string; amount: number })[] }
export interface InvoicePayment { receipt_id: string; received_on: string; amount: number; reference: string | null; mode: PayMode | null; account_name: string | null }
export interface BrandBilling { id: string; name: string; billing_name: string | null; gstin: string | null; pan: string | null; billing_address: string | null; city: string | null; state: string | null; state_code: string | null; payment_terms_days: number | null; billing_contact: string | null; billing_email: string | null }

export interface PaymentRow {
  id: string; created_at: string; updated_at: string; is_archived: boolean; brand_id: string | null; brand_name: string | null; account_id: string; account_name: string
  received_on: string; amount_received: number; tds_deducted: number; credited: number; category: 'client_payment' | 'other_income'; mode: PayMode | null
  reference: string | null; notes: string | null; applied: number; unapplied: number; invoice_numbers: string[]; invoice_ids: string[]
}
export interface PaymentInput { brand_id: string | null; account_id: string; received_on: string; amount_received: number; tds_deducted: number; mode: PayMode | null; reference: string | null; notes: string | null; category: 'client_payment' | 'other_income' }
export interface Allocation { invoice_id: string; amount: number }

export interface ExpenseRow {
  id: string; created_at: string; updated_at: string; is_archived: boolean; expense_date: string; description: string; amount: number; gst_amount: number
  tds_deducted: number; total: number; paid_out: number; status: 'unpaid' | 'paid'; paid_on: string | null; account_id: string | null; account_name: string | null
  category_id: string; category_name: string; treatment: Treatment; vendor_id: string | null; vendor_name: string | null
  brand_id: string | null; brand_name: string | null; campaign_id: string | null; campaign_name: string | null; deliverable_id: string | null; deliverable_title: string | null
  bill_number: string | null; notes: string | null; payout_id: string | null; recurring_id: string | null; recurring_period: string | null; bills: number
}
export interface ExpenseInput {
  expense_date: string; description: string; amount: number; gst_amount: number; tds_deducted: number; category_id: string; status: 'unpaid' | 'paid'
  account_id: string | null; paid_on: string | null; vendor_id: string | null; brand_id: string | null; campaign_id: string | null; deliverable_id: string | null
  bill_number: string | null; notes: string | null
}
export interface RecurringRow { id: string; description: string; category_id: string; category_name: string; vendor_id: string | null; amount: number; gst_amount: number; account_id: string | null; account_name: string | null; mark_paid: boolean; day_of_month: number; start_date: string; end_date: string | null; is_paused: boolean; notes: string | null; is_archived: boolean; created: number; last_created: string | null }
export type RecurringInput = Omit<RecurringRow, 'id' | 'category_name' | 'account_name' | 'created' | 'last_created' | 'is_archived'>

export interface PayoutRow {
  id: string; created_at: string; updated_at: string; is_archived: boolean; status: PayoutStatus; description: string | null
  creator_id: string | null; vendor_id: string | null; payee_kind: 'creator' | 'freelancer'; payee_name: string; payee_photo_path: string | null
  campaign_creator_id: string | null; campaign_id: string | null; campaign_name: string | null; deliverable_id: string | null; deliverable_title: string | null
  brand_id: string | null; brand_name: string | null; gross: number; tds_rate: number; tds: number; gst_rate: number; gst: number; net_payable: number
  due_date: string | null; is_overdue: boolean; approved_at: string | null; approved_by_name: string | null; paid_on: string | null
  account_id: string | null; account_name: string | null; reference: string | null; creator_invoice_no: string | null; notes: string | null; expense_id: string | null
}
export interface PayoutInput {
  creator_id: string | null; vendor_id: string | null; campaign_creator_id: string | null; deliverable_id: string | null; campaign_id: string | null; brand_id: string | null
  description: string | null; amount: number; tds_rate: number; gst_rate: number; due_date: string | null; creator_invoice_no: string | null; notes: string | null
}
export interface PayeeOption { kind: 'creator' | 'vendor'; id: string; name: string; hint: string }
export interface CampaignCreatorOption { id: string; creator_id: string; creator_name: string; campaign_id: string; campaign_name: string; agreed_fee: number | null }
export interface LinkOption { id: string; name: string; brand_id?: string | null }

export interface CapitalRow { id: string; created_at: string; updated_at: string; is_archived: boolean; entry_date: string; kind: CapitalKind; founder_id: string | null; founder_name: string; account_id: string | null; account_name: string | null; amount: number; signed_amount: number; notes: string | null }
export interface CapitalInput { entry_date: string; kind: CapitalKind; founder_id: string | null; account_id: string | null; amount: number; notes: string | null }
export interface AccountInput { name: string; kind: AccountKind; bank_name: string | null; last4: string | null; opening_balance: number; opening_date: string; is_default: boolean; notes: string | null }
export interface RetainerDue { retainer_id: string; brand_id: string; brand_name: string; title: string; monthly_fee: number; invoice_id: string | null; invoice_number: string | null }
export interface GstRegisterRow { invoice_id: string; invoice_number: string; issue_date: string; brand_name: string; billing_name: string | null; brand_gstin: string | null; place_of_supply_code: string | null; brand_state: string | null; is_interstate: boolean; gst_rate: number; taxable_value: number; cgst: number; sgst: number; igst: number; gst_total: number; total: number }
export interface TdsRegisterRow { direction: 'deducted_by_client' | 'deducted_by_us'; entry_date: string; party: string; party_pan: string | null; reference: string | null; tds: number; gross: number; source_table: string; source_id: string }
export interface BillFile { id: string; file_name: string; kind: string; size_bytes: number | null; storage_path: string; created_at: string }
export type MoneyActivity = ActivityEntry & { reason: string | null }

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}
const BUCKET = 'records'
const nums = <T extends object>(rows: T[]): T[] => rows   // numeric columns arrive as numbers from PostgREST
const withReason = <T extends object>(patch: T, reason?: string) => reason ? { ...patch, change_reason: reason } : patch

export const moneyApi = {
  // ── settings & founders ──
  async settings(): Promise<OrgSettings> {
    if (!supabase) return pv.settings()
    return must(await supabase.from('org_settings').select('company_name, legal_name, gstin, pan, state, state_code, address, email, phone, logo_path, invoice_prefix, default_gst_rate, default_payment_terms_days, invoice_number_digits, default_creator_tds_rate, bank_account_name, bank_name, bank_account_number, bank_ifsc, bank_branch, upi_id, invoice_terms').limit(1).single()) as OrgSettings
  },
  async saveSettings(patch: Partial<OrgSettings>) {
    if (!supabase) return pv.saveSettings(patch)
    must(await supabase.from('org_settings').update(patch).eq('singleton', true))
  },
  async logoUrl(path: string | null): Promise<string | null> {
    if (!supabase || !path) return null
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    return data?.signedUrl ?? null
  },
  async uploadLogo(file: File) {
    if (!supabase) throw new Error('Connect Supabase to upload a logo')
    const path = `org/logo-${Date.now()}-${safeFileName(file.name)}`
    must(await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined }))
    must(await supabase.from('org_settings').update({ logo_path: path }).eq('singleton', true))
  },
  async founders(): Promise<FounderRec[]> {
    if (!supabase) return pv.founders()
    return must(await supabase.from('team_members').select('id, name, profit_share_pct').eq('role', 'founder').eq('is_archived', false).order('name')) as FounderRec[]
  },
  async saveShares(rows: { id: string; profit_share_pct: number }[]) {
    if (!supabase) return pv.saveShares(rows)
    for (const r of rows) must(await supabase.from('team_members').update({ profit_share_pct: r.profit_share_pct }).eq('id', r.id))
  },

  // ── accounts ──
  async accounts(): Promise<AccountBalance[]> {
    if (!supabase) return pv.accounts()
    return nums(must(await supabase.rpc('account_balances')) as AccountBalance[])
  },
  async accountRecords(): Promise<AccountRec[]> {
    if (!supabase) return pv.accountRecords()
    return must(await supabase.from('money_accounts').select('id, name, kind, bank_name, last4, opening_balance, opening_date, is_default, notes, is_archived').eq('is_archived', false).order('name')) as AccountRec[]
  },
  async saveAccount(input: AccountInput, id?: string, reason?: string): Promise<string> {
    if (!supabase) return pv.saveAccount(input, id, reason)
    if (id) { must(await supabase.from('money_accounts').update(withReason(input, reason)).eq('id', id)); return id }
    return (must(await supabase.from('money_accounts').insert(input).select('id').single()) as { id: string }).id
  },
  async archiveAccount(id: string, reason: string) {
    if (!supabase) return pv.archiveAccount(id, reason)
    must(await supabase.from('money_accounts').update({ is_archived: true, change_reason: reason }).eq('id', id))
  },
  async statement(id: string): Promise<StatementLine[]> {
    if (!supabase) return pv.statement(id)
    return must(await supabase.rpc('account_statement', { p_account: id })) as StatementLine[]
  },
  async saveTransfer(input: { from_account_id: string; to_account_id: string; transfer_date: string; amount: number; notes: string | null }) {
    if (!supabase) return pv.saveTransfer(input)
    must(await supabase.from('account_transfers').insert(input))
  },

  // ── invoices ──
  async invoices(): Promise<InvoiceTotals[]> {
    if (!supabase) return pv.invoices()
    return must(await supabase.from('invoice_totals').select('*').order('created_at', { ascending: false })) as InvoiceTotals[]
  },
  async invoice(id: string): Promise<InvoiceDetail | null> {
    if (!supabase) return pv.invoice(id)
    const totals = must(await supabase.from('invoice_totals').select('*').eq('invoice_id', id).maybeSingle()) as InvoiceTotals | null
    if (!totals) return null
    const items = must(await supabase.from('invoice_items').select('id, position, description, hsn_sac, quantity, rate, amount').eq('invoice_id', id).eq('is_archived', false).order('position')) as InvoiceDetail['items']
    return { totals, items }
  },
  async invoicePayments(id: string): Promise<InvoicePayment[]> {
    if (!supabase) return pv.invoicePayments(id)
    const rows = must(await supabase.from('receipt_allocations').select('amount, receipt:receipts!inner(id, received_on, reference, mode, is_archived, account:money_accounts(name))').eq('invoice_id', id).eq('is_archived', false)) as unknown as
      { amount: number; receipt: { id: string; received_on: string; reference: string | null; mode: PayMode | null; is_archived: boolean; account: { name: string } | null } }[]
    return rows.filter(r => !r.receipt.is_archived).map(r => ({ receipt_id: r.receipt.id, received_on: r.receipt.received_on, amount: r.amount, reference: r.receipt.reference, mode: r.receipt.mode, account_name: r.receipt.account?.name ?? null }))
      .sort((a, b) => a.received_on.localeCompare(b.received_on))
  },
  async brandBilling(brandId: string): Promise<BrandBilling | null> {
    if (!supabase) return pv.brandBilling(brandId)
    const b = must(await supabase.from('brands').select('id, name, billing_name, gstin, pan, billing_address, city, state, state_code, payment_terms_days').eq('id', brandId).maybeSingle()) as Omit<BrandBilling, 'billing_contact' | 'billing_email'> | null
    if (!b) return null
    const c = must(await supabase.from('brand_contacts').select('name, email').eq('brand_id', brandId).eq('is_archived', false).order('is_billing', { ascending: false }).order('is_primary', { ascending: false }).limit(1).maybeSingle()) as { name: string; email: string | null } | null
    return { ...b, billing_contact: c?.name ?? null, billing_email: c?.email ?? null }
  },
  /** Saves a draft (or, with a reason, a sent invoice): header + lines. Removed lines are archived. */
  async saveInvoice(header: InvoiceInput, items: InvoiceItem[], id?: string, reason?: string): Promise<string> {
    if (!supabase) return pv.saveInvoice(header, items, id, reason)
    let iid = id
    if (id) must(await supabase.from('invoices').update(withReason(header, reason)).eq('id', id))
    else iid = (must(await supabase.from('invoices').insert(header).select('id').single()) as { id: string }).id
    const existing = id ? (must(await supabase.from('invoice_items').select('id').eq('invoice_id', id).eq('is_archived', false)) as { id: string }[]) : []
    const keep = new Set(items.map(i => i.id).filter(Boolean))
    for (const e of existing) if (!keep.has(e.id)) must(await supabase.from('invoice_items').update(withReason({ is_archived: true }, reason)).eq('id', e.id))
    for (const [i, it] of items.entries()) {
      const row = { position: i + 1, description: it.description, hsn_sac: it.hsn_sac, quantity: it.quantity, rate: it.rate }
      if (it.id) must(await supabase.from('invoice_items').update(withReason(row, reason)).eq('id', it.id))
      else must(await supabase.from('invoice_items').insert({ ...row, invoice_id: iid }))
    }
    return iid!
  },
  async sendInvoice(id: string, issueDate: string | null) {
    if (!supabase) return pv.sendInvoice(id, issueDate)
    const patch = { status: 'sent', ...(issueDate ? { issue_date: issueDate } : {}) }
    const { error } = await supabase.from('invoices').update(patch).eq('id', id)
    if (!error) return
    // poka-yoke: a possible duplicate is stopped unless a person confirms it is intended
    if (!error.message.includes('possible duplicate') || !window.confirm(`${error.message.replace('Poka-yoke: ', '')}\n\nSend this one as well?`)) throw new Error(error.message)
    must(await supabase.from('invoices').update({ ...patch, duplicate_ok: true }).eq('id', id))
  },
  async cancelInvoice(id: string, reason: string) {
    if (!supabase) return pv.cancelInvoice(id, reason)
    must(await supabase.from('invoices').update({ status: 'cancelled', cancel_reason: reason }).eq('id', id))
  },
  async archiveDraft(id: string) {
    if (!supabase) return pv.archiveDraft(id)
    must(await supabase.from('invoices').update({ is_archived: true }).eq('id', id).eq('status', 'draft'))
  },
  async retainersToInvoice(month: string): Promise<RetainerDue[]> {
    if (!supabase) return pv.retainersToInvoice(month)
    return must(await supabase.rpc('retainers_to_invoice', { p_month: month })) as RetainerDue[]
  },
  async createRetainerInvoice(retainerId: string, month: string): Promise<string> {
    if (!supabase) return pv.createRetainerInvoice(retainerId, month)
    return must(await supabase.rpc('create_retainer_invoice', { p_retainer: retainerId, p_month: month })) as string
  },
  async openInvoices(brandId: string): Promise<InvoiceTotals[]> {
    if (!supabase) return pv.openInvoices(brandId)
    return must(await supabase.from('invoice_totals').select('*').eq('brand_id', brandId).eq('document_status', 'sent').gt('outstanding', 0).order('issue_date')) as InvoiceTotals[]
  },

  // ── payments ──
  async payments(): Promise<PaymentRow[]> {
    if (!supabase) return pv.payments()
    return must(await supabase.from('payment_list').select('*').eq('is_archived', false).order('received_on', { ascending: false })) as PaymentRow[]
  },
  async payment(id: string): Promise<{ row: PaymentRow; allocations: (Allocation & { invoice_number: string | null; id: string })[] } | null> {
    if (!supabase) return pv.payment(id)
    const row = must(await supabase.from('payment_list').select('*').eq('id', id).maybeSingle()) as PaymentRow | null
    if (!row) return null
    const a = must(await supabase.from('receipt_allocations').select('id, invoice_id, amount, invoice:invoices(invoice_number)').eq('receipt_id', id).eq('is_archived', false)) as unknown as { id: string; invoice_id: string; amount: number; invoice: { invoice_number: string | null } | null }[]
    return { row, allocations: a.map(x => ({ id: x.id, invoice_id: x.invoice_id, amount: x.amount, invoice_number: x.invoice?.invoice_number ?? null })) }
  },
  async recordPayment(p: PaymentInput, allocations: Allocation[]): Promise<string> {
    if (!supabase) return pv.recordPayment(p, allocations)
    return must(await supabase.rpc('record_payment', {
      p_brand: p.brand_id, p_account: p.account_id, p_received_on: p.received_on, p_amount: p.amount_received, p_tds: p.tds_deducted,
      p_mode: p.mode, p_reference: p.reference, p_notes: p.notes, p_allocations: allocations, p_category: p.category,
    })) as string
  },
  /** Change a payment's details and how it is applied — needs a reason. */
  async updatePayment(id: string, patch: Partial<PaymentInput>, allocations: Allocation[] | null, reason: string) {
    if (!supabase) return pv.updatePayment(id, patch, allocations, reason)
    if (allocations) {
      const cur = must(await supabase.from('receipt_allocations').select('id, invoice_id, amount').eq('receipt_id', id).eq('is_archived', false)) as { id: string; invoice_id: string; amount: number }[]
      // lower / remove first so the "not more than received" check passes, then raise / add
      for (const c of cur) { const want = allocations.find(a => a.invoice_id === c.invoice_id)?.amount ?? 0; if (want < c.amount) must(await supabase.from('receipt_allocations').update(want > 0 ? { amount: want, change_reason: reason } : { is_archived: true, change_reason: reason }).eq('id', c.id)) }
      if (Object.keys(patch).length) must(await supabase.from('receipts').update({ ...patch, change_reason: reason }).eq('id', id))
      for (const a of allocations.filter(x => x.amount > 0)) {
        const c = cur.find(x => x.invoice_id === a.invoice_id)
        if (!c) {
          const old = must(await supabase.from('receipt_allocations').select('id').eq('receipt_id', id).eq('invoice_id', a.invoice_id).maybeSingle()) as { id: string } | null
          if (old) must(await supabase.from('receipt_allocations').update({ amount: a.amount, is_archived: false, change_reason: reason }).eq('id', old.id))
          else must(await supabase.from('receipt_allocations').insert({ receipt_id: id, invoice_id: a.invoice_id, amount: a.amount }))
        } else if (a.amount > c.amount) must(await supabase.from('receipt_allocations').update({ amount: a.amount, change_reason: reason }).eq('id', c.id))
      }
    } else must(await supabase.from('receipts').update({ ...patch, change_reason: reason }).eq('id', id))
  },
  async archivePayment(id: string, reason: string) {
    if (!supabase) return pv.archivePayment(id, reason)
    must(await supabase.from('receipts').update({ is_archived: true, change_reason: reason }).eq('id', id))
  },

  // ── expenses ──
  async categories(includeArchived = false): Promise<CategoryRec[]> {
    if (!supabase) return pv.categories(includeArchived)
    let q = supabase.from('expense_categories').select('id, name, treatment, system_key, position, is_archived').order('position').order('name')
    if (!includeArchived) q = q.eq('is_archived', false)
    return must(await q) as CategoryRec[]
  },
  async saveCategory(input: { name: string; treatment: Treatment; is_archived?: boolean }, id?: string) {
    if (!supabase) return pv.saveCategory(input, id)
    if (id) must(await supabase.from('expense_categories').update(input).eq('id', id))
    else must(await supabase.from('expense_categories').insert({ ...input, position: 50 }))
  },
  async expenses(): Promise<ExpenseRow[]> {
    if (!supabase) return pv.expenses()
    return must(await supabase.from('expense_list').select('*').eq('is_archived', false).order('expense_date', { ascending: false })) as ExpenseRow[]
  },
  async expense(id: string): Promise<ExpenseRow | null> {
    if (!supabase) return pv.expense(id)
    return must(await supabase.from('expense_list').select('*').eq('id', id).maybeSingle()) as ExpenseRow | null
  },
  async expensesFor(link: { deliverable_id?: string; campaign_id?: string }): Promise<ExpenseRow[]> {
    if (!supabase) return pv.expensesFor(link)
    let q = supabase.from('expense_list').select('*').eq('is_archived', false)
    if (link.deliverable_id) q = q.eq('deliverable_id', link.deliverable_id)
    if (link.campaign_id) q = q.eq('campaign_id', link.campaign_id)
    return must(await q.order('expense_date', { ascending: false })) as ExpenseRow[]
  },
  async saveExpense(input: ExpenseInput, id?: string, reason?: string): Promise<string> {
    if (!supabase) return pv.saveExpense(input, id, reason)
    if (id) { must(await supabase.from('expenses').update(withReason(input, reason)).eq('id', id)); return id }
    return (must(await supabase.from('expenses').insert(input).select('id').single()) as { id: string }).id
  },
  async markExpensePaid(id: string, accountId: string, paidOn: string) {
    if (!supabase) return pv.markExpensePaid(id, accountId, paidOn)
    must(await supabase.from('expenses').update({ status: 'paid', account_id: accountId, paid_on: paidOn }).eq('id', id))
  },
  async archiveExpense(id: string, reason: string) {
    if (!supabase) return pv.archiveExpense(id, reason)
    must(await supabase.from('expenses').update({ is_archived: true, change_reason: reason }).eq('id', id))
  },
  async recurring(): Promise<RecurringRow[]> {
    if (!supabase) return pv.recurring()
    const rows = must(await supabase.from('recurring_expenses').select('*, category:expense_categories(name), account:money_accounts(name)').eq('is_archived', false).order('description')) as unknown as (RecurringRow & { category: { name: string } | null; account: { name: string } | null })[]
    const made = must(await supabase.from('expenses').select('recurring_id, expense_date').not('recurring_id', 'is', null).eq('is_archived', false)) as { recurring_id: string; expense_date: string }[]
    return rows.map(r => {
      const mine = made.filter(m => m.recurring_id === r.id).map(m => m.expense_date).sort()
      return { ...r, category_name: r.category?.name ?? '', account_name: r.account?.name ?? null, created: mine.length, last_created: mine.at(-1) ?? null }
    })
  },
  async saveRecurring(input: RecurringInput, id?: string) {
    if (!supabase) return pv.saveRecurring(input, id)
    if (id) must(await supabase.from('recurring_expenses').update(input).eq('id', id))
    else must(await supabase.from('recurring_expenses').insert(input))
  },
  async archiveRecurring(id: string) {
    if (!supabase) return pv.archiveRecurring(id)
    must(await supabase.from('recurring_expenses').update({ is_archived: true }).eq('id', id))
  },
  /** Creates any recurring expenses that have come due (safe to call any time). */
  async runRecurring(): Promise<number> {
    if (!supabase) return pv.runRecurring()
    return must(await supabase.rpc('create_recurring_expenses')) as number
  },
  async bills(expenseId: string): Promise<BillFile[]> {
    if (!supabase) return pv.bills(expenseId)
    return must(await supabase.from('files').select('id, file_name, kind, size_bytes, storage_path, created_at').eq('expense_id', expenseId).eq('is_archived', false).order('created_at', { ascending: false })) as BillFile[]
  },
  async uploadBill(expenseId: string, file: File, kind: string) {
    if (!supabase) return pv.uploadBill(expenseId, file, kind)
    const path = `money/expenses/${expenseId}/${Date.now()}-${safeFileName(file.name)}`
    must(await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined }))
    must(await supabase.from('files').insert({ bucket: BUCKET, storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size, kind, expense_id: expenseId }))
  },
  async archiveBill(id: string) {
    if (!supabase) return pv.archiveBill(id)
    must(await supabase.from('files').update({ is_archived: true }).eq('id', id))
  },
  async signedUrl(path: string, download?: string) {
    if (!supabase) return null
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300, download ? { download } : undefined)
    return data?.signedUrl ?? null
  },

  // ── payouts ──
  async payouts(): Promise<PayoutRow[]> {
    if (!supabase) return pv.payouts()
    return must(await supabase.from('payout_list').select('*').eq('is_archived', false).order('created_at', { ascending: false })) as PayoutRow[]
  },
  async payout(id: string): Promise<PayoutRow | null> {
    if (!supabase) return pv.payout(id)
    return must(await supabase.from('payout_list').select('*').eq('id', id).maybeSingle()) as PayoutRow | null
  },
  async savePayout(input: PayoutInput, id?: string, reason?: string): Promise<string> {
    if (!supabase) return pv.savePayout(input, id, reason)
    if (id) { must(await supabase.from('creator_payouts').update(withReason(input, reason)).eq('id', id)); return id }
    return (must(await supabase.from('creator_payouts').insert(input).select('id').single()) as { id: string }).id
  },
  async approvePayout(id: string) {
    if (!supabase) return pv.approvePayout(id)
    must(await supabase.from('creator_payouts').update({ status: 'approved' }).eq('id', id))
  },
  /** Marks paid — the database creates the matching expense. */
  async payPayout(id: string, p: { paid_on: string; account_id: string; reference: string | null }) {
    if (!supabase) return pv.payPayout(id, p)
    must(await supabase.from('creator_payouts').update({ status: 'paid', ...p }).eq('id', id))
  },
  async setPayoutStatus(id: string, status: PayoutStatus, reason: string) {
    if (!supabase) return pv.setPayoutStatus(id, status, reason)
    must(await supabase.from('creator_payouts').update({ status, change_reason: reason }).eq('id', id))
  },
  async archivePayout(id: string, reason: string) {
    if (!supabase) return pv.archivePayout(id, reason)
    must(await supabase.from('creator_payouts').update({ is_archived: true, change_reason: reason }).eq('id', id))
  },
  async payeeOptions(): Promise<PayeeOption[]> {
    if (!supabase) return pv.payeeOptions()
    const [creators, vendors] = await Promise.all([
      supabase.from('creators').select('id, name, city').eq('is_archived', false).order('name'),
      supabase.from('vendors').select('id, name, skill').eq('is_archived', false).order('name'),
    ])
    return [
      ...((creators.data ?? []) as { id: string; name: string; city: string | null }[]).map(c => ({ kind: 'creator' as const, id: c.id, name: c.name, hint: `Creator${c.city ? ` · ${c.city}` : ''}` })),
      ...((vendors.data ?? []) as { id: string; name: string; skill: string | null }[]).map(v => ({ kind: 'vendor' as const, id: v.id, name: v.name, hint: `Freelancer${v.skill ? ` · ${v.skill}` : ''}` })),
    ]
  },
  async campaignCreatorOptions(): Promise<CampaignCreatorOption[]> {
    if (!supabase) return pv.campaignCreatorOptions()
    const rows = must(await supabase.from('campaign_creators').select('id, creator_id, campaign_id, status, creator:creators(name), campaign:campaigns(name), fee:campaign_creator_fees(agreed_fee)').eq('is_archived', false).neq('status', 'dropped')) as unknown as
      { id: string; creator_id: string; campaign_id: string; creator: { name: string } | null; campaign: { name: string } | null; fee: { agreed_fee: number | null } | { agreed_fee: number | null }[] | null }[]
    return rows.map(r => ({ id: r.id, creator_id: r.creator_id, creator_name: r.creator?.name ?? '', campaign_id: r.campaign_id, campaign_name: r.campaign?.name ?? '',
      agreed_fee: Array.isArray(r.fee) ? r.fee[0]?.agreed_fee ?? null : r.fee?.agreed_fee ?? null }))
  },
  /** UPI IDs for payees — creators' come from their payment details, so only founders get them. */
  async payeeUpi(): Promise<Record<string, string>> {
    if (!supabase) return pv.payeeUpi()
    const [c, v] = await Promise.all([
      supabase.from('creator_payment_details').select('creator_id, upi_id').not('upi_id', 'is', null),
      supabase.from('vendors').select('id, upi_id').not('upi_id', 'is', null),
    ])
    return Object.fromEntries([
      ...((c.data ?? []) as { creator_id: string; upi_id: string }[]).map(x => [x.creator_id, x.upi_id]),
      ...((v.data ?? []) as { id: string; upi_id: string }[]).map(x => [x.id, x.upi_id]),
    ])
  },

  // ── links for pickers ──
  async brandOptions(): Promise<(LinkOption & { state_code: string | null; payment_terms_days: number | null })[]> {
    if (!supabase) return pv.brandOptions()
    return must(await supabase.from('brands').select('id, name, state_code, payment_terms_days').eq('is_archived', false).order('name')) as (LinkOption & { state_code: string | null; payment_terms_days: number | null })[]
  },
  async campaignOptions(): Promise<LinkOption[]> {
    if (!supabase) return pv.campaignOptions()
    return must(await supabase.from('campaigns').select('id, name, brand_id').eq('is_archived', false).order('start_date', { ascending: false, nullsFirst: false })) as LinkOption[]
  },
  async deliverableOptions(): Promise<LinkOption[]> {
    if (!supabase) return pv.deliverableOptions()
    const rows = must(await supabase.from('deliverables').select('id, title, brand_id').eq('is_archived', false).neq('stage', 'cancelled').order('created_at', { ascending: false }).limit(500)) as { id: string; title: string; brand_id: string }[]
    return rows.map(r => ({ id: r.id, name: r.title, brand_id: r.brand_id }))
  },
  async vendorOptions(): Promise<LinkOption[]> {
    if (!supabase) return pv.vendorOptions()
    return must(await supabase.from('vendors').select('id, name').eq('is_archived', false).order('name')) as LinkOption[]
  },

  // ── capital (founders only) ──
  async capital(): Promise<CapitalRow[]> {
    if (!supabase) return pv.capital()
    return must(await supabase.from('capital_list').select('*').eq('is_archived', false).order('entry_date', { ascending: false })) as CapitalRow[]
  },
  async saveCapital(input: CapitalInput, id?: string, reason?: string): Promise<string> {
    if (!supabase) return pv.saveCapital(input, id, reason)
    if (id) { must(await supabase.from('capital_entries').update(withReason(input, reason)).eq('id', id)); return id }
    return (must(await supabase.from('capital_entries').insert(input).select('id').single()) as { id: string }).id
  },
  async archiveCapital(id: string, reason: string) {
    if (!supabase) return pv.archiveCapital(id, reason)
    must(await supabase.from('capital_entries').update({ is_archived: true, change_reason: reason }).eq('id', id))
  },
  async capitalAccounts(): Promise<CapitalAccount[]> {
    if (!supabase) return pv.capitalAccounts()
    return must(await supabase.rpc('capital_accounts')) as CapitalAccount[]
  },
  async balanceCheck(): Promise<BalanceCheck> {
    if (!supabase) return pv.balanceCheck()
    return (must(await supabase.rpc('balance_check')) as BalanceCheck[])[0]
  },

  // ── reports ──
  async overview(from: string, to: string, basis: Basis): Promise<Overview> {
    if (!supabase) return pv.overview(from, to, basis)
    return (must(await supabase.rpc('money_overview', { p_from: from, p_to: to, p_basis: basis })) as Overview[])[0]
  },
  async profitBy(group: 'brand' | 'campaign', from: string, to: string, basis: Basis): Promise<ProfitRow[]> {
    if (!supabase) return pv.profitBy(group, from, to, basis)
    return must(await supabase.rpc('profit_by', { p_group: group, p_from: from, p_to: to, p_basis: basis })) as ProfitRow[]
  },
  async gstMonthly(from: string, to: string): Promise<GstMonth[]> {
    if (!supabase) return pv.gstMonthly(from, to)
    return must(await supabase.rpc('gst_monthly', { p_from: from, p_to: to })) as GstMonth[]
  },
  async gstRegister(from: string, to: string): Promise<GstRegisterRow[]> {
    if (!supabase) return pv.gstRegister(from, to)
    return must(await supabase.from('gst_register').select('*').gte('issue_date', from).lte('issue_date', to).order('issue_date').order('invoice_number')) as GstRegisterRow[]
  },
  async tdsMonthly(from: string, to: string): Promise<TdsMonth[]> {
    if (!supabase) return pv.tdsMonthly(from, to)
    return must(await supabase.rpc('tds_monthly', { p_from: from, p_to: to })) as TdsMonth[]
  },
  async tdsRegister(from: string, to: string): Promise<TdsRegisterRow[]> {
    if (!supabase) return pv.tdsRegister(from, to)
    return must(await supabase.from('tds_register').select('*').gte('entry_date', from).lte('entry_date', to).order('entry_date')) as TdsRegisterRow[]
  },

  async activity(table: string, id: string): Promise<MoneyActivity[]> {
    if (!supabase) return pv.activity(table, id)
    return must(await supabase.rpc('money_activity', { p_table: table, p_id: id })) as MoneyActivity[]
  },
}
