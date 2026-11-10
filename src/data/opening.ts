// Opening balances & import (feature 7): Supabase when configured, otherwise
// the in-memory preview. Founders only. Every figure in OpeningState comes
// from the database function opening_state(); nothing here adds numbers up.
import { supabase } from '../lib/supabase'
import type { AccountKind, PayoutStatus } from '../lib/money'
import { openingPreview as pv } from './openingPreview'

export interface OpeningFounder {
  founder_id: string; name: string; profit_share_pct: number
  accumulated_profit: number   // their share of profit made before go-live
  own_money: number            // money they personally put in
  other: number                // their share of adjustments / company-level opening entries
  total: number                // opening capital for this founder
}
export interface OpeningAdjustment { id: string; amount: number; note: string }
export interface OpeningAccount { account_id: string; name: string; kind: AccountKind; opening_balance: number; opening_date: string }
export interface OpeningReceivable { invoice_id: string; invoice_number: string; brand_id: string; brand_name: string; issue_date: string; due_date: string | null; amount: number; outstanding: number }
export interface OpeningPayable { payout_id: string; payee_name: string; payee_kind: 'creator' | 'freelancer'; creator_id: string | null; vendor_id: string | null; description: string | null; due_date: string | null; amount: number; tds_rate: number; status: PayoutStatus }
export interface OpeningTotals {
  capital: number; accounts: number; receivables: number; payables: number
  net_position: number   // accounts + receivables − payables
  difference: number     // net_position − capital (0 = it balances)
  is_balanced: boolean
}
export interface OpeningState {
  go_live_date: string | null; locked_at: string | null; locked_by_name: string | null
  founders: OpeningFounder[]; adjustments: OpeningAdjustment[]; accounts: OpeningAccount[]
  receivables: OpeningReceivable[]; payables: OpeningPayable[]; totals: OpeningTotals
}
export interface CapitalRowInput { founder_id: string; accumulated_profit: number; own_money: number }
export interface OpeningInvoiceInput { brand_id: string; invoice_number: string; issue_date: string; due_date: string | null; amount: number; note: string | null }
export interface OpeningPayoutInput { creator_id: string | null; vendor_id: string | null; amount: number; tds_rate: number; due_date: string | null; description: string | null }

/** Result of a history import. `row` counts data rows from 1. */
export interface ImportResult { created: number; skipped: number; errors: { row: number; name: string; problem: string }[] }
export interface HistoryBrandRow { name: string; billing_name?: string; industry?: string; city?: string; state?: string; gstin?: string; website?: string; instagram_handle?: string; contact_name?: string; contact_email?: string; contact_phone?: string; notes?: string }
/** Dates are YYYY-MM-DD; money fields are plain numbers as text ("150000"). */
export interface HistoryCampaignRow { brand: string; name: string; start_date?: string; end_date?: string; kind?: string; client_fee?: string; creator_spend?: string; notes?: string }
export interface HistoryCampaignCreatorRow { brand?: string; campaign: string; creator: string; fee?: string }

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

export const openingApi = {
  async state(): Promise<OpeningState> {
    if (!supabase) return pv.state()
    return must(await supabase.rpc('opening_state')) as OpeningState
  },
  async setGoLive(date: string) {
    if (!supabase) return pv.setGoLive(date)
    must(await supabase.rpc('opening_set_go_live', { p_date: date }))
  },
  /** Replaces the opening capital the wizard saved before. */
  async saveCapital(rows: CapitalRowInput[]) {
    if (!supabase) return pv.saveCapital(rows)
    must(await supabase.rpc('opening_save_capital', { p_rows: rows }))
  },
  async setBalances(rows: { account_id: string; balance: number }[]) {
    if (!supabase) return pv.setBalances(rows)
    must(await supabase.rpc('opening_set_balances', { p_rows: rows }))
  },
  /** Positive = more capital, negative = less. The note is required. */
  async addAdjustment(amount: number, note: string) {
    if (!supabase) return pv.addAdjustment(amount, note)
    must(await supabase.rpc('opening_add_adjustment', { p_amount: amount, p_note: note }))
  },
  async addInvoice(i: OpeningInvoiceInput) {
    if (!supabase) return pv.addInvoice(i)
    must(await supabase.rpc('opening_add_invoice', { p_brand: i.brand_id, p_number: i.invoice_number, p_issue_date: i.issue_date, p_due_date: i.due_date, p_amount: i.amount, p_note: i.note }))
  },
  async addPayout(p: OpeningPayoutInput) {
    if (!supabase) return pv.addPayout(p)
    must(await supabase.rpc('opening_add_payout', { p_creator: p.creator_id, p_vendor: p.vendor_id, p_amount: p.amount, p_tds_rate: p.tds_rate, p_due_date: p.due_date, p_description: p.description }))
  },
  async remove(kind: 'invoice' | 'payout' | 'adjustment', id: string) {
    if (!supabase) return pv.remove(kind, id)
    must(await supabase.rpc('opening_remove', { p_kind: kind, p_id: id }))
  },
  /** Refused by the database while the check doesn't balance. */
  async lock() {
    if (!supabase) return pv.lock()
    must(await supabase.rpc('opening_lock'))
  },
  /** Re-open: signs the founder in again with their password, then unlocks.
   *  The database only unlocks for a login that used a password in the last 10 minutes. */
  async unlock(email: string, password: string) {
    if (!supabase) return pv.unlock(email, password)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'That password isn’t right.' : error.message)
    must(await supabase.rpc('opening_unlock'))
  },

  // ── step 5: history import ──
  async importBrands(rows: HistoryBrandRow[], source: string): Promise<ImportResult> {
    if (!supabase) return pv.importBrands(rows, source)
    return must(await supabase.rpc('import_history_brands', { p_rows: rows, p_source: source })) as ImportResult
  },
  async importCampaigns(rows: HistoryCampaignRow[], source: string): Promise<ImportResult> {
    if (!supabase) return pv.importCampaigns(rows, source)
    return must(await supabase.rpc('import_history_campaigns', { p_rows: rows, p_source: source })) as ImportResult
  },
  async importCampaignCreators(rows: HistoryCampaignCreatorRow[], source: string): Promise<ImportResult> {
    if (!supabase) return pv.importCampaignCreators(rows, source)
    return must(await supabase.rpc('import_history_campaign_creators', { p_rows: rows, p_source: source })) as ImportResult
  },
}
