import { test } from 'node:test';
import assert from 'node:assert/strict';
import { all, get, insert, openDb, type Row, type User } from '../src/server/db.ts';
import { hashPassword } from '../src/server/app.ts';
import { seedDemo } from '../src/server/seed.ts';
import { backfillTdsCredits, forecastInputs, listInvoices, listObligations, payeeStatement, recordTransaction, reverseSettlement, settleNonCash, tdsPeriod, tdsRegister, today, totalCash, updateTdsCredit } from '../src/server/finance.ts';
import { dashboard } from '../src/server/domain.ts';

process.env.HQ_TODAY = '2026-10-07';
const db = openDb(':memory:');
insert(db, 'users', { name: 'Founder', email: 'f@test.in', role: 'founder', status: 'active', password_hash: hashPassword('founder-password') });
seedDemo(db);
const founder = get(db, `SELECT id, name, email, role, editor_id, influencer_id, brand_id FROM users WHERE email = 'f@test.in'`) as User;
const bank = get(db, `SELECT id FROM accounts WHERE type = 'bank' AND active = 1 ORDER BY id LIMIT 1`)!.id;
const L = (r: number) => r * 100;
const t = () => today(db);

/** A fresh issued receivable and a creator payable to work with. */
function fixture(amount = L(100000)) {
  const brand = get(db, 'SELECT id FROM brands LIMIT 1')!.id;
  const camp = get(db, 'SELECT id FROM campaigns LIMIT 1')!.id;
  const inv = insert(db, 'invoices', { label: 'TDS test', kind: 'brand_billing', status: 'issued', number: `TDS-${Math.random().toString(36).slice(2, 8)}`, payer_type: 'brand', brand_id: brand, campaign_id: camp, issue_date: '2026-09-01', due_date: '2026-10-01', expected_date: '2026-10-01', confidence: 'expected', subtotal: amount, tax: 0, total: amount });
  const creator = get(db, `SELECT id, name FROM influencers WHERE handle = '@riyaglows'`)!;
  const ob = insert(db, 'obligations', { description: 'Creator fee (TDS test)', category: 'creator_payout', payee_type: 'influencer', influencer_id: creator.id, campaign_id: camp, amount: L(65000), due_date: '2026-10-20', status: 'committed', priority: 'normal', repeat: 'none' });
  return { inv, ob, creator };
}
const receive = (inv: number, cash: number, tds: number, split?: Row[]) =>
  recordTransaction(db, founder, { account_id: bank, txn_date: '2026-10-05', direction: 'in', amount: cash, category: 'brand_payment', reference: `UTR-${Math.random()}`, allocations: [{ invoice_id: inv, amount: cash, tds, tds_split: split as any }] });

test('financial year, quarter and when the credit should show in 26AS', () => {
  assert.deepEqual(tdsPeriod('2026-10-05'), { fy: '2026-27', quarter: 'Q3', return_due: '2027-01-31' });
  assert.deepEqual(tdsPeriod('2027-02-10'), { fy: '2026-27', quarter: 'Q4', return_due: '2027-05-31' });
  assert.deepEqual(tdsPeriod('2026-04-01'), { fy: '2026-27', quarter: 'Q1', return_due: '2026-07-31' });
});

test('brand TDS defaults to ours; TDS is never counted as cash', () => {
  const { inv } = fixture();
  const cash = totalCash(db, t());
  receive(inv, L(90000), L(10000));
  assert.equal(totalCash(db, t()), cash + L(90000));
  assert.equal(listInvoices(db, t(), { ids: [inv] })[0].outstanding, 0);
  const c = get(db, 'SELECT * FROM tds_credits WHERE invoice_id = ?', inv)!;
  assert.equal(c.owner, 'agency');
  assert.equal(c.status, 'expected');
  assert.equal(c.amount, L(10000));
  assert.equal(c.fy, '2026-27');
});

test("split TDS: ours, ours-but-the-creator's (on hold until 26AS), creator claims it (their payable reduced, nothing for us to deposit)", () => {
  const { inv, ob, creator } = fixture();
  const taxPayablesBefore = all(db, `SELECT id FROM obligations WHERE source LIKE 'tds:%'`).length;
  assert.throws(() => receive(inv, L(90000), L(10000), [{ owner: 'agency', amount: L(5000) }]), /must add up/);
  assert.throws(() => receive(inv, L(90000), L(10000), [{ owner: 'agency', amount: L(5000) }, { owner: 'agency_for_creator', amount: L(5000) }]), /Choose the creator/);
  assert.throws(() => receive(inv, L(90000), L(10000), [{ owner: 'agency', amount: L(5000) }, { owner: 'creator', amount: L(5000), influencer_id: creator.id, obligation_id: 999999 }]), /open payable/);
  receive(inv, L(90000), L(10000), [
    { owner: 'agency', amount: L(3500) },
    { owner: 'agency_for_creator', amount: L(4000), influencer_id: creator.id },
    { owner: 'creator', amount: L(2500), influencer_id: creator.id, obligation_id: ob },
  ]);
  const credits = all(db, 'SELECT * FROM tds_credits WHERE invoice_id = ? ORDER BY id', inv);
  assert.deepEqual(credits.map((c) => [c.owner, c.amount, c.status]), [['agency', L(3500), 'expected'], ['agency_for_creator', L(4000), 'expected'], ['creator', L(2500), 'creator_claims']]);

  // Owed to the creator only once the credit is confirmed: on hold and out of the forecast until then.
  const passOn = get(db, 'SELECT * FROM obligations WHERE id = ?', credits[1].obligation_id)!;
  assert.equal(passOn.status, 'on_hold');
  assert.equal(passOn.influencer_id, creator.id);
  assert.ok(!forecastInputs(db, t(), 365).obligations.some((o: Row) => o.id === passOn.id && o.status !== 'on_hold'));
  updateTdsCredit(db, founder, credits[1].id, { status: 'in_26as', certificate_ref: '16A/Q3/123' });
  assert.equal(get(db, 'SELECT status FROM obligations WHERE id = ?', passOn.id)!.status, 'committed');
  updateTdsCredit(db, founder, credits[1].id, { status: 'expected' });
  assert.equal(get(db, 'SELECT status FROM obligations WHERE id = ?', passOn.id)!.status, 'on_hold', 'goes back on hold while unpaid');

  // Deducted under the creator's PAN: we owe them less, and we have nothing to deposit.
  const fee = listObligations(db, t(), { ids: [ob] })[0];
  assert.equal(fee.outstanding, L(65000 - 2500));
  assert.equal(fee.tds, L(2500));
  assert.equal(all(db, `SELECT id FROM obligations WHERE source LIKE 'tds:%'`).length, taxPayablesBefore, 'no TDS deposit created for TDS the brand deducted');
  assert.ok(payeeStatement(db, t(), 'influencer', creator.id).payments.some((p: Row) => p.kind === 'tds' && p.amount === L(2500)));
  assert.throws(() => updateTdsCredit(db, founder, credits[2].id, { status: 'claimed' }), /creator claims/);

  const reg = tdsRegister(db, '2026-27');
  assert.ok(reg.summary.claimable >= L(7500));
  assert.ok(reg.summary.owed_to_creators >= L(4000));
  assert.ok(reg.summary.creator_claimed >= L(2500));
});

test('reversing the brand TDS undoes everything it caused, unless the creator was already paid', () => {
  const { inv, ob, creator } = fixture();
  receive(inv, L(90000), L(10000), [
    { owner: 'agency_for_creator', amount: L(6000), influencer_id: creator.id },
    { owner: 'creator', amount: L(4000), influencer_id: creator.id, obligation_id: ob },
  ]);
  const sid = get(db, `SELECT id FROM settlements WHERE invoice_id = ? AND kind = 'tds'`, inv)!.id;
  const credits = all(db, 'SELECT * FROM tds_credits WHERE settlement_id = ? ORDER BY id', sid);
  const creatorSettlement = credits[1].creator_settlement_id;
  assert.throws(() => reverseSettlement(db, founder, creatorSettlement, 'oops'), /Reverse it from the brand receivable/);
  reverseSettlement(db, founder, sid, 'Brand corrected its TDS');
  assert.ok(all(db, 'SELECT status FROM tds_credits WHERE settlement_id = ?', sid).every((c) => c.status === 'reversed'));
  assert.equal(get(db, 'SELECT status FROM obligations WHERE id = ?', credits[0].obligation_id)!.status, 'cancelled');
  assert.equal(listObligations(db, t(), { ids: [ob] })[0].outstanding, L(65000), 'creator payable restored');
  assert.equal(listInvoices(db, t(), { ids: [inv] })[0].outstanding, L(10000));

  // Once the creator has been paid the pass-on amount, the brand TDS cannot silently disappear.
  const again = fixture();
  settleNonCash(db, founder, { invoice_id: again.inv, kind: 'tds', amount: L(5000), settled_on: '2026-10-05', reason: 'TDS per brand certificate', tds_split: [{ owner: 'agency_for_creator', amount: L(5000), influencer_id: again.creator.id }] });
  const c = get(db, 'SELECT * FROM tds_credits WHERE invoice_id = ?', again.inv)!;
  updateTdsCredit(db, founder, c.id, { status: 'in_26as' });
  recordTransaction(db, founder, { account_id: bank, txn_date: '2026-10-06', direction: 'out', amount: L(5000), category: 'creator_payout', reference: `UTR-${Math.random()}`, allocations: [{ obligation_id: c.obligation_id, amount: L(5000) }] });
  assert.throws(() => reverseSettlement(db, founder, c.settlement_id, 'x'), /already been paid/);
});

test('dashboard reminds to check 26AS after the brand\'s TDS return date, and flags missing credits', () => {
  const { inv } = fixture();
  settleNonCash(db, founder, { invoice_id: inv, kind: 'tds', amount: L(1000), settled_on: '2026-05-10', reason: 'TDS Q1' });
  let d = dashboard(db, founder);
  assert.ok(d.attention.some((a: Row) => a.kind === 'tds' && /Check 26AS/.test(a.title)), 'Q1 return was due 31 Jul');
  const c = get(db, 'SELECT id FROM tds_credits WHERE invoice_id = ?', inv)!;
  updateTdsCredit(db, founder, c.id, { status: 'not_received' });
  d = dashboard(db, founder);
  assert.ok(d.attention.some((a: Row) => a.kind === 'tds' && a.severity === 'high'));
  updateTdsCredit(db, founder, c.id, { status: 'claimed', claimed_in: 'ITR FY 2026-27' });
  assert.ok(!dashboard(db, founder).attention.some((a: Row) => a.kind === 'tds'), 'claimed credits stop reminding (others in this file are not due until Jan 2027)');
});

test('TDS recorded before the register existed is backfilled once as ours, to be checked', () => {
  const { inv } = fixture();
  const sid = insert(db, 'settlements', { invoice_id: inv, kind: 'tds', amount: L(2000), settled_on: '2026-08-01', reason: 'old TDS' });
  assert.equal(get(db, 'SELECT COUNT(*) n FROM tds_credits WHERE settlement_id = ?', sid)!.n, 0);
  assert.ok(backfillTdsCredits(db) >= 1);
  assert.equal(backfillTdsCredits(db), 0, 'idempotent');
  const c = get(db, 'SELECT * FROM tds_credits WHERE settlement_id = ?', sid)!;
  assert.deepEqual([c.owner, c.status, c.quarter, c.fy], ['agency', 'expected', 'Q2', '2026-27']);
});
