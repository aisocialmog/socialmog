// Money, dates and periods — India rules: INR with Indian grouping,
// DD MMM YYYY, Asia/Kolkata, financial year 1 April – 31 March.
export const TZ = 'Asia/Kolkata'

const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** ₹1,00,000 — paise shown only when asked or when present. */
export function formatINR(amount: number | string | null | undefined, opts: { paise?: boolean } = {}): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) return '—'
  const withPaise = opts.paise ?? !Number.isInteger(Math.round(n * 100) / 100)
  return (withPaise ? inr2 : inr0).format(n)
}

/** Compact form for hero numbers: ₹4.2L, ₹1.35Cr */
export function formatINRShort(n: number): string {
  const a = Math.abs(n), s = n < 0 ? '−' : ''
  if (a >= 1e7) return `${s}₹${trim(a / 1e7)}Cr`
  if (a >= 1e5) return `${s}₹${trim(a / 1e5)}L`
  if (a >= 1e3) return `${s}₹${trim(a / 1e3)}K`
  return `${s}₹${a}`
}
const trim = (x: number) => x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2).replace(/\.?0+$/, '')

/** A calendar date as YYYY-MM-DD (Postgres `date`) */
export type ISODate = string

/** Today's date in IST, as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** 09 Nov 2026. Accepts YYYY-MM-DD (calendar date) or a timestamp (converted to IST). */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const iso = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : istToday(new Date(value))
  const [y, m, d] = iso.split('-')
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`
}

/** 09 Nov 2026, 4:05 pm (IST) */
export function formatDateTime(value: string | Date): string {
  const d = new Date(value)
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
  return `${formatDate(d)}, ${time.toLowerCase()}`
}

// ─── Periods ────────────────────────────────────────────────
export type PeriodKey =
  | 'this_week' | 'last_week' | 'this_month' | 'last_month'
  | 'this_quarter' | 'last_quarter' | 'this_fy' | 'last_fy' | 'custom'

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_week: 'This week', last_week: 'Last week',
  this_month: 'This month', last_month: 'Last month',
  this_quarter: 'This quarter', last_quarter: 'Last quarter',
  this_fy: 'This financial year', last_fy: 'Last financial year',
  custom: 'Custom range',
}

export interface Range { from: ISODate; to: ISODate }

const toISO = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toISOString().slice(0, 10)
}
const parse = (iso: ISODate) => iso.split('-').map(Number) as [number, number, number]
const addDays = (iso: ISODate, n: number) => { const [y, m, d] = parse(iso); return toISO(y, m, d + n) }

export function fyStart(iso: ISODate): ISODate {
  const [y, m] = parse(iso)
  return toISO(m >= 4 ? y : y - 1, 4, 1)
}
/** 'FY 2026-27' */
export function fyLabel(iso: ISODate): string {
  const y = parse(fyStart(iso))[0]
  return `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

/** Same rules as public.period_bounds() in the database. Weeks are Monday–Sunday. */
export function periodRange(key: PeriodKey, today: ISODate = istToday(), custom?: Range): Range {
  const [y, m, d] = parse(today)
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // Monday = 0
  const weekStart = addDays(today, -dow)
  const fy = fyStart(today)
  const [fyY] = parse(fy)
  const monthsIn = (y - fyY) * 12 + m - 4
  const qStartMonth = 4 + Math.floor(monthsIn / 3) * 3
  switch (key) {
    case 'this_week': return { from: weekStart, to: addDays(weekStart, 6) }
    case 'last_week': return { from: addDays(weekStart, -7), to: addDays(weekStart, -1) }
    case 'this_month': return { from: toISO(y, m, 1), to: toISO(y, m + 1, 0) }
    case 'last_month': return { from: toISO(y, m - 1, 1), to: toISO(y, m, 0) }
    case 'this_quarter': return { from: toISO(fyY, qStartMonth, 1), to: toISO(fyY, qStartMonth + 3, 0) }
    case 'last_quarter': return { from: toISO(fyY, qStartMonth - 3, 1), to: toISO(fyY, qStartMonth, 0) }
    case 'this_fy': return { from: fy, to: toISO(fyY + 1, 3, 31) }
    case 'last_fy': return { from: toISO(fyY - 1, 4, 1), to: toISO(fyY, 3, 31) }
    case 'custom':
      if (!custom || custom.to < custom.from) throw new Error('Custom range needs a start on or before the end')
      return custom
  }
}

export function formatRange(r: Range): string {
  return r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} – ${formatDate(r.to)}`
}
