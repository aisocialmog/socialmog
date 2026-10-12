/**
 * Import a prepared bundle of records (e.g. data moved over from the old app) in one go.
 * Every record goes through the same checks as the app's forms, money goes through recordTransaction/allocate
 * (so receipts and payouts settle real receivables and payables), and the whole bundle saves or nothing does.
 * The preview is a full trial run that is rolled back, so what it shows is exactly what Import would save.
 *
 * Bundle format: { id, source, notes?: string[], account, brands, contacts, influencers, editors, assets, deals, campaigns,
 * campaign_creators, deliverables, content_tasks, invoices, obligations, transactions, tds_updates, tasks }.
 * Each record may have a `key`; fields that point at another record refer to it as "@key". Amounts are rupees, percentages are whole percents,
 * dates are YYYY-MM-DD. Readonly fields that a migration must keep (live_at, closed_at, delivered_at) go in `_set`.
 */
import { ENTITY } from '../shared/schema.ts';
import { rupeesToPaise, type Paise } from '../shared/money.ts';
import { clean } from './app.ts';
import { afterWrite, beforeWrite } from './domain.ts';
import { all, audit, decode, get, getSetting, HttpError, insert, setSetting, tx, update, type Db, type Row, type User } from './db.ts';
import { listInvoices, listObligations, recordTransaction, today, totalCash, updateTdsCredit } from './finance.ts';

const ORDER = ['brands', 'contacts', 'influencers', 'editors', 'assets', 'deals', 'campaigns', 'campaign_creators', 'deliverables', 'content_tasks', 'invoices', 'obligations', 'tasks'] as const;
const SETTABLE = new Set(['live_at', 'closed_at', 'delivered_at']);

class Rollback extends Error {
  summary: Row;
  constructor(summary: Row) {
    super('preview');
    this.summary = summary;
  }
}

export function importBundle(db: Db, user: User, bundle: Row, apply: boolean): Row {
  if (!bundle || typeof bundle !== 'object' || typeof bundle.id !== 'string' || !bundle.id.trim()) throw new HttpError(400, 'This is not an import file (it has no id)');
  const done = getSetting<Row | null>(db, `bundle:${bundle.id}`, null);
  if (done) throw new HttpError(409, `This file was already imported on ${String(done.at).slice(0, 10)}. Nothing was changed.`);
  try {
    return tx(db, () => {
      const summary = run(db, user, bundle);
      if (!apply) throw new Rollback(summary);
      setSetting(db, `bundle:${bundle.id}`, { at: new Date().toISOString(), by: user.id, source: bundle.source ?? null });
      audit(db, user.id, 'import', 'system', null, null, { bundle: bundle.id, source: bundle.source, created: summary.created });
      return summary;
    });
  } catch (err) {
    if (err instanceof Rollback) return err.summary;
    throw err;
  }
}

function run(db: Db, user: User, b: Row): Row {
  const ids = new Map<string, number>();
  const created: Record<string, number> = {};
  const where = (what: string, r: Row) => `${what}${r?.key ? ` "${r.key}"` : ''}`;
  const ref = (v: unknown, what: string): number => {
    const id = typeof v === 'string' && v.startsWith('@') ? ids.get(v.slice(1)) : undefined;
    if (!id) throw new HttpError(400, `${what}: ${String(v)} is not defined earlier in the file`);
    return id;
  };
  const paise = (v: unknown, what: string): Paise => {
    try {
      return rupeesToPaise(v as number);
    } catch {
      throw new HttpError(400, `${what}: ${String(v)} is not a valid amount`);
    }
  };

  const make = (entity: string, r: Row): number => {
    const e = ENTITY[entity];
    const what = where(e.label, r);
    const input: Row = {};
    for (const f of e.fields) {
      if (!(f.key in r)) continue;
      // Only fields that point at other records take "@key" (handles like @name stay text).
      let v = r[f.key];
      if (v !== null && v !== undefined && (f.type === 'ref' || (entity === 'tasks' && f.key === 'related_id'))) v = ref(v, `${what} ${f.key}`);
      if (v !== null && f.type === 'money') v = paise(v, `${what} ${f.key}`);
      if (v !== null && f.type === 'percent') v = Math.round(Number(v) * 100);
      input[f.key] = v;
    }
    if (entity === 'deals' && Array.isArray(input.creators)) input.creators = input.creators.map((c: Row) => ({ ...c, influencer_id: ref(c.influencer_id, `${what} creator`), fee: paise(c.fee ?? 0, `${what} creator fee`) }));
    let values: Row;
    try {
      values = clean(db, e, input, user, 'create');
      beforeWrite(db, user, entity, values, null);
    } catch (err) {
      if (err instanceof HttpError) throw new HttpError(err.status, `${what}: ${err.message}`);
      throw err;
    }
    const id = insert(db, entity, { ...values, created_by: user.id });
    const set = Object.fromEntries(Object.entries(r._set ?? {}).filter(([k]) => SETTABLE.has(k)));
    if (Object.keys(set).length) update(db, entity, id, set);
    const row = decode(e, get(db, `SELECT * FROM ${entity} WHERE id = ?`, id))!;
    // A second pass with the row as "existing" lets payables pick up dates set above, without stage-change side effects.
    afterWrite(db, user, entity, row, null);
    if (Object.keys(set).length) afterWrite(db, user, entity, row, row);
    audit(db, user.id, 'create', entity, id, null, { ...values, ...set }, `Imported: ${b.source ?? b.id}`);
    if (r.key) {
      if (ids.has(r.key)) throw new HttpError(400, `The key "${r.key}" is used twice`);
      ids.set(r.key, id);
    }
    created[entity] = (created[entity] ?? 0) + 1;
    return id;
  };

  if (!b.account?.name) throw new HttpError(400, 'The file needs an account');
  make('accounts', b.account);
  for (const entity of ORDER) {
    for (const r of b[entity] ?? []) {
      const id = make(entity, r);
      if (entity === 'campaigns' && r.deal_id) update(db, 'deals', ref(r.deal_id, where('Campaign', r)), { campaign_id: id });
    }
  }

  // The payable the app created for a confirmed creator or an editor's fee.
  const payableOf = (prefix: 'cc' | 'ct', key: string, what: string): number => {
    const ob = get(db, `SELECT id FROM obligations WHERE source = ? AND status <> 'cancelled'`, `${prefix}:${ref(key, what)}`);
    if (!ob) throw new HttpError(400, `${what}: ${key} has no payable (is the fee set?)`);
    return ob.id;
  };
  const accountId = ids.get(b.account.key) ?? get(db, 'SELECT MAX(id) id FROM accounts')!.id;
  const unapplied: Row[] = [];
  for (const t of b.transactions ?? []) {
    const what = where('Payment', t);
    const allocations = (t.allocations ?? []).map((a: Row) => ({
      invoice_id: a.invoice ? ref(a.invoice, what) : undefined,
      obligation_id: a.obligation ? ref(a.obligation, what) : a.creator_fee ? payableOf('cc', a.creator_fee, what) : a.editor_fee ? payableOf('ct', a.editor_fee, what) : undefined,
      amount: paise(a.amount, what),
      tds: a.tds ? paise(a.tds, what) : undefined,
    }));
    try {
      recordTransaction(db, user, {
        account_id: accountId, txn_date: t.txn_date, direction: t.direction, amount: paise(t.amount, what), category: t.category,
        description: t.description, method: t.method, counterparty_type: t.counterparty_type ?? null,
        counterparty_id: t.counterparty_id ? ref(t.counterparty_id, what) : null, counterparty_name: t.counterparty_name ?? null,
        campaign_id: t.campaign_id ? ref(t.campaign_id, what) : null, asset_id: t.asset_id ? ref(t.asset_id, what) : null,
        notes: t.notes, allocations, idempotency_key: `import:${b.id}:${t.key ?? created.transactions ?? 0}:${t.txn_date}`, allow_duplicate: true,
      });
    } catch (err) {
      if (err instanceof HttpError) throw new HttpError(err.status, `${what} on ${t.txn_date}: ${err.message}`);
      throw err;
    }
    created.transactions = (created.transactions ?? 0) + 1;
    const left = paise(t.amount, what) - allocations.reduce((s: number, a: Row) => s + a.amount, 0);
    if (left > 0 && ['brand_payment', 'creator_payout', 'editor_payout'].includes(t.category)) unapplied.push({ date: t.txn_date, description: t.description, amount: left });
  }

  for (const u of b.tds_updates ?? []) {
    const what = where('TDS entry', u);
    const credit = get(db, `SELECT id FROM tds_credits WHERE invoice_id = ? AND status <> 'reversed' ORDER BY id DESC`, ref(u.invoice_id, what));
    if (!credit) throw new HttpError(400, `${what}: no TDS was recorded on ${u.invoice_id}`);
    updateTdsCredit(db, user, credit.id, { status: u.status, claimed_in: u.claimed_in ?? null, notes: u.notes ?? null });
  }

  const t = today(db);
  const invoices = listInvoices(db, t).filter((i) => i.status !== 'cancelled' && i.outstanding > 0);
  const payables = listObligations(db, t).filter((o) => !['cancelled', 'on_hold'].includes(o.status) && o.outstanding > 0);
  return {
    source: b.source ?? null,
    notes: b.notes ?? [],
    created,
    cash: totalCash(db, t),
    receivables: invoices.map((i) => ({ label: i.label, payer: i.payer, due: i.due_date, outstanding: i.outstanding })),
    payables: payables.map((o) => ({ description: o.description, payee: o.payee, due: o.due_date, outstanding: o.outstanding })),
    unapplied,
    tds: all(db, 'SELECT payer_name, amount, status FROM tds_credits'),
  };
}
