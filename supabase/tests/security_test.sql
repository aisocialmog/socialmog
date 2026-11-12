-- LOCAL TESTING ONLY: feature 13 — security, trash, health check, backups.
-- Runs last, on the data the earlier suites left behind.
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
create or replace function pg_temp.login(uid text, claims text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.jwt.claims', coalesce(claims, ''), false);
end $$;
-- how many rows a person can read from a table (0 also when access is denied outright)
create or replace function pg_temp.readable(t text) returns bigint language plpgsql as $$
declare n bigint;
begin execute format('select count(*) from public.%I', t) into n; return n; exception when insufficient_privilege then return 0; end $$;
create or replace function pg_temp.asowner(q text) returns text language plpgsql security definer as $$ declare r text; begin execute q into r; return r; end $$;
\set F1 '''00000000-0000-0000-0000-0000000000a1'''
\set MGR '''00000000-0000-0000-0000-0000000000a3'''
\set TEAM '''00000000-0000-0000-0000-0000000000a4'''
\set FREE '''00000000-0000-0000-0000-0000000000a5'''
create temp table money_tables (t text);
insert into money_tables values ('invoices'), ('invoice_items'), ('receipts'), ('receipt_allocations'), ('expenses'), ('expense_categories'), ('creator_payouts'), ('account_transfers'),
  ('money_accounts'), ('capital_entries'), ('campaign_finances'), ('campaign_creator_fees'), ('creator_payment_details'), ('creator_rate_cards'), ('retainers'), ('recurring_expenses'), ('targets'), ('api_clients'), ('backups'), ('webhook_subscriptions');
grant select on money_tables to authenticated, anon;
create temp table money_views (t text);
insert into money_views values ('invoice_totals'), ('payment_list'), ('expense_list'), ('payout_list'), ('capital_list'), ('money_ledger'), ('pnl_lines');
grant select on money_views to authenticated, anon;
set role authenticated;

-- ── Money tables, read as each role ─────────────────────────
select pg_temp.login(:F1);
select pg_temp.expect('founder can read money (baseline)', (select count(*) > 0 from money_tables where pg_temp.readable(t) > 0), true);
select pg_temp.login(:TEAM);
select pg_temp.expect('TEAM MEMBER reads nothing from any money table', (select count(*) from money_tables where pg_temp.readable(t) > 0), 0::bigint);
select pg_temp.expect('TEAM MEMBER reads nothing from any money view', (select count(*) from money_views where pg_temp.readable(t) > 0), 0::bigint);
select pg_temp.expect_error('TEAM MEMBER can’t write an expense', $q$insert into expenses (description, amount, category_id) values ('x', 1, (select id from expense_categories limit 1))$q$);
select pg_temp.expect('TEAM MEMBER’s money totals are all zero', (select revenue + cash_received + outstanding + payouts_pending from money_overview('2020-01-01', '2030-12-31')), 0::numeric);
select pg_temp.login(:FREE);
select pg_temp.expect('FREELANCER reads nothing from any money table', (select count(*) from money_tables where pg_temp.readable(t) > 0), 0::bigint);
select pg_temp.login(:MGR);
select pg_temp.expect('MANAGER reads invoices and expenses', (select pg_temp.readable('invoices') > 0 and pg_temp.readable('expenses') > 0), true);
select pg_temp.expect('MANAGER never sees capital, API keys, backups or payment details', (select count(*) from money_tables where t in ('capital_entries','api_clients','backups','webhook_subscriptions','creator_payment_details') and pg_temp.readable(t) > 0), 0::bigint);
select pg_temp.expect('MANAGER’s capital view is empty', pg_temp.readable('capital_list'), 0::bigint);
reset role;
set role anon;
select pg_temp.expect('SIGNED-OUT visitors read nothing at all', (select count(*) from money_tables where pg_temp.readable(t) > 0) + (select count(*) from money_views where pg_temp.readable(t) > 0), 0::bigint);
select pg_temp.expect('…not even people or tasks', pg_temp.readable('team_members') + pg_temp.readable('tasks') + pg_temp.readable('brands') + pg_temp.readable('creators'), 0::bigint);
reset role;

-- ── Row Level Security everywhere ───────────────────────────
select pg_temp.expect('every table has RLS on and a policy', (select count(*) from public.schema_rule_violations()), 0::bigint);
select pg_temp.login(:F1);
set role authenticated;
select pg_temp.expect('security_report: no table with an open or signed-out policy', (select count(*) from security_report() where issue is not null), 0::bigint);
select pg_temp.expect('security_report covers every table', (select count(*) from security_report()), (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'));
select pg_temp.login(:TEAM);
select pg_temp.expect('security_report is for founders', (select count(*) from security_report()), 0::bigint);
reset role;

-- ── Two-factor and re-entering the password ─────────────────
set role authenticated;
select pg_temp.login(:F1, '{"aal":"aal1","amr":[{"method":"password","timestamp":' || extract(epoch from now())::bigint || '}]}');
select pg_temp.expect('founder without the authenticator check is only a team member', public.current_app_role(), 'team_member');
select pg_temp.expect('…so reads no money', (select count(*) from money_tables where pg_temp.readable(t) > 0), 0::bigint);
select pg_temp.expect_error('…and can’t create an API key', $q$select ops_key_create('x')$q$);
select pg_temp.login(:F1, '{"aal":"aal2","amr":[{"method":"password","timestamp":' || (extract(epoch from now())::bigint - 7200) || '},{"method":"totp","timestamp":' || extract(epoch from now())::bigint || '}]}');
select pg_temp.expect('aal2 founder is a founder', public.current_app_role(), 'founder');
select pg_temp.expect('a password login 2 hours ago is not recent', public.password_is_recent(), false);
select pg_temp.expect('…so bank details are hidden', pg_temp.readable('creator_payment_details'), 0::bigint);
select pg_temp.expect_error('…and an API key can’t be created', $q$select ops_key_create('x')$q$, '%Re-enter your password%');
select pg_temp.login(:F1, '{"aal":"aal2","amr":[{"method":"password","timestamp":' || extract(epoch from now())::bigint || '}]}');
select pg_temp.expect('just re-entered: bank details readable', pg_temp.readable('creator_payment_details') > 0, true);
select pg_temp.expect('just re-entered: an API key can be made', (select ops_key_create('Security test') like 'smog_ops_%'), true);
select pg_temp.login(:F1, '{"aal":"aal2","amr":[{"method":"oauth","timestamp":' || extract(epoch from now())::bigint || '}]}');
select pg_temp.expect('Google-only login can’t pass the password check', public.password_is_recent(), false);
select pg_temp.login(:F1);
reset role;
update org_settings set require_founder_mfa = false;
set role authenticated;
select pg_temp.login(:F1, '{"aal":"aal1"}');
select pg_temp.expect('the switch can turn the requirement off (e.g. to recover)', public.current_app_role(), 'founder');
reset role;
update org_settings set require_founder_mfa = true;

-- closed month: a founder needs a fresh password as well as a reason
set role authenticated;
select pg_temp.login(:F1);
reset role;
update org_settings set books_locked_through = '2026-10-31';
set role authenticated;
select pg_temp.login(:F1, '{"aal":"aal2","amr":[{"method":"password","timestamp":' || (extract(epoch from now())::bigint - 7200) || '}]}');
select pg_temp.expect_error('closed month: reason given but password is stale', $q$update expenses set description = 'late fix', change_reason = 'CA asked' where id = (select id from expenses where expense_date <= '2026-10-31' and payout_id is null order by id limit 1)$q$, '%Re-enter your password%');
select pg_temp.login(:F1, '{"aal":"aal2","amr":[{"method":"password","timestamp":' || extract(epoch from now())::bigint || '}]}');
update expenses set description = 'late fix', change_reason = 'CA asked' where id = (select id from expenses where expense_date <= '2026-10-31' and payout_id is null order by id limit 1);
select pg_temp.expect('closed month: reason + fresh password works', (select count(*) from expenses where description = 'late fix'), 1::bigint);
reset role;
update org_settings set books_locked_through = null;

-- ── Trash ───────────────────────────────────────────────────
set role authenticated;
select pg_temp.login(:F1);
insert into tasks (id, title) values ('7f000000-0000-0000-0000-000000000001', 'Trash me');
update tasks set is_archived = true where id = '7f000000-0000-0000-0000-000000000001';
select pg_temp.expect('archived task is in the trash with 30 days left', (select days_left from trash_list() where record_id = '7f000000-0000-0000-0000-000000000001'), 30);
select trash_restore('tasks', '7f000000-0000-0000-0000-000000000001');
select pg_temp.expect('restored', (select is_archived from tasks where id = '7f000000-0000-0000-0000-000000000001'), false);
select pg_temp.expect_error('restoring something not archived', $q$select trash_restore('tasks', '7f000000-0000-0000-0000-000000000001')$q$, '%isn’t in the trash%');
select pg_temp.expect_error('only listed kinds', $q$select trash_restore('activity_log', '7f000000-0000-0000-0000-000000000001')$q$, '%can’t be restored%');
insert into expenses (id, description, amount, expense_date, category_id, status) values ('7f000000-0000-0000-0000-000000000002', 'Trash expense', 100, '2026-11-05', (select id from expense_categories where system_key is null limit 1), 'unpaid');
update expenses set is_archived = true, change_reason = 'entered twice' where id = '7f000000-0000-0000-0000-000000000002';
select pg_temp.expect_error('money records need a reason to come back', $q$select trash_restore('expenses', '7f000000-0000-0000-0000-000000000002')$q$, '%reason%');
select trash_restore('expenses', '7f000000-0000-0000-0000-000000000002', 'it was needed after all');
select pg_temp.expect('money record restored, reason in the history', (select count(*) from activity_log where record_id = '7f000000-0000-0000-0000-000000000002' and reason = 'it was needed after all'), 1::bigint);
reset role;
update tasks set is_archived = true where id = '7f000000-0000-0000-0000-000000000001';
update tasks set archived_at = now() - interval '31 days' where id = '7f000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.expect('after 30 days it leaves the list', (select count(*) from trash_list() where record_id = '7f000000-0000-0000-0000-000000000001'), 0::bigint);
select pg_temp.expect_error('…and can’t be restored from here', $q$select trash_restore('tasks', '7f000000-0000-0000-0000-000000000001')$q$, '%more than 30 days%');
select pg_temp.login(:TEAM);
select pg_temp.expect_error('team member has no trash', $q$select * from trash_list()$q$, '%founders and managers%');

-- ── Health check ────────────────────────────────────────────
select pg_temp.login(:F1);
select pg_temp.expect('health check: every total matches its records', (select string_agg(check_name || ' (' || expected || ' vs ' || actual || ')', '; ') from health_check() where not ok), null::text);
select pg_temp.expect('health check ran all checks', (select count(*) >= 10 from health_check()), true);
select pg_temp.login(:MGR);
select pg_temp.expect('manager’s health check leaves out capital', (select count(*) from health_check() where area = 'Capital'), 0::bigint);
select pg_temp.login(:TEAM);
select pg_temp.expect_error('team member can’t run it', $q$select * from health_check()$q$);

-- ── Settings & backups ──────────────────────────────────────
select pg_temp.login(:F1);
select pg_temp.expect('lead sources and label overrides exist', (select count(*) from list_items where kind = 'lead_source') >= 6, true);
insert into list_labels (kind, key, label) values ('stage', 'editing', 'In the edit suite');
select pg_temp.expect('a stage can be renamed', (select label from list_labels where kind = 'stage' and key = 'editing'), 'In the edit suite');
select pg_temp.expect_error('only known list kinds', $q$insert into list_labels (kind, key, label) values ('colour', 'x', 'y')$q$);
select pg_temp.login(:TEAM);
select pg_temp.expect_error('team member can’t rename lists', $q$insert into list_items (kind, name) values ('lead_source', 'Spam')$q$);
select pg_temp.expect_error('backup table list is server-only', $q$select backup_tables()$q$);
reset role;
select pg_temp.expect('backup lists every table', (select cardinality(backup_tables()) = (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r')), true);
update org_settings set invoice_number_digits = 5;
select pg_temp.expect('invoice numbers can use 5 digits', (select exists (select 1 from information_schema.routines where routine_name = 'invoice_prepare')), true);
update org_settings set invoice_number_digits = 3;
select pg_temp.expect('no schema rule violations', (select count(*) from public.schema_rule_violations()), 0::bigint);
\o
\echo 'SECURITY CHECKS PASSED'
