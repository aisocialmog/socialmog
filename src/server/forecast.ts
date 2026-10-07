/**
 * Cash forecast engine. Pure function of its inputs, no database access, so every
 * scenario is reproducible and testable. All amounts are integer paise.
 */
import { addDays, diffDays, formatDate } from '../shared/dates.ts';
import { formatINR, type Paise } from '../shared/money.ts';

export type Confidence = 'confirmed' | 'expected' | 'at_risk' | 'delayed';

export interface FcReceivable {
  id: number;
  label: string;
  amount: Paise; // outstanding
  expectedDate: string;
  confidence: Confidence;
  campaignId?: number | null;
}

export interface FcObligation {
  id: number;
  label: string;
  amount: Paise; // outstanding
  dueDate: string;
  status: string; // planned | committed | approved | on_hold
  priority?: 'critical' | 'high' | 'normal' | 'low';
  campaignId?: number | null;
  projected?: boolean; // future occurrence of a recurring expense
}

export interface Scenario {
  name: 'base' | 'conservative' | 'custom';
  include: Confidence[];
  receiptDelayDays: number;
  overdueReceiptDays: number;
  includePlanned: boolean;
  includeOnHold: boolean;
  sameDay: 'inflows_first' | 'outflows_first';
  protectReserves: boolean;
  receivableOverrides?: Record<number, { exclude?: boolean; delayDays?: number }>;
  obligationOverrides?: Record<number, { exclude?: boolean; date?: string }>;
}

export const SCENARIOS: Record<'base' | 'conservative', Scenario> = {
  base: {
    name: 'base',
    include: ['confirmed', 'expected', 'delayed'],
    receiptDelayDays: 0,
    overdueReceiptDays: 7,
    includePlanned: true,
    includeOnHold: false,
    sameDay: 'inflows_first',
    protectReserves: false,
  },
  conservative: {
    name: 'conservative',
    include: ['confirmed', 'delayed'],
    receiptDelayDays: 14,
    overdueReceiptDays: 30,
    includePlanned: true,
    includeOnHold: true,
    sameDay: 'outflows_first',
    protectReserves: true,
  },
};

export interface ExtraEvent {
  label: string;
  date: string;
  amount: Paise;
  direction: 'in' | 'out';
  kind: 'purchase' | 'manual';
}

export interface ForecastInput {
  today: string;
  horizonDays: number;
  openingCash: Paise;
  receivables: FcReceivable[];
  obligations: FcObligation[];
  reserves: { label: string; amount: Paise; protected: boolean }[];
  scenario: Scenario;
  extra?: ExtraEvent[];
}

export interface FcEvent {
  date: string;
  direction: 'in' | 'out';
  source: 'receivable' | 'obligation' | 'purchase' | 'manual';
  sourceId: number | null;
  label: string;
  amount: Paise;
  originalDate?: string;
  note?: string;
  balanceBefore: Paise;
  balanceAfter: Paise;
  /** Outflows only: can it be paid in full on the date without dipping below the floor? */
  payable?: 'yes' | 'partial' | 'no';
  shortBy?: Paise;
  projected?: boolean;
}

export interface ForecastResult {
  today: string;
  horizonEnd: string;
  scenario: Scenario;
  openingCash: Paise;
  floor: Paise;
  assumptions: string[];
  events: FcEvent[];
  daily: { date: string; inflow: Paise; outflow: Paise; closing: Paise }[];
  excluded: { source: string; id: number; label: string; amount: Paise; reason: string }[];
  totals: { inflows: Paise; outflows: Paise; closing: Paise };
  minBalance: Paise;
  minBalanceDate: string;
  earliestShortfall: { date: string; label: string; balanceAfter: Paise } | null;
  recoveryDate: string | null;
  fundingRequired: Paise;
  affected: FcEvent[];
}

const PRIORITY: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export function forecast(input: ForecastInput): ForecastResult {
  const { today, scenario: sc } = input;
  const horizonEnd = addDays(today, input.horizonDays);
  const floor = sc.protectReserves ? input.reserves.filter((r) => r.protected).reduce((a, r) => a + r.amount, 0) : 0;
  const excluded: ForecastResult['excluded'] = [];
  const planned: Omit<FcEvent, 'balanceBefore' | 'balanceAfter'>[] = [];

  for (const r of input.receivables) {
    if (r.amount <= 0) continue;
    const ov = sc.receivableOverrides?.[r.id];
    if (ov?.exclude) {
      excluded.push({ source: 'receivable', id: r.id, label: r.label, amount: r.amount, reason: 'Excluded in this scenario' });
      continue;
    }
    if (!sc.include.includes(r.confidence)) {
      excluded.push({ source: 'receivable', id: r.id, label: r.label, amount: r.amount, reason: `Confidence "${r.confidence.replace('_', ' ')}" not counted` });
      continue;
    }
    let date = r.expectedDate;
    let note: string | undefined;
    if (date < today) {
      date = addDays(today, sc.overdueReceiptDays);
      note = `Overdue since ${formatDate(r.expectedDate)}; assumed ${sc.overdueReceiptDays} days from today`;
    }
    const delay = sc.receiptDelayDays + (ov?.delayDays ?? 0);
    if (delay) {
      date = addDays(date, delay);
      note = [note, `delayed ${delay} days`].filter(Boolean).join('; ');
    }
    if (date > horizonEnd) {
      excluded.push({ source: 'receivable', id: r.id, label: r.label, amount: r.amount, reason: `Expected ${formatDate(date)}, after the forecast window` });
      continue;
    }
    planned.push({ date, direction: 'in', source: 'receivable', sourceId: r.id, label: r.label, amount: r.amount, originalDate: r.expectedDate, note });
  }

  for (const o of input.obligations) {
    if (o.amount <= 0) continue;
    const ov = sc.obligationOverrides?.[o.id];
    if (ov?.exclude) {
      excluded.push({ source: 'obligation', id: o.id, label: o.label, amount: o.amount, reason: 'Excluded in this scenario' });
      continue;
    }
    if (o.status === 'planned' && !sc.includePlanned) {
      excluded.push({ source: 'obligation', id: o.id, label: o.label, amount: o.amount, reason: 'Planned (not committed) costs not counted' });
      continue;
    }
    if (o.status === 'on_hold' && !sc.includeOnHold) {
      excluded.push({ source: 'obligation', id: o.id, label: o.label, amount: o.amount, reason: 'On hold' });
      continue;
    }
    let date = ov?.date ?? o.dueDate;
    let note: string | undefined;
    if (date < today) {
      note = `Overdue since ${formatDate(date)}; treated as due today`;
      date = today;
    }
    if (date > horizonEnd) {
      excluded.push({ source: 'obligation', id: o.id, label: o.label, amount: o.amount, reason: `Due ${formatDate(date)}, after the forecast window` });
      continue;
    }
    planned.push({ date, direction: 'out', source: 'obligation', sourceId: o.id, label: o.label, amount: o.amount, originalDate: o.dueDate, note, projected: o.projected });
  }

  for (const x of input.extra ?? []) {
    const date = x.date < today ? today : x.date;
    planned.push({ date, direction: x.direction, source: x.kind, sourceId: null, label: x.label, amount: x.amount });
  }

  const dirOrder = (d: 'in' | 'out') => (sc.sameDay === 'inflows_first' ? (d === 'in' ? 0 : 1) : d === 'out' ? 0 : 1);
  const prio = (e: (typeof planned)[number]) =>
    e.source === 'obligation' ? PRIORITY[input.obligations.find((o) => o.id === e.sourceId)?.priority ?? 'normal'] : 2;
  planned.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      dirOrder(a.direction) - dirOrder(b.direction) ||
      prio(a) - prio(b) ||
      (a.sourceId ?? 0) - (b.sourceId ?? 0),
  );

  let balance = input.openingCash;
  let minBalance = balance;
  let minBalanceDate = today;
  let earliestShortfall: ForecastResult['earliestShortfall'] = balance < floor ? { date: today, label: 'Opening balance', balanceAfter: balance } : null;
  const events: FcEvent[] = [];
  for (const p of planned) {
    const before = balance;
    const ev: FcEvent = { ...p, balanceBefore: before, balanceAfter: before };
    if (p.direction === 'in') {
      balance += p.amount;
    } else {
      const available = before - floor;
      ev.payable = available >= p.amount ? 'yes' : available > 0 ? 'partial' : 'no';
      ev.shortBy = Math.max(0, p.amount - Math.max(0, available));
      balance -= p.amount;
    }
    ev.balanceAfter = balance;
    if (balance < minBalance) {
      minBalance = balance;
      minBalanceDate = p.date;
    }
    if (!earliestShortfall && balance < floor) earliestShortfall = { date: p.date, label: p.label, balanceAfter: balance };
    events.push(ev);
  }

  // First date after the shortfall on which the closing balance is back at or above the floor.
  let recoveryDate: string | null = null;
  const daily: ForecastResult['daily'] = [];
  let running = input.openingCash;
  for (let d = today, i = 0; d <= horizonEnd; d = addDays(d, 1)) {
    let inflow = 0;
    let outflow = 0;
    while (i < events.length && events[i].date === d) {
      if (events[i].direction === 'in') inflow += events[i].amount;
      else outflow += events[i].amount;
      i++;
    }
    running += inflow - outflow;
    daily.push({ date: d, inflow, outflow, closing: running });
    if (earliestShortfall && !recoveryDate && d >= earliestShortfall.date && running >= floor) recoveryDate = d;
  }

  const inflows = events.filter((e) => e.direction === 'in').reduce((a, e) => a + e.amount, 0);
  const outflows = events.filter((e) => e.direction === 'out').reduce((a, e) => a + e.amount, 0);

  return {
    today,
    horizonEnd,
    scenario: sc,
    openingCash: input.openingCash,
    floor,
    assumptions: describeScenario(sc, floor, input.horizonDays),
    events,
    daily,
    excluded,
    totals: { inflows, outflows, closing: balance },
    minBalance,
    minBalanceDate,
    earliestShortfall,
    recoveryDate,
    fundingRequired: Math.max(0, floor - minBalance),
    affected: events.filter((e) => e.direction === 'out' && e.payable !== 'yes'),
  };
}

export function describeScenario(sc: Scenario, floor: Paise, horizonDays: number): string[] {
  const out = [
    `Window: next ${horizonDays} days. Opening balance is actual cash across active accounts today.`,
    `Incoming payments counted: ${sc.include.map((c) => c.replace('_', ' ')).join(', ')}. Others are listed as excluded.`,
    sc.receiptDelayDays ? `Every counted receipt is assumed to arrive ${sc.receiptDelayDays} days after its expected date.` : 'Receipts are assumed to arrive on their expected dates.',
    `Overdue receivables are assumed to arrive ${sc.overdueReceiptDays} days from today.`,
    'Overdue payables are treated as due today.',
    `Planned (uncommitted) costs ${sc.includePlanned ? 'are' : 'are not'} counted; on-hold payables ${sc.includeOnHold ? 'are' : 'are not'} counted.`,
    `On the same day, ${sc.sameDay === 'inflows_first' ? 'incoming money is applied before payments' : 'payments go out before incoming money lands'}.`,
    sc.protectReserves && floor > 0 ? `Protected reserves of ${formatINR(floor)} are treated as untouchable.` : 'Reserves are not treated as untouchable.',
    'Recurring expenses are projected forward from their last scheduled occurrence.',
    'Pipeline deals that are not yet won are not included.',
  ];
  const ro = Object.entries(sc.receivableOverrides ?? {}).filter(([, v]) => v.exclude || v.delayDays);
  if (ro.length) out.push(`${ro.length} incoming payment(s) manually delayed or excluded.`);
  return out;
}

export interface PurchaseCheck {
  purchase: ExtraEvent;
  without: ForecastResult;
  with: ForecastResult;
  safe: boolean;
  newlyAffected: FcEvent[];
  warning: string | null;
}

/** "Can we afford this purchase?" — compares the forecast with and without it. */
export function simulatePurchase(input: ForecastInput, purchase: { label: string; amount: Paise; date: string }): PurchaseCheck {
  const ev: ExtraEvent = { ...purchase, direction: 'out', kind: 'purchase' };
  const without = forecast(input);
  const withP = forecast({ ...input, extra: [...(input.extra ?? []), ev] });
  const key = (e: FcEvent) => `${e.source}:${e.sourceId}:${e.date}`;
  const before = new Map(without.affected.map((e) => [key(e), e]));
  const newlyAffected = withP.affected.filter((e) => e.source !== 'purchase' && (!before.has(key(e)) || (before.get(key(e))!.shortBy ?? 0) < (e.shortBy ?? 0)));
  const purchaseEvent = withP.events.find((e) => e.source === 'purchase')!;
  const worse = withP.fundingRequired > without.fundingRequired;
  const safe = !worse && purchaseEvent.payable === 'yes';
  let warning: string | null = null;
  if (!safe) {
    const parts: string[] = [];
    if (purchaseEvent.payable !== 'yes') {
      parts.push(`On ${formatDate(purchaseEvent.date)} only ${formatINR(Math.max(0, purchaseEvent.balanceBefore - withP.floor))} is available for this ${formatINR(purchase.amount)} purchase.`);
    }
    if (withP.earliestShortfall) {
      parts.push(`Cash first falls below ${withP.floor ? 'the protected reserve' : 'zero'} on ${formatDate(withP.earliestShortfall.date)} (${withP.earliestShortfall.label}).`);
    }
    for (const e of newlyAffected.slice(0, 5)) {
      parts.push(`${e.label} due ${formatDate(e.date)} (${formatINR(e.amount)}) ${e.payable === 'no' ? 'cannot be paid' : 'can only be partly paid'}: short by ${formatINR(e.shortBy ?? 0)}.`);
    }
    if (newlyAffected.length > 5) parts.push(`…and ${newlyAffected.length - 5} more payments.`);
    parts.push(`Funding required: ${formatINR(withP.fundingRequired)}${without.fundingRequired ? ` (vs ${formatINR(without.fundingRequired)} without the purchase)` : ''}.`);
    if (withP.recoveryDate) parts.push(`Balance recovers on ${formatDate(withP.recoveryDate)} if expected payments arrive as assumed.`);
    else parts.push(`Balance does not recover within the ${diffDays(withP.today, withP.horizonEnd)}-day window.`);
    warning = parts.join(' ');
  }
  return { purchase: ev, without, with: withP, safe, newlyAffected, warning };
}
