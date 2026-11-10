// In-memory stand-in used ONLY by the local design preview (no Supabase).
// Mirrors the rules in supabase/migrations/20261115000100_opening_balances.sql.
import { openingTotals, splitByShare } from '../lib/opening'
import type {
  CapitalRowInput, HistoryBrandRow, HistoryCampaignCreatorRow, HistoryCampaignRow, ImportResult, OpeningAccount, OpeningFounder,
  OpeningInvoiceInput, OpeningPayable, OpeningPayoutInput, OpeningReceivable, OpeningState,
} from './opening'

const ME = '00000000-0000-0000-0000-000000000000'
const LOCKED = 'Opening balances are locked — unlock them first'
const delay = <V,>(v: V) => new Promise<V>(r => setTimeout(() => r(structuredClone(v)), 70))
const uid = () => crypto.randomUUID()
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const BRANDS: Record<string, string> = { b1: 'Chai Sutra (sample)', b2: 'Neelam Naturals (sample)' }
const CREATORS: Record<string, string> = { c1: 'Aarohi Sinha (sample)', c3: 'Sana Qureshi (sample)' }
const VENDORS: Record<string, string> = { v1: 'Lens & Light Studio', v2: 'Farid (freelance editor)' }
const KNOWN_CREATORS = ['Aarohi Sinha (sample)', 'Kabir Menon (sample)', 'Sana Qureshi (sample)', 'Meenal Jha (sample)']

interface Founder { id: string; name: string; pct: number }
interface CapEntry { id: string; founder_id: string | null; part: 'accumulated_profit' | 'founder_money' | 'adjustment'; amount: number; note: string }
interface Invoice extends OpeningInvoiceInput { id: string }
interface Payout extends OpeningPayoutInput { id: string }

const founders: Founder[] = [{ id: ME, name: '[Founder 1 name]', pct: 50 }, { id: 'f2', name: '[Founder 2 name]', pct: 50 }]
let goLive: string | null = null
let lockedAt: string | null = null
let lockedBy: string | null = null
let capital: CapEntry[] = []
const accounts: { account_id: string; name: string; kind: OpeningAccount['kind']; opening_balance: number }[] = [
  { account_id: 'a1', name: 'HDFC Current', kind: 'bank', opening_balance: 0 },
  { account_id: 'a2', name: 'Founder 1 UPI', kind: 'upi', opening_balance: 0 },
  { account_id: 'a3', name: 'Petty cash', kind: 'cash', opening_balance: 0 },
]
let invoices: Invoice[] = []
let payouts: Payout[] = []
const importedBrands = new Set<string>()
const importedCampaigns: { brand: string; name: string }[] = []
const importedCreatorLinks = new Set<string>()

const assertOpen = (needDate = true): string | null => {
  if (lockedAt) throw new Error(LOCKED)
  if (needDate && !goLive) throw new Error('Set the go-live date first')
  return goLive
}
const guard = <T,>(fn: () => T): Promise<T> => { try { return Promise.resolve(fn()) } catch (e) { return Promise.reject(e) } }

function snapshot(): OpeningState {
  const split = founders.map(f => ({ founder_id: f.id, profit_share_pct: f.pct }))
  const other: Record<string, number> = Object.fromEntries(founders.map(f => [f.id, 0]))
  for (const c of capital) {
    if (c.part !== 'adjustment') continue
    const parts = c.founder_id ? { [c.founder_id]: c.amount } : splitByShare(c.amount, split)
    for (const k of Object.keys(parts)) other[k] = r2((other[k] ?? 0) + parts[k])
  }
  const sumPart = (id: string, part: CapEntry['part']) => r2(capital.filter(c => c.founder_id === id && c.part === part).reduce((a, c) => a + c.amount, 0))
  const fs: OpeningFounder[] = [...founders].sort((a, b) => a.name.localeCompare(b.name)).map(f => {
    const accumulated_profit = sumPart(f.id, 'accumulated_profit'), own_money = sumPart(f.id, 'founder_money')
    return { founder_id: f.id, name: f.name, profit_share_pct: f.pct, accumulated_profit, own_money, other: other[f.id], total: r2(accumulated_profit + own_money + other[f.id]) }
  })
  const receivables: OpeningReceivable[] = [...invoices].sort((a, b) => a.issue_date.localeCompare(b.issue_date)).map(i => ({
    invoice_id: i.id, invoice_number: i.invoice_number, brand_id: i.brand_id, brand_name: BRANDS[i.brand_id] ?? 'Brand',
    issue_date: i.issue_date, due_date: i.due_date ?? i.issue_date, amount: i.amount, outstanding: i.amount,
  }))
  const payables: OpeningPayable[] = payouts.map(p => ({
    payout_id: p.id, payee_name: p.creator_id ? CREATORS[p.creator_id] ?? 'Creator' : VENDORS[p.vendor_id ?? ''] ?? 'Freelancer',
    payee_kind: p.creator_id ? 'creator' : 'freelancer', creator_id: p.creator_id, vendor_id: p.vendor_id,
    description: p.description ?? 'Opening balance — due from before go-live', due_date: p.due_date, amount: p.amount, tds_rate: p.tds_rate, status: 'pending',
  }))
  return {
    go_live_date: goLive, locked_at: lockedAt, locked_by_name: lockedBy,
    founders: fs,
    adjustments: capital.filter(c => c.part === 'adjustment').map(c => ({ id: c.id, amount: c.amount, note: c.note })),
    accounts: accounts.map(a => ({ account_id: a.account_id, name: a.name, kind: a.kind, opening_balance: a.opening_balance, opening_date: goLive ?? '' })),
    receivables, payables,
    totals: openingTotals({
      capital: capital.reduce((a, c) => a + c.amount, 0),
      accounts: accounts.reduce((a, c) => a + c.opening_balance, 0),
      receivables: receivables.reduce((a, c) => a + c.amount, 0),
      payables: payables.reduce((a, c) => a + c.amount, 0),
    }),
  }
}

const emptyResult = (): ImportResult => ({ created: 0, skipped: 0, errors: [] })
const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase()

export const openingPreview = {
  state: (): Promise<OpeningState> => delay(snapshot()),

  setGoLive: (date: string): Promise<void> => guard(() => {
    assertOpen(false)
    if (!date) throw new Error('Pick a go-live date')
    if (invoices.some(i => i.issue_date >= date)) throw new Error('An opening invoice is dated on or after that day — change or remove it first')
    goLive = date
  }),

  saveCapital: (rows: CapitalRowInput[]): Promise<void> => guard(() => {
    assertOpen()
    // validate first so a refused save leaves the old rows in place
    for (const r of rows) if ((r.accumulated_profit ?? 0) < 0 || (r.own_money ?? 0) < 0) throw new Error('Amounts can’t be negative — use an opening adjustment for a loss')
    capital = capital.filter(c => c.part === 'adjustment')
    for (const r of rows) {
      if (r.accumulated_profit > 0) capital.push({ id: uid(), founder_id: r.founder_id, part: 'accumulated_profit', amount: r2(r.accumulated_profit), note: 'Share of profit made before go-live' })
      if (r.own_money > 0) capital.push({ id: uid(), founder_id: r.founder_id, part: 'founder_money', amount: r2(r.own_money), note: 'Founder’s own money put in before go-live' })
    }
  }),

  setBalances: (rows: { account_id: string; balance: number }[]): Promise<void> => guard(() => {
    assertOpen()
    for (const r of rows) {
      const a = accounts.find(x => x.account_id === r.account_id)
      if (a) a.opening_balance = r2(r.balance ?? 0)
    }
  }),

  addAdjustment: (amount: number, note: string): Promise<void> => guard(() => {
    assertOpen()
    if (!amount) throw new Error('The adjustment can’t be zero')
    if (!note || !note.trim()) throw new Error('Add a note saying what the adjustment is for')
    capital.push({ id: uid(), founder_id: null, part: 'adjustment', amount: r2(amount), note: note.trim() })
  }),

  addInvoice: (i: OpeningInvoiceInput): Promise<void> => guard(() => {
    const live = assertOpen()!
    if (!(i.amount > 0)) throw new Error('Enter the amount still owed')
    if (!i.invoice_number || !i.invoice_number.trim()) throw new Error('Give the old invoice its original number')
    if (!i.issue_date || i.issue_date >= live) throw new Error(`An opening invoice is dated before go-live (${live})`)
    invoices.push({ ...i, invoice_number: i.invoice_number.trim(), id: uid(), due_date: i.due_date ?? i.issue_date })
  }),

  addPayout: (p: OpeningPayoutInput): Promise<void> => guard(() => {
    assertOpen()
    if (!(p.amount > 0)) throw new Error('Enter the amount still owed')
    payouts.push({ ...p, id: uid(), tds_rate: p.tds_rate ?? 0 })
  }),

  remove: (kind: 'invoice' | 'payout' | 'adjustment', id: string): Promise<void> => guard(() => {
    assertOpen()
    if (kind === 'invoice') invoices = invoices.filter(x => x.id !== id)
    else if (kind === 'payout') payouts = payouts.filter(x => x.id !== id)
    else if (kind === 'adjustment') capital = capital.filter(x => !(x.id === id && x.part === 'adjustment'))
    else throw new Error(`Unknown kind ${String(kind)}`)
  }),

  lock: (): Promise<void> => guard(() => {
    assertOpen()
    const t = snapshot().totals
    if (Math.abs(t.difference) >= 1) {
      throw new Error(`The opening balances are ₹${Math.abs(t.difference).toLocaleString('en-IN')} apart — fix them or add an opening adjustment first`)
    }
    lockedAt = new Date().toISOString()
    lockedBy = founders[0].name
  }),

  unlock: (email: string, password: string): Promise<void> => guard(() => {
    void email
    if (!password || password === 'wrong') throw new Error('That password isn’t right.')
    lockedAt = null
    lockedBy = null
  }),

  importBrands: (rows: HistoryBrandRow[], source: string): Promise<ImportResult> => guard(() => {
    void source
    const res = emptyResult()
    rows.forEach((r, idx) => {
      const row = idx + 1, name = (r.name ?? '').trim()
      if (!name) { res.errors.push({ row, name: '', problem: 'No brand name' }); return }
      const key = name.toLowerCase()
      if (importedBrands.has(key) || Object.values(BRANDS).some(b => b.toLowerCase() === key)) { res.skipped++; return }
      const gstin = (r.gstin ?? '').trim().toUpperCase()
      if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) res.errors.push({ row, name, problem: 'GSTIN doesn’t look right — imported without it' })
      importedBrands.add(key)
      res.created++
    })
    return res
  }),

  importCampaigns: (rows: HistoryCampaignRow[], source: string): Promise<ImportResult> => guard(() => {
    void source
    const res = emptyResult()
    rows.forEach((r, idx) => {
      const row = idx + 1, name = (r.name ?? '').trim()
      if (!name) { res.errors.push({ row, name: '', problem: 'No campaign name' }); return }
      const brand = norm(r.brand)
      const known = importedBrands.has(brand) || Object.values(BRANDS).some(b => b.toLowerCase() === brand)
      if (!known) { res.errors.push({ row, name, problem: `Brand “${r.brand ?? ''}” not found — import the brand first` }); return }
      if (importedCampaigns.some(c => c.brand === brand && c.name === name.toLowerCase())) { res.skipped++; return }
      const first = (r.start_date ?? '').trim() || (r.end_date ?? '').trim()
      if (goLive && first && first >= goLive) { res.errors.push({ row, name, problem: 'Starts on or after go-live — add it as a normal campaign' }); return }
      importedCampaigns.push({ brand, name: name.toLowerCase() })
      res.created++
    })
    return res
  }),

  importCampaignCreators: (rows: HistoryCampaignCreatorRow[], source: string): Promise<ImportResult> => guard(() => {
    void source
    const res = emptyResult()
    rows.forEach((r, idx) => {
      const row = idx + 1, creator = (r.creator ?? '').trim()
      const camp = importedCampaigns.find(c => c.name === norm(r.campaign) && (!norm(r.brand) || c.brand === norm(r.brand)))
      if (!camp) { res.errors.push({ row, name: creator, problem: `Past campaign “${r.campaign ?? ''}” not found — import the campaigns first` }); return }
      if (!KNOWN_CREATORS.some(c => c.toLowerCase() === creator.toLowerCase())) { res.errors.push({ row, name: creator, problem: `Creator “${creator}” not found — import creators first` }); return }
      const key = `${camp.brand}|${camp.name}|${creator.toLowerCase()}`
      if (importedCreatorLinks.has(key)) { res.skipped++; return }
      importedCreatorLinks.add(key)
      res.created++
    })
    return res
  }),
}
