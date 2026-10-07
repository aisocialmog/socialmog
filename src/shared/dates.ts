/**
 * Calendar dates are stored as 'YYYY-MM-DD' strings in the agency timezone (default Asia/Kolkata).
 * Timestamps are stored as ISO-8601 UTC strings. Date arithmetic on calendar dates uses UTC
 * midnight internally so it is never affected by the server's local timezone or DST.
 */
export const DEFAULT_TZ = 'Asia/Kolkata';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The calendar date "today" in the given timezone. */
export function todayInTz(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return dateInTz(now, tz);
}

export function dateInTz(instant: Date | string, tz: string = DEFAULT_TZ): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Hour/minute/weekday for an instant in a timezone (weekday: 0=Sunday). */
export function partsInTz(instant: Date, tz: string = DEFAULT_TZ): { date: string; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: dateInTz(instant, tz),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: weekdays.indexOf(parts.weekday),
  };
}

function toUtc(date: string): Date {
  if (!isIsoDate(date)) throw new Error(`Invalid date: ${date}`);
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = toUtc(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** ISO weekday 1=Monday..7=Sunday */
export function isoWeekday(date: string): number {
  const wd = toUtc(date).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Monday of the week containing date. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function weekEnd(date: string): string {
  return addDays(weekStart(date), 6);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Indian financial year (April–March) start for a date. */
export function financialYearStart(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-07' -> '7 Oct 2026' */
export function formatDate(date: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!date) return '—';
  const d = date.slice(0, 10);
  if (!isIsoDate(d)) return date;
  const [y, m, day] = d.split('-').map(Number);
  return opts.year === false ? `${day} ${MONTHS[m - 1]}` : `${day} ${MONTHS[m - 1]} ${y}`;
}

/** Timestamp displayed in agency timezone: '7 Oct 2026, 09:05 IST' */
export function formatDateTime(iso: string | null | undefined, tz: string = DEFAULT_TZ): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = dateInTz(d, tz);
  const p = partsInTz(d, tz);
  const label = tz === 'Asia/Kolkata' ? 'IST' : tz;
  return `${formatDate(date)}, ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} ${label}`;
}

export function formatPeriod(from: string, to: string): string {
  return `${formatDate(from)} – ${formatDate(to)}`;
}

