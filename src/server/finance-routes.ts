import type { Express, Request } from 'express';
import { addDays, financialYearStart, isIsoDate, monthStart } from '../shared/dates.ts';
import { TXN_GROUP } from '../shared/schema.ts';
import { all, audit, get, HttpError, insert, run, tx, type Row } from './db.ts';
import { requireCap, sendCsv, toCsv } from './app.ts';
import {
  accountBalances, ageing, allocate, campaignFinancials, cashflowByPeriod, cashPosition, changeEarmark, classifyTransaction, createEarmark,
  earnings, forecastInputs, importTransactions, listEarmarks, listInvoices, listObligations, payeeStatement, recordTransaction,
  recordTransfer, reverseSettlement, reverseTransaction, settleNonCash, TDS_OWNER_LABEL, tdsPeriod, tdsRegister, today, updateTdsCredit,
} from './finance.ts';
import { forecast, SCENARIOS, simulatePurchase, type Confidence, type Scenario } from './forecast.ts';

const CONFIDENCES: Confidence[] = ['confirmed', 'expected', 'at_risk', 'delayed'];

export function parseScenario(body: Row): Scenario {
  const name = body?.scenario ?? 'base';
  const preset = SCENARIOS[(name === 'conservative' ? 'conservative' : 'base') as 'base' | 'conservative'];
  const c = body?.custom ?? {};
  const int = (v: unknown, d: number, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : d);
  const sc: Scenario = name === 'custom'
    ? {
        name: 'custom',
        include: Array.isArray(c.include) ? c.include.filter((x: string) => CONFIDENCES.includes(x as Confidence)) : preset.include,
        receiptDelayDays: int(c.receiptDelayDays, 0, 365),
        overdueReceiptDays: int(c.overdueReceiptDays, 7, 365),
        includePlanned: c.includePlanned !== false,
        includeOnHold: !!c.includeOnHold,
        sameDay: c.sameDay === 'outflows_first' ? 'outflows_first' : 'inflows_first',
        protectReserves: !!c.protectReserves,
      }
    : { ...preset };
  const overrides = (o: unknown) =>
    Object.fromEntries(Object.entries((o ?? {}) as Row).filter(([k]) => Number.isInteger(Number(k))).map(([k, v]) => [Number(k), v as Row]));
  sc.receivableOverrides = Object.fromEntries(
    Object.entries(overrides(body?.receivableOverrides)).map(([k, v]) => [k, { exclude: !!v.exclude, delayDays: int(v.delayDays, 0, 365) }]),
  );
  sc.obligationOverrides = Object.fromEntries(
    Object.entries(overrides(body?.obligationOverrides)).map(([k, v]) => [k, { exclude: !!v.exclude, date: isIsoDate(v.date) ? v.date : undefined }]),
  );
  return sc;
}

function horizon(body: Row): number {
  const h = Number(body?.horizonDays ?? 90);
  return Number.isInteger(h) && h >= 7 && h <= 366 ? h : 90;
}

function period(req: Request): { from: string; to: string } {
  const t = today(req.db);
  const from = isIsoDate(req.query.from) ? String(req.query.from) : financialYearStart(t);
  const to = isIsoDate(req.query.to) ? String(req.query.to) : t;
  if (from > to) throw new HttpError(400, 'Start date must be before end date');
  return { from, to };
}

export function financeRoutes(app: Express) {
  app.get('/api/finance/position', (req, res) => {
    requireCap(req, 'finance');
    const q = req.query;
    res.json(cashPosition(req.db, today(req.db), {
      horizonDays: q.horizon && q.horizon !== 'all' ? Number(q.horizon) : null,
      includePlanned: q.planned !== '0',
      reserves: (['all', 'protected', 'none'].includes(String(q.reserves)) ? q.reserves : 'protected') as 'all' | 'protected' | 'none',
    }));
  });

  app.get('/api/finance/accounts', (req, res) => {
    requireCap(req, 'finance');
    res.json({ rows: accountBalances(req.db, isIsoDate(req.query.as_of) ? String(req.query.as_of) : today(req.db)) });
  });

  app.get('/api/finance/transactions', (req, res) => {
    requireCap(req, 'finance');
    const where = ['1=1'];
    const params: unknown[] = [];
    const { from, to, account_id, category, campaign_id, reconciliation, q, asset_id } = req.query;
    if (isIsoDate(from)) where.push('t.txn_date >= ?'), params.push(from);
    if (isIsoDate(to)) where.push('t.txn_date <= ?'), params.push(to);
    if (account_id) where.push('t.account_id = ?'), params.push(Number(account_id));
    if (category) where.push('t.category = ?'), params.push(String(category));
    if (campaign_id) where.push('t.campaign_id = ?'), params.push(Number(campaign_id));
    if (asset_id) where.push('t.asset_id = ?'), params.push(Number(asset_id));
    if (reconciliation) where.push('t.reconciliation = ?'), params.push(String(reconciliation));
    if (q) where.push('(t.description LIKE ? OR t.reference LIKE ? OR t.counterparty_name LIKE ?)'), params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    const rows = all(
      req.db,
      `SELECT t.*, a.name AS account_name, c.name AS campaign_name, u.name AS created_by_name,
         COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.transaction_id = t.id AND s.reversed_at IS NULL), 0) AS allocated
       FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN campaigns c ON c.id = t.campaign_id LEFT JOIN users u ON u.id = t.created_by
       WHERE ${where.join(' AND ')} ORDER BY t.txn_date DESC, t.id DESC LIMIT 5000`,
      ...params,
    ).map((t) => ({ ...t, group: TXN_GROUP[t.category], unallocated: t.amount - t.allocated }));
    if (req.query.format === 'csv') {
      return sendCsv(res, 'transactions.csv', toCsv(rows, [
        { key: 'txn_date', label: 'Date' }, { key: 'account_name', label: 'Account' }, { key: 'direction', label: 'Direction' },
        { key: 'amount', label: 'Amount (INR)', type: 'money' }, { key: 'category', label: 'Category' }, { key: 'group', label: 'Reporting group' },
        { key: 'description', label: 'Description' }, { key: 'counterparty_name', label: 'Counterparty' }, { key: 'campaign_name', label: 'Campaign' },
        { key: 'reference', label: 'Reference' }, { key: 'reconciliation', label: 'Reconciliation' }, { key: 'reversal_of_id', label: 'Reversal of #' }, { key: 'reversed_by_id', label: 'Reversed by #' },
      ]));
    }
    res.json({ rows });
  });

  app.get('/api/finance/transactions/:id', (req, res) => {
    requireCap(req, 'finance');
    const t = get(req.db, `SELECT t.*, a.name AS account_name, c.name AS campaign_name FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN campaigns c ON c.id = t.campaign_id WHERE t.id = ?`, Number(req.params.id));
    if (!t) throw new HttpError(404, 'Transaction not found');
    const settlements = all(req.db, `SELECT s.*, i.label AS invoice_label, i.number, o.description AS obligation_label FROM settlements s LEFT JOIN invoices i ON i.id = s.invoice_id LEFT JOIN obligations o ON o.id = s.obligation_id WHERE s.transaction_id = ? ORDER BY s.id`, t.id);
    const legs = t.transfer_group ? all(req.db, `SELECT t.id, t.direction, t.amount, a.name AS account_name FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.transfer_group = ?`, t.transfer_group) : [];
    res.json({ row: t, settlements, legs });
  });

  app.post('/api/finance/transactions', (req, res) => {
    const u = requireCap(req, 'finance');
    const id = recordTransaction(req.db, u, req.body ?? {});
    res.status(201).json({ id });
  });

  app.patch('/api/finance/transactions/:id', (req, res) => {
    const u = requireCap(req, 'finance');
    classifyTransaction(req.db, u, Number(req.params.id), req.body ?? {});
    res.json({ ok: true });
  });

  app.post('/api/finance/transactions/:id/allocate', (req, res) => {
    const u = requireCap(req, 'finance');
    allocate(req.db, u, Number(req.params.id), Array.isArray(req.body?.allocations) ? req.body.allocations : []);
    res.json({ ok: true });
  });

  app.post('/api/finance/transactions/:id/reverse', (req, res) => {
    const u = requireCap(req, 'finance');
    res.json({ ids: reverseTransaction(req.db, u, Number(req.params.id), req.body?.reason, req.body?.date) });
  });

  app.post('/api/finance/transfers', (req, res) => {
    const u = requireCap(req, 'finance');
    res.status(201).json({ group: recordTransfer(req.db, u, req.body ?? {}) });
  });

  app.post('/api/finance/import', (req, res) => {
    const u = requireCap(req, 'finance');
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'No rows to import');
    if (rows.length > 5000) throw new HttpError(400, 'Import at most 5,000 rows at a time');
    res.json(importTransactions(req.db, u, Number(req.body.account_id), rows));
  });

  const listFilter = (req: Request) => ({
    campaign_id: req.query.campaign_id ? Number(req.query.campaign_id) : undefined,
    brand_id: req.query.brand_id ? Number(req.query.brand_id) : undefined,
    influencer_id: req.query.influencer_id ? Number(req.query.influencer_id) : undefined,
    editor_id: req.query.editor_id ? Number(req.query.editor_id) : undefined,
    open: req.query.open === '1',
  });

  app.get('/api/finance/receivables', (req, res) => {
    requireCap(req, 'campaign_finance');
    const t = today(req.db);
    const rows = listInvoices(req.db, t, listFilter(req));
    if (req.query.format === 'csv') {
      return sendCsv(res, 'receivables.csv', toCsv(rows, [
        { key: 'number', label: 'Invoice no.' }, { key: 'label', label: 'Milestone' }, { key: 'payer', label: 'Payer' }, { key: 'campaign_name', label: 'Campaign' },
        { key: 'status', label: 'Status' }, { key: 'issue_date', label: 'Issued' }, { key: 'due_date', label: 'Due' }, { key: 'expected_date', label: 'Expected' },
        { key: 'confidence', label: 'Confidence' }, { key: 'total', label: 'Total (INR)', type: 'money' }, { key: 'paid', label: 'Received (INR)', type: 'money' },
        { key: 'tds', label: 'TDS (INR)', type: 'money' }, { key: 'written_off', label: 'Written off (INR)', type: 'money' }, { key: 'outstanding', label: 'Outstanding (INR)', type: 'money' }, { key: 'days_overdue', label: 'Days overdue' },
      ]));
    }
    res.json({ rows, ageing: ageing(rows) });
  });

  app.get('/api/finance/payables', (req, res) => {
    requireCap(req, 'campaign_finance');
    const rows = listObligations(req.db, today(req.db), listFilter(req));
    if (req.query.format === 'csv') {
      return sendCsv(res, 'payables.csv', toCsv(rows, [
        { key: 'description', label: 'Description' }, { key: 'category', label: 'Category' }, { key: 'payee', label: 'Payee' }, { key: 'campaign_name', label: 'Campaign' },
        { key: 'status', label: 'Status' }, { key: 'due_date', label: 'Due' }, { key: 'amount', label: 'Amount (INR)', type: 'money' }, { key: 'paid', label: 'Paid (INR)', type: 'money' },
        { key: 'tds', label: 'TDS deducted (INR)', type: 'money' }, { key: 'outstanding', label: 'Outstanding (INR)', type: 'money' }, { key: 'earmarked', label: 'Earmarked (INR)', type: 'money' }, { key: 'days_overdue', label: 'Days overdue' },
      ]));
    }
    res.json({ rows, ageing: ageing(rows) });
  });

  app.get('/api/finance/settlements', (req, res) => {
    requireCap(req, 'campaign_finance');
    const col = req.query.invoice_id ? 'invoice_id' : 'obligation_id';
    const id = Number(req.query.invoice_id ?? req.query.obligation_id);
    res.json({
      rows: all(req.db, `SELECT s.*, t.txn_date, t.reference, t.method, a.name AS account_name, u.name AS created_by_name FROM settlements s LEFT JOIN transactions t ON t.id = s.transaction_id LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN users u ON u.id = s.created_by WHERE s.${col} = ? ORDER BY s.settled_on, s.id`, id),
    });
  });

  // TDS register: what brands withheld from us (whose credit it is, and whether it has reached 26AS/AIS) and what we deducted from payouts.
  app.get('/api/finance/tds', (req, res) => {
    requireCap(req, 'finance');
    const fy = typeof req.query.fy === 'string' && /^\d{4}-\d{2}$/.test(req.query.fy) ? req.query.fy : null;
    const reg = tdsRegister(req.db, fy);
    if (req.query.format === 'csv') {
      return sendCsv(res, `tds-register${fy ? `-${fy}` : ''}.csv`, toCsv(reg.credits.map((c) => ({ ...c, whose: TDS_OWNER_LABEL[c.owner as keyof typeof TDS_OWNER_LABEL] ?? c.owner })), [
        { key: 'deducted_on', label: 'Deducted on' }, { key: 'fy', label: 'FY' }, { key: 'quarter', label: 'Quarter' }, { key: 'payer_name', label: 'Deducted by' },
        { key: 'invoice_number', label: 'Invoice no.' }, { key: 'invoice_label', label: 'For' }, { key: 'amount', label: 'TDS (INR)', type: 'money' }, { key: 'whose', label: 'Whose credit' },
        { key: 'creator_name', label: 'Creator' }, { key: 'status', label: 'Status' }, { key: 'certificate_ref', label: 'Form 16A / certificate' }, { key: 'claimed_in', label: 'Claimed in' }, { key: 'notes', label: 'Notes' },
      ]));
    }
    const fys = [...all(req.db, 'SELECT DISTINCT fy FROM tds_credits WHERE fy IS NOT NULL').map((r) => r.fy), ...tdsRegister(req.db, null).deducted.map((o) => o.fy).filter(Boolean)];
    res.json({ ...reg, fy, current_fy: tdsPeriod(today(req.db)).fy, fys: [...new Set([tdsPeriod(today(req.db)).fy, ...fys])].sort().reverse(), owners: TDS_OWNER_LABEL });
  });

  app.patch('/api/finance/tds/:id', (req, res) => {
    const u = requireCap(req, 'finance');
    updateTdsCredit(req.db, u, Number(req.params.id), req.body ?? {});
    res.json({ ok: true });
  });

  app.post('/api/finance/settlements', (req, res) => {
    const u = requireCap(req, 'finance');
    res.status(201).json({ id: settleNonCash(req.db, u, req.body ?? {}) });
  });

  app.post('/api/finance/settlements/:id/reverse', (req, res) => {
    const u = requireCap(req, 'finance');
    reverseSettlement(req.db, u, Number(req.params.id), req.body?.reason);
    res.json({ ok: true });
  });

  app.post('/api/finance/invoices/:id/issue', (req, res) => {
    const u = requireCap(req, 'finance');
    const db = req.db;
    const id = Number(req.params.id);
    tx(db, () => {
      const inv = get(db, 'SELECT * FROM invoices WHERE id = ?', id);
      if (!inv) throw new HttpError(404, 'Receivable not found');
      if (inv.status !== 'scheduled') throw new HttpError(400, 'Only scheduled milestones can be issued');
      const issueDate = isIsoDate(req.body?.issue_date) ? req.body.issue_date : today(db);
      let number = String(req.body?.number ?? '').trim();
      if (!number) {
        const fy = financialYearStart(issueDate).slice(0, 4);
        const prefix = `SM/${fy}-${String(Number(fy) + 1).slice(2)}/`;
        const last = get(db, `SELECT number FROM invoices WHERE number LIKE ? ORDER BY number DESC LIMIT 1`, `${prefix}%`);
        number = `${prefix}${String((last ? Number(last.number.slice(prefix.length)) : 0) + 1).padStart(4, '0')}`;
      }
      if (get(db, 'SELECT id FROM invoices WHERE number = ?', number)) throw new HttpError(400, `Invoice number ${number} is already used`);
      run(db, `UPDATE invoices SET status = 'issued', number = ?, issue_date = ?, updated_at = ? WHERE id = ?`, number, issueDate, new Date().toISOString(), id);
      audit(db, u.id, 'issue', 'invoices', id, inv, { number, issue_date: issueDate });
    });
    res.json({ ok: true });
  });

  for (const kind of ['invoices', 'obligations'] as const) {
    app.post(`/api/finance/${kind}/:id/cancel`, (req, res) => {
      const u = requireCap(req, 'finance');
      const reason = String(req.body?.reason ?? '').trim();
      if (!reason) throw new HttpError(400, 'A reason is required to cancel');
      const id = Number(req.params.id);
      tx(req.db, () => {
        const row = get(req.db, `SELECT * FROM ${kind} WHERE id = ?`, id);
        if (!row) throw new HttpError(404, 'Not found');
        if (get(req.db, `SELECT id FROM settlements WHERE ${kind === 'invoices' ? 'invoice_id' : 'obligation_id'} = ? AND kind = 'cash' AND reversed_at IS NULL`, id)) {
          throw new HttpError(400, 'Payments are recorded against this. Reverse or re-allocate them first.');
        }
        // Brand TDS changes creator payables; undo it on the receivable first so nothing is left half-applied.
        if (kind === 'invoices' && get(req.db, `SELECT id FROM tds_credits WHERE invoice_id = ? AND status <> 'reversed'`, id)) {
          throw new HttpError(400, 'TDS withheld by the brand is recorded against this receivable. Reverse that TDS first (it also undoes any creator payables it changed).');
        }
        if (kind === 'obligations' && get(req.db, `SELECT c.id FROM tds_credits c JOIN settlements s ON s.id = c.creator_settlement_id WHERE s.obligation_id = ? AND c.status <> 'reversed' AND s.reversed_at IS NULL`, id)) {
          throw new HttpError(400, 'Brand TDS is applied to this payable. Reverse that TDS on the brand receivable first.');
        }
        run(req.db, `UPDATE ${kind} SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ?`, reason, new Date().toISOString(), id);
        if (kind === 'obligations') run(req.db, `UPDATE earmarks SET status = 'released', ended_at = ?, end_reason = 'Payable cancelled' WHERE obligation_id = ? AND status = 'active'`, new Date().toISOString(), id);
        audit(req.db, u.id, 'cancel', kind, id, row, null, reason);
      });
      res.json({ ok: true });
    });
  }

  app.get('/api/finance/earmarks', (req, res) => {
    requireCap(req, 'finance');
    res.json({ rows: listEarmarks(req.db, today(req.db), req.query.history === '1') });
  });

  app.post('/api/finance/earmarks', (req, res) => {
    const u = requireCap(req, 'finance');
    res.status(201).json({ id: createEarmark(req.db, u, req.body ?? {}) });
  });

  app.post('/api/finance/earmarks/:id/change', (req, res) => {
    const u = requireCap(req, 'finance');
    const amount = req.body?.amount === null || req.body?.amount === undefined ? null : Number(req.body.amount);
    res.json({ id: changeEarmark(req.db, u, Number(req.params.id), amount, req.body?.reason) });
  });

  const fcInput = (req: Request) => {
    const t = today(req.db);
    const h = horizon(req.body);
    return { today: t, horizonDays: h, ...forecastInputs(req.db, t, h), scenario: parseScenario(req.body) };
  };

  app.post('/api/finance/forecast', (req, res) => {
    requireCap(req, 'finance');
    res.json(forecast(fcInput(req)));
  });

  const purchaseOf = (req: Request) => {
    const amount = Number(req.body?.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'Enter the purchase amount');
    if (!isIsoDate(req.body?.date)) throw new HttpError(400, 'Choose the purchase date');
    return { label: String(req.body?.label || 'Purchase').slice(0, 200), amount, date: req.body.date as string };
  };

  app.post('/api/finance/simulate', (req, res) => {
    requireCap(req, 'finance');
    res.json(simulatePurchase(fcInput(req), purchaseOf(req)));
  });

  // Record the founder's decision. The warning is recomputed on the server and kept with the decision.
  app.post('/api/finance/simulations', (req, res) => {
    const u = requireCap(req, 'finance');
    const p = purchaseOf(req);
    const decision = String(req.body?.decision ?? 'simulated');
    if (!['simulated', 'proceed', 'override', 'cancelled'].includes(decision)) throw new HttpError(400, 'Invalid decision');
    const result = simulatePurchase(fcInput(req), p);
    const reason = String(req.body?.reason ?? '').trim();
    if (decision === 'proceed' && !result.safe) throw new HttpError(400, 'This purchase has a cash warning. Record an override with a reason instead.');
    if (decision === 'override' && !reason) throw new HttpError(400, 'A reason is required to override a cash warning');
    const id = tx(req.db, () => {
      const simId = insert(req.db, 'purchase_simulations', {
        label: p.label, amount: p.amount, purchase_date: p.date, scenario: result.with.scenario, decision, reason: reason || null, created_by: u.id,
        result: {
          safe: result.safe, warning: result.warning, funding_required: result.with.fundingRequired, funding_required_without: result.without.fundingRequired,
          earliest_shortfall: result.with.earliestShortfall, recovery_date: result.with.recoveryDate, min_balance: result.with.minBalance,
          affected: result.newlyAffected.map((e) => ({ label: e.label, date: e.date, amount: e.amount, shortBy: e.shortBy })), assumptions: result.with.assumptions,
        },
      });
      if ((decision === 'proceed' || decision === 'override') && req.body?.create_payable !== false) {
        const obId = insert(req.db, 'obligations', {
          description: p.label, category: 'asset_purchase', payee_type: 'vendor', payee_name: req.body?.vendor || null, amount: p.amount, due_date: p.date,
          status: 'committed', priority: 'normal', repeat: 'none', source: `sim:${simId}`, created_by: u.id,
          notes: decision === 'override' ? `Founder override: ${reason}` : null,
        });
        run(req.db, 'UPDATE purchase_simulations SET obligation_id = ? WHERE id = ?', obId, simId);
      }
      audit(req.db, u.id, decision, 'purchase_simulations', simId, null, { ...p, reason, warning: result.warning });
      return simId;
    });
    res.status(201).json({ id, safe: result.safe, warning: result.warning });
  });

  app.get('/api/finance/simulations', (req, res) => {
    requireCap(req, 'finance');
    res.json({ rows: all(req.db, `SELECT p.*, u.name AS created_by_name FROM purchase_simulations p LEFT JOIN users u ON u.id = p.created_by ORDER BY p.id DESC LIMIT 200`).map((r) => ({ ...r, result: JSON.parse(r.result ?? 'null'), scenario: JSON.parse(r.scenario ?? 'null') })) });
  });

  app.get('/api/finance/earnings', (req, res) => {
    requireCap(req, 'finance');
    const { from, to } = period(req);
    res.json(earnings(req.db, from, to, today(req.db)));
  });

  app.get('/api/finance/campaigns', (req, res) => {
    requireCap(req, 'campaign_finance');
    const rows = [...campaignFinancials(req.db, today(req.db)).values()];
    if (req.query.format === 'csv') {
      return sendCsv(res, 'campaign-margins.csv', toCsv(rows, [
        { key: 'name', label: 'Campaign' }, { key: 'brand_name', label: 'Brand' }, { key: 'stage', label: 'Stage' }, { key: 'billing_model', label: 'Model' },
        { key: 'client_budget', label: 'Client budget', type: 'money' }, { key: 'revenue', label: 'Revenue (excl. tax)', type: 'money' }, { key: 'billed', label: 'Billed', type: 'money' },
        { key: 'collected', label: 'Cash collected', type: 'money' }, { key: 'planned_cost', label: 'Planned cost', type: 'money' }, { key: 'committed_cost', label: 'Committed cost', type: 'money' },
        { key: 'paid_cost', label: 'Paid cost', type: 'money' }, { key: 'agency_earnings', label: 'Agency earnings', type: 'money' }, { key: 'contribution_margin', label: 'Contribution margin', type: 'money' },
        { key: 'margin_bps', label: 'Margin %', type: 'percent' }, { key: 'receivable_outstanding', label: 'Receivable outstanding', type: 'money' }, { key: 'unpaid_cost', label: 'Payouts outstanding', type: 'money' },
      ]));
    }
    res.json({ rows });
  });

  app.get('/api/finance/reports/:kind', (req, res) => {
    requireCap(req, req.params.kind === 'campaign-budget' ? 'campaign_finance' : 'finance');
    const db = req.db;
    const t = today(db);
    const { from, to } = period(req);
    let out: { columns: { key: string; label: string; type?: string }[]; rows: Row[]; title: string };
    switch (req.params.kind) {
      case 'cashflow':
        out = {
          title: 'Cash flow by month',
          columns: [{ key: 'period', label: 'Period' }, { key: 'cash_in', label: 'Cash in', type: 'money' }, { key: 'cash_out', label: 'Cash out', type: 'money' }, { key: 'net', label: 'Net', type: 'money' }, { key: 'transfers', label: 'Transfers (excluded)', type: 'money' }],
          rows: cashflowByPeriod(db, from, to, req.query.grain === 'week' ? 'week' : 'month'),
        };
        break;
      case 'receivables-ageing':
        out = { title: 'Receivables ageing', columns: [{ key: 'bucket', label: 'Overdue by' }, { key: 'count', label: 'Items' }, { key: 'total', label: 'Outstanding', type: 'money' }], rows: ageing(listInvoices(db, t, { open: true })) };
        break;
      case 'payables-ageing':
        out = { title: 'Payables ageing', columns: [{ key: 'bucket', label: 'Overdue by' }, { key: 'count', label: 'Items' }, { key: 'total', label: 'Outstanding', type: 'money' }], rows: ageing(listObligations(db, t, { open: true })) };
        break;
      case 'expenses': {
        const rows = all(db, `SELECT t.category, COUNT(*) AS count, SUM(CASE WHEN t.direction = 'out' THEN t.amount ELSE -t.amount END) AS total FROM transactions t WHERE t.txn_date BETWEEN ? AND ? AND t.category IN ('operating_expense','bank_charges','asset_purchase','vendor_payment','editor_payout','creator_payout','tax_payment') GROUP BY t.category ORDER BY total DESC`, from, to)
          .map((r) => ({ ...r, group: TXN_GROUP[r.category] }));
        out = { title: 'Expense breakdown (assets shown separately as capex)', columns: [{ key: 'category', label: 'Category' }, { key: 'group', label: 'Group' }, { key: 'count', label: 'Transactions' }, { key: 'total', label: 'Total', type: 'money' }], rows };
        break;
      }
      case 'campaign-budget': {
        const rows = [...campaignFinancials(db, t).values()].map((f) => ({ ...f, variance: f.committed_cost - f.planned_cost }));
        out = { title: 'Budget vs actual by campaign', columns: [{ key: 'name', label: 'Campaign' }, { key: 'client_budget', label: 'Client budget', type: 'money' }, { key: 'planned_cost', label: 'Planned cost', type: 'money' }, { key: 'committed_cost', label: 'Committed cost', type: 'money' }, { key: 'paid_cost', label: 'Paid', type: 'money' }, { key: 'variance', label: 'Committed − planned', type: 'money' }], rows };
        break;
      }
      case 'operating': {
        const e = earnings(db, from, to, t);
        const rows = [
          { line: 'Gross billings to brands (excl. tax)', amount: e.gross_billings },
          { line: 'Commission billed', amount: e.commission_billed },
          { line: 'Cash collected (incl. GST, pass-through)', amount: e.cash_collected },
          { line: `Agency earnings (${e.basis.basis} basis)`, amount: e.agency_earnings },
          { line: 'Campaign contribution margin', amount: e.contribution_margin },
          { line: 'Operating expenses (paid)', amount: e.opex },
          { line: e.basis.assets === 'capitalise' ? 'Depreciation' : 'Asset purchases (expensed)', amount: e.basis.assets === 'capitalise' ? e.depreciation : e.capex },
          { line: 'Operating result', amount: e.operating_result },
          { line: 'Asset purchases (capex, cash)', amount: e.capex },
          { line: 'Founder contributions', amount: e.financing.founder_contributions },
          { line: 'Founder withdrawals', amount: e.financing.founder_withdrawals },
          { line: 'Loans received', amount: e.financing.loans_received },
          { line: 'Loan repayments', amount: e.financing.loan_repayments },
        ];
        out = { title: 'Agency operating results', columns: [{ key: 'line', label: 'Line' }, { key: 'amount', label: 'Amount', type: 'money' }], rows };
        break;
      }
      case 'statement': {
        const kind = req.query.payee_type === 'editor' ? 'editor' : 'influencer';
        const s = payeeStatement(db, t, kind, Number(req.query.payee_id));
        out = {
          title: `${kind === 'editor' ? 'Editor' : 'Creator'} payment statement`,
          columns: [{ key: 'settled_on', label: 'Date' }, { key: 'description', label: 'For' }, { key: 'kind', label: 'Type' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'reference', label: 'Reference' }],
          rows: s.payments,
        };
        if (req.query.format !== 'csv') return res.json({ ...out, ...s });
        break;
      }
      default:
        throw new HttpError(404, 'Unknown report');
    }
    if (req.query.format === 'csv') return sendCsv(res, `${req.params.kind}-${from}-${to}.csv`, toCsv(out.rows, out.columns));
    res.json({ ...out, from, to });
  });

  // Cash-flow calendar: receivables, payables and actual transactions by day.
  app.get('/api/finance/calendar', (req, res) => {
    requireCap(req, 'finance');
    const t = today(req.db);
    const from = isIsoDate(req.query.from) ? String(req.query.from) : monthStart(t);
    const to = isIsoDate(req.query.to) ? String(req.query.to) : addDays(from, 41);
    const events = [
      ...listInvoices(req.db, t, { open: true }).filter((r) => r.expected_date >= from && r.expected_date <= to).map((r) => ({ date: r.expected_date, kind: 'expected_in', label: `${r.label} — ${r.payer ?? ''}`, amount: r.outstanding, confidence: r.confidence, link: `/finance/receivables/${r.id}` })),
      ...listObligations(req.db, t, { open: true }).filter((r) => r.due_date >= from && r.due_date <= to).map((r) => ({ date: r.due_date, kind: 'due_out', label: `${r.description}${r.payee ? ` — ${r.payee}` : ''}`, amount: r.outstanding, status: r.status, link: `/finance/payables/${r.id}` })),
      ...all(req.db, `SELECT * FROM transactions WHERE txn_date BETWEEN ? AND ? AND category NOT IN ('transfer_in','transfer_out')`, from, to).map((r) => ({ date: r.txn_date, kind: r.direction === 'in' ? 'actual_in' : 'actual_out', label: r.description ?? r.category, amount: r.amount, link: `/finance/transactions/${r.id}` })),
    ];
    res.json({ from, to, events });
  });
}
