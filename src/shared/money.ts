/**
 * Money is stored and calculated as integer paise (1 INR = 100 paise).
 * Never use floating point rupees for arithmetic; convert at the edges only.
 */
export type Paise = number;

export class MoneyError extends Error {}

export function assertPaise(value: unknown, label = 'amount'): Paise {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a whole number of paise`);
  }
  return value;
}

/**
 * Parse user input in rupees ("1,00,000", "₹ 2,500.50", "1234.5", 1234.5) into paise.
 * Rejects more than two decimal places instead of silently rounding.
 */
export function rupeesToPaise(input: string | number): Paise {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyError('Amount is not a number');
    const scaled = input * 100;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > 1e-6) throw new MoneyError('Amount can have at most two decimal places');
    if (!Number.isSafeInteger(rounded)) throw new MoneyError('Amount is too large');
    return rounded === 0 ? 0 : rounded;
  }
  const cleaned = String(input).replace(/[₹,\s]/g, '').replace(/^Rs\.?/i, '').replace(/^INR/i, '');
  if (cleaned === '') throw new MoneyError('Amount is required');
  const m = /^(-)?(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!m) {
    if (/^-?\d+\.\d{3,}$/.test(cleaned)) throw new MoneyError('Amount can have at most two decimal places');
    throw new MoneyError(`"${input}" is not a valid amount`);
  }
  const sign = m[1] ? -1 : 1;
  const whole = BigInt(m[2]);
  const frac = BigInt((m[3] ?? '').padEnd(2, '0') || '0');
  const total = whole * 100n + frac;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyError('Amount is too large');
  const result = Number(total) * sign;
  return result === 0 ? 0 : result;
}

/** Plain decimal string in rupees, e.g. 10000050 -> "100000.50" (for inputs and CSV). */
export function paiseToRupeesString(p: Paise): string {
  assertPaise(p);
  const neg = p < 0;
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${neg ? '-' : ''}${whole}.${String(frac).padStart(2, '0')}`;
}

/** Indian digit grouping for a non-negative integer string: 1234567 -> 12,34,567 */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(',')},${last3}`;
}

export interface FormatOptions {
  /** 'auto' shows paise only when non-zero. */
  decimals?: 'auto' | 0 | 2;
  /** Use lakh / crore abbreviations (₹1.25L, ₹3.4Cr). */
  compact?: boolean;
  /** Prefix positive numbers with + */
  signed?: boolean;
  symbol?: boolean;
}

/** Format paise as INR with Indian grouping: 10000000 -> "₹1,00,000". */
export function formatINR(p: Paise | null | undefined, opts: FormatOptions = {}): string {
  if (p === null || p === undefined || Number.isNaN(p)) return '—';
  const { decimals = 'auto', compact = false, signed = false, symbol = true } = opts;
  const neg = p < 0;
  const abs = Math.abs(Math.round(p));
  const sym = symbol ? '₹' : '';
  const sign = neg ? '-' : signed && abs > 0 ? '+' : '';
  if (compact) {
    const rupees = abs / 100;
    if (rupees >= 1_00_00_000) return `${sign}${sym}${trimZeros((rupees / 1_00_00_000).toFixed(2))}Cr`;
    if (rupees >= 1_00_000) return `${sign}${sym}${trimZeros((rupees / 1_00_000).toFixed(2))}L`;
    if (rupees >= 1_000) return `${sign}${sym}${trimZeros((rupees / 1_000).toFixed(1))}K`;
  }
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const showFrac = decimals === 2 || (decimals === 'auto' && frac !== 0);
  const body = groupIndian(String(whole)) + (showFrac ? `.${String(frac).padStart(2, '0')}` : '');
  return `${sign}${sym}${body}`;
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Format a plain number with Indian grouping (followers, views). */
export function formatNumberIN(n: number | null | undefined, opts: { compact?: boolean; decimals?: number } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (opts.compact) {
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1_00_00_000) return `${sign}${trimZeros((abs / 1_00_00_000).toFixed(2))}Cr`;
    if (abs >= 1_00_000) return `${sign}${trimZeros((abs / 1_00_000).toFixed(2))}L`;
    if (abs >= 1_000) return `${sign}${trimZeros((abs / 1_000).toFixed(1))}K`;
  }
  const d = opts.decimals ?? 0;
  const fixed = Math.abs(n).toFixed(d);
  const [w, f] = fixed.split('.');
  return `${n < 0 ? '-' : ''}${groupIndian(w)}${f ? `.${f}` : ''}`;
}

/** Round half away from zero for BigInt division. */
function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  const away = twice >= (d < 0n ? -d : d);
  if (!away) return q;
  return (n < 0n) !== (d < 0n) ? q - 1n : q + 1n;
}

/** amount * basisPoints / 10000, rounded half away from zero. 1850 bps = 18.5% */
export function applyBps(amount: Paise, bps: number): Paise {
  assertPaise(amount);
  if (!Number.isInteger(bps)) throw new MoneyError('Rate must be in whole basis points');
  return Number(divRound(BigInt(amount) * BigInt(bps), 10000n));
}

/** Ratio of two paise values in basis points (e.g. margin %). Returns null when the base is zero. */
export function ratioBps(part: Paise, whole: Paise): number | null {
  if (whole === 0) return null;
  return Number(divRound(BigInt(part) * 10000n, BigInt(whole)));
}

/**
 * Split a total into parts proportional to weights using the largest-remainder method,
 * so the parts always sum exactly to the total.
 */
export function splitProportional(total: Paise, weights: number[]): Paise[] {
  assertPaise(total);
  if (weights.length === 0) return [];
  const wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum <= 0) {
    const out = weights.map(() => 0);
    out[0] = total;
    return out;
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / wsum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors.map((f) => f * sign);
}

