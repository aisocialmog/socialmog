-- LOCAL TESTING ONLY: feature 7 (Opening balances & import) checks. Runs after
-- money_test.sql in the same database: its accounts, capital, invoices and payouts
-- are still there, so totals are compared before / after rather than assumed.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.expect(label text, actual anyelement, expected anyelement) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL %: got %, expected %', label, actual, expected; end if;
  raise notice 'ok  %', label;
end $$;
create or replace function pg_temp.expect_error(label text, stmt text, pattern text default '%') returns void language plpgsql as $$
begin
  execute stmt; raise exception 'FAIL %: statement was allowed', label;
exception when others then
  if sqlerrm like 'FAIL %' then raise; end if;
  if sqlerrm not ilike pattern then raise exception 'FAIL %: wrong error: %', label, sqlerrm; end if;
  raise notice 'ok  % (blocked: %)', label, left(sqlerrm, 70);
end $$;
create or replace function pg_temp.login(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
-- opening_state() totals, as numbers
create or replace function pg_temp.tot(k text) returns numeric language sql as $$ select (public.opening_state()->'totals'->>k)::numeric $$;
-- every profit-and-loss figure for a wide range, one basis
create or replace function pg_temp.pnl(basis text) returns text language sql as $$
  select format('inv %s rev %s oth %s po %s dir %s ovh %s exp %s gross %s net %s gsto %s gsti %s',
                revenue_invoiced, revenue, other_income, creator_payouts, direct_expenses, overhead_expenses, expenses,
                gross_profit, net_profit, gst_output, gst_input)
  from public.money_overview('2020-01-01', '2030-12-31', basis)
$$;
create or replace function pg_temp.pnl_sum() returns text language sql as $$
  select format('%s|%s|%s', count(*), sum(amount), sum(amount) filter (where line = 'revenue')) from public.pnl_lines
$$;
create or replace function pg_temp.profit(basis text) returns text language sql as $$
  select string_agg(format('%s:%s/%s/%s', name, revenue, creator_payouts, profit), ' ' order by name)
  from public.profit_by('brand', '2020-01-01', '2030-12-31', basis)
$$;

set role authenticated;

-- ── 1. Founders only ────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');   -- manager
select pg_temp.expect_error('manager: no opening state', $q$select opening_state()$q$);
select pg_temp.expect_error('manager: can’t set go-live', $q$select opening_set_go_live('2026-12-01')$q$);
select pg_temp.expect_error('manager: can’t add an opening invoice',
  $q$select opening_add_invoice('b0000000-0000-0000-0000-0000000000a1', 'X/1', '2026-10-01', null, 100)$q$);
select pg_temp.expect_error('manager: can’t import history', $q$select import_history_brands('[{"name":"Manager Brand"}]')$q$);
select pg_temp.expect_error('manager: can’t set go_live_date directly', $q$update org_settings set go_live_date = '2026-12-01'$q$);
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');   -- team member
select pg_temp.expect_error('team member: no opening state', $q$select opening_state()$q$);
select pg_temp.expect_error('team member: can’t set go-live', $q$select opening_set_go_live('2026-12-01')$q$);
select pg_temp.expect_error('team member: can’t add an opening invoice',
  $q$select opening_add_invoice('b0000000-0000-0000-0000-0000000000a1', 'X/1', '2026-10-01', null, 100)$q$);
select pg_temp.expect_error('team member: can’t import history', $q$select import_history_brands('[{"name":"Team Brand"}]')$q$);

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');   -- founder 1
select id as f1 from team_members where email = 'founder1@example.com' \gset
select id as f2 from team_members where email = 'founder2@example.com' \gset
select pg_temp.expect('no go-live date yet', (select go_live_date from org_settings), null::date);

-- baselines (money_test data)
select pg_temp.tot('capital') as cap0, pg_temp.tot('accounts') as acc0, pg_temp.tot('receivables') as rec0,
       pg_temp.tot('payables') as pay0, pg_temp.tot('difference') as diff0 \gset
select difference as bc0 from balance_check() \gset
select pg_temp.pnl('invoice') as pnl_inv0, pg_temp.pnl('cash') as pnl_cash0, pg_temp.pnl_sum() as pnl_sum0,
       pg_temp.profit('invoice') as prof_inv0, pg_temp.profit('cash') as prof_cash0 \gset
select outstanding as out0, payouts_pending as pp0 from money_overview('2020-01-01', '2030-12-31') \gset
select lifetime_revenue as masala_rev0 from brand_overview where id = 'b0000000-0000-0000-0000-0000000000a1' \gset
select next_value as seq0 from document_sequences where doc_type = 'invoice' and fy_label = '2026-27' \gset

-- ── 2. Step 1: the go-live date comes first ─────────────────
select pg_temp.expect_error('capital needs the go-live date first',
  format($q$select opening_save_capital('[{"founder_id":"%s","accumulated_profit":1000}]')$q$, :'f1'), '%go-live date first%');
select pg_temp.expect_error('balances need the go-live date first', $q$select opening_set_balances('[]')$q$, '%go-live date first%');
select pg_temp.expect_error('an opening invoice needs the go-live date first',
  $q$select opening_add_invoice('b0000000-0000-0000-0000-0000000000a1', 'X/1', '2026-10-01', null, 100)$q$, '%go-live date first%');
select pg_temp.expect_error('a go-live date is required', $q$select opening_set_go_live(null)$q$);
select opening_set_go_live('2026-12-01');
select pg_temp.expect('go-live stored', (select go_live_date from org_settings), '2026-12-01'::date);
select pg_temp.expect('state shows go-live', opening_state()->>'go_live_date', '2026-12-01');
select pg_temp.expect('not locked yet', opening_state()->'locked_at', 'null'::jsonb);

-- ── 3. Step 2: opening capital ──────────────────────────────
select opening_save_capital(format('[{"founder_id":"%s","accumulated_profit":10000,"own_money":5000},{"founder_id":"%s","accumulated_profit":10000}]', :'f1', :'f2')::jsonb);
select pg_temp.expect('first save: three entries',
  (select count(*) from capital_entries where opening_part is not null and not is_archived), 3::bigint);
-- saving again replaces it
select opening_save_capital(format('[{"founder_id":"%s","accumulated_profit":30000,"own_money":20000},{"founder_id":"%s","accumulated_profit":30000,"own_money":0}]', :'f1', :'f2')::jsonb);
select pg_temp.expect('saving again replaces, not doubles',
  (select string_agg(format('%s/%s/%s/%s/%s', f.email, c.kind, c.opening_part, c.entry_date, c.amount), ' ' order by f.email, c.opening_part)
   from capital_entries c join team_members f on f.id = c.founder_id where c.opening_part is not null and not c.is_archived),
  'founder1@example.com/opening_capital/accumulated_profit/2026-11-30/30000.00 founder1@example.com/opening_capital/founder_money/2026-11-30/20000.00 '
  || 'founder2@example.com/opening_capital/accumulated_profit/2026-11-30/30000.00');
select pg_temp.expect('the old ones are archived', (select count(*) from capital_entries where opening_part is not null and is_archived), 3::bigint);
select pg_temp.expect_error('negative capital refused',
  format($q$select opening_save_capital('[{"founder_id":"%s","accumulated_profit":-1}]')$q$, :'f1'), '%negative%');
select pg_temp.expect_error('negative own money refused',
  format($q$select opening_save_capital('[{"founder_id":"%s","own_money":-5}]')$q$, :'f2'), '%negative%');
select pg_temp.expect('a refused save keeps what was there', (select count(*) from capital_entries where opening_part is not null and not is_archived), 3::bigint);
select pg_temp.expect_error('capital needs a founder', $q$select opening_save_capital('[{"accumulated_profit":100}]')$q$);
select pg_temp.expect_error('capital for a non-founder refused',
  $q$select opening_save_capital('[{"founder_id":"10000000-0000-0000-0000-000000000003","accumulated_profit":100}]')$q$);
select pg_temp.expect('capital total moved by 80000', pg_temp.tot('capital') - :cap0, 80000::numeric);
-- per founder: company-level opening capital (money_test's) is split 50:50 into "other"
select pg_temp.expect('founder rows: profit / own money / other / total add up',
  (select bool_and((f->>'total')::numeric = (f->>'accumulated_profit')::numeric + (f->>'own_money')::numeric + (f->>'other')::numeric)
   from jsonb_array_elements(opening_state()->'founders') f), true);
select pg_temp.expect('founder rows add up to the capital total',
  (select sum((f->>'total')::numeric) from jsonb_array_elements(opening_state()->'founders') f), pg_temp.tot('capital'));
select pg_temp.expect('Founder One: 30000 profit + 20000 own',
  (select format('%s|%s|%s', f->>'accumulated_profit', f->>'own_money', (f->>'total')::numeric - (f->>'other')::numeric)
   from jsonb_array_elements(opening_state()->'founders') f where f->>'name' = 'Founder One'), '30000.00|20000.00|50000.00');
select pg_temp.expect('Founder Two: 30000 profit, no own money',
  (select format('%s|%s|%s', f->>'accumulated_profit', f->>'own_money', (f->>'total')::numeric - (f->>'other')::numeric)
   from jsonb_array_elements(opening_state()->'founders') f where f->>'name' = 'Founder Two'), '30000.00|0|30000.00');
select pg_temp.expect('capital_accounts sees the opening capital too',
  (select sum(opening_capital) from capital_accounts()), pg_temp.tot('capital'));

-- ── 4. Opening capital is never revenue or profit ───────────
select pg_temp.expect('P&L unchanged by opening capital (invoice basis)', pg_temp.pnl('invoice'), :'pnl_inv0');
select pg_temp.expect('P&L unchanged by opening capital (payments basis)', pg_temp.pnl('cash'), :'pnl_cash0');
select pg_temp.expect('pnl_lines unchanged by opening capital', pg_temp.pnl_sum(), :'pnl_sum0');

-- ── 5. Step 3: account balances on go-live day ──────────────
insert into money_accounts (id, name, kind) values ('a0000000-0000-0000-0000-0000000000b1', 'Kotak Current (opening test)', 'bank');
select opening_set_balances('[{"account_id":"a0000000-0000-0000-0000-0000000000b1","balance":41000}]');
select pg_temp.expect('opening balance set, dated go-live',
  (select format('%s|%s', opening_balance, opening_date) from money_accounts where id = 'a0000000-0000-0000-0000-0000000000b1'), '41000.00|2026-12-01');
select pg_temp.expect('state accounts moved by 41000', pg_temp.tot('accounts') - :acc0, 41000::numeric);
select pg_temp.expect('the account is listed in the state',
  (select a->>'opening_balance' from jsonb_array_elements(opening_state()->'accounts') a where a->>'account_id' = 'a0000000-0000-0000-0000-0000000000b1'), '41000.00');
select opening_set_balances('[{"account_id":"a0000000-0000-0000-0000-0000000000b1","balance":41000}]');   -- same again: no-op
select pg_temp.expect('setting the same balance again changes nothing', pg_temp.tot('accounts') - :acc0, 41000::numeric);

-- ── 6. Step 4a: unpaid invoices from before go-live ─────────
select opening_add_invoice('b0000000-0000-0000-0000-0000000000a1', 'OLD/25-26/041', '2026-10-15', '2026-10-30', 59000, null) as oinv \gset
select pg_temp.expect('opening invoice: sent, keeps its number, no GST',
  (select format('%s|%s|%s|%s|%s|%s', is_opening, document_status, invoice_number, total, gst_total, outstanding) from invoice_totals where invoice_id = :'oinv'),
  'true|sent|OLD/25-26/041|59000.00|0|59000.00');
select pg_temp.expect('no SM/ number consumed',
  (select next_value from document_sequences where doc_type = 'invoice' and fy_label = '2026-27'), :seq0);
select pg_temp.expect('receivables moved by 59000', pg_temp.tot('receivables') - :rec0, 59000::numeric);
select pg_temp.expect('listed as a receivable',
  (select format('%s|%s|%s', r->>'invoice_number', r->>'brand_name', r->>'amount') from jsonb_array_elements(opening_state()->'receivables') r where r->>'invoice_id' = :'oinv'),
  'OLD/25-26/041|Masala Co|59000.00');
select pg_temp.expect('outstanding includes it', (select outstanding - :out0 from money_overview('2020-01-01', '2030-12-31')), 59000::numeric);
select pg_temp.expect('not revenue (invoice basis)', pg_temp.pnl('invoice'), :'pnl_inv0');
select pg_temp.expect('not revenue (payments basis)', pg_temp.pnl('cash'), :'pnl_cash0');
select pg_temp.expect('not in pnl_lines', pg_temp.pnl_sum(), :'pnl_sum0');
select pg_temp.expect('not in the GST register', (select count(*) from gst_register where invoice_id = :'oinv'), 0::bigint);
select pg_temp.expect('not in the brand’s lifetime revenue', (select lifetime_revenue from brand_overview where id = 'b0000000-0000-0000-0000-0000000000a1'), :masala_rev0::numeric);
select pg_temp.expect_error('an opening invoice is dated before go-live',
  $q$select opening_add_invoice('b0000000-0000-0000-0000-0000000000a1', 'OLD/25-26/050', '2026-12-01', null, 1000)$q$, '%before go-live%');
select pg_temp.expect_error('…also when inserted directly',
  $q$insert into invoices (brand_id, invoice_number, issue_date, is_opening) values ('b0000000-0000-0000-0000-0000000000a1', 'OLD/X', '2026-12-02', true)$q$, '%before go-live%');
select pg_temp.expect_error('an opening invoice needs its original number',
  $q$select opening_add_invoice('b0000000-0000-0000-0000-0000000000a1', null, '2026-10-01', null, 1000)$q$);
select pg_temp.expect_error('an opening invoice needs an amount',
  $q$select opening_add_invoice('b0000000-0000-0000-0000-0000000000a1', 'OLD/25-26/051', '2026-10-01', null, 0)$q$);
select pg_temp.expect_error('go-live can’t move to on/before an opening invoice', $q$select opening_set_go_live('2026-10-15')$q$, '%opening invoice%');
select pg_temp.expect_error('…nor to before it', $q$select opening_set_go_live('2026-10-01')$q$, '%opening invoice%');
-- moving go-live moves the opening entries; then move it back
select opening_set_go_live('2026-12-15');
select pg_temp.expect('moving go-live moves the capital entries and account dates',
  (select format('%s|%s', (select string_agg(distinct entry_date::text, ',') from capital_entries where opening_part is not null and not is_archived),
                          (select opening_date from money_accounts where id = 'a0000000-0000-0000-0000-0000000000b1'))), '2026-12-14|2026-12-15');
select opening_set_go_live('2026-12-01');
select pg_temp.expect('…and back', (select string_agg(distinct entry_date::text, ',') from capital_entries where opening_part is not null and not is_archived), '2026-11-30');
select pg_temp.expect_error('an opening invoice stays an opening invoice',
  format($q$update invoices set is_opening = false, change_reason = 'x' where id = '%s'$q$, :'oinv'));

-- the next normal invoice still gets the next SM/ number
insert into invoices (id, brand_id) values ('10000000-0000-0000-0000-0000000001b1', 'b0000000-0000-0000-0000-0000000000a1');
insert into invoice_items (invoice_id, description, quantity, rate) values ('10000000-0000-0000-0000-0000000001b1', 'Normal reel', 1, 10000);
update invoices set status = 'sent', issue_date = '2026-12-02' where id = '10000000-0000-0000-0000-0000000001b1';
select pg_temp.expect('next normal invoice: next number in sequence',
  (select invoice_number from invoices where id = '10000000-0000-0000-0000-0000000001b1'), format('SM/26-27/%s', lpad(:seq0::text, 3, '0')));
update invoices set status = 'cancelled', cancel_reason = 'Opening test: numbering check only' where id = '10000000-0000-0000-0000-0000000001b1';
select pg_temp.expect('the cancelled check invoice leaves P&L as it was', pg_temp.pnl('invoice'), :'pnl_inv0');

-- ── 7. Step 4b: unpaid creator / freelancer dues ────────────
select opening_add_payout('c0000000-0000-0000-0000-0000000000a1', null, 20000, 10, '2026-12-10', 'Reel for Masala Co, Oct 2026') as opay \gset
select pg_temp.expect('opening payout: pending, flagged',
  (select format('%s|%s|%s|%s', status, is_opening, amount, tds_rate) from creator_payouts where id = :'opay'), 'pending|true|20000.00|10.00');
select pg_temp.expect('payables moved by 20000', pg_temp.tot('payables') - :pay0, 20000::numeric);
select pg_temp.expect('listed as a payable',
  (select format('%s|%s|%s', p->>'payee_name', p->>'amount', p->>'status') from jsonb_array_elements(opening_state()->'payables') p where p->>'payout_id' = :'opay'),
  'Test Creator|20000.00|pending');
select pg_temp.expect('pending payouts include it', (select payouts_pending - :pp0 from money_overview('2020-01-01', '2030-12-31')), 18000::numeric);
select pg_temp.expect('not a cost (invoice basis)', pg_temp.pnl('invoice'), :'pnl_inv0');
select pg_temp.expect('not a cost (payments basis)', pg_temp.pnl('cash'), :'pnl_cash0');
select pg_temp.expect_error('an opening payout needs an amount', $q$select opening_add_payout('c0000000-0000-0000-0000-0000000000a1', null, 0)$q$);

-- ── 8. The check ────────────────────────────────────────────
-- ours: 41000 + 59000 − 20000 = 80000 = capital, so it adds nothing to the difference
select pg_temp.expect('our opening set balances itself', pg_temp.tot('difference'), :diff0::numeric);
select pg_temp.expect('difference = accounts + receivables − payables − capital',
  pg_temp.tot('difference'), pg_temp.tot('accounts') + pg_temp.tot('receivables') - pg_temp.tot('payables') - pg_temp.tot('capital'));
select pg_temp.expect('net position', pg_temp.tot('net_position'), pg_temp.tot('accounts') + pg_temp.tot('receivables') - pg_temp.tot('payables'));
select pg_temp.expect('balance_check unchanged by a balanced opening set', (select difference from balance_check()), :bc0::numeric);
-- a known mismatch: a freelancer due nobody accounted for
select opening_add_payout(null, 'd0000000-0000-0000-0000-0000000000a1', 5000, 0, null, null) as opay2 \gset
select pg_temp.expect('the mismatch shows', pg_temp.tot('difference') - :diff0, -5000::numeric);
select pg_temp.expect('not balanced', (opening_state()->'totals'->>'is_balanced')::boolean, false);
select pg_temp.expect_error('lock refused while it doesn’t balance', $q$select opening_lock()$q$, '%5000.00 apart%');
select pg_temp.expect_error('an adjustment needs a note', $q$select opening_add_adjustment(-5000, '  ')$q$, '%note%');
select pg_temp.expect_error('an adjustment can’t be zero', $q$select opening_add_adjustment(0, 'x')$q$, '%zero%');
select opening_add_adjustment(-5000, 'Freelancer due from Oct missing from capital') as adj \gset
select pg_temp.expect('a negative adjustment fixes it', pg_temp.tot('difference'), :diff0::numeric);
select pg_temp.expect('the adjustment is listed',
  (select format('%s|%s', a->>'amount', a->>'note') from jsonb_array_elements(opening_state()->'adjustments') a where a->>'id' = :'adj'),
  '-5000.00|Freelancer due from Oct missing from capital');
select pg_temp.expect('balance_check unchanged once our opening set balances', (select difference from balance_check()), :bc0::numeric);
-- earlier tests' data may leave the opening figures apart; clear that with an adjustment
-- so the wizard can lock (balance_check stays balanced only if that was 0 to begin with)
select pg_temp.expect('earlier tests leave the opening figures balanced', :diff0::numeric, 0::numeric);
select pg_temp.expect('is balanced', (opening_state()->'totals'->>'is_balanced')::boolean, true);

-- ── 9. Taking things back ───────────────────────────────────
select opening_add_invoice('b0000000-0000-0000-0000-0000000000a2', 'OLD/25-26/060', '2026-09-01', null, 1000, 'Typed by mistake') as oinv2 \gset
select opening_remove('invoice', :'oinv2');
select pg_temp.expect('removing an opening invoice archives it',
  (select format('%s|%s', is_archived, (select count(*) from invoice_totals where invoice_id = :'oinv2')) from invoices where id = :'oinv2'), 'true|0');
select opening_add_adjustment(123, 'temporary') as adj2 \gset
select opening_remove('adjustment', :'adj2');
select pg_temp.expect('removing an adjustment archives it', (select is_archived from capital_entries where id = :'adj2'), true);
select opening_add_payout(null, 'd0000000-0000-0000-0000-0000000000a1', 700) as opay3 \gset
select opening_remove('payout', :'opay3');
select pg_temp.expect('removing a payout archives it', (select is_archived from creator_payouts where id = :'opay3'), true);
select pg_temp.expect_error('unknown kind', format($q$select opening_remove('expense', '%s')$q$, :'opay3'));
select pg_temp.expect('removals leave the check where it was', pg_temp.tot('difference'), :diff0::numeric);

-- money received against an opening invoice: collected, not revenue
select record_payment('b0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000b1', '2026-12-05', 20000, 0, 'neft', 'OLD-PAY-1', null,
                      format('[{"invoice_id":"%s","amount":20000}]', :'oinv')::jsonb);
select pg_temp.expect('payment reduces what’s owed',
  (select format('%s|%s', outstanding, payment_status) from invoice_totals where invoice_id = :'oinv'), '39000.00|overdue');
select pg_temp.expect('outstanding goes down', (select outstanding - :out0 from money_overview('2020-01-01', '2030-12-31')), 39000::numeric);
select pg_temp.expect('the payment is not revenue (payments basis)', pg_temp.pnl('cash'), :'pnl_cash0');
select pg_temp.expect('…nor on the invoice basis', pg_temp.pnl('invoice'), :'pnl_inv0');
select pg_temp.expect('the summary stays as at go-live', pg_temp.tot('receivables') - :rec0, 59000::numeric);
select pg_temp.expect('balance_check unchanged after collecting', (select difference from balance_check()), :bc0::numeric);
select pg_temp.expect_error('can’t remove an invoice with a payment', format($q$select opening_remove('invoice', '%s')$q$, :'oinv'), '%received%');

-- paying an opening due: the expense is made, but it's no cost of the new period
update creator_payouts set status = 'paid', paid_on = '2026-12-03', account_id = 'a0000000-0000-0000-0000-0000000000b1' where id = :'opay';
select pg_temp.expect('paying makes the expense as usual',
  (select format('%s|%s', amount, tds_deducted) from expenses where payout_id = :'opay' and not is_archived), '20000.00|2000.00');
select pg_temp.expect('paid opening due: no cost (invoice basis)', pg_temp.pnl('invoice'), :'pnl_inv0');
select pg_temp.expect('paid opening due: no cost (payments basis)', pg_temp.pnl('cash'), :'pnl_cash0');
select pg_temp.expect('pnl_lines still unchanged', pg_temp.pnl_sum(), :'pnl_sum0');
select pg_temp.expect('profit by brand unchanged (invoice basis)', pg_temp.profit('invoice'), :'prof_inv0');
select pg_temp.expect('profit by brand unchanged (payments basis)', pg_temp.profit('cash'), :'prof_cash0');
select pg_temp.expect('the account paid out the net', (select balance from account_balances() where account_id = 'a0000000-0000-0000-0000-0000000000b1'), 41000 + 20000 - 18000::numeric);
select pg_temp.expect('balance_check unchanged after paying', (select difference from balance_check()), :bc0::numeric);
select pg_temp.expect_error('can’t remove a paid due', format($q$select opening_remove('payout', '%s')$q$, :'opay'), '%paid%');
select pg_temp.expect('a paid due is still in the summary', pg_temp.tot('payables') - :pay0, 25000::numeric);

-- ── 10. Lock ────────────────────────────────────────────────
select opening_lock();
select pg_temp.expect('locked: who and when',
  (select format('%s|%s', opening_state()->>'locked_at' is not null, opening_state()->>'locked_by_name')), 'true|Founder One');
select pg_temp.expect_error('locked: go-live', $q$select opening_set_go_live('2026-12-02')$q$, '%locked%');
select pg_temp.expect_error('locked: capital', format($q$select opening_save_capital('[{"founder_id":"%s","accumulated_profit":1}]')$q$, :'f1'), '%locked%');
select pg_temp.expect_error('locked: balances', $q$select opening_set_balances('[]')$q$, '%locked%');
select pg_temp.expect_error('locked: adjustment', $q$select opening_add_adjustment(1, 'x')$q$, '%locked%');
select pg_temp.expect_error('locked: invoice', $q$select opening_add_invoice('b0000000-0000-0000-0000-0000000000a1', 'OLD/9', '2026-10-01', null, 1)$q$, '%locked%');
select pg_temp.expect_error('locked: payout', $q$select opening_add_payout(null, 'd0000000-0000-0000-0000-0000000000a1', 1)$q$, '%locked%');
select pg_temp.expect_error('locked: remove', format($q$select opening_remove('adjustment', '%s')$q$, :'adj'), '%locked%');
select pg_temp.expect_error('locked: lock again', $q$select opening_lock()$q$, '%locked%');
select pg_temp.expect_error('locked: direct opening invoice',
  $q$insert into invoices (brand_id, invoice_number, issue_date, is_opening) values ('b0000000-0000-0000-0000-0000000000a1', 'OLD/Y', '2026-10-02', true)$q$, '%locked%');
select pg_temp.expect_error('locked: direct opening payout',
  $q$insert into creator_payouts (vendor_id, amount, is_opening) values ('d0000000-0000-0000-0000-0000000000a1', 10, true)$q$, '%locked%');
select pg_temp.expect_error('locked: go_live_date by direct update', $q$update org_settings set go_live_date = '2026-12-05'$q$, '%locked%');
select pg_temp.expect_error('locked: can’t unlock by direct update (skips the password)', $q$update org_settings set opening_locked_at = null, opening_locked_by = null$q$);
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_error('manager can’t unlock', $q$select opening_unlock()$q$);
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error('unlock needs a fresh password login', $q$select opening_unlock()$q$, '%password%');
select set_config('request.jwt.claims', json_build_object('amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch from now() - interval '2 hours')::bigint)))::text, false);
select pg_temp.expect_error('a password login 2 hours ago isn’t enough', $q$select opening_unlock()$q$, '%password%');
select set_config('request.jwt.claims', json_build_object('amr', json_build_array(json_build_object('method','otp','timestamp', extract(epoch from now())::bigint)))::text, false);
select pg_temp.expect_error('another sign-in method isn’t enough', $q$select opening_unlock()$q$, '%password%');
select set_config('request.jwt.claims', json_build_object('amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch from now())::bigint)))::text, false);
select opening_unlock();
select pg_temp.expect('unlocked', opening_state()->'locked_at', 'null'::jsonb);
select set_config('request.jwt.claims', '', false);
select pg_temp.expect_error('lock can’t be set by direct update (skips the check)', $q$update org_settings set opening_locked_at = now()$q$);
select opening_lock();
select pg_temp.expect('locked again', (select opening_locked_at is not null from org_settings), true);

-- ── 11. History import ──────────────────────────────────────
select import_history_brands($j$[
  {"name": "masala co"},
  {"name": "Old Brand A", "gstin": "BADGSTIN", "industry": "Food", "contact_name": "Ravi Kumar", "contact_email": "ravi@oldbrand.in", "contact_phone": "+91 98111 11111"},
  {"name": "Old Brand B", "gstin": "29abcde1234f1z5", "city": "Bengaluru", "instagram_handle": "@oldbrandb"}
]$j$::jsonb) as rb \gset
select pg_temp.expect('brands: created / skipped / errors',
  format('%s|%s|%s', (:'rb'::jsonb)->>'created', (:'rb'::jsonb)->>'skipped', (select string_agg(format('%s:%s', e->>'row', e->>'name'), ',') from jsonb_array_elements((:'rb'::jsonb)->'errors') e)),
  '2|1|2:Old Brand A');
select pg_temp.expect('the duplicate wasn’t added', (select count(*) from brands where lower(name) = 'masala co'), 1::bigint);
select pg_temp.expect('imported brands are ended; bad GSTIN dropped, good one kept',
  (select string_agg(format('%s/%s/%s/%s', name, status, coalesce(gstin, '-'), coalesce(state_code, '-')), ' ' order by name) from brands where name like 'Old Brand %'),
  'Old Brand A/ended/-/- Old Brand B/ended/29ABCDE1234F1Z5/29');
select pg_temp.expect('instagram handle without the @', (select instagram_handle from brands where name = 'Old Brand B'), 'oldbrandb');
select pg_temp.expect('primary contact created',
  (select format('%s|%s|%s', primary_contact_name, primary_contact_email, primary_contact_phone) from brand_overview where name = 'Old Brand A'),
  'Ravi Kumar|ravi@oldbrand.in|+91 98111 11111');
select pg_temp.expect('the import is recorded', (select format('%s|%s|%s', rows_total, rows_valid, rows_invalid) from import_batches where id = ((:'rb'::jsonb)->>'batch_id')::uuid), '3|2|1');

select import_history_campaigns($j$[
  {"brand": "Old Brand A", "name": "Diwali 2025", "start_date": "2025-10-01", "end_date": "2025-10-31", "client_fee": "150000", "creator_spend": "90000", "notes": "Festive push"},
  {"brand": "No Such Brand", "name": "Ghost"},
  {"brand": "old brand b", "name": "Too new", "start_date": "2026-12-05"},
  {"brand": "Old Brand B", "name": "Summer 2026", "start_date": "2026-05-01", "kind": "UGC", "client_fee": "50000"}
]$j$::jsonb) as rc \gset
select pg_temp.expect('campaigns: created / skipped / error rows',
  format('%s|%s|%s', (:'rc'::jsonb)->>'created', (:'rc'::jsonb)->>'skipped', (select string_agg(e->>'row', ',') from jsonb_array_elements((:'rc'::jsonb)->'errors') e)),
  '2|0|2,3');
select pg_temp.expect('error says the brand is missing', (select e->>'problem' like '%not found%' from jsonb_array_elements((:'rc'::jsonb)->'errors') e where e->>'row' = '2'), true);
select pg_temp.expect('error says it starts after go-live', (select e->>'problem' like '%go-live%' from jsonb_array_elements((:'rc'::jsonb)->'errors') e where e->>'row' = '3'), true);
select pg_temp.expect('past campaigns: historical, completed, budget figures',
  (select string_agg(format('%s/%s/%s/%s/%s/%s/%s', c.name, c.is_historical, c.status, c.kind, c.end_date, f.contract_value, coalesce(f.creator_budget::text, '-')), ' ' order by c.name)
   from campaigns c join campaign_finances f on f.campaign_id = c.id where c.name in ('Diwali 2025', 'Summer 2026')),
  'Diwali 2025/true/completed/influencer/2025-10-31/150000.00/90000.00 Summer 2026/true/completed/ugc/2026-05-01/50000.00/-');
select pg_temp.expect('re-importing skips', (select import_history_campaigns('[{"brand":"Old Brand A","name":"diwali 2025"}]')->>'skipped'), '1');
select pg_temp.expect('brand page shows the history',
  (select string_agg(format('%s:%s/%s/%s', name, historical_revenue, historical_campaigns, lifetime_revenue), ' ' order by name) from brand_overview where name like 'Old Brand %'),
  'Old Brand A:150000.00/1/0 Old Brand B:50000.00/1/0');
select pg_temp.expect('history is not money (invoice basis)', pg_temp.pnl('invoice'), :'pnl_inv0');
select pg_temp.expect('history is not money (payments basis)', pg_temp.pnl('cash'), :'pnl_cash0');
select pg_temp.expect('history: profit by brand unchanged', pg_temp.profit('invoice'), :'prof_inv0');
select pg_temp.expect('history: profit by brand unchanged (payments)', pg_temp.profit('cash'), :'prof_cash0');
select pg_temp.expect('history: Masala Co lifetime revenue unchanged', (select lifetime_revenue from brand_overview where id = 'b0000000-0000-0000-0000-0000000000a1'), :masala_rev0::numeric);
select pg_temp.expect('campaign summary flags it', (select is_historical from campaign_summary where name = 'Diwali 2025'), true);

insert into creators (id, name) values ('c0000000-0000-0000-0000-0000000000b1', 'Hist Creator');
select import_history_campaign_creators($j$[
  {"brand": "Old Brand A", "campaign": "Diwali 2025", "creator": "hist creator", "fee": "45000"},
  {"campaign": "Diwali 2025", "creator": "Nobody Known"},
  {"campaign": "Not A Campaign", "creator": "Hist Creator"}
]$j$::jsonb) as rcc \gset
select pg_temp.expect('campaign creators: created / skipped / error rows',
  format('%s|%s|%s', (:'rcc'::jsonb)->>'created', (:'rcc'::jsonb)->>'skipped', (select string_agg(e->>'row', ',') from jsonb_array_elements((:'rcc'::jsonb)->'errors') e)),
  '1|0|2,3');
select pg_temp.expect('creator on a past campaign: paid, with the fee',
  (select format('%s|%s', cc.status, f.agreed_fee) from campaign_creators cc join campaign_creator_fees f on f.campaign_creator_id = cc.id
   where cc.creator_id = 'c0000000-0000-0000-0000-0000000000b1'), 'paid|45000.00');
select pg_temp.expect('creator history shows it',
  (select format('%s|%s|%s|%s', campaign_name, brand_name, is_historical, agreed_fee) from creator_campaign_history where creator_id = 'c0000000-0000-0000-0000-0000000000b1'),
  'Diwali 2025|Old Brand A|true|45000.00');
select pg_temp.expect('re-importing a creator skips',
  (select import_history_campaign_creators('[{"campaign":"Diwali 2025","creator":"Hist Creator","fee":"45000"}]')->>'skipped'), '1');
select pg_temp.expect('creator history is not money', pg_temp.pnl('invoice'), :'pnl_inv0');
select pg_temp.expect('creator history is not money (payments)', pg_temp.pnl('cash'), :'pnl_cash0');
select pg_temp.expect('balance_check still unchanged', (select difference from balance_check()), :bc0::numeric);
reset role;

select pg_temp.expect('no schema rule violations', (select count(*) from public.schema_rule_violations()), 0::bigint);
\o
\echo 'OPENING CHECKS PASSED'
