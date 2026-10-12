/**
 * Finance engine: ledger, receivables, payables, settlements, earmarks, cash position,
 * campaign economics and earnings. Every figure is derived from stored records and
 * returns the records that explain it.
 *
 * Rules that matter:
 *  - Cash = account opening balances + posted transactions. Nothing else changes cash.
 *  - Transfers are two linked transactions and are excluded from income/expense.
 *  - Invoices and obligations never change cash; settlements link them to transactions.
 *  - Corrections are reversal transactions, never edits or deletes of amounts.
 *  - Earmarks are internal allocations, not bank movements.
 */
import { createHash, randomUUID } from 'node:crypto';
import { addDays, addMonths, diffDays, isIsoDate, monthStart, todayInTz } from '../shared/dates.ts';
import { assertPaise, formatINR, ratioBps, rupeesToPaise, type Paise } from '../shared/money.ts';
import { OBLIGATION_TXN_CATEGORY, TXN_CATEGORIES, TXN_GROUP } from '../shared/schema.ts';
import { all, audit, decode, get, getSetting, HttpError, insert, run, tx, update, type Db, type Row, type User } from './db.ts';
import type { FcObligation, FcReceivable } from './forecast.ts';

export function today(db: Db): string {
  return process.env.HQ_TODAY || todayInTz(getSetting(db, 'timezone', 'Asia/Kolkata'));
}

export interface Recognition {
  basis: 'invoice' | 'cash' | 'completion';
  creatorPassThrough: boolean;
  assets: 'capitalise' | 'expense';
}

export function recognition(db: Db): Recognition {
  return getSetting(db, 'recognition', { basis: 'invoice', creatorPassThrough: true, assets: 'capitalise' } as Recognition);
}

const IN_CATS = new Set<string>(TXN_CATEGORIES.in);
const OUT_CATS = new Set<string>(TXN_CATEGORIES.out);

/** Amount in the category's natural direction; reversals come out negative. */
export function signed(t: Row): Paise {
  const natural = IN_CATS.has(t.category) ? 'in' : 'out';
  return t.direction === natural ? t.amount : -t.amount;
}

// ---------------------------------------------------------------- accounts

export function accountBalances(db: Db, asOf: string): Row[] {
  return all(
    db,
    // An account contributes nothing before its opening date.
    `SELECT a.id, a.name, a.type, a.institution, a.active, a.opening_balance, a.opening_date,
       CASE WHEN a.opening_date <= ? THEN a.opening_balance ELSE 0 END + COALESCE(SUM(CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END), 0) AS balance,
       COUNT(t.id) AS txn_count,
       SUM(CASE WHEN t.reconciliation = 'unreconciled' THEN 1 ELSE 0 END) AS unreconciled
     FROM accounts a
     LEFT JOIN transactions t ON t.account_id = a.id AND t.txn_date <= ?
     WHERE a.archived_at IS NULL
     GROUP BY a.id ORDER BY a.active DESC, a.name`,
    asOf,
    asOf,
  ).map((r) => ({ ...r, active: !!r.active }));
}

export function totalCash(db: Db, asOf: string): Paise {
  return accountBalances(db, asOf).filter((a) => a.active).reduce((s, a) => s + a.balance, 0);
}

// ---------------------------------------------------------------- receivables / payables

const settledCols = (col: string) => `
  COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.${col} = x.id AND s.reversed_at IS NULL AND s.kind = 'cash'), 0) AS paid,
  COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.${col} = x.id AND s.reversed_at IS NULL AND s.kind = 'tds'), 0) AS tds,
  COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.${col} = x.id AND s.reversed_at IS NULL AND s.kind IN ('write_off','waiver')), 0) AS written_off`;

function paymentState(r: Row, amount: Paise, today: string, dueKey: string): Row {
  const settled = r.paid + r.tds + r.written_off;
  const outstanding = r.status === 'cancelled' ? 0 : Math.max(0, amount - settled);
  const state = r.status === 'cancelled' ? 'cancelled' : outstanding === 0 ? 'settled' : settled > 0 ? 'part_paid' : 'unpaid';
  const daysOverdue = outstanding > 0 && r[dueKey] < today ? diffDays(r[dueKey], today) : 0;
  return { ...r, outstanding, payment_state: state, days_overdue: daysOverdue };
}

export interface ListFilter {
  campaign_id?: number;
  brand_id?: number;
  influencer_id?: number;
  editor_id?: number;
  open?: boolean;
  ids?: number[];
}

function filterSql(f: ListFilter, cols: string[]): { where: string; params: any[] } {
  const where = ['x.archived_at IS NULL'];
  const params: any[] = [];
  for (const c of cols) {
    const v = (f as any)[c];
    if (v !== undefined && v !== null) {
      where.push(`x.${c} = ?`);
      params.push(v);
    }
  }
  if (f.ids) where.push(`x.id IN (${f.ids.map(Number).join(',') || 'NULL'})`);
  return { where: where.join(' AND '), params };
}

export function listInvoices(db: Db, today: string, f: ListFilter = {}): Row[] {
  const { where, params } = filterSql(f, ['campaign_id', 'brand_id', 'influencer_id']);
  const rows = all(
    db,
    `SELECT x.*, ${settledCols('invoice_id')}, b.name AS brand_name, c.name AS campaign_name, i.name AS influencer_name
     FROM invoices x LEFT JOIN brands b ON b.id = x.brand_id LEFT JOIN campaigns c ON c.id = x.campaign_id
     LEFT JOIN influencers i ON i.id = x.influencer_id
     WHERE ${where} ORDER BY x.expected_date, x.id`,
    ...params,
  ).map((r) => {
    const out = paymentState(r, r.total, today, 'due_date');
    out.payer = r.payer_type === 'brand' ? r.brand_name : r.payer_type === 'influencer' ? r.influencer_name : r.payer_name;
    return out;
  });
  return f.open ? rows.filter((r) => r.outstanding > 0) : rows;
}

export function listObligations(db: Db, today: string, f: ListFilter = {}): Row[] {
  const { where, params } = filterSql(f, ['campaign_id', 'influencer_id', 'editor_id']);
  const rows = all(
    db,
    `SELECT x.*, ${settledCols('obligation_id')}, c.name AS campaign_name, i.name AS influencer_name, e.name AS editor_name,
       COALESCE((SELECT SUM(m.amount) FROM earmarks m WHERE m.obligation_id = x.id AND m.status = 'active'), 0) AS earmarked_raw
     FROM obligations x LEFT JOIN campaigns c ON c.id = x.campaign_id
     LEFT JOIN influencers i ON i.id = x.influencer_id LEFT JOIN editors e ON e.id = x.editor_id
     WHERE ${where} ORDER BY x.due_date, x.id`,
    ...params,
  ).map((r) => {
    const out = paymentState(r, r.amount, today, 'due_date');
    out.payee = r.payee_type === 'influencer' ? r.influencer_name : r.payee_type === 'editor' ? r.editor_name : r.payee_name;
    out.earmarked = Math.min(r.earmarked_raw, out.outstanding);
    out.unfunded = out.outstanding - out.earmarked;
    return out;
  });
  return f.open ? rows.filter((r) => r.outstanding > 0) : rows;
}

// ---------------------------------------------------------------- recording money movements

export interface Allocation {
  invoice_id?: number;
  obligation_id?: number;
  amount: Paise;
  /** Non-cash part settled together with this payment (TDS withheld by payer / deducted by us). */
  tds?: Paise;
  /** Receivables only: whose TDS it is (defaults to all ours). */
  tds_split?: TdsShare[];
}

export interface TxnInput {
  account_id: number;
  txn_date: string;
  direction: 'in' | 'out';
  amount: Paise;
  category: string;
  description?: string;
  reference?: string;
  method?: string;
  campaign_id?: number | null;
  asset_id?: number | null;
  counterparty_type?: string | null;
  counterparty_id?: number | null;
  counterparty_name?: string | null;
  notes?: string;
  allocations?: Allocation[];
  idempotency_key?: string;
  allow_duplicate?: boolean;
  receipt_document_id?: number | null;
}

function requireAccount(db: Db, id: number): Row {
  const a = get(db, 'SELECT * FROM accounts WHERE id = ? AND archived_at IS NULL', id);
  if (!a) throw new HttpError(400, 'Choose a valid account');
  if (!a.active) throw new HttpError(400, `${a.name} is inactive`);
  return a;
}

function requireDate(date: unknown, label: string, todayStr: string, allowFuture = false): string {
  if (!isIsoDate(date)) throw new HttpError(400, `${label} must be a valid date`);
  if (!allowFuture && date > todayStr) throw new HttpError(400, `${label} cannot be in the future. Record expected payments as receivables or payables instead.`);
  return date;
}

function requireAmount(v: unknown, label = 'Amount'): Paise {
  try {
    const p = assertPaise(v, label);
    if (p <= 0) throw new Error();
    return p;
  } catch {
    throw new HttpError(400, `${label} must be greater than zero`);
  }
}

/** Records a real money movement. Returns the new transaction id. */
export function recordTransaction(db: Db, user: User, input: TxnInput): number {
  const t = today(db);
  return tx(db, () => {
    if (input.idempotency_key) {
      const prior = get(db, 'SELECT id FROM transactions WHERE idempotency_key = ?', input.idempotency_key);
      if (prior) return prior.id as number; // same form submitted twice
    }
    const account = requireAccount(db, input.account_id);
    const date = requireDate(input.txn_date, 'Transaction date', t);
    if (date < account.opening_date) throw new HttpError(400, `Date is before ${account.name}'s opening balance date`);
    const amount = requireAmount(input.amount);
    if (!['in', 'out'].includes(input.direction)) throw new HttpError(400, 'Direction must be in or out');
    const cats = input.direction === 'in' ? IN_CATS : OUT_CATS;
    if (!cats.has(input.category) || TXN_GROUP[input.category] === 'transfer') {
      throw new HttpError(400, `Category "${input.category}" is not valid for ${input.direction === 'in' ? 'money in' : 'money out'}`);
    }
    const reference = input.reference?.trim() || null;
    if (reference) {
      const dup = get(db, `SELECT id FROM transactions WHERE account_id = ? AND direction = ? AND reference = ? AND reversal_of_id IS NULL AND reversed_by_id IS NULL`, input.account_id, input.direction, reference);
      if (dup) throw new HttpError(409, `Reference ${reference} is already recorded on this account (transaction #${dup.id}). This looks like a duplicate payment.`, { duplicate_of: dup.id });
    } else if (!input.allow_duplicate) {
      const dup = get(db, `SELECT id FROM transactions WHERE account_id = ? AND direction = ? AND amount = ? AND txn_date = ? AND reversed_by_id IS NULL AND reversal_of_id IS NULL AND COALESCE(counterparty_name,'') = COALESCE(?, '')`, input.account_id, input.direction, amount, date, input.counterparty_name ?? null);
      if (dup) throw new HttpError(409, `A ${formatINR(amount)} transaction on the same date and account already exists (#${dup.id}). Add a reference, or confirm it is not a duplicate.`, { duplicate_of: dup.id, confirmable: true });
    }

    const id = insert(db, 'transactions', {
      account_id: input.account_id,
      txn_date: date,
      direction: input.direction,
      amount,
      category: input.category,
      description: input.description?.trim() || null,
      reference,
      method: input.method || null,
      campaign_id: input.campaign_id || null,
      asset_id: input.asset_id || null,
      counterparty_type: input.counterparty_type || null,
      counterparty_id: input.counterparty_id || null,
      counterparty_name: input.counterparty_name || null,
      notes: input.notes || null,
      idempotency_key: input.idempotency_key || null,
      receipt_document_id: input.receipt_document_id || null,
      reconciliation: 'unreconciled',
      created_by: user.id,
    });
    if (input.allocations?.length) allocate(db, user, id, input.allocations);
    audit(db, user.id, 'create', 'transactions', id, null, { ...input, id });
    return id;
  });
}

/** Apply (part of) an existing transaction to invoices or obligations. */
export function allocate(db: Db, user: User, transactionId: number, allocations: Allocation[]): void {
  tx(db, () => {
    const t = get(db, 'SELECT * FROM transactions WHERE id = ?', transactionId);
    if (!t) throw new HttpError(404, 'Transaction not found');
    if (t.reversal_of_id || t.reversed_by_id) throw new HttpError(400, 'Reversed transactions cannot be allocated');
    if (TXN_GROUP[t.category] === 'transfer') throw new HttpError(400, 'Transfers cannot settle invoices or payables');
    const already = get(db, `SELECT COALESCE(SUM(amount),0) AS s FROM settlements WHERE transaction_id = ? AND reversed_at IS NULL`, transactionId)!.s;
    const requested = allocations.reduce((s, a) => s + requireAmount(a.amount, 'Allocated amount'), 0);
    if (already + requested > t.amount) {
      throw new HttpError(400, `Allocations (${formatINR(already + requested)}) exceed the transaction amount (${formatINR(t.amount)})`);
    }
    const tday = today(db);
    for (const a of allocations) {
      const isInvoice = !!a.invoice_id;
      if (isInvoice === !!a.obligation_id) throw new HttpError(400, 'Each allocation needs exactly one invoice or payable');
      if (isInvoice && t.direction !== 'in') throw new HttpError(400, 'Only money in can settle a receivable');
      if (!isInvoice && t.direction !== 'out') throw new HttpError(400, 'Only money out can settle a payable');
      const target = isInvoice ? listInvoices(db, tday, { ids: [a.invoice_id!] })[0] : listObligations(db, tday, { ids: [a.obligation_id!] })[0];
      if (!target) throw new HttpError(404, 'Receivable or payable not found');
      if (target.status === 'cancelled') throw new HttpError(400, 'Cannot settle a cancelled record');
      const tds = a.tds ? requireAmount(a.tds, 'TDS amount') : 0;
      if (a.amount + tds > target.outstanding) {
        throw new HttpError(400, `${target.label ?? target.description}: ${formatINR(a.amount + tds)} exceeds the outstanding ${formatINR(target.outstanding)}. It may already be paid.`);
      }
      const base = { invoice_id: a.invoice_id ?? null, obligation_id: a.obligation_id ?? null, settled_on: t.txn_date, created_by: user.id };
      insert(db, 'settlements', { ...base, transaction_id: transactionId, kind: 'cash', amount: a.amount });
      if (tds) {
        const sid = insert(db, 'settlements', { ...base, transaction_id: null, kind: 'tds', amount: tds, reason: 'TDS' });
        if (isInvoice) recordTdsCredit(db, user, target, sid, tds, t.txn_date, a.tds_split);
        else createTdsPayable(db, user, target, tds, t.txn_date, sid);
      } else if (a.tds_split?.length) throw new HttpError(400, 'TDS ownership was given without a TDS amount');
      if (!isInvoice) afterObligationSettled(db, user, a.obligation_id!);
    }
    audit(db, user.id, 'allocate', 'transactions', transactionId, null, allocations);
  });
}

function createTdsPayable(db: Db, user: User, ob: Row, amount: Paise, date: string, settlementId: number) {
  // TDS deducted from a payout must be deposited by the 7th of the next month (30 April for March deductions).
  const due = date.slice(5, 7) === '03' ? `${date.slice(0, 4)}-04-30` : addDays(addMonths(monthStart(date), 1), 6);
  insert(db, 'obligations', {
    description: `TDS deducted: ${ob.description}`,
    category: 'tax',
    payee_type: 'other',
    payee_name: 'Income Tax Department (TDS)',
    amount,
    due_date: due,
    status: 'committed',
    priority: 'high',
    repeat: 'none',
    source: `tds:${settlementId}`,
    created_by: user.id,
  });
}

function afterObligationSettled(db: Db, user: User, obligationId: number) {
  const ob = listObligations(db, today(db), { ids: [obligationId] })[0];
  if (!ob || ob.outstanding > 0) return;
  run(db, `UPDATE earmarks SET status = 'consumed', ended_at = ?, end_reason = 'Payable settled' WHERE obligation_id = ? AND status = 'active'`, new Date().toISOString(), obligationId);
  if (ob.repeat && ob.repeat !== 'none') {
    const step = ob.repeat === 'monthly' ? 1 : ob.repeat === 'quarterly' ? 3 : 12;
    const exists = get(db, 'SELECT id FROM obligations WHERE source = ?', `repeat:${ob.id}`);
    if (!exists) {
      insert(db, 'obligations', {
        description: ob.description, category: ob.category, payee_type: ob.payee_type, influencer_id: ob.influencer_id,
        editor_id: ob.editor_id, payee_name: ob.payee_name, campaign_id: ob.campaign_id, amount: ob.amount,
        due_date: addMonths(ob.due_date, step), status: 'committed', priority: ob.priority, repeat: ob.repeat,
        source: `repeat:${ob.id}`, notes: ob.notes, created_by: user.id,
      });
    }
  }
}

export function recordTransfer(
  db: Db,
  user: User,
  input: { from_account_id: number; to_account_id: number; amount: Paise; txn_date: string; reference?: string; notes?: string; idempotency_key?: string },
): string {
  const t = today(db);
  return tx(db, () => {
    if (input.idempotency_key) {
      const prior = get(db, 'SELECT transfer_group FROM transactions WHERE idempotency_key = ?', input.idempotency_key);
      if (prior) return prior.transfer_group as string;
    }
    if (input.from_account_id === input.to_account_id) throw new HttpError(400, 'Choose two different accounts');
    const from = requireAccount(db, input.from_account_id);
    const to = requireAccount(db, input.to_account_id);
    const date = requireDate(input.txn_date, 'Transfer date', t);
    if (date < from.opening_date || date < to.opening_date) throw new HttpError(400, 'Date is before an account opening date');
    const amount = requireAmount(input.amount);
    const group = randomUUID();
    const common = { txn_date: date, amount, transfer_group: group, notes: input.notes || null, created_by: user.id, reconciliation: 'unreconciled' };
    insert(db, 'transactions', { ...common, account_id: from.id, direction: 'out', category: 'transfer_out', description: `Transfer to ${to.name}`, reference: input.reference || null, idempotency_key: input.idempotency_key || null });
    insert(db, 'transactions', { ...common, account_id: to.id, direction: 'in', category: 'transfer_in', description: `Transfer from ${from.name}`, reference: input.reference || null, idempotency_key: input.idempotency_key ? `${input.idempotency_key}:in` : null });
    audit(db, user.id, 'transfer', 'transactions', null, null, { ...input, group });
    return group;
  });
}

/** Corrects a transaction by posting an equal and opposite entry. History is preserved. */
export function reverseTransaction(db: Db, user: User, id: number, reason: string, date?: string): number[] {
  if (!reason?.trim()) throw new HttpError(400, 'A reason is required to reverse a transaction');
  return tx(db, () => {
    const t = get(db, 'SELECT * FROM transactions WHERE id = ?', id);
    if (!t) throw new HttpError(404, 'Transaction not found');
    if (t.reversal_of_id) throw new HttpError(400, 'This is already a reversal entry');
    if (t.reversed_by_id) throw new HttpError(400, 'Transaction is already reversed');
    const legs = t.transfer_group ? all(db, 'SELECT * FROM transactions WHERE transfer_group = ? AND reversal_of_id IS NULL', t.transfer_group) : [t];
    const revDate = date ? requireDate(date, 'Reversal date', today(db)) : t.txn_date;
    const ids: number[] = [];
    const now = new Date().toISOString();
    for (const leg of legs) {
      const rid = insert(db, 'transactions', {
        account_id: leg.account_id, txn_date: revDate, direction: leg.direction === 'in' ? 'out' : 'in', amount: leg.amount,
        category: leg.category, description: `Reversal of #${leg.id}: ${reason}`, campaign_id: leg.campaign_id,
        counterparty_type: leg.counterparty_type, counterparty_id: leg.counterparty_id, counterparty_name: leg.counterparty_name,
        transfer_group: leg.transfer_group ? `${leg.transfer_group}:rev` : null, reversal_of_id: leg.id, reconciliation: 'unreconciled', created_by: user.id,
      });
      run(db, 'UPDATE transactions SET reversed_by_id = ?, updated_at = ? WHERE id = ?', rid, now, leg.id);
      run(db, 'UPDATE settlements SET reversed_at = ?, reversed_reason = ? WHERE transaction_id = ? AND reversed_at IS NULL', now, `Transaction #${leg.id} reversed: ${reason}`, leg.id);
      ids.push(rid);
      audit(db, user.id, 'reverse', 'transactions', leg.id, leg, { reversal_id: rid }, reason);
    }
    return ids;
  });
}

/** TDS withheld by a brand, a write-off, or a waived payable. Not a cash movement. */
export function settleNonCash(
  db: Db,
  user: User,
  input: { invoice_id?: number; obligation_id?: number; kind: 'tds' | 'write_off' | 'waiver'; amount: Paise; settled_on: string; reason: string; tds_split?: TdsShare[] },
): number {
  if (!input.reason?.trim()) throw new HttpError(400, 'A reason is required');
  if (!['tds', 'write_off', 'waiver'].includes(input.kind)) throw new HttpError(400, 'Invalid adjustment kind');
  return tx(db, () => {
    const isInvoice = !!input.invoice_id;
    const tday = today(db);
    const target = isInvoice ? listInvoices(db, tday, { ids: [input.invoice_id!] })[0] : listObligations(db, tday, { ids: [input.obligation_id!] })[0];
    if (!target) throw new HttpError(404, 'Record not found');
    const amount = requireAmount(input.amount);
    if (amount > target.outstanding) throw new HttpError(400, `Exceeds outstanding ${formatINR(target.outstanding)}`);
    const date = requireDate(input.settled_on, 'Date', tday);
    const id = insert(db, 'settlements', {
      invoice_id: input.invoice_id ?? null, obligation_id: input.obligation_id ?? null, transaction_id: null,
      kind: input.kind, amount, settled_on: date, reason: input.reason, created_by: user.id,
    });
    if (!isInvoice && input.kind === 'tds') createTdsPayable(db, user, target, amount, date, id);
    if (isInvoice && input.kind === 'tds') recordTdsCredit(db, user, target, id, amount, date, input.tds_split);
    if (!isInvoice) afterObligationSettled(db, user, input.obligation_id!);
    audit(db, user.id, 'settle', isInvoice ? 'invoices' : 'obligations', target.id, null, input);
    return id;
  });
}

/** Undo an allocation or adjustment (e.g. receipt applied to the wrong invoice). The transaction stays. */
export function reverseSettlement(db: Db, user: User, id: number, reason: string): void {
  if (!reason?.trim()) throw new HttpError(400, 'A reason is required');
  tx(db, () => {
    const s = get(db, 'SELECT * FROM settlements WHERE id = ?', id);
    if (!s || s.reversed_at) throw new HttpError(404, 'Active settlement not found');
    if (s.kind === 'tds' && s.invoice_id) reverseTdsCredits(db, user, id, reason);
    if (s.obligation_id && get(db, `SELECT id FROM tds_credits WHERE creator_settlement_id = ? AND status <> 'reversed'`, id)) {
      throw new HttpError(400, 'This comes from TDS a brand withheld. Reverse that TDS on the brand receivable instead (it undoes this too).');
    }
    if (s.kind === 'tds' && s.obligation_id) {
      const dep = get(db, `SELECT id FROM obligations WHERE source = ? AND status <> 'cancelled'`, `tds:${id}`);
      const deposit = dep ? listObligations(db, today(db), { ids: [dep.id] })[0] : null;
      if (deposit && deposit.paid > 0) throw new HttpError(400, 'This TDS has already been deposited with the government. Record the correction with your CA rather than reversing it here.');
    }
    run(db, 'UPDATE settlements SET reversed_at = ?, reversed_reason = ? WHERE id = ?', new Date().toISOString(), reason, id);
    if (s.kind === 'tds' && s.obligation_id) {
      run(db, `UPDATE obligations SET status = 'cancelled', cancel_reason = ? WHERE source = ? AND status <> 'cancelled'`, `TDS settlement #${id} reversed`, `tds:${id}`);
    }
    audit(db, user.id, 'reverse', 'settlements', id, s, null, reason);
  });
}

// ---------------------------------------------------------------- TDS withheld by brands (our tax credits)

export type TdsOwner = 'agency' | 'agency_for_creator' | 'creator';
export interface TdsShare { owner: TdsOwner; amount: Paise; influencer_id?: number | null; obligation_id?: number | null }
export const TDS_OWNER_LABEL: Record<TdsOwner, string> = {
  agency: 'Ours — we claim it',
  agency_for_creator: "We claim it, but it is the creator's money",
  creator: "Creator claims it (deducted under the creator's PAN)",
};

/** Indian financial year and quarter of a deduction, and the deductor's quarterly TDS return due date (the credit shows in 26AS/AIS after it is filed). */
export function tdsPeriod(date: string) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const fy = m >= 4 ? y : y - 1;
  const q = m <= 3 ? 4 : m <= 6 ? 1 : m <= 9 ? 2 : 3;
  const returnDue = [`${fy}-07-31`, `${fy}-10-31`, `${fy + 1}-01-31`, `${fy + 1}-05-31`][q - 1];
  return { fy: `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`, quarter: `Q${q}`, return_due: returnDue };
}

/**
 * Records who a brand-withheld TDS belongs to. One deduction can be split between owners:
 * - agency: our tax credit, tracked until it shows in 26AS/AIS and is claimed;
 * - agency_for_creator: credited under our PAN but owed to the creator — an on-hold payable to them is released once the credit is confirmed;
 * - creator: deducted under the creator's PAN, so they claim it and we pay them that much less (no TDS deposit by us).
 */
function recordTdsCredit(db: Db, user: User, invoice: Row, settlementId: number, amount: Paise, date: string, shares?: TdsShare[]) {
  if (shares !== undefined && shares !== null && (!Array.isArray(shares) || shares.some((x) => !x || typeof x !== 'object'))) throw new HttpError(400, 'Invalid TDS split');
  const list: TdsShare[] = shares?.length ? shares : [{ owner: 'agency', amount }];
  const total = list.reduce((sum, x) => sum + requireAmount(x?.amount, 'TDS share'), 0);
  if (total !== amount) throw new HttpError(400, `The TDS split (${formatINR(total)}) must add up to the TDS amount (${formatINR(amount)})`);
  const period = tdsPeriod(date);
  const payer = invoice.payer ?? invoice.payer_name ?? 'Brand';
  for (const share of list) {
    if (!Object.hasOwn(TDS_OWNER_LABEL, share.owner)) throw new HttpError(400, 'Choose whose TDS this is');
    const inf = share.owner === 'agency' || !Number.isSafeInteger(Number(share.influencer_id)) ? null : get(db, 'SELECT id, name FROM influencers WHERE id = ?', Number(share.influencer_id));
    if (share.owner !== 'agency' && !inf) throw new HttpError(400, 'Choose the creator this TDS belongs to');
    // Both creator options act on the creator's real fee payable, so the total owed to them never changes.
    const fee = share.owner === 'agency' ? null : Number.isSafeInteger(Number(share.obligation_id)) ? listObligations(db, today(db), { ids: [Number(share.obligation_id)] })[0] : undefined;
    if (share.owner !== 'agency' && (!fee || ['cancelled', 'on_hold'].includes(fee.status) || fee.influencer_id !== inf!.id || String(fee.source ?? '').startsWith('tdscredit:'))) {
      throw new HttpError(400, `Choose ${inf!.name}'s fee payable that this TDS relates to${share.owner === 'agency_for_creator' ? ' (if they were already paid in full, the credit is ours)' : ''}`);
    }
    if (fee && share.amount > fee.outstanding) throw new HttpError(400, `${fee.description}: only ${formatINR(fee.outstanding)} is still owed to ${inf!.name}`);
    const creditId = insert(db, 'tds_credits', {
      settlement_id: settlementId, invoice_id: invoice.id, payer_name: payer, amount: share.amount, deducted_on: date, ...period,
      owner: share.owner, influencer_id: inf?.id ?? null, status: share.owner === 'creator' ? 'creator_claims' : 'expected', created_by: user.id,
    });
    if (share.owner === 'agency_for_creator') {
      // That part of the creator's fee moves into a separate payable, on hold (left out of forecasts) until the credit is
      // confirmed in our 26AS/AIS — the creator is owed the same total, just later for this part.
      const ob = insert(db, 'obligations', {
        description: `TDS credit to pass on to ${inf!.name} — ${invoice.label}${invoice.number ? ` (${invoice.number})` : ''}`, category: fee!.category,
        payee_type: 'influencer', influencer_id: inf!.id, campaign_id: fee!.campaign_id ?? invoice.campaign_id ?? null, amount: share.amount,
        due_date: addDays(period.return_due, 15), status: 'on_hold', priority: 'normal', repeat: 'none', source: `tdscredit:${creditId}`,
        notes: `Held back from "${fee!.description}"; released when the TDS from ${payer} shows in our 26AS/AIS`, created_by: user.id,
      });
      const sid = insert(db, 'settlements', {
        obligation_id: fee!.id, transaction_id: null, kind: 'waiver', amount: share.amount, settled_on: date, created_by: user.id,
        reason: `Held back until the TDS credit from ${payer} is confirmed (moved to payable #${ob})`,
      });
      update(db, 'tds_credits', creditId, { obligation_id: ob, creator_settlement_id: sid });
      audit(db, user.id, 'create', 'obligations', ob, null, { amount: share.amount, status: 'on_hold', moved_from: fee!.id }, `TDS credit #${creditId}`);
      afterObligationSettled(db, user, fee!.id);
    }
    if (share.owner === 'creator') {
      // The brand deposits this TDS for the creator, so we pay them that much less and deposit nothing ourselves.
      const sid = insert(db, 'settlements', {
        obligation_id: fee!.id, transaction_id: null, kind: 'tds', amount: share.amount, settled_on: date, created_by: user.id,
        reason: `TDS deducted by ${payer} under the creator's PAN (receivable #${invoice.id})`,
      });
      update(db, 'tds_credits', creditId, { obligation_id: fee!.id, creator_settlement_id: sid });
      afterObligationSettled(db, user, fee!.id);
    }
    audit(db, user.id, 'create', 'tds_credits', creditId, null, { ...share, invoice_id: invoice.id, settlement_id: settlementId });
  }
}

function reverseTdsCredits(db: Db, user: User, settlementId: number, reason: string) {
  const now = new Date().toISOString();
  for (const c of all(db, `SELECT * FROM tds_credits WHERE settlement_id = ? AND status <> 'reversed'`, settlementId)) {
    if (c.owner === 'agency_for_creator' && c.obligation_id) {
      const ob = listObligations(db, today(db), { ids: [c.obligation_id] })[0];
      if (ob && ob.paid + ob.tds > 0) throw new HttpError(400, `The creator has already been paid part of this TDS credit (${ob.description}). Reverse that payment first.`);
      run(db, `UPDATE obligations SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ? AND status <> 'cancelled'`, `Brand TDS reversed: ${reason}`, now, c.obligation_id);
      audit(db, user.id, 'cancel', 'obligations', c.obligation_id, null, null, `Brand TDS reversed: ${reason}`);
    }
    if (c.creator_settlement_id) {
      run(db, 'UPDATE settlements SET reversed_at = ?, reversed_reason = ? WHERE id = ? AND reversed_at IS NULL', now, `Brand TDS reversed: ${reason}`, c.creator_settlement_id);
      audit(db, user.id, 'reverse', 'settlements', c.creator_settlement_id, null, null, `Brand TDS reversed: ${reason}`);
    }
    update(db, 'tds_credits', c.id, { status: 'reversed' });
    audit(db, user.id, 'reverse', 'tds_credits', c.id, c, { status: 'reversed' }, reason);
  }
}

/** TDS recorded before the register existed is listed as ours and waiting for 26AS, to be checked. Idempotent; runs at startup. */
export function backfillTdsCredits(db: Db): number {
  const missing = all(db, `SELECT s.* FROM settlements s WHERE s.kind = 'tds' AND s.invoice_id IS NOT NULL AND s.reversed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM tds_credits c WHERE c.settlement_id = s.id)`);
  for (const s of missing) {
    const inv = listInvoices(db, today(db), { ids: [s.invoice_id] })[0];
    insert(db, 'tds_credits', {
      settlement_id: s.id, invoice_id: s.invoice_id, payer_name: inv?.payer ?? 'Brand', amount: s.amount, deducted_on: s.settled_on, ...tdsPeriod(s.settled_on),
      owner: 'agency', status: 'expected', notes: 'Recorded before the TDS register — confirm whose TDS this is', created_by: s.created_by ?? null,
    });
  }
  return missing.length;
}

/** Track a credit until it is ours: confirmed in 26AS/AIS (releases any amount owed to the creator), claimed, or not received. */
export function updateTdsCredit(db: Db, user: User, id: number, input: { status?: string; certificate_ref?: string | null; claimed_in?: string | null; notes?: string | null }) {
  return tx(db, () => {
    const c = get(db, 'SELECT * FROM tds_credits WHERE id = ?', id);
    if (!c || c.status === 'reversed') throw new HttpError(404, 'TDS entry not found');
    const values: Row = {};
    for (const k of ['certificate_ref', 'claimed_in', 'notes'] as const) {
      if (input[k] === undefined) continue;
      if (input[k] !== null && (typeof input[k] !== 'string' || input[k]!.length > 300)) throw new HttpError(400, `Invalid ${k.replace('_', ' ')}`);
      values[k] = input[k]?.trim() || null;
    }
    if (input.status !== undefined && input.status !== c.status) {
      if (c.owner === 'creator') throw new HttpError(400, 'The creator claims this TDS; there is nothing for us to track');
      if (!['expected', 'in_26as', 'claimed', 'not_received'].includes(input.status)) throw new HttpError(400, 'Invalid status');
      values.status = input.status;
      if (c.owner === 'agency_for_creator' && c.obligation_id) {
        const ob = get(db, 'SELECT * FROM obligations WHERE id = ?', c.obligation_id);
        const confirmed = ['in_26as', 'claimed'].includes(input.status);
        const note = `TDS credit #${id} marked ${input.status}`;
        if (ob && confirmed && ob.status === 'on_hold') {
          update(db, 'obligations', ob.id, { status: 'committed', due_date: ob.due_date < today(db) ? today(db) : ob.due_date });
          audit(db, user.id, 'release', 'obligations', ob.id, { status: 'on_hold' }, { status: 'committed' }, note);
        }
        if (ob && !confirmed && ob.status === 'committed' && !get(db, 'SELECT id FROM settlements WHERE obligation_id = ? AND reversed_at IS NULL', ob.id)) {
          update(db, 'obligations', ob.id, { status: 'on_hold' });
          audit(db, user.id, 'hold', 'obligations', ob.id, { status: 'committed' }, { status: 'on_hold' }, note);
        }
      }
    }
    if (!Object.keys(values).length) return;
    update(db, 'tds_credits', id, values);
    audit(db, user.id, 'update', 'tds_credits', id, c, values);
  });
}

/** Register for a financial year: credits from brands and the TDS we deducted from payouts. */
export function tdsRegister(db: Db, fy: string | null) {
  const credits = all(db, `SELECT c.*, i.label AS invoice_label, i.number AS invoice_number, i.campaign_id, cp.name AS campaign_name, inf.name AS creator_name, o.status AS payable_status
    FROM tds_credits c LEFT JOIN invoices i ON i.id = c.invoice_id LEFT JOIN campaigns cp ON cp.id = i.campaign_id LEFT JOIN influencers inf ON inf.id = c.influencer_id LEFT JOIN obligations o ON o.id = c.obligation_id
    ${fy ? 'WHERE c.fy = ?' : ''} ORDER BY c.deducted_on DESC, c.id DESC`, ...(fy ? [fy] : []));
  const deducted = listObligations(db, today(db), {}).filter((o) => String(o.source ?? '').startsWith('tds:') && o.status !== 'cancelled').map((o) => {
    const s = get(db, `SELECT s.settled_on, s.obligation_id, x.description, x.payee_type, i.name AS creator, e.name AS editor, x.payee_name FROM settlements s JOIN obligations x ON x.id = s.obligation_id
      LEFT JOIN influencers i ON i.id = x.influencer_id LEFT JOIN editors e ON e.id = x.editor_id WHERE s.id = ?`, Number(String(o.source).slice(4)));
    return { ...o, deducted_on: s?.settled_on ?? null, deducted_from: s?.creator ?? s?.editor ?? s?.payee_name ?? null, for_payable: s?.obligation_id ?? null, for_description: s?.description ?? null, ...(s?.settled_on ? tdsPeriod(s.settled_on) : {}) };
  }).filter((o) => !fy || o.fy === fy);
  const passIds = credits.filter((c) => c.owner === 'agency_for_creator' && c.obligation_id).map((c) => c.obligation_id);
  const passOn = new Map(passIds.length ? listObligations(db, today(db), { ids: passIds }).map((o) => [o.id, o]) : []);
  for (const c of credits) {
    const o = c.owner === 'agency_for_creator' ? passOn.get(c.obligation_id) : null;
    c.payable_state = o ? (o.status === 'on_hold' ? 'on_hold' : o.status === 'cancelled' ? 'cancelled' : o.payment_state) : null;
    c.payable_outstanding = o && o.status !== 'cancelled' ? o.outstanding : 0;
  }
  const live = credits.filter((c) => c.status !== 'reversed');
  const sum = (rows: Row[]) => rows.reduce((a, r) => a + r.amount, 0);
  const ours = live.filter((c) => c.owner !== 'creator');
  return {
    credits,
    deducted,
    summary: {
      claimable: sum(ours),
      confirmed: sum(ours.filter((c) => ['in_26as', 'claimed'].includes(c.status))),
      claimed: sum(ours.filter((c) => c.status === 'claimed')),
      awaiting: sum(ours.filter((c) => c.status === 'expected')),
      not_received: sum(ours.filter((c) => c.status === 'not_received')),
      owed_to_creators: live.filter((c) => c.owner === 'agency_for_creator').reduce((a, c) => a + c.payable_outstanding, 0),
      creator_claimed: sum(live.filter((c) => c.owner === 'creator')),
      deducted_by_us: deducted.reduce((a, o) => a + o.amount, 0),
      deposited: deducted.reduce((a, o) => a + o.paid, 0),
      to_deposit: deducted.reduce((a, o) => a + o.outstanding, 0),
    },
  };
}

// ---------------------------------------------------------------- earmarks

export function createEarmark(
  db: Db,
  user: User,
  input: { target_type: 'obligation' | 'campaign' | 'reserve'; obligation_id?: number; campaign_id?: number; label?: string; amount: Paise; protected?: boolean; reason?: string },
  supersedes?: number,
): number {
  const amount = requireAmount(input.amount);
  if (input.target_type === 'obligation') {
    const ob = listObligations(db, today(db), { ids: [input.obligation_id!] })[0];
    if (!ob) throw new HttpError(404, 'Payable not found');
    if (ob.outstanding === 0) throw new HttpError(400, 'This payable is already settled');
    const others = get(db, `SELECT COALESCE(SUM(amount),0) s FROM earmarks WHERE obligation_id = ? AND status = 'active' AND id <> ?`, ob.id, supersedes ?? 0)!.s;
    if (others + amount > ob.outstanding) throw new HttpError(400, `Earmarks would exceed the outstanding ${formatINR(ob.outstanding)}`);
  } else if (input.target_type === 'campaign') {
    if (!get(db, 'SELECT id FROM campaigns WHERE id = ?', input.campaign_id)) throw new HttpError(404, 'Campaign not found');
  } else if (input.target_type === 'reserve') {
    if (!input.label?.trim()) throw new HttpError(400, 'Name the reserve (e.g. GST reserve)');
  } else throw new HttpError(400, 'Invalid earmark target');
  const id = insert(db, 'earmarks', {
    target_type: input.target_type, obligation_id: input.obligation_id ?? null, campaign_id: input.campaign_id ?? null,
    label: input.label ?? null, amount, protected: !!input.protected, status: 'active', reason: input.reason ?? null,
    supersedes_id: supersedes ?? null, created_by: user.id,
  });
  audit(db, user.id, 'create', 'earmarks', id, null, input);
  return id;
}

/** Changing an earmark releases the old one and creates a new one, so history is kept. */
export function changeEarmark(db: Db, user: User, id: number, amount: Paise | null, reason: string): number | null {
  if (!reason?.trim()) throw new HttpError(400, 'A reason is required');
  return tx(db, () => {
    const e = get(db, `SELECT * FROM earmarks WHERE id = ? AND status = 'active'`, id);
    if (!e) throw new HttpError(404, 'Active earmark not found');
    run(db, `UPDATE earmarks SET status = 'released', ended_at = ?, end_reason = ? WHERE id = ?`, new Date().toISOString(), amount === null ? reason : `Changed: ${reason}`, id);
    audit(db, user.id, amount === null ? 'release' : 'change', 'earmarks', id, e, { amount }, reason);
    if (amount === null) return null;
    return createEarmark(db, user, { target_type: e.target_type, obligation_id: e.obligation_id, campaign_id: e.campaign_id, label: e.label, amount, protected: !!e.protected, reason }, id);
  });
}

export function listEarmarks(db: Db, todayStr: string, includeHistory = false): Row[] {
  const rows = all(
    db,
    `SELECT m.*, o.description AS obligation_label, c.name AS campaign_name, u.name AS created_by_name
     FROM earmarks m LEFT JOIN obligations o ON o.id = m.obligation_id LEFT JOIN campaigns c ON c.id = COALESCE(m.campaign_id, o.campaign_id)
     LEFT JOIN users u ON u.id = m.created_by
     ${includeHistory ? '' : "WHERE m.status = 'active'"} ORDER BY m.created_at DESC`,
  );
  const outstanding = new Map(listObligations(db, todayStr, { ids: rows.filter((r) => r.obligation_id).map((r) => r.obligation_id) }).map((o) => [o.id, o.outstanding]));
  const used = new Map<number, number>();
  return rows.map((r) => {
    let effective = r.status === 'active' ? r.amount : 0;
    if (r.status === 'active' && r.obligation_id) {
      const left = (outstanding.get(r.obligation_id) ?? 0) - (used.get(r.obligation_id) ?? 0);
      effective = Math.max(0, Math.min(r.amount, left));
      used.set(r.obligation_id, (used.get(r.obligation_id) ?? 0) + effective);
    }
    return { ...r, protected: !!r.protected, effective };
  });
}

// ---------------------------------------------------------------- cash position

export interface PositionOptions {
  horizonDays?: number | null; // only obligations due within N days (null = all)
  includePlanned?: boolean;
  reserves?: 'all' | 'protected' | 'none';
}

export function cashPosition(db: Db, todayStr: string, opts: PositionOptions = {}) {
  const accounts = accountBalances(db, todayStr);
  const cash = accounts.filter((a) => a.active).reduce((s, a) => s + a.balance, 0);
  const receivables = listInvoices(db, todayStr, { open: true });
  const payables = listObligations(db, todayStr, { open: true }).filter((o) => o.status !== 'cancelled');
  const earmarks = listEarmarks(db, todayStr);
  const sum = (rows: Row[], k = 'outstanding') => rows.reduce((s, r) => s + r[k], 0);
  const dueWithin = (n: number) => payables.filter((o) => o.status !== 'on_hold' && o.due_date <= addDays(todayStr, n));
  const horizon = opts.horizonDays ?? null;
  const selectedPayables = payables.filter(
    (o) => o.status !== 'on_hold' && (opts.includePlanned !== false || o.status !== 'planned') && (horizon === null || o.due_date <= addDays(todayStr, horizon)),
  );
  const reserveRows = earmarks.filter((e) => e.target_type === 'reserve' && (opts.reserves === 'all' || ((opts.reserves ?? 'protected') === 'protected' && e.protected)));
  const earmarked = sum(earmarks, 'effective');
  const byType = (t: string) => sum(earmarks.filter((e) => e.target_type === t), 'effective');
  const committedTotal = sum(selectedPayables);
  const reservesTotal = sum(reserveRows, 'effective');

  const payeeGroups = new Map<string, Paise>();
  for (const o of payables) payeeGroups.set(o.category, (payeeGroups.get(o.category) ?? 0) + o.outstanding);

  return {
    today: todayStr,
    accounts,
    cash,
    receivables: {
      total: sum(receivables),
      overdue: sum(receivables.filter((r) => r.days_overdue > 0)),
      byConfidence: Object.fromEntries(['confirmed', 'expected', 'at_risk', 'delayed'].map((c) => [c, sum(receivables.filter((r) => r.confidence === c))])),
      items: receivables,
    },
    payables: {
      total: sum(payables),
      overdue: sum(payables.filter((o) => o.days_overdue > 0 && o.status !== 'on_hold')),
      due7: sum(dueWithin(7)),
      due14: sum(dueWithin(14)),
      due30: sum(dueWithin(30)),
      byCategory: Object.fromEntries(payeeGroups),
      items: payables,
    },
    earmarks: { total: earmarked, obligations: byType('obligation'), campaigns: byType('campaign'), reserves: byType('reserve'), items: earmarks },
    unallocated: cash - earmarked,
    selection: { horizonDays: horizon, includePlanned: opts.includePlanned !== false, reserves: opts.reserves ?? 'protected', payables: committedTotal, reserveTotal: reservesTotal },
    afterCommitments: cash - committedTotal - reservesTotal,
  };
}

// ---------------------------------------------------------------- forecast inputs

export function forecastInputs(db: Db, todayStr: string, horizonDays = 90): { openingCash: Paise; receivables: FcReceivable[]; obligations: FcObligation[]; reserves: { label: string; amount: Paise; protected: boolean }[] } {
  const receivables = listInvoices(db, todayStr, { open: true }).map((r) => ({
    id: r.id,
    label: `${r.label}${r.payer ? ` — ${r.payer}` : ''}${r.campaign_name ? ` (${r.campaign_name})` : ''}`,
    amount: r.outstanding,
    expectedDate: r.expected_date ?? r.due_date,
    confidence: r.confidence,
    campaignId: r.campaign_id,
  }));
  const open = listObligations(db, todayStr, { open: true }).filter((o) => o.status !== 'cancelled');
  const obligations: FcObligation[] = open.map((o) => ({
    id: o.id,
    label: `${o.description}${o.payee ? ` — ${o.payee}` : ''}`,
    amount: o.outstanding,
    dueDate: o.due_date,
    status: o.status,
    priority: o.priority ?? 'normal',
    campaignId: o.campaign_id,
  }));
  // Project future occurrences of recurring expenses that have no successor yet (ids are negative = projected).
  const successors = new Set(all(db, `SELECT source FROM obligations WHERE source LIKE 'repeat:%'`).map((r) => Number(String(r.source).split(':')[1])));
  const recurring = all(db, `SELECT * FROM obligations WHERE repeat IS NOT NULL AND repeat <> 'none' AND status <> 'cancelled' AND archived_at IS NULL`).filter((o) => !successors.has(o.id));
  let pid = -1;
  for (const o of recurring) {
    const step = o.repeat === 'monthly' ? 1 : o.repeat === 'quarterly' ? 3 : 12;
    for (let k = 1; k < 60; k++) {
      const d = addMonths(o.due_date, step * k);
      if (d > addDays(todayStr, horizonDays)) break;
      if (d < todayStr) continue;
      obligations.push({ id: pid--, label: `${o.description} (projected recurring)`, amount: o.amount, dueDate: d, status: 'planned', priority: o.priority ?? 'normal', campaignId: o.campaign_id, projected: true });
    }
  }
  const reserves = listEarmarks(db, todayStr).filter((e) => e.target_type === 'reserve').map((e) => ({ label: e.label, amount: e.effective, protected: e.protected }));
  return { openingCash: totalCash(db, todayStr), receivables, obligations, reserves };
}

// ---------------------------------------------------------------- campaign economics

const PLAN_CATEGORY: Record<string, string> = {
  creator_payout: 'creator',
  editor_payout: 'editing',
  vendor_payment: 'production',
};
/** Obligation categories that count as campaign direct costs (TDS remittances, loans etc. never do). */
const CAMPAIGN_COST = new Set(['creator_payout', 'editor_payout', 'vendor_payment', 'operating_expense', 'other', 'subscription']);

export function campaignFinancials(db: Db, todayStr: string, campaignIds?: number[]): Map<number, Row> {
  const rec = recognition(db);
  const idFilter = campaignIds ? `AND c.id IN (${campaignIds.map(Number).join(',') || 'NULL'})` : '';
  const campaigns = all(db, `SELECT c.*, b.name AS brand_name FROM campaigns c LEFT JOIN brands b ON b.id = c.brand_id WHERE c.archived_at IS NULL ${idFilter}`);
  const out = new Map<number, Row>();
  if (!campaigns.length) return out;
  const ids = campaigns.map((c) => c.id);
  const invoices = listInvoices(db, todayStr).filter((i) => ids.includes(i.campaign_id));
  const obligations = listObligations(db, todayStr).filter((o) => ids.includes(o.campaign_id));
  // Campaign-tagged transactions not (fully) linked to an invoice/payable.
  const loose = all(
    db,
    `SELECT t.*, t.amount - COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.transaction_id = t.id AND s.reversed_at IS NULL), 0) AS unallocated
     FROM transactions t WHERE t.campaign_id IN (${ids.join(',')})`,
  ).filter((t) => t.unallocated > 0 && TXN_GROUP[t.category] !== 'transfer');
  const earmarks = all(db, `SELECT * FROM earmarks WHERE status = 'active' AND target_type = 'campaign' AND campaign_id IN (${ids.join(',')})`);

  for (const c of decodeAll('campaigns', campaigns)) {
    const inv = invoices.filter((i) => i.campaign_id === c.id && i.status !== 'cancelled');
    const obs = obligations.filter((o) => o.campaign_id === c.id && o.status !== 'cancelled');
    const costObs = obs.filter((o) => CAMPAIGN_COST.has(o.category));
    const looseT: Row[] = loose.filter((t) => t.campaign_id === c.id).map((t) => ({ ...t, part: t.unallocated * (signed(t) < 0 ? -1 : 1) }));
    const looseIn = looseT.filter((t) => TXN_GROUP[t.category] === 'collection');
    const looseCost = looseT.filter((t) => TXN_GROUP[t.category] === 'direct_cost');

    const contracted = inv.reduce((s, i) => s + i.subtotal, 0);
    const billed = inv.filter((i) => i.status === 'issued').reduce((s, i) => s + i.subtotal, 0);
    const revenue = inv.length ? contracted : c.client_budget ?? 0;
    const collected = inv.reduce((s, i) => s + i.paid, 0) + looseIn.reduce((s, t) => s + t.part, 0);
    const receivableOutstanding = inv.reduce((s, i) => s + i.outstanding, 0);

    const categories = ['creator', 'editing', 'production', 'other'];
    const committedBy: Record<string, Paise> = Object.fromEntries(categories.map((k) => [k, 0]));
    const paidBy: Record<string, Paise> = Object.fromEntries(categories.map((k) => [k, 0]));
    for (const o of costObs) {
      const k = PLAN_CATEGORY[o.category] ?? 'other';
      committedBy[k] += o.amount - o.written_off;
      paidBy[k] += o.paid + o.tds;
    }
    for (const t of looseCost) {
      const k = PLAN_CATEGORY[t.category] ?? 'other';
      committedBy[k] += t.part;
      paidBy[k] += t.part;
    }
    const plannedBy: Record<string, Paise> = Object.fromEntries(categories.map((k) => [k, 0]));
    for (const line of (c.budget_plan as Row[] | null) ?? []) {
      const k = categories.includes(line.category) ? line.category : 'other';
      plannedBy[k] += Number(line.planned) || 0;
    }
    const cost = Object.values(committedBy).reduce((a, b) => a + b, 0);
    const paid = Object.values(paidBy).reduce((a, b) => a + b, 0);
    const planned = Object.values(plannedBy).reduce((a, b) => a + b, 0);
    const unpaid = costObs.reduce((s, o) => s + o.outstanding, 0);
    const earmarked = costObs.reduce((s, o) => s + o.earmarked, 0) + earmarks.filter((e) => e.campaign_id === c.id).reduce((s, e) => s + e.amount, 0);
    const passThrough = c.billing_model === 'gross' && rec.creatorPassThrough ? committedBy.creator : 0;
    const agencyEarnings = revenue - passThrough;
    const margin = revenue - cost;
    out.set(c.id, {
      campaign_id: c.id,
      name: c.name,
      brand_name: c.brand_name,
      stage: c.stage,
      billing_model: c.billing_model,
      client_budget: c.client_budget ?? 0,
      revenue,
      revenue_basis: inv.length ? 'contracted (invoices + scheduled milestones, excl. tax)' : 'client budget (no billing scheduled yet)',
      billed,
      scheduled: contracted - billed,
      collected,
      receivable_outstanding: receivableOutstanding,
      planned_cost: planned,
      planned_by: plannedBy,
      committed_cost: cost,
      committed_by: committedBy,
      paid_cost: paid,
      paid_by: paidBy,
      unpaid_cost: unpaid,
      earmarked: Math.min(earmarked, unpaid),
      funding_gap: Math.max(0, unpaid - earmarked),
      net_cash: collected - paid,
      // Payouts still owed beyond what this campaign has collected so far (by record links, not bank tracing).
      payment_exposure: Math.max(0, unpaid - Math.max(0, collected - paid)),
      agency_earnings: agencyEarnings,
      pass_through: passThrough,
      contribution_margin: margin,
      margin_bps: ratioBps(margin, revenue),
      budget_variance: planned ? cost - planned : null,
      over_budget: !!c.client_budget && cost > c.client_budget,
      financially_closed: receivableOutstanding === 0 && unpaid === 0,
    });
  }
  return out;
}

function decodeAll(entity: string, rows: Row[]): Row[] {
  return rows.map((r) => decode(entity, r)!);
}

// ---------------------------------------------------------------- earnings (period)

export function earnings(db: Db, from: string, to: string, todayStr: string) {
  const rec = recognition(db);
  const fin = campaignFinancials(db, todayStr);
  const factor = (campaignId: number | null, kind: string, key: 'agency_earnings' | 'contribution_margin') => {
    if (kind === 'commission' || !campaignId) return 1;
    const f = fin.get(campaignId);
    if (!f || !f.revenue) return 1;
    return f[key] / f.revenue;
  };
  const invoices = listInvoices(db, todayStr).filter((i) => i.status !== 'cancelled');
  const items: Row[] = [];
  let grossBillings = 0;
  let commissionBilled = 0;
  let recognised = 0;
  let agencyEarnings = 0;
  let margin = 0;

  for (const i of invoices) {
    if (i.status === 'issued' && i.issue_date >= from && i.issue_date <= to) {
      if (i.kind === 'commission') commissionBilled += i.subtotal;
      else grossBillings += i.subtotal;
    }
  }

  if (rec.basis === 'invoice') {
    for (const i of invoices.filter((x) => x.status === 'issued' && x.issue_date >= from && x.issue_date <= to)) {
      const e = Math.round(i.subtotal * factor(i.campaign_id, i.kind, 'agency_earnings'));
      const m = Math.round(i.subtotal * factor(i.campaign_id, i.kind, 'contribution_margin'));
      recognised += i.subtotal;
      agencyEarnings += e;
      margin += m;
      items.push({ type: 'invoice', id: i.id, date: i.issue_date, label: `${i.number ?? i.label} — ${i.payer ?? ''}`, campaign_id: i.campaign_id, revenue: i.subtotal, earnings: e, margin: m });
    }
  } else if (rec.basis === 'cash') {
    const rows = all(
      db,
      `SELECT s.amount, s.settled_on, i.id AS invoice_id, i.subtotal, i.total, i.kind, i.campaign_id, i.label, i.number
       FROM settlements s JOIN invoices i ON i.id = s.invoice_id
       WHERE s.reversed_at IS NULL AND s.kind IN ('cash','tds') AND s.settled_on BETWEEN ? AND ?`,
      from,
      to,
    );
    for (const r of rows) {
      const exTax = r.total ? Math.round((r.amount * r.subtotal) / r.total) : r.amount;
      const e = Math.round(exTax * factor(r.campaign_id, r.kind, 'agency_earnings'));
      const m = Math.round(exTax * factor(r.campaign_id, r.kind, 'contribution_margin'));
      recognised += exTax;
      agencyEarnings += e;
      margin += m;
      items.push({ type: 'invoice', id: r.invoice_id, date: r.settled_on, label: `Received against ${r.number ?? r.label}`, campaign_id: r.campaign_id, revenue: exTax, earnings: e, margin: m });
    }
  } else {
    for (const f of fin.values()) {
      const c = get(db, 'SELECT live_at FROM campaigns WHERE id = ?', f.campaign_id);
      if (c?.live_at && c.live_at >= from && c.live_at <= to) {
        recognised += f.revenue;
        agencyEarnings += f.agency_earnings;
        margin += f.contribution_margin;
        items.push({ type: 'campaign', id: f.campaign_id, date: c.live_at, label: f.name, campaign_id: f.campaign_id, revenue: f.revenue, earnings: f.agency_earnings, margin: f.contribution_margin });
      }
    }
  }

  const txns = all(db, `SELECT t.*, a.name AS account_name FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.txn_date BETWEEN ? AND ?`, from, to);
  const group = (g: string) => txns.filter((t) => TXN_GROUP[t.category] === g);
  const total = (rows: Row[]) => rows.reduce((s, t) => s + signed(t), 0);
  const opexRows = group('opex');
  const capexRows = group('capex');
  const opex = total(opexRows);
  const capex = total(capexRows);
  let depreciation = 0;
  if (rec.assets === 'capitalise') {
    for (const a of all(db, `SELECT * FROM assets WHERE archived_at IS NULL AND useful_life_months > 0 AND cost > 0 AND purchase_date IS NOT NULL`)) {
      const monthly = a.cost / a.useful_life_months;
      const end = addMonths(a.purchase_date, a.useful_life_months);
      const start = a.purchase_date > from ? a.purchase_date : from;
      const stop = end < to ? end : to;
      // Depreciation is an estimate: round to whole rupees.
      if (stop > start) depreciation += Math.round((monthly * diffDays(start, stop)) / 30.4375 / 100) * 100;
    }
  }
  const operatingResult = margin - opex - (rec.assets === 'expense' ? capex : depreciation);

  return {
    from,
    to,
    basis: rec,
    gross_billings: grossBillings,
    commission_billed: commissionBilled,
    recognised_revenue: recognised,
    agency_earnings: agencyEarnings,
    contribution_margin: margin,
    cash_collected: total(group('collection')),
    other_income: total(group('other_income')),
    opex,
    capex,
    depreciation,
    taxes_paid: total(group('tax')),
    financing: {
      founder_contributions: total(txns.filter((t) => t.category === 'founder_contribution')),
      founder_withdrawals: total(txns.filter((t) => t.category === 'founder_withdrawal')),
      loans_received: total(txns.filter((t) => t.category === 'loan_received')),
      loan_repayments: total(txns.filter((t) => t.category === 'loan_repayment')),
    },
    unclassified: group('unclassified').length,
    operating_result: operatingResult,
    items,
    opex_items: opexRows,
    capex_items: capexRows,
    explanation: [
      `Earnings basis: ${rec.basis === 'invoice' ? 'recognised when an invoice is issued' : rec.basis === 'cash' ? 'recognised when money is received' : 'recognised when a campaign goes live'}.`,
      rec.creatorPassThrough ? 'Creator fees on gross campaigns are pass-through: agency earnings = billing − creator costs.' : 'Creator fees are treated as cost of sales: agency earnings = full billing.',
      'Contribution margin = campaign revenue − all direct campaign costs (creators, editing, production), recognised proportionally on the same basis.',
      'Operating expenses are counted when paid (cash basis). Transfers, founder money and loans are excluded from earnings.',
      rec.assets === 'capitalise' ? 'Asset purchases are capitalised; straight-line depreciation is deducted where a useful life is set.' : 'Asset purchases are expensed in full when paid.',
      'Gross billings and cash collected include pass-through money that is not agency earnings. Cash collected includes GST.',
    ],
  };
}

// ---------------------------------------------------------------- ageing & statements

export function ageing(rows: Row[]): { bucket: string; total: Paise; count: number }[] {
  const buckets = [
    { bucket: 'Not yet due', test: (d: number) => d <= 0 },
    { bucket: '1–30 days', test: (d: number) => d >= 1 && d <= 30 },
    { bucket: '31–60 days', test: (d: number) => d >= 31 && d <= 60 },
    { bucket: '61–90 days', test: (d: number) => d >= 61 && d <= 90 },
    { bucket: '90+ days', test: (d: number) => d > 90 },
  ];
  return buckets.map((b) => {
    const m = rows.filter((r) => r.outstanding > 0 && b.test(r.days_overdue));
    return { bucket: b.bucket, total: m.reduce((s, r) => s + r.outstanding, 0), count: m.length };
  });
}

export function cashflowByPeriod(db: Db, from: string, to: string, grain: 'month' | 'week' = 'month') {
  const txns = all(db, `SELECT * FROM transactions WHERE txn_date BETWEEN ? AND ? ORDER BY txn_date`, from, to);
  const periods = new Map<string, Row>();
  for (const t of txns) {
    const key = grain === 'month' ? t.txn_date.slice(0, 7) : isoWeekKey(t.txn_date);
    const p = periods.get(key) ?? { period: key, cash_in: 0, cash_out: 0, transfers: 0, byGroup: {} as Record<string, Paise> };
    const g = TXN_GROUP[t.category];
    if (g === 'transfer') p.transfers += t.amount;
    else if (t.direction === 'in') p.cash_in += t.amount;
    else p.cash_out += t.amount;
    if (g !== 'transfer') p.byGroup[g] = (p.byGroup[g] ?? 0) + (t.direction === 'in' ? t.amount : -t.amount);
    periods.set(key, p);
  }
  return [...periods.values()].map((p) => ({ ...p, net: p.cash_in - p.cash_out }));
}

function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Payment statement for a creator or editor: what was owed, paid (with references) and what remains. */
export function payeeStatement(db: Db, todayStr: string, kind: 'influencer' | 'editor', id: number) {
  const obligations = listObligations(db, todayStr, kind === 'influencer' ? { influencer_id: id } : { editor_id: id }).filter((o) => o.status !== 'cancelled');
  const payments = all(
    db,
    `SELECT s.*, t.txn_date, t.reference, t.method, a.name AS account_name, o.description, c.owner AS brand_tds_owner, c.payer_name AS brand_tds_by
     FROM settlements s JOIN obligations o ON o.id = s.obligation_id LEFT JOIN tds_credits c ON c.creator_settlement_id = s.id AND c.status <> 'reversed'
     LEFT JOIN transactions t ON t.id = s.transaction_id LEFT JOIN accounts a ON a.id = t.account_id
     WHERE o.${kind === 'influencer' ? 'influencer_id' : 'editor_id'} = ? AND s.reversed_at IS NULL ORDER BY s.settled_on`,
    id,
  );
  return {
    obligations,
    payments,
    total_owed: obligations.reduce((s, o) => s + o.amount - o.written_off, 0),
    total_paid: payments.filter((p) => p.kind === 'cash').reduce((s, p) => s + p.amount, 0),
    total_tds: payments.filter((p) => p.kind === 'tds').reduce((s, p) => s + p.amount, 0),
    tds_by_brand: payments.filter((p) => p.kind === 'tds' && p.brand_tds_owner === 'creator').reduce((s, p) => s + p.amount, 0),
    outstanding: obligations.reduce((s, o) => s + o.outstanding, 0),
  };
}

// ---------------------------------------------------------------- bank CSV import

export interface ImportRow {
  date: string;
  description?: string;
  reference?: string;
  amount: string | number; // signed: negative = money out
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD-MMM-YYYY, DD MMM YYYY (Indian bank formats). */
export function parseBankDate(s: string): string | null {
  const v = s.trim();
  if (isIsoDate(v)) return v;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return isIsoDate(d) ? d : null;
  }
  m = /^(\d{1,2})[\s/-]([A-Za-z]{3})[a-z]*[\s/-](\d{2,4})$/.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = `${y}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
    return isIsoDate(d) ? d : null;
  }
  return null;
}

export function importTransactions(db: Db, user: User, accountId: number, rows: ImportRow[]) {
  const account = requireAccount(db, accountId);
  const t = today(db);
  const result = { imported: 0, duplicates: 0, errors: [] as { row: number; error: string }[] };
  tx(db, () => {
    rows.forEach((r, i) => {
      const date = parseBankDate(String(r.date ?? ''));
      let amount: Paise;
      try {
        amount = rupeesToPaise(String(r.amount ?? '').replace(/\s*(cr|dr)$/i, ''));
        if (/dr$/i.test(String(r.amount).trim())) amount = -Math.abs(amount);
      } catch (e) {
        result.errors.push({ row: i + 1, error: (e as Error).message });
        return;
      }
      if (!date) return void result.errors.push({ row: i + 1, error: `Unrecognised date "${r.date}"` });
      if (date > t) return void result.errors.push({ row: i + 1, error: 'Date is in the future' });
      if (date < account.opening_date) return void result.errors.push({ row: i + 1, error: 'Before account opening date' });
      if (amount === 0) return void result.errors.push({ row: i + 1, error: 'Zero amount' });
      const direction = amount > 0 ? 'in' : 'out';
      const reference = r.reference?.trim() || null;
      const fingerprint = createHash('sha256')
        .update([accountId, date, direction, Math.abs(amount), reference ?? '', (r.description ?? '').trim().toLowerCase().replace(/\s+/g, ' ')].join('|'))
        .digest('hex');
      const dup = get(db, 'SELECT id FROM transactions WHERE account_id = ? AND (import_fingerprint = ? OR (reference IS NOT NULL AND reference = ? AND direction = ? AND reversed_by_id IS NULL AND reversal_of_id IS NULL))', accountId, fingerprint, reference, direction);
      if (dup) return void result.duplicates++;
      insert(db, 'transactions', {
        account_id: accountId, txn_date: date, direction, amount: Math.abs(amount),
        category: direction === 'in' ? 'uncategorised_in' : 'uncategorised_out', description: r.description?.trim() || null,
        reference, import_fingerprint: fingerprint, reconciliation: 'unreconciled', created_by: user.id, method: 'bank_import',
      });
      result.imported++;
    });
    audit(db, user.id, 'import', 'transactions', null, null, { account: accountId, ...result, rows: rows.length });
  });
  return result;
}

/** Edits allowed on a posted transaction: classification only. Amount/date/account need a reversal. */
export function classifyTransaction(db: Db, user: User, id: number, changes: Row): void {
  const allowed = ['category', 'description', 'campaign_id', 'asset_id', 'counterparty_type', 'counterparty_id', 'counterparty_name', 'notes', 'reconciliation', 'receipt_document_id'];
  const t = get(db, 'SELECT * FROM transactions WHERE id = ?', id);
  if (!t) throw new HttpError(404, 'Transaction not found');
  const bad = Object.keys(changes).filter((k) => !allowed.includes(k));
  if (bad.length) throw new HttpError(400, `Cannot edit ${bad.join(', ')} on a posted transaction. Reverse it and record it again.`);
  if (changes.category !== undefined) {
    const cats = t.direction === 'in' ? IN_CATS : OUT_CATS;
    if (!cats.has(changes.category) || TXN_GROUP[changes.category] === 'transfer' || TXN_GROUP[t.category] === 'transfer') {
      throw new HttpError(400, 'Invalid category for this transaction');
    }
  }
  if (changes.reconciliation !== undefined && !['unreconciled', 'reconciled', 'flagged'].includes(changes.reconciliation)) throw new HttpError(400, 'Invalid reconciliation status');
  update(db, 'transactions', id, changes);
  audit(db, user.id, 'update', 'transactions', id, t, changes);
}
