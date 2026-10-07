import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatINR, rupeesToPaise, splitProportional, applyBps } from '../src/shared/money.ts';
import { insert, openDb, get, type User } from '../src/server/db.ts';
import {
  accountBalances, allocate, campaignFinancials, cashPosition, changeEarmark, createEarmark, earnings, forecastInputs,
  importTransactions, listEarmarks, listInvoices, listObligations, recordTransaction, recordTransfer, reverseTransaction, settleNonCash, totalCash,
} from '../src/server/finance.ts';
import { forecast, simulatePurchase, SCENARIOS } from '../src/server/forecast.ts';

process.env.HQ_TODAY = '2026-10-07';
const T = '2026-10-07';
const L = (rupees: number) => rupees * 100; // rupees -> paise

function setup() {
  const db = openDb(':memory:');
  const uid = insert(db, 'users', { name: 'Founder', email: 'f@x.in', role: 'founder', status: 'active', password_hash: 'x' });
  const user: User = { id: uid, name: 'Founder', email: 'f@x.in', role: 'founder', editor_id: null, influencer_id: null, brand_id: null };
  const bank = insert(db, 'accounts', { name: 'HDFC Current', type: 'bank', opening_balance: L(40_000), opening_date: '2026-09-01', active: true });
  const wallet = insert(db, 'accounts', { name: 'Petty cash', type: 'cash', opening_balance: L(5_000), opening_date: '2026-09-01', active: true });
  const brand = insert(db, 'brands', { name: 'Glow Co', status: 'active' });
  const creator = insert(db, 'influencers', { name: 'Riya', relationship: 'exclusive' });
  return { db, user, bank, wallet, brand, creator };
}

test('money: parsing, Indian formatting, exact splits', () => {
  assert.equal(rupeesToPaise('1,00,000'), 10_000_000);
  assert.equal(rupeesToPaise('₹ 2,500.5'), 250_050);
  assert.equal(rupeesToPaise(0.1 + 0.2), 30);
  assert.throws(() => rupeesToPaise('12.345'));
  assert.equal(formatINR(10_000_000), '₹1,00,000');
  assert.equal(formatINR(1_234_567_890), '₹1,23,45,678.90');
  assert.equal(formatINR(-5_000_000, { compact: true }), '-₹50K');
  assert.equal(formatINR(12_500_000, { compact: true }), '₹1.25L');
  const parts = splitProportional(10_000, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 10_000);
  assert.deepEqual(parts, [3334, 3333, 3333]);
  assert.equal(applyBps(L(1_00_000), 1800), L(18_000));
});

test('transfers move cash between accounts without changing totals or earnings', () => {
  const { db, user, bank, wallet } = setup();
  const before = totalCash(db, T);
  recordTransfer(db, user, { from_account_id: bank, to_account_id: wallet, amount: L(10_000), txn_date: '2026-10-01' });
  assert.equal(totalCash(db, T), before);
  const bal = Object.fromEntries(accountBalances(db, T).map((a) => [a.id, a.balance]));
  assert.equal(bal[bank], L(30_000));
  assert.equal(bal[wallet], L(15_000));
  const e = earnings(db, '2026-10-01', '2026-10-31', T);
  assert.equal(e.cash_collected, 0);
  assert.equal(e.opex, 0);
});

test('partial payments, over-payment guard, duplicate guards and reversal', () => {
  const { db, user, bank, brand } = setup();
  const inv = insert(db, 'invoices', { label: 'Advance', kind: 'brand_billing', status: 'issued', number: 'SM-001', payer_type: 'brand', brand_id: brand, issue_date: '2026-10-01', due_date: '2026-10-10', expected_date: '2026-10-10', confidence: 'confirmed', subtotal: L(50_000), tax: 0, total: L(50_000) });
  const unpaid = listInvoices(db, T, { ids: [inv] })[0];
  assert.equal(unpaid.outstanding, L(50_000));
  assert.equal(totalCash(db, T), L(45_000), 'an unpaid invoice is not cash');

  const t1 = recordTransaction(db, user, { account_id: bank, txn_date: '2026-10-02', direction: 'in', amount: L(20_000), category: 'brand_payment', reference: 'UTR1', allocations: [{ invoice_id: inv, amount: L(20_000) }], idempotency_key: 'form-1' });
  let r = listInvoices(db, T, { ids: [inv] })[0];
  assert.equal(r.payment_state, 'part_paid');
  assert.equal(r.outstanding, L(30_000));

  // Same form submitted twice: no second transaction.
  assert.equal(recordTransaction(db, user, { account_id: bank, txn_date: '2026-10-02', direction: 'in', amount: L(20_000), category: 'brand_payment', reference: 'UTR1', idempotency_key: 'form-1' }), t1);
  // Same bank reference again: rejected.
  assert.throws(() => recordTransaction(db, user, { account_id: bank, txn_date: '2026-10-02', direction: 'in', amount: L(20_000), category: 'brand_payment', reference: 'UTR1' }), /duplicate/i);
  // Allocating more than is outstanding: rejected and nothing is written.
  assert.throws(() => recordTransaction(db, user, { account_id: bank, txn_date: '2026-10-03', direction: 'in', amount: L(40_000), category: 'brand_payment', reference: 'UTR2', allocations: [{ invoice_id: inv, amount: L(40_000) }] }), /exceeds the outstanding/);
  assert.equal(totalCash(db, T), L(65_000));
  // Future-dated cash is refused.
  assert.throws(() => recordTransaction(db, user, { account_id: bank, txn_date: '2026-12-01', direction: 'in', amount: L(1), category: 'brand_payment' }), /future/);

  // Brand pays 27,000 and withholds 3,000 TDS: invoice fully settled, cash only 27,000.
  recordTransaction(db, user, { account_id: bank, txn_date: '2026-10-05', direction: 'in', amount: L(27_000), category: 'brand_payment', reference: 'UTR3', allocations: [{ invoice_id: inv, amount: L(27_000), tds: L(3_000) }] });
  r = listInvoices(db, T, { ids: [inv] })[0];
  assert.equal(r.payment_state, 'settled');
  assert.equal(totalCash(db, T), L(92_000));

  // Reversal restores the balance and the outstanding amount, keeping both records.
  reverseTransaction(db, user, t1, 'Bounced');
  assert.equal(totalCash(db, T), L(72_000));
  r = listInvoices(db, T, { ids: [inv] })[0];
  assert.equal(r.outstanding, L(20_000));
  assert.ok(get(db, 'SELECT reversed_by_id FROM transactions WHERE id = ?', t1)!.reversed_by_id);
  assert.throws(() => reverseTransaction(db, user, t1, 'again'), /already reversed/);
});

test('payout with TDS deduction creates a tax payable; recurring payable rolls forward', () => {
  const { db, user, bank, creator } = setup();
  const ob = insert(db, 'obligations', { description: 'Reel fee', category: 'creator_payout', payee_type: 'influencer', influencer_id: creator, amount: L(20_000), due_date: '2026-10-05', status: 'committed', repeat: 'none' });
  recordTransaction(db, user, { account_id: bank, txn_date: '2026-10-05', direction: 'out', amount: L(18_000), category: 'creator_payout', reference: 'P1', allocations: [{ obligation_id: ob, amount: L(18_000), tds: L(2_000) }] });
  assert.equal(listObligations(db, T, { ids: [ob] })[0].payment_state, 'settled');
  const tax = get(db, `SELECT * FROM obligations WHERE category = 'tax'`)!;
  assert.equal(tax.amount, L(2_000));
  assert.equal(tax.due_date, '2026-11-07');

  const rent = insert(db, 'obligations', { description: 'Studio rent', category: 'rent', payee_type: 'other', payee_name: 'Landlord', amount: L(15_000), due_date: '2026-10-05', status: 'committed', repeat: 'monthly' });
  recordTransaction(db, user, { account_id: bank, txn_date: '2026-10-06', direction: 'out', amount: L(15_000), category: 'operating_expense', reference: 'R1', allocations: [{ obligation_id: rent, amount: L(15_000) }] });
  const next = get(db, `SELECT * FROM obligations WHERE source = ?`, `repeat:${rent}`)!;
  assert.equal(next.due_date, '2026-11-05');
});

test('campaign costs are not double counted across budget, payables and payouts', () => {
  const { db, user, bank, brand, creator } = setup();
  const camp = insert(db, 'campaigns', { name: 'Diwali', brand_id: brand, stage: 'production', billing_model: 'gross', client_budget: L(1_00_000), budget_plan: [{ category: 'creator', planned: L(60_000) }, { category: 'editing', planned: L(10_000) }] });
  insert(db, 'invoices', { label: 'Advance 50%', kind: 'brand_billing', status: 'issued', number: 'SM-2', payer_type: 'brand', brand_id: brand, campaign_id: camp, issue_date: '2026-10-01', due_date: '2026-10-01', expected_date: '2026-10-01', confidence: 'confirmed', subtotal: L(50_000), tax: 0, total: L(50_000) });
  insert(db, 'invoices', { label: 'Final 50%', kind: 'brand_billing', status: 'scheduled', payer_type: 'brand', brand_id: brand, campaign_id: camp, due_date: '2026-11-15', expected_date: '2026-11-15', confidence: 'expected', subtotal: L(50_000), tax: 0, total: L(50_000) });
  const ob = insert(db, 'obligations', { description: 'Creator fee', category: 'creator_payout', payee_type: 'influencer', influencer_id: creator, campaign_id: camp, amount: L(65_000), due_date: '2026-10-20', status: 'committed' });
  insert(db, 'obligations', { description: 'Edit', category: 'editor_payout', payee_type: 'other', payee_name: 'Editor', campaign_id: camp, amount: L(10_000), due_date: '2026-10-15', status: 'committed' });
  recordTransaction(db, user, { account_id: bank, txn_date: '2026-10-06', direction: 'out', amount: L(30_000), category: 'creator_payout', campaign_id: camp, reference: 'C1', allocations: [{ obligation_id: ob, amount: L(30_000) }] });
  // A campaign expense with no payable record (paid directly).
  recordTransaction(db, user, { account_id: bank, txn_date: '2026-10-06', direction: 'out', amount: L(2_000), category: 'vendor_payment', campaign_id: camp, reference: 'V1' });

  const f = campaignFinancials(db, T).get(camp)!;
  assert.equal(f.planned_cost, L(70_000));
  assert.equal(f.committed_cost, L(77_000), '65k + 10k payables + 2k direct spend; the 30k payout is not counted again');
  assert.equal(f.paid_cost, L(32_000));
  assert.equal(f.unpaid_cost, L(45_000));
  assert.equal(f.revenue, L(1_00_000));
  assert.equal(f.contribution_margin, L(23_000));
  assert.equal(f.agency_earnings, L(35_000), 'billing − pass-through creator fees');
  assert.equal(f.over_budget, false);
  assert.equal(f.financially_closed, false);
});

test('earmarks are internal allocations with preserved history', () => {
  const { db, user, creator } = setup();
  const ob = insert(db, 'obligations', { description: 'Fee', category: 'creator_payout', payee_type: 'influencer', influencer_id: creator, amount: L(10_000), due_date: '2026-10-20', status: 'committed' });
  const cashBefore = totalCash(db, T);
  const e1 = createEarmark(db, user, { target_type: 'obligation', obligation_id: ob, amount: L(6_000) });
  assert.throws(() => createEarmark(db, user, { target_type: 'obligation', obligation_id: ob, amount: L(5_000) }), /exceed/);
  const e2 = changeEarmark(db, user, e1, L(8_000), 'Creator asked for early payment');
  createEarmark(db, user, { target_type: 'reserve', label: 'GST reserve', amount: L(5_000), protected: true });
  assert.equal(totalCash(db, T), cashBefore, 'earmarking never moves money');
  const hist = listEarmarks(db, T, true);
  assert.equal(hist.find((e) => e.id === e1)!.status, 'released');
  assert.equal(hist.find((e) => e.id === e2)!.supersedes_id, e1);
  const pos = cashPosition(db, T, { reserves: 'protected' });
  assert.equal(pos.earmarks.total, L(13_000));
  assert.equal(pos.unallocated, cashBefore - L(13_000));
  assert.equal(pos.afterCommitments, cashBefore - L(10_000) - L(5_000));
});

test('bank CSV import skips duplicates and leaves rows uncategorised', () => {
  const { db, user, bank } = setup();
  const rows = [
    { date: '03/10/2026', description: 'NEFT GLOW CO', reference: 'N123', amount: '25,000.00' },
    { date: '04-Oct-2026', description: 'Adobe subscription', amount: '-1,675.50' },
  ];
  assert.deepEqual({ ...importTransactions(db, user, bank, rows), errors: [] }, { imported: 2, duplicates: 0, errors: [] });
  const again = importTransactions(db, user, bank, [...rows, { date: '31/02/2026', amount: '5' }]);
  assert.equal(again.imported, 0);
  assert.equal(again.duplicates, 2);
  assert.equal(again.errors.length, 1);
  assert.equal(totalCash(db, T), L(45_000) + L(25_000) - 167_550);
});

test('forecast: same-day ordering decides whether a payout can be made', () => {
  const base = {
    today: T, horizonDays: 30, openingCash: L(10_000), reserves: [],
    receivables: [{ id: 1, label: 'Brand final', amount: L(50_000), expectedDate: '2026-10-10', confidence: 'confirmed' as const }],
    obligations: [{ id: 1, label: 'Creator payout', amount: L(40_000), dueDate: '2026-10-10', status: 'committed' }],
  };
  const inFirst = forecast({ ...base, scenario: { ...SCENARIOS.base, sameDay: 'inflows_first' } });
  assert.equal(inFirst.affected.length, 0);
  assert.equal(inFirst.earliestShortfall, null);
  const outFirst = forecast({ ...base, scenario: { ...SCENARIOS.base, sameDay: 'outflows_first' } });
  assert.equal(outFirst.affected[0].payable, 'partial');
  assert.equal(outFirst.earliestShortfall?.date, '2026-10-10');
  assert.equal(outFirst.fundingRequired, L(30_000));
  // Events are in date order, overdue payables are pulled to today.
  const f = forecast({ ...base, obligations: [...base.obligations, { id: 2, label: 'Old bill', amount: L(1_000), dueDate: '2026-09-01', status: 'committed' }], scenario: SCENARIOS.base });
  assert.equal(f.events[0].date, T);
  assert.ok(f.events.every((e, i) => i === 0 || f.events[i - 1].date <= e.date));
});

test("founder's example: ₹1L campaign, ₹50k advance, ₹30k camera, delayed commission", () => {
  const { db, user, bank, brand, creator } = setup();
  // Opening: 40,000 bank + 5,000 cash. Advance of 50,000 received.
  const camp = insert(db, 'campaigns', { name: 'Glow launch', brand_id: brand, stage: 'production', billing_model: 'gross', client_budget: L(1_00_000) });
  const adv = insert(db, 'invoices', { label: 'Advance', kind: 'brand_billing', status: 'issued', number: 'SM-10', payer_type: 'brand', brand_id: brand, campaign_id: camp, issue_date: '2026-10-01', due_date: '2026-10-01', expected_date: '2026-10-01', confidence: 'confirmed', subtotal: L(50_000), tax: 0, total: L(50_000) });
  insert(db, 'invoices', { label: 'Final payment', kind: 'brand_billing', status: 'scheduled', payer_type: 'brand', brand_id: brand, campaign_id: camp, due_date: '2026-11-05', expected_date: '2026-11-05', confidence: 'expected', subtotal: L(50_000), tax: 0, total: L(50_000) });
  const commission = insert(db, 'invoices', { label: 'Commission', kind: 'commission', status: 'issued', number: 'SM-11', payer_type: 'influencer', influencer_id: creator, issue_date: '2026-10-01', due_date: '2026-10-25', expected_date: '2026-10-25', confidence: 'expected', subtotal: L(20_000), tax: 0, total: L(20_000) });
  recordTransaction(db, user, { account_id: bank, txn_date: '2026-10-02', direction: 'in', amount: L(50_000), category: 'brand_payment', reference: 'ADV', allocations: [{ invoice_id: adv, amount: L(50_000) }] });
  insert(db, 'obligations', { description: 'Creator fees', category: 'creator_payout', payee_type: 'influencer', influencer_id: creator, campaign_id: camp, amount: L(65_000), due_date: '2026-10-28', status: 'committed' });
  insert(db, 'obligations', { description: 'Editing', category: 'editor_payout', payee_type: 'other', payee_name: 'Editor', campaign_id: camp, amount: L(10_000), due_date: '2026-10-20', status: 'committed' });

  const inputs = forecastInputs(db, T);
  assert.equal(inputs.openingCash, L(95_000));
  const fc = { today: T, horizonDays: 60, ...inputs, scenario: SCENARIOS.base };

  // Without the camera: 95k − 10k (20 Oct) + 20k commission (25 Oct) − 65k (28 Oct) = 40k, then +50k on 5 Nov.
  const plain = forecast(fc);
  assert.equal(plain.earliestShortfall, null);
  assert.equal(plain.minBalance, L(40_000));

  // Camera on 8 Oct: 95k − 30k = 65k → −10k → 55k → +20k = 75k → −65k = 10k. Still positive.
  const cam = simulatePurchase(fc, { label: 'Camera', amount: L(30_000), date: '2026-10-08' });
  assert.equal(cam.safe, true);
  assert.equal(cam.with.minBalance, L(10_000));

  // Delay the commission by 30 days: creator payout on 28 Oct now short by 10,000 until the final payment on 5 Nov.
  const delayed = simulatePurchase({ ...fc, scenario: { ...SCENARIOS.base, receivableOverrides: { [commission]: { delayDays: 30 } } } }, { label: 'Camera', amount: L(30_000), date: '2026-10-08' });
  assert.equal(delayed.safe, false);
  assert.equal(delayed.with.earliestShortfall?.date, '2026-10-28');
  assert.equal(delayed.with.fundingRequired, L(10_000));
  assert.equal(delayed.newlyAffected[0].shortBy, L(10_000));
  assert.equal(delayed.with.recoveryDate, '2026-11-05');
  assert.match(delayed.warning!, /Creator fees/);
  // Obligations are untouched by simulations.
  assert.equal(listObligations(db, T, { open: true }).length, 2);
});
