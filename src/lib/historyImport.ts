// Pure logic for the history import (opening-balances step 5): field definitions,
// header → field guessing, cleaning/validating rows, and CSV templates.
import type { HistoryBrandRow, HistoryCampaignCreatorRow, HistoryCampaignRow } from '../data/opening'
import { normaliseKind, parseAmount, parseDateIN } from './opening'

export type HistoryType = 'brands' | 'campaigns' | 'campaignCreators'
export interface HistoryField { key: string; label: string; required: boolean; synonyms: string[] }
export interface HistoryProblem { row: number; name: string; problem: string }
export interface HistoryRowMap { brands: HistoryBrandRow; campaigns: HistoryCampaignRow; campaignCreators: HistoryCampaignCreatorRow }
export interface ReviewRow<T> { row: number; name: string; values: Record<string, string>; clean: T | null; problems: string[] }
export interface PreparedHistory<T> { rows: T[]; problems: HistoryProblem[]; review: ReviewRow<T>[] }

const F = (key: string, label: string, required: boolean, synonyms: string[]): HistoryField => ({ key, label, required, synonyms })

export const HISTORY_FIELDS: Record<HistoryType, HistoryField[]> = {
  brands: [
    F('name', 'Brand name', true, ['name', 'brand', 'brand name', 'client', 'client name', 'company', 'company name']),
    F('billing_name', 'Billing / legal name', false, ['billing name', 'legal name', 'company legal name', 'registered name', 'billing legal name']),
    F('industry', 'Industry', false, ['industry', 'category', 'sector', 'vertical']),
    F('city', 'City', false, ['city', 'town', 'location']),
    F('state', 'State', false, ['state']),
    F('gstin', 'GSTIN', false, ['gstin', 'gst', 'gst no', 'gst number', 'gst in']),
    F('website', 'Website', false, ['website', 'web', 'url', 'site']),
    F('instagram_handle', 'Instagram handle', false, ['instagram', 'instagram handle', 'insta', 'ig', 'ig handle']),
    F('contact_name', 'Contact name', false, ['contact name', 'contact', 'contact person', 'poc', 'point of contact']),
    F('contact_email', 'Contact email', false, ['contact email', 'email', 'e-mail', 'email id', 'mail']),
    F('contact_phone', 'Contact phone', false, ['contact phone', 'phone', 'mobile', 'phone number', 'mobile number', 'contact number']),
    F('notes', 'Notes', false, ['notes', 'note', 'remarks', 'comments']),
  ],
  campaigns: [
    F('brand', 'Brand', true, ['brand', 'brand name', 'client', 'client name', 'company']),
    F('name', 'Campaign name', true, ['campaign', 'campaign name', 'name', 'project', 'project name', 'title']),
    F('start_date', 'Start date', false, ['start date', 'start', 'from', 'date', 'campaign date', 'started']),
    F('end_date', 'End date', false, ['end date', 'end', 'to', 'finish date', 'ended']),
    F('kind', 'Kind', false, ['kind', 'type', 'campaign type', 'campaign kind']),
    F('client_fee', 'Client fee', false, ['client fee', 'fee', 'fees', 'amount', 'revenue', 'billing', 'billed', 'contract value', 'client amount', 'budget', 'client budget']),
    F('creator_spend', 'Creator spend', false, ['creator spend', 'creator cost', 'creator costs', 'creator payout', 'creator payouts', 'payout', 'payouts', 'creator fees', 'spend', 'cost']),
    F('notes', 'Notes', false, ['notes', 'note', 'remarks', 'comments']),
  ],
  campaignCreators: [
    F('brand', 'Brand', false, ['brand', 'brand name', 'client', 'client name', 'company']),
    F('campaign', 'Campaign', true, ['campaign', 'campaign name', 'project', 'project name']),
    F('creator', 'Creator', true, ['creator', 'creator name', 'influencer', 'influencer name', 'name']),
    F('fee', 'Fee', false, ['fee', 'fees', 'amount', 'creator fee', 'payout', 'rate', 'price', 'paid']),
  ],
}

export const HISTORY_TYPE_LABEL: Record<HistoryType, string> = {
  brands: 'Old brands', campaigns: 'Past campaigns', campaignCreators: 'Who was on each campaign',
}

const norm = (h: string) => h.toLowerCase().replace(/[_.\-/]+/g, ' ').replace(/\(.*?\)/g, '').replace(/[*:]/g, '').replace(/\s+/g, ' ').trim()

/** For each file column, the key of the field it most likely is ('' = none). Each field is used once. */
export function guessHistoryMapping(headers: string[], fields: HistoryField[]): (string | '')[] {
  const out: (string | '')[] = headers.map(() => '')
  const cols = headers.map(norm)
  for (const f of fields) {
    const names = [norm(f.label), norm(f.key), ...f.synonyms.map(norm)]
    // earlier synonyms win, so "campaign name" beats a bare "name"
    let best = -1, bestRank = Infinity
    cols.forEach((c, i) => {
      if (out[i] || !c) return
      const rank = names.indexOf(c)
      if (rank !== -1 && rank < bestRank) { best = i; bestRank = rank }
    })
    if (best !== -1) out[best] = f.key
  }
  return out
}

const cell = (data: string[], mapping: (string | '')[], key: string) => {
  const i = mapping.indexOf(key)
  return i === -1 ? '' : (data[i] ?? '').trim()
}

/** Cleans every non-empty data row. `row` is the data-row number counted from 1. */
export function prepareHistoryRows<K extends HistoryType>(type: K, rawRows: string[][], mapping: (string | '')[], goLive: string | null): PreparedHistory<HistoryRowMap[K]> {
  const fields = HISTORY_FIELDS[type]
  const rows: HistoryRowMap[K][] = [], problems: HistoryProblem[] = [], review: ReviewRow<HistoryRowMap[K]>[] = []
  rawRows.forEach((data, idx) => {
    if (!data.some(c => c.trim() !== '')) return
    const row = idx + 1
    const v: Record<string, string> = {}
    const probs: string[] = []
    for (const f of fields) {
      let val = cell(data, mapping, f.key)
      if (val && (f.key === 'start_date' || f.key === 'end_date')) {
        const d = parseDateIN(val)
        if (d) val = d
        else { probs.push(`${f.label} “${val}” isn’t a date we can read`); val = '' }
      } else if (val && (f.key === 'client_fee' || f.key === 'creator_spend' || f.key === 'fee')) {
        const n = parseAmount(val)
        if (n !== null) val = String(n)
        else { probs.push(`${f.label} “${val}” isn’t an amount we can read`); val = '' }
      } else if (val && f.key === 'kind') {
        const k: unknown = normaliseKind(val)
        val = typeof k === 'string' ? k : ''
      }
      v[f.key] = val
      if (f.required && !val && !probs.some(p => p.startsWith(f.label))) probs.push(`${f.label} is missing`)
    }
    if (type === 'campaigns' && goLive && v.start_date && v.start_date >= goLive) probs.push('Starts on or after go-live — add it as a normal campaign')
    const name = (type === 'campaignCreators' ? [v.creator, v.campaign].filter(Boolean).join(' on ') : type === 'campaigns' ? v.name : v.name) || `Row ${row}`
    const opt = (k: string) => (v[k] ? { [k]: v[k] } : {})
    let clean: HistoryRowMap[K] | null = null
    if (!probs.length) {
      if (type === 'brands') {
        const r: HistoryBrandRow = { name: v.name, ...opt('billing_name'), ...opt('industry'), ...opt('city'), ...opt('state'), ...opt('gstin'), ...opt('website'),
          ...opt('instagram_handle'), ...opt('contact_name'), ...opt('contact_email'), ...opt('contact_phone'), ...opt('notes') }
        clean = r as HistoryRowMap[K]
      } else if (type === 'campaigns') {
        const r: HistoryCampaignRow = { brand: v.brand, name: v.name, ...opt('start_date'), ...opt('end_date'), ...opt('kind'), ...opt('client_fee'), ...opt('creator_spend'), ...opt('notes') }
        clean = r as HistoryRowMap[K]
      } else {
        const r: HistoryCampaignCreatorRow = { campaign: v.campaign, creator: v.creator, ...opt('brand'), ...opt('fee') }
        clean = r as HistoryRowMap[K]
      }
      rows.push(clean)
    }
    for (const problem of probs) problems.push({ row, name, problem })
    review.push({ row, name, values: v, clean, problems: probs })
  })
  return { rows, problems, review }
}

export interface HistoryTemplate { filename: string; headers: string[]; example: string[] }
export function historyTemplate(type: HistoryType): HistoryTemplate {
  const fields = HISTORY_FIELDS[type]
  const examples: Record<HistoryType, Record<string, string>> = {
    brands: { name: 'Chai Sutra', billing_name: 'Chai Sutra Beverages Pvt. Ltd.', industry: 'Beverages', city: 'Mumbai', state: 'Maharashtra', gstin: '27AAACC1234D1ZC', website: 'https://chaisutra.example',
      instagram_handle: '@chaisutra', contact_name: 'Priya Nair', contact_email: 'priya@chaisutra.example', contact_phone: '+91 98200 11111', notes: 'Example row — delete me' },
    campaigns: { brand: 'Chai Sutra', name: 'Monsoon Masala Reels', start_date: '15/07/2025', end_date: '30/08/2025', kind: 'Campaign', client_fee: '₹1,50,000', creator_spend: '₹90,000', notes: 'Example row — delete me' },
    campaignCreators: { brand: 'Chai Sutra', campaign: 'Monsoon Masala Reels', creator: 'Aarohi Sinha', fee: '30000' },
  }
  return {
    filename: `history-${type === 'brands' ? 'brands' : type === 'campaigns' ? 'campaigns' : 'campaign-creators'}-template.csv`,
    headers: fields.map(f => f.label + (f.required ? ' *' : '')),
    example: fields.map(f => examples[type][f.key] ?? ''),
  }
}
