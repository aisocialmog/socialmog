-- LOCAL TESTING ONLY: feature 2 checks. Runs after smoke_test.sql (same database).
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

-- sample data loads, and loading twice changes nothing
\i supabase/samples/sample_brands.sql
\i supabase/samples/sample_brands.sql
\o /dev/null
select pg_temp.expect('two sample brands', (select count(*) from brands where id::text like '5a3b1e00-%'), 2::bigint);

set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');   -- founder 1
select pg_temp.expect('overview: renewal warning at 10 days',
  (select renewal_warning::text || '/' || days_to_renewal from brand_overview where name = 'Chai Sutra (sample)'), 'true/10');
select pg_temp.expect('overview: retainer fee', (select monthly_fee from brand_overview where name = 'Chai Sutra (sample)'), 85000.00::numeric);
select pg_temp.expect('overview: sample revenue is ₹0 until Money', (select lifetime_revenue from brand_overview where name = 'Chai Sutra (sample)'), 0::numeric);
select pg_temp.expect('overview: primary contact', (select primary_contact_name from brand_overview where name = 'Chai Sutra (sample)'), 'Priya Nair');
select pg_temp.expect('overview: owner name', (select owner_name from brand_overview where name = 'Chai Sutra (sample)'), 'Founder One');
select pg_temp.expect('overview: revenue calculated from invoices (pre-GST)', (select lifetime_revenue from brand_overview where name = 'Mama Bites'), 200000.00::numeric);
select pg_temp.expect('overview: outstanding incl. GST', (select outstanding from brand_overview where name = 'Mama Bites'), 236000.00::numeric);
select pg_temp.expect('overview: active campaigns counted', (select active_campaigns from brand_overview where name = 'Mama Bites'), 1::bigint);
select pg_temp.expect('overview: no warning without a retainer', (select renewal_warning from brand_overview where name = 'Neelam Naturals (sample)'), false);

select set_primary_contact('5a3b1e00-0000-4000-8000-0000000000c2');
select pg_temp.expect('primary contact switched', (select string_agg(name, ',') from brand_contacts where brand_id = '5a3b1e00-0000-4000-8000-0000000000b1' and is_primary), 'Rohan Shah');
select pg_temp.expect_error('only one primary contact per brand',
  $q$insert into brand_contacts (brand_id, name, is_primary) values ('5a3b1e00-0000-4000-8000-0000000000b1', 'Second primary', true)$q$);
select pg_temp.expect_error('GSTIN format checked',
  $q$update brands set gstin = '27ABC' where id = '5a3b1e00-0000-4000-8000-0000000000b2'$q$);
select pg_temp.expect_error('one live retainer per brand',
  $q$insert into retainers (brand_id, title, monthly_fee, start_date, status) values ('5a3b1e00-0000-4000-8000-0000000000b1', 'Second', 1, '2026-11-01', 'active')$q$);
select pg_temp.expect_error('renewal cannot be before start',
  $q$update retainers set renewal_date = '2020-01-01' where id = '5a3b1e00-0000-4000-8000-0000000000a1'$q$);
select pg_temp.expect_error('old status "churned" no longer allowed',
  $q$update brands set status = 'churned' where id = '5a3b1e00-0000-4000-8000-0000000000b2'$q$);

update brands set status = 'active' where id = '5a3b1e00-0000-4000-8000-0000000000b2';   -- pipeline drag
select pg_temp.expect('pipeline move logged as status change',
  (select old_values->>'status' || '→' || (new_values->>'status') from brand_activity('5a3b1e00-0000-4000-8000-0000000000b2')
   where action = 'status_change' limit 1), 'pitching→active');
select pg_temp.expect('brand activity includes contacts and retainer',
  (select string_agg(distinct table_name, ',' order by table_name) from brand_activity('5a3b1e00-0000-4000-8000-0000000000b1')),
  'brand_contacts,brands,retainers');
select pg_temp.expect('primary switch shows in brand activity (update of a child row)',
  (select count(*) from brand_activity('5a3b1e00-0000-4000-8000-0000000000b1') where table_name = 'brand_contacts' and action = 'update'), 2::bigint);

-- freelancer (assigned work on Kesar Skin only) sees no samples and no retainer money
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select pg_temp.expect('freelancer: overview limited to own brand', (select string_agg(name, ',') from brand_overview), 'Kesar Skin');
select pg_temp.expect('freelancer: no brand activity for samples', (select count(*) from brand_activity('5a3b1e00-0000-4000-8000-0000000000b1')), 0::bigint);
reset role;

-- removal refuses while a sample brand has real work attached
insert into campaigns (id, brand_id, name) values ('5a3b1e00-0000-4000-8000-00000000ca00', '5a3b1e00-0000-4000-8000-0000000000b2', 'Real work');
\o
\set ON_ERROR_STOP 0
\i supabase/samples/remove_sample_brands.sql
\set ON_ERROR_STOP 1
\o /dev/null
select pg_temp.expect('removal blocked while work is attached', (select count(*) from brands where id::text like '5a3b1e00-%'), 2::bigint);
delete from task_assignees where task_id in (select id from tasks where campaign_id = '5a3b1e00-0000-4000-8000-00000000ca00');
delete from tasks where campaign_id = '5a3b1e00-0000-4000-8000-00000000ca00';   -- made by the task-template automation
delete from campaigns where id = '5a3b1e00-0000-4000-8000-00000000ca00';
delete from activity_log where record_id = '5a3b1e00-0000-4000-8000-00000000ca00';
\i supabase/samples/remove_sample_brands.sql
\o /dev/null
select pg_temp.expect('samples removed', (select count(*) from brands where id::text like '5a3b1e00-%'), 0::bigint);
select pg_temp.expect('sample contacts & retainer removed',
  (select count(*) from brand_contacts where id::text like '5a3b1e00-%') + (select count(*) from retainers where id::text like '5a3b1e00-%'), 0::bigint);
select pg_temp.expect('sample activity removed',
  (select count(*) from activity_log where record_id::text like '5a3b1e00-%' or coalesce(new_values->>'brand_id', old_values->>'brand_id') like '5a3b1e00-%'), 0::bigint);
select pg_temp.expect('real brands untouched', (select count(*) from brands), 2::bigint);
select pg_temp.expect('no schema rule violations', (select count(*) from public.schema_rule_violations()), 0::bigint);
\o
\echo 'BRANDS CHECKS PASSED'
