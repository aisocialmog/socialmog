-- LOCAL TESTING ONLY: feature 6 (Money) checks. Runs after production_test.sql
-- (same database; the smoke test's HDFC account, opening capital and
-- Mama Bites invoice are still there and are part of the balance check).
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.expect(label text, actual anyelement, expected anyelement) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL %: got %, expected %', label, actual, expected; end if;
  raise notice 'ok  %', label;
end $$;
create or replace function pg_temp.expect_error(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt; raise exception 'FAIL %: statement was allowed', label;
exception when others then
  if sqlerrm like 'FAIL %' then raise; end if;
  raise notice 'ok  % (blocked: %)', label, left(sqlerrm, 70);
end $$;
create or replace function pg_temp.login(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;

set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');   -- founder 1
update org_settings set state_code = '27', state = 'Maharashtra', gstin = '27ABCDE1234F1Z5', upi_id = 'socialmog@hdfcbank';
insert into brands (id, name, status, state_code, payment_terms_days) values
  ('b0000000-0000-0000-0000-0000000000a1', 'Masala Co', 'active', '27', 15),
  ('b0000000-0000-0000-0000-0000000000a2', 'Bengaluru Brew', 'active', '29', null);
insert into money_accounts (id, name, kind, opening_balance, opening_date) values
  ('a0000000-0000-0000-0000-0000000000a1', 'ICICI Current (test)', 'bank', 100000, '2026-04-01'),
  ('a0000000-0000-0000-0000-0000000000a2', 'Founder 1 UPI (test)', 'upi', 0, '2026-04-01');
insert into capital_entries (kind, founder_id, account_id, entry_date, amount) values ('opening_capital', null, null, '2026-04-01', 100000);

-- ── Invoices: numbering, GST split, statuses ────────────────
insert into invoices (id, brand_id, tds_rate) values ('10000000-0000-0000-0000-0000000001a1', 'b0000000-0000-0000-0000-0000000000a1', 10);
insert into invoice_items (invoice_id, position, description, quantity, rate) values
  ('10000000-0000-0000-0000-0000000001a1', 1, 'Reels', 2, 25000), ('10000000-0000-0000-0000-0000000001a1', 2, 'Stories', 1, 10000);
select pg_temp.expect('a draft has no number yet', (select invoice_number from invoices where id = '10000000-0000-0000-0000-0000000001a1'), null::text);
select pg_temp.expect('place of supply taken from the brand', (select place_of_supply_code from invoices where id = '10000000-0000-0000-0000-0000000001a1'), '27');
update invoice_items set rate = 26000 where invoice_id = '10000000-0000-0000-0000-0000000001a1' and position = 1;   -- drafts edit freely
update invoice_items set rate = 25000 where invoice_id = '10000000-0000-0000-0000-0000000001a1' and position = 1;
update invoices set status = 'sent', issue_date = '2026-11-02' where id = '10000000-0000-0000-0000-0000000001a1';
select pg_temp.expect('number given on send: SM/26-27/001', (select invoice_number from invoices where id = '10000000-0000-0000-0000-0000000001a1'), 'SM/26-27/001');
select pg_temp.expect('due date from the brand’s payment terms', (select due_date from invoices where id = '10000000-0000-0000-0000-0000000001a1'), '2026-11-17'::date);
select pg_temp.expect('same state → CGST + SGST',
  (select format('%s|%s|%s|%s|%s|%s', subtotal, cgst, sgst, igst, total, tds_expected) from invoice_totals where invoice_id = '10000000-0000-0000-0000-0000000001a1'),
  '60000.00|5400.00|5400.00|0|70800.00|6000.00');

insert into invoices (id, brand_id) values ('10000000-0000-0000-0000-0000000001a2', 'b0000000-0000-0000-0000-0000000000a2');
insert into invoice_items (invoice_id, description, quantity, rate) values ('10000000-0000-0000-0000-0000000001a2', 'Launch campaign', 1, 100000);
update invoices set status = 'sent', issue_date = '2026-09-01' where id = '10000000-0000-0000-0000-0000000001a2';
select pg_temp.expect('other state → IGST; numbers run in order',
  (select format('%s|%s|%s|%s', invoice_number, cgst, igst, total) from invoice_totals where invoice_id = '10000000-0000-0000-0000-0000000001a2'),
  'SM/26-27/002|0|18000.00|118000.00');
select pg_temp.expect('past due date → Overdue automatically', (select payment_status from invoice_totals where invoice_id = '10000000-0000-0000-0000-0000000001a2'), 'overdue');

insert into invoices (id, brand_id) values ('10000000-0000-0000-0000-0000000001a3', 'b0000000-0000-0000-0000-0000000000a2'),
                                           ('10000000-0000-0000-0000-0000000001a4', 'b0000000-0000-0000-0000-0000000000a2'),
                                           ('10000000-0000-0000-0000-0000000001a5', 'b0000000-0000-0000-0000-0000000000a2');
insert into invoice_items (invoice_id, description, quantity, rate) values
  ('10000000-0000-0000-0000-0000000001a3', 'March reels', 1, 50000), ('10000000-0000-0000-0000-0000000001a4', 'April reels', 1, 40000);
update invoices set status = 'sent', issue_date = '2027-03-31' where id = '10000000-0000-0000-0000-0000000001a3';
update invoices set status = 'sent', issue_date = '2027-04-01' where id = '10000000-0000-0000-0000-0000000001a4';
select pg_temp.expect('31 March is still FY 26-27', (select invoice_number from invoices where id = '10000000-0000-0000-0000-0000000001a3'), 'SM/26-27/003');
select pg_temp.expect('1 April starts again at 001', (select invoice_number from invoices where id = '10000000-0000-0000-0000-0000000001a4'), 'SM/27-28/001');
select pg_temp.expect_error('can’t send an invoice with no lines', $q$update invoices set status = 'sent' where id = '10000000-0000-0000-0000-0000000001a5'$q$);
select pg_temp.expect_error('editing a sent invoice needs a reason', $q$update invoices set due_date = '2027-05-15' where id = '10000000-0000-0000-0000-0000000001a4'$q$);
select pg_temp.expect_error('editing a sent invoice’s lines needs a reason', $q$update invoice_items set rate = 45000 where invoice_id = '10000000-0000-0000-0000-0000000001a4'$q$);
update invoices set due_date = '2027-05-15', change_reason = 'Client asked for 45 days' where id = '10000000-0000-0000-0000-0000000001a4';
select pg_temp.expect('the reason is in the activity log, not on the invoice',
  (select reason from activity_log where record_id = '10000000-0000-0000-0000-0000000001a4' and reason is not null), 'Client asked for 45 days');
select pg_temp.expect('change_reason is never stored', (select change_reason from invoices where id = '10000000-0000-0000-0000-0000000001a4'), null::text);
select pg_temp.expect_error('numbers never change', $q$update invoices set invoice_number = 'SM/27-28/099', change_reason = 'x' where id = '10000000-0000-0000-0000-0000000001a4'$q$);
select pg_temp.expect_error('sent can’t go back to draft', $q$update invoices set status = 'draft', change_reason = 'x' where id = '10000000-0000-0000-0000-0000000001a4'$q$);
select pg_temp.expect_error('cancelling needs a reason', $q$update invoices set status = 'cancelled' where id = '10000000-0000-0000-0000-0000000001a4'$q$);
update invoices set status = 'cancelled', cancel_reason = 'Raised against the wrong brand' where id = '10000000-0000-0000-0000-0000000001a4';
select pg_temp.expect('cancelled invoice keeps its number, owes nothing',
  (select format('%s|%s|%s', invoice_number, payment_status, outstanding) from invoice_totals where invoice_id = '10000000-0000-0000-0000-0000000001a4'),
  'SM/27-28/001|cancelled|0');
select pg_temp.expect_error('totals can’t be typed in', $q$insert into invoice_items (invoice_id, description, quantity, rate, amount) values ('10000000-0000-0000-0000-0000000001a5', 'x', 1, 1, 999)$q$);

-- ── Payments ────────────────────────────────────────────────
select record_payment('b0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', '2026-11-05', 30000, 0, 'upi', 'UTR-1', null,
                      '[{"invoice_id":"10000000-0000-0000-0000-0000000001a1","amount":30000}]');
select pg_temp.expect('part payment → Partly paid', (select format('%s|%s', payment_status, outstanding) from invoice_totals where invoice_id = '10000000-0000-0000-0000-0000000001a1'), 'partly_paid|40800.00');
select pg_temp.expect_error('can’t apply more than the invoice owes',
  $q$select record_payment('b0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', '2026-11-06', 50000, 0, 'upi', null, null, '[{"invoice_id":"10000000-0000-0000-0000-0000000001a1","amount":50000}]')$q$);
select pg_temp.expect_error('can’t apply to another brand’s invoice',
  $q$select record_payment('b0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', '2026-11-06', 5000, 0, 'upi', null, null, '[{"invoice_id":"10000000-0000-0000-0000-0000000001a2","amount":5000}]')$q$);
select pg_temp.expect_error('can’t apply more than was received',
  $q$select record_payment('b0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', '2026-11-06', 5000, 0, 'upi', null, null, '[{"invoice_id":"10000000-0000-0000-0000-0000000001a1","amount":6000}]')$q$);
select record_payment('b0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', '2026-11-08', 34800, 6000, 'neft', 'UTR-2', null,
                      '[{"invoice_id":"10000000-0000-0000-0000-0000000001a1","amount":40800}]');
select pg_temp.expect('cash + client’s TDS settles it → Paid', (select format('%s|%s', payment_status, outstanding) from invoice_totals where invoice_id = '10000000-0000-0000-0000-0000000001a1'), 'paid|0.00');
-- one payment across two invoices
select record_payment('b0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a1', '2026-11-07', 150000, 0, 'neft', 'UTR-3', null,
  '[{"invoice_id":"10000000-0000-0000-0000-0000000001a2","amount":118000},{"invoice_id":"10000000-0000-0000-0000-0000000001a3","amount":32000}]');
select pg_temp.expect('one payment, two invoices',
  (select string_agg(payment_status, ',' order by invoice_number) from invoice_totals where invoice_id in ('10000000-0000-0000-0000-0000000001a2','10000000-0000-0000-0000-0000000001a3')),
  'paid,partly_paid');
select pg_temp.expect('payment list shows both numbers', (select array_to_string(invoice_numbers, ',') from payment_list where reference = 'UTR-3'), 'SM/26-27/002,SM/26-27/003');
select pg_temp.expect_error('a cancelled-with-payments check', $q$update invoices set status = 'cancelled', cancel_reason = 'test' where id = '10000000-0000-0000-0000-0000000001a3'$q$);
select record_payment('b0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a1', '2026-11-07', 10000, 0, 'upi', 'ADV-1', 'Advance for December');
select pg_temp.expect('unapplied money is an advance', (select unapplied from payment_list where reference = 'ADV-1'), 10000.00::numeric);
select record_payment(null, 'a0000000-0000-0000-0000-0000000000a1', '2026-11-06', 1500, 0, 'neft', 'INT-NOV', 'Savings interest', '[]', 'other_income');
select pg_temp.expect_error('editing a payment needs a reason', $q$update receipts set reference = 'UTR-1b' where reference = 'UTR-1'$q$);
update receipts set reference = 'UTR-1b', change_reason = 'Typo in UTR' where reference = 'UTR-1';

-- ── Expenses ────────────────────────────────────────────────
insert into expenses (id, category_id, brand_id, description, expense_date, amount, gst_amount, status, account_id) values
  ('e0000000-0000-0000-0000-0000000000a1', (select id from expense_categories where name = 'Equipment'), 'b0000000-0000-0000-0000-0000000000a1', 'Camera rental', '2026-11-03', 20000, 3600, 'paid', 'a0000000-0000-0000-0000-0000000000a1'),
  ('e0000000-0000-0000-0000-0000000000a2', (select id from expense_categories where name = 'Software/subscriptions'), null, 'Notion', '2026-11-04', 5000, 900, 'paid', 'a0000000-0000-0000-0000-0000000000a2'),
  ('e0000000-0000-0000-0000-0000000000a3', (select id from expense_categories where name = 'Location'), 'b0000000-0000-0000-0000-0000000000a1', 'Studio booking', '2026-11-10', 8000, 0, 'unpaid', null),
  ('e0000000-0000-0000-0000-0000000000a4', (select id from expense_categories where name = 'Food'), null, 'Shoot lunch', '2026-11-03', 2000, 0, 'unpaid', null),
  ('e0000000-0000-0000-0000-0000000000a5', (select id from expense_categories where name = 'GST paid to government'), null, 'GST for October', '2026-11-07', 5000, 0, 'paid', 'a0000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error('paid needs an account', $q$insert into expenses (category_id, description, expense_date, amount, status) values ((select id from expense_categories where name = 'Props'), 'x', '2026-11-01', 10, 'paid')$q$);
update expenses set status = 'paid', account_id = 'a0000000-0000-0000-0000-0000000000a1' where id = 'e0000000-0000-0000-0000-0000000000a4';
select pg_temp.expect('marking an expense paid needs no reason; paid on = its date', (select paid_on from expenses where id = 'e0000000-0000-0000-0000-0000000000a4'), '2026-11-03'::date);
select pg_temp.expect_error('changing an expense amount needs a reason', $q$update expenses set amount = 2500 where id = 'e0000000-0000-0000-0000-0000000000a4'$q$);
select pg_temp.expect_error('archiving (deleting) needs a reason', $q$update expenses set is_archived = true where id = 'e0000000-0000-0000-0000-0000000000a4'$q$);

insert into recurring_expenses (id, description, category_id, amount, gst_amount, account_id, day_of_month, start_date) values
  ('f0000000-0000-0000-0000-0000000000a1', 'Adobe Creative Cloud', (select id from expense_categories where name = 'Software/subscriptions'), 4000, 720, 'a0000000-0000-0000-0000-0000000000a1', 5, '2026-09-01');
select pg_temp.expect('recurring: one expense per month so far', create_recurring_expenses('2026-11-09'), 3);
select pg_temp.expect('recurring: running again adds nothing', create_recurring_expenses('2026-11-09'), 0);
select pg_temp.expect('recurring: named by month', (select string_agg(description, ' / ' order by expense_date) from expenses where recurring_id = 'f0000000-0000-0000-0000-0000000000a1'),
  'Adobe Creative Cloud — Sep 2026 / Adobe Creative Cloud — Oct 2026 / Adobe Creative Cloud — Nov 2026');

-- ── Payouts ─────────────────────────────────────────────────
insert into creators (id, name) values ('c0000000-0000-0000-0000-0000000000a1', 'Test Creator');
insert into vendors (id, name, kind, upi_id) values ('d0000000-0000-0000-0000-0000000000a1', 'Test Editor', 'freelancer', 'editor@upi');
insert into creator_payouts (id, creator_id, brand_id, amount, tds_rate, due_date, description) values
  ('90000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1', 40000, 10, '2026-11-08', 'Masala Co reel');
insert into creator_payouts (id, vendor_id, brand_id, amount, tds_rate, due_date, description) values
  ('90000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1', 15000, 0, '2026-11-20', 'Edit for Masala Co');
select pg_temp.expect('net payable = amount − TDS', (select net_payable from payout_list where id = '90000000-0000-0000-0000-0000000000a1'), 36000.00::numeric);
update creator_payouts set status = 'approved' where id = '90000000-0000-0000-0000-0000000000a1';
select pg_temp.expect('approving needs no reason and records who', (select approved_by_name from payout_list where id = '90000000-0000-0000-0000-0000000000a1'), 'Founder One');
select pg_temp.expect_error('paying needs the account', $q$update creator_payouts set status = 'paid' where id = '90000000-0000-0000-0000-0000000000a1'$q$);
select pg_temp.expect_error('poka-yoke: no payout to a creator without UPI or bank details',
  $q$update creator_payouts set status = 'paid', paid_on = '2026-11-08', account_id = 'a0000000-0000-0000-0000-0000000000a1' where id = '90000000-0000-0000-0000-0000000000a1'$q$);
insert into creator_payment_details (creator_id, upi_id) values ('c0000000-0000-0000-0000-0000000000a1', 'test@upi');
update creator_payouts set status = 'paid', paid_on = '2026-11-08', account_id = 'a0000000-0000-0000-0000-0000000000a1', reference = 'UTR-P1' where id = '90000000-0000-0000-0000-0000000000a1';
select pg_temp.expect('paying creates the matching expense',
  (select format('%s|%s|%s|%s|%s', c.name, e.amount, e.tds_deducted, e.total - e.tds_deducted, e.notes) from expenses e join expense_categories c on c.id = e.category_id
   where e.payout_id = '90000000-0000-0000-0000-0000000000a1'), 'Creator payout|40000.00|4000.00|36000.00|UTR-P1');
select pg_temp.expect_error('the payout’s expense can’t be edited by hand', $q$update expenses set amount = 1, change_reason = 'x' where payout_id = '90000000-0000-0000-0000-0000000000a1'$q$);
select pg_temp.expect_error('changing a paid payout needs a reason', $q$update creator_payouts set amount = 42000 where id = '90000000-0000-0000-0000-0000000000a1'$q$);
update creator_payouts set amount = 42000, change_reason = 'Agreed ₹2,000 for an extra story' where id = '90000000-0000-0000-0000-0000000000a1';
select pg_temp.expect('the expense follows the payout', (select format('%s|%s', amount, tds_deducted) from expenses where payout_id = '90000000-0000-0000-0000-0000000000a1'), '42000.00|4200.00');
select pg_temp.expect('a paid payout is counted once in profit',
  (select count(*) from pnl_lines where basis = 'invoice' and (source_id = '90000000-0000-0000-0000-0000000000a1' or source_id = (select id from expenses where payout_id = '90000000-0000-0000-0000-0000000000a1'))), 1::bigint);
select pg_temp.expect('payouts due: the freelancer is still pending', (select string_agg(payee_name, ',') from payout_list where status in ('pending','approved') and brand_id = 'b0000000-0000-0000-0000-0000000000a1'), 'Test Editor');

-- ── Capital ─────────────────────────────────────────────────
insert into capital_entries (kind, founder_id, account_id, entry_date, amount) values
  ('capital_added', (select id from team_members where email = 'founder1@example.com'), 'a0000000-0000-0000-0000-0000000000a1', '2026-10-01', 50000),
  ('founder_withdrawal', (select id from team_members where email = 'founder2@example.com'), 'a0000000-0000-0000-0000-0000000000a1', '2026-11-01', 20000),
  ('profit_transferred', null, null, '2026-10-31', 30000);
select pg_temp.expect_error('a withdrawal comes out of an account', $q$insert into capital_entries (kind, founder_id, entry_date, amount) values ('founder_withdrawal', null, '2026-11-01', 10)$q$);
select pg_temp.expect_error('capital belongs to founders only', $q$insert into capital_entries (kind, founder_id, entry_date, amount) values ('opening_capital', '10000000-0000-0000-0000-000000000003', '2026-11-01', 10)$q$);
select pg_temp.expect('capital per founder (50:50 for company entries)',
  (select string_agg(format('%s:%s/%s/%s/%s=%s', name, opening_capital, capital_added, withdrawals, profit_transferred, balance), ' ' order by name) from capital_accounts()),
  'Founder One:300000.00/50000.00/0/15000.00=365000.00 Founder Two:300000.00/0/20000.00/15000.00=295000.00');

-- ── Balances, overview, GST, TDS ────────────────────────────
select pg_temp.expect('account balance = opening + in − out',
  (select format('%s|%s|%s', money_in, money_out, balance) from account_balances() where name = 'ICICI Current (test)'),
  -- in: 30000 + 34800 + 150000 + 10000 + 1500 + 50000 = 276300
  -- out: 20000+3600 + 2000 + 5000 + Adobe 3×4720 + payout 37800 + withdrawal 20000 = 102560
  '276300.00|102560.00|273740.00');
select pg_temp.expect('November, invoice basis',
  (select format('rev %s cash %s other %s payouts %s direct %s overhead %s gross %s net %s', revenue, cash_received, other_income, creator_payouts, direct_expenses, overhead_expenses, gross_profit, net_profit)
   from money_overview('2026-11-01', '2026-11-30', 'invoice')),
  'rev 60000.00 cash 226300.00 other 1500.00 payouts 57000.00 direct 30000.00 overhead 9000.00 gross -27000.00 net -34500.00');
select pg_temp.expect('November, payments basis',
  (select format('rev %s payouts %s direct %s overhead %s net %s', revenue, creator_payouts, direct_expenses, overhead_expenses, net_profit)
   from money_overview('2026-11-01', '2026-11-30', 'cash')),
  'rev 187118.64 payouts 42000.00 direct 22000.00 overhead 9000.00 net 115618.64');
select pg_temp.expect('ageing buckets add up to outstanding',
  (select age_0_30 + age_31_60 + age_61_plus = outstanding and outstanding = 236000 + 27000 from money_overview('2026-11-01', '2026-11-30')), true);
select pg_temp.expect('payouts pending', (select payouts_pending from money_overview('2026-11-01', '2026-11-30')), 15000.00::numeric);
select pg_temp.expect('GST for November', (select format('%s|%s|%s|%s', output_gst, input_gst, gst_paid, net_gst) from gst_monthly('2026-11-01', '2026-11-30')),
  '10800.00|5220.00|5000.00|5580.00');
select pg_temp.expect('GST month rows for a range', (select count(*) from gst_monthly('2026-09-01', '2026-11-30')), 3::bigint);
select pg_temp.expect('TDS for November', (select format('%s|%s', tds_by_clients, tds_we_deducted) from tds_monthly('2026-11-01', '2026-11-30')), '6000.00|4200.00');
select pg_temp.expect('profit by brand', (select format('%s|%s|%s|%s', revenue, creator_payouts, direct_expenses, profit) from profit_by('brand', '2026-11-01', '2026-11-30') where name = 'Masala Co'),
  '60000.00|57000.00|28000.00|-25000.00');

select pg_temp.expect('the books balance', (select format('%s|%s', difference, is_balanced) from balance_check()), '0.00|t');
insert into money_accounts (id, name, kind, opening_balance) values ('a0000000-0000-0000-0000-0000000000a3', 'Petty cash (test)', 'cash', 25000);
select pg_temp.expect('a missing entry is flagged', (select format('%s|%s', difference, is_balanced) from balance_check()), '-25000.00|f');
insert into capital_entries (kind, founder_id, entry_date, amount) values ('opening_capital', null, ist_today(), 25000);
select pg_temp.expect('…and clears once recorded', (select is_balanced from balance_check()), true);

-- ── Retainer invoice in one click ───────────────────────────
insert into retainers (id, brand_id, title, monthly_fee, start_date, status) values
  ('70000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1', 'Social retainer', 25000, '2026-10-01', 'active');
insert into retainer_scope_items (retainer_id, deliverable_type, quantity_per_month) values ('70000000-0000-0000-0000-0000000000a1', 'reel', 4);
select create_retainer_invoice('70000000-0000-0000-0000-0000000000a1', '2026-11-15');
select pg_temp.expect('retainer invoice drafted from the retainer',
  (select format('%s|%s|%s', i.status, it.description, it.rate) from invoices i join invoice_items it on it.invoice_id = i.id where i.retainer_id = '70000000-0000-0000-0000-0000000000a1'),
  'draft|Social retainer — November 2026 (4 reels)|25000.00');
select pg_temp.expect_error('only one per month', $q$select create_retainer_invoice('70000000-0000-0000-0000-0000000000a1', '2026-11-01')$q$);
select pg_temp.expect('retainers to invoice knows it’s done', (select invoice_id is not null from retainers_to_invoice('2026-11-01') where retainer_id = '70000000-0000-0000-0000-0000000000a1'), true);

-- ── Manager: invoices, expenses, payouts — not capital ──────
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select pg_temp.expect('manager sees invoices', (select count(*) > 0 from invoice_totals), true);
select pg_temp.expect('manager sees payouts', (select count(*) from payout_list where brand_id = 'b0000000-0000-0000-0000-0000000000a1'), 2::bigint);
select pg_temp.expect('manager: no capital rows', (select count(*) from capital_list), 0::bigint);
select pg_temp.expect_error('manager: no capital per founder', $q$select * from capital_accounts()$q$);
select pg_temp.expect_error('manager: no balance check', $q$select * from balance_check()$q$);
select pg_temp.expect_error('manager can’t set an opening balance', $q$update money_accounts set opening_balance = 1, change_reason = 'x' where id = 'a0000000-0000-0000-0000-0000000000a2'$q$);
select pg_temp.expect('manager: capital shows as one line on the statement',
  (select count(*) from account_statement('a0000000-0000-0000-0000-0000000000a1') where source_table = 'capital_entries'), 1::bigint);
select pg_temp.expect('manager: the account still adds up',
  (select sum(money_in) - sum(money_out) from account_statement('a0000000-0000-0000-0000-0000000000a1')), 273740.00::numeric);
select pg_temp.expect('manager: no capital in the activity log', (select count(*) from activity_log where table_name = 'capital_entries'), 0::bigint);
insert into expenses (category_id, description, expense_date, amount, status) values ((select id from expense_categories where name = 'Props'), 'Manager can add', '2026-11-09', 300, 'unpaid');

-- ── Team member: no money at all ────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select pg_temp.expect('team member: no invoices', (select count(*) from invoice_totals), 0::bigint);
select pg_temp.expect('team member: no expenses or payouts', (select count(*) from expense_list) + (select count(*) from payout_list), 0::bigint);
select pg_temp.expect('team member: no balances', (select count(*) from account_balances()), 0::bigint);
select pg_temp.expect_error('team member can’t add an expense', $q$insert into expenses (category_id, description, expense_date, amount) values ((select id from expense_categories limit 1), 'x', '2026-11-09', 1)$q$);
reset role;

-- hard delete is refused even for the database owner
select pg_temp.expect_error('owner can’t hard-delete money', $q$delete from expenses where id = 'e0000000-0000-0000-0000-0000000000a2'$q$);
select pg_temp.expect('no schema rule violations', (select count(*) from public.schema_rule_violations()), 0::bigint);
\o
\echo 'MONEY CHECKS PASSED'
