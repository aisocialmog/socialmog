// Pure helpers for the opening balances wizard (feature 7). No data-module imports.
import type { OpeningTotals } from '../data/opening'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const cents = (n: number) => Math.round(n * 100)

/** Splits an amount by profit share %, paise-exact. Any remainder goes to the first founder. */
export function splitByShare(total: number, founders: { founder_id: string; profit_share_pct: number | null }[]): Record<string, number> {
  const out: Record<string, number> = {}
  if (founders.length === 0) return out
  const totalC = cents(total)
  const shares = founders.map(f => Math.max(0, f.profit_share_pct ?? 0))
  const sum = shares.reduce((a, b) => a + b, 0)
  const weights = sum > 0 ? shares : shares.map(() => 1)
  const wSum = weights.reduce((a, b) => a + b, 0)
  const parts = weights.map(w => Math.trunc((totalC * w) / wSum))
  const rest = totalC - parts.reduce((a, b) => a + b, 0)
  parts[0] += rest
  founders.forEach((f, i) => { out[f.founder_id] = (out[f.founder_id] ?? 0) + parts[i] / 100 })
  for (const k of Object.keys(out)) out[k] = r2(out[k])
  return out
}

export function openingTotals(input: { capital: number; accounts: number; receivables: number; payables: number }): OpeningTotals {
  const capital = r2(input.capital), accounts = r2(input.accounts), receivables = r2(input.receivables), payables = r2(input.payables)
  const net_position = r2(accounts + receivables - payables)
  const difference = r2(net_position - capital)
  return { capital, accounts, receivables, payables, net_position, difference, is_balanced: Math.abs(difference) < 1 }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The calendar day before an ISO date (YYYY-MM-DD). */
export function dayBefore(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - 1)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

const UNITS: Record<string, number> = {
  k: 1e3, l: 1e5, lac: 1e5, lacs: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7,
}

/** "₹1,50,000", "2.5L", "1.2 Cr", "45k" → number. Null for blank / unparseable. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? r2(raw) : null
  if (typeof raw !== 'string') return null
  const s = raw.toLowerCase().replace(/₹|rs\.?|inr/g, '').replace(/,/g, '').trim()
  if (!s) return null
  const m = /^(-?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-z]+)?$/.exec(s)
  if (!m) return null
  let n = Number(m[1])
  if (m[2]) {
    const mult = UNITS[m[2]]
    if (!mult) return null
    n *= mult
  }
  return Number.isFinite(n) ? r2(n) : null
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

function build(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}
const year = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s))

/** Indian day-first dates → YYYY-MM-DD, or null. */
export function parseDateIN(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ')
  if (!s) return null
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})$/.exec(s)
  if (m) return build(year(m[3]), Number(m[2]), Number(m[1]))
  m = /^(\d{1,2})(?:st|nd|rd|th)?[ \-/.]([a-z]+)[ \-/.](\d{4}|\d{2})$/.exec(s)
  if (m && MONTHS[m[2]]) return build(year(m[3]), MONTHS[m[2]], Number(m[1]))
  m = /^([a-z]+)[ \-/.](\d{4})$/.exec(s)
  if (m && MONTHS[m[1]]) return build(Number(m[2]), MONTHS[m[1]], 1)
  return null
}

export type CampaignKind = 'influencer' | 'production' | 'full_marketing_month' | 'ugc'

/** Free text → one of the four campaign kinds (default influencer). */
export function normaliseKind(raw: unknown): CampaignKind {
  const s = typeof raw === 'string' ? raw.toLowerCase() : ''
  if (/\bugc\b|user[- ]generated/.test(s)) return 'ugc'
  if (/full|monthly|month|retainer|always[- ]on/.test(s)) return 'full_marketing_month'
  if (/production|shoot|film|video|photo/.test(s)) return 'production'
  return 'influencer'
}
