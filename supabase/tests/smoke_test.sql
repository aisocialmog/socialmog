-- LOCAL TESTING ONLY: run by scripts/test-db.sh after the auth stub + all migrations.
-- Signs in as each role and checks what that role can see and change.
-- Any failed expectation stops the run with an error.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

create function pg_temp.expect(label text, actual anyelement, expected anyelement) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: got %, expected %', label, actual, expected;
  end if;
  raise notice 'ok  %', label;
end $$;
create function pg_temp.expect_error(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL %: statement was allowed', label;
exception when others then
  if sqlerrm like 'FAIL %' then raise; end if;
  raise notice 'ok  % (blocked: %)', label, left(sqlerrm, 70);
end $$;
create function pg_temp.login(uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false)
$$;

-- ── Logins ───────────────────────────────────────────────────
-- Founders were seeded by the migration; their logins appear (dashboard invite) and link.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'Founder1@example.com'),   -- case differs on purpose
  ('00000000-0000-0000-0000-0000000000a2', 'founder2@example.com'),
  ('00000000-0000-0000-0000-0000000000a9', 'stranger@example.com');   -- nobody invited this person
select pg_temp.expect('both founders linked to their logins',
  (select count(*) from team_members where role = 'founder' and user_id is not null), 2::bigint);
select pg_temp.expect('uninvited login gets no team member row',
  (select count(*) from team_members where email = 'stranger@example.com'), 0::bigint);

-- ── Founder invites the team ────────────────────────────────
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into team_members (id, name, email, role, monthly_cost) values
  ('10000000-0000-0000-0000-000000000003', 'Mira Manager', 'manager@example.com', 'manager', 90000),
  ('10000000-0000-0000-0000-000000000004', 'Tara Team',    'team@example.com',    'team_member', 45000),
  ('10000000-0000-0000-0000-000000000005', 'Farid Freelance', 'free@example.com', 'freelancer', null);
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a3', 'manager@example.com'),
  ('00000000-0000-0000-0000-0000000000a4', 'team@example.com'),
  ('00000000-0000-0000-0000-0000000000a5', 'free@example.com');
update auth.users set last_sign_in_at = now() where id = '00000000-0000-0000-0000-0000000000a4';
select pg_temp.expect('invited logins linked', (select count(*) from team_members where user_id is not null), 5::bigint);
select pg_temp.expect('first sign-in recorded',
  (select first_signed_in_at is not null from team_members where email = 'team@example.com'), true);

-- ── Founder sets up some work ───────────────────────────────
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into brands (id, name, status, industry) values
  ('20000000-0000-0000-0000-00000000000a', 'Mama Bites', 'active', 'Food'),
  ('20000000-0000-0000-0000-00000000000b', 'Kesar Skin', 'active', 'Beauty');
insert into campaigns (id, brand_id, name, code, status) values
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Diwali reels', 'MAMA-DIW', 'live'),
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Winter glow', 'KES-WIN', 'creator_outreach');
insert into campaign_finances (campaign_id, contract_value) values ('30000000-0000-0000-0000-00000000000a', 300000);
insert into campaign_members (campaign_id, team_member_id) values ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000004');
insert into creators (id, name) values ('40000000-0000-0000-0000-00000000000a', 'Asha Rao'), ('40000000-0000-0000-0000-00000000000b', 'Meher Kaur');
insert into creator_platforms (creator_id, platform, handle) values ('40000000-0000-0000-0000-00000000000a', 'instagram', 'asha.cooks');
insert into deliverables (id, brand_id, campaign_id, creator_id, title, assignee_id) values
  ('50000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'Leftovers reel', '10000000-0000-0000-0000-000000000004'),
  ('50000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b', 'Glow edit', '10000000-0000-0000-0000-000000000005'),
  ('50000000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', null, 'Unassigned story', null);
insert into deliverable_fees (deliverable_id, creator_fee, billable_amount) values ('50000000-0000-0000-0000-00000000000a', 20000, 60000);
insert into tasks (title, assignee_id) values ('Tara: send script', '10000000-0000-0000-0000-000000000004'),
                                             ('Farid: export edit', '10000000-0000-0000-0000-000000000005'),
                                             ('Founder-only task', null);
insert into money_accounts (id, name) values ('60000000-0000-0000-0000-00000000000a', 'HDFC Current');
insert into capital_entries (kind, founder_id, account_id, entry_date, amount)
  select 'opening_balance', null, '60000000-0000-0000-0000-00000000000a', '2026-04-01', 500000;
insert into invoices (id, brand_id, campaign_id, invoice_number, issue_date, due_date, status) values
  ('70000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'SM/2026-27/0001', '2026-10-05', '2026-10-20', 'sent');
insert into invoice_items (invoice_id, description, quantity, rate) values ('70000000-0000-0000-0000-00000000000a', 'Reels', 4, 50000);
select pg_temp.expect('founder sees capital', (select count(*) from capital_entries), 1::bigint);
select pg_temp.expect('founder sees balance incl. capital', (select balance from account_balances()), 500000.00::numeric);
select pg_temp.expect('created_by is the founder''s team member id',
  (select created_by from brands where name = 'Mama Bites') = (select id from team_members where email = 'founder1@example.com'), true);

-- ── Manager ─────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select pg_temp.expect('manager: all brands', (select count(*) from brands), 2::bigint);
select pg_temp.expect('manager: invoices visible', (select count(*) from invoice_totals), 1::bigint);
select pg_temp.expect('manager: NO capital entries', (select count(*) from capital_entries), 0::bigint);
select pg_temp.expect('manager: balance still correct (total only)', (select balance from account_balances()), 500000.00::numeric);
select pg_temp.expect('manager: sees team incl. monthly cost', (select monthly_cost from team_members where email = 'team@example.com'), 45000.00::numeric);
select pg_temp.expect_error('manager cannot add capital',
  $q$insert into capital_entries (kind, account_id, entry_date, amount) values ('founder_withdrawal','60000000-0000-0000-0000-00000000000a','2026-11-01',1000)$q$);
select pg_temp.expect_error('manager cannot change roles',
  $q$update team_members set role = 'founder' where email = 'manager@example.com'$q$);
select pg_temp.expect_error('manager cannot invite',
  $q$insert into team_members (name, email, role) values ('X','x@example.com','team_member')$q$);

-- ── Team member (on campaign A, assigned deliverable A) ─────
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select pg_temp.expect('team: only own campaign', (select string_agg(name, ',') from campaigns), 'Diwali reels');
select pg_temp.expect('team: only that brand', (select string_agg(name, ',') from brands), 'Mama Bites');
select pg_temp.expect('team: deliverables of own campaign', (select string_agg(title, ',') from deliverables), 'Leftovers reel');
select pg_temp.expect('team: creator on own work only', (select string_agg(name, ',') from creators), 'Asha Rao');
select pg_temp.expect('team: own tasks only', (select string_agg(title, ',') from tasks), 'Tara: send script');
select pg_temp.expect('team: no invoices', (select count(*) from invoices), 0::bigint);
select pg_temp.expect('team: no invoice totals', (select count(*) from invoice_totals), 0::bigint);
select pg_temp.expect('team: no campaign money', (select count(*) from campaign_finances), 0::bigint);
select pg_temp.expect('team: no deliverable fees', (select count(*) from deliverable_fees), 0::bigint);
select pg_temp.expect('team: no balances', (select count(*) from account_balances()), 0::bigint);
select pg_temp.expect('team: only own team row', (select count(*) from team_members), 1::bigint);
select pg_temp.expect('team: directory shows colleagues', (select count(*) from team_directory), 5::bigint);
select pg_temp.expect('team: search finds brand + campaign, never invoices',
  (select string_agg(kind, ',' order by kind) from global_search('mama')), 'brand,campaign');
update deliverables set stage = 'editing' where id = '50000000-0000-0000-0000-00000000000a';
select pg_temp.expect('team: can move own deliverable stage', (select stage from deliverables where id = '50000000-0000-0000-0000-00000000000a'), 'editing');
select pg_temp.expect_error('team cannot re-assign a deliverable',
  $q$update deliverables set assignee_id = '10000000-0000-0000-0000-000000000005' where id = '50000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.expect_error('team cannot create a task for someone else',
  $q$insert into tasks (title, assignee_id) values ('x', '10000000-0000-0000-0000-000000000005')$q$);
select pg_temp.expect_error('team cannot promote self',
  $q$update team_members set role = 'founder' where email = 'team@example.com'$q$);
update team_members set phone = '+91 98000 00000' where email = 'team@example.com';
select pg_temp.expect('team: can edit own phone', (select phone from team_members where email = 'team@example.com'), '+91 98000 00000');
insert into tasks (title, deliverable_id) values ('My own reminder', '50000000-0000-0000-0000-00000000000a');
select pg_temp.expect('team: activity limited to own work',
  (select bool_and(table_name in ('deliverables','tasks','campaigns')) from activity_log), true);
select pg_temp.expect('team: sees history of own deliverable',
  (select count(*) > 0 from activity_log where record_id = '50000000-0000-0000-0000-00000000000a'), true);
select pg_temp.expect('team: no history of other campaign',
  (select count(*) from activity_log where record_id = '30000000-0000-0000-0000-00000000000b'), 0::bigint);

-- ── Freelancer (assigned deliverable B only) ────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select pg_temp.expect('freelancer: only assigned deliverable', (select string_agg(title, ',') from deliverables), 'Glow edit');
select pg_temp.expect('freelancer: no campaigns', (select count(*) from campaigns), 0::bigint);
select pg_temp.expect('freelancer: brand of own work only', (select string_agg(name, ',') from brands), 'Kesar Skin');
select pg_temp.expect('freelancer: own tasks only', (select string_agg(title, ',') from tasks), 'Farid: export edit');
select pg_temp.expect('freelancer: no money', (select count(*) from invoices) + (select count(*) from deliverable_fees), 0::bigint);

-- ── Uninvited login ─────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect('stranger: no role', current_app_role(), null::text);
select pg_temp.expect('stranger: sees nothing',
  (select count(*) from brands) + (select count(*) from team_members) + (select count(*) from tasks)
  + (select count(*) from team_directory) + (select count(*) from org_settings), 0::bigint);
select pg_temp.expect_error('stranger cannot write', $q$insert into brands (name) values ('Sneaky')$q$);

-- ── Founder: deactivation & last-founder rule ───────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
update team_members set status = 'inactive' where email = 'team@example.com';
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select pg_temp.expect('deactivated member instantly sees nothing', (select count(*) from deliverables), 0::bigint);
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
update team_members set status = 'inactive' where email = 'founder2@example.com';
select pg_temp.expect_error('cannot remove the last active founder',
  $q$update team_members set role = 'manager' where email = 'founder1@example.com'$q$);
delete from brands where name = 'Mama Bites';
select pg_temp.expect('hard delete does nothing (archive instead)', (select count(*) from brands where name = 'Mama Bites'), 1::bigint);
update brands set status = 'paused' where name = 'Mama Bites';
select pg_temp.expect('status change logged with old/new',
  (select old_values->>'status' || '→' || (new_values->>'status') from activity_log
   where table_name = 'brands' and action = 'status_change'), 'active→paused');
reset role;

-- ── Reusable hook for future tables ─────────────────────────
create table public.zz_future_feature (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), created_by uuid references public.team_members(id), note text);
select public.enable_standard_table('public.zz_future_feature');
create policy staff_all on public.zz_future_feature for all to authenticated using (public.is_staff()) with check (public.is_staff());
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
insert into zz_future_feature (note) values ('hello');
select pg_temp.expect('new table logs automatically', (select count(*) from activity_log where table_name = 'zz_future_feature'), 1::bigint);
reset role;
select pg_temp.expect_error('hook refuses tables without standard columns',
  $q$create table public.zz_bad (x int); select public.enable_standard_table('public.zz_bad')$q$);
drop table public.zz_future_feature;
select pg_temp.expect('no schema rule violations', (select count(*) from public.schema_rule_violations()), 0::bigint);
\o
\echo 'ALL CHECKS PASSED'
