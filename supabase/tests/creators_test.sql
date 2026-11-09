-- LOCAL TESTING ONLY: feature 3 checks. Runs after brands_test.sql (same database).
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

\i supabase/samples/sample_creators.sql
\i supabase/samples/sample_creators.sql
\o /dev/null
select pg_temp.expect('five sample creators', (select count(*) from creators where id::text like '5a3b1e00-%'), 5::bigint);

set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');   -- founder
select pg_temp.expect('tiers from biggest platform',
  (select string_agg(tier, ',' order by name) from creator_overview where name like '%(sample)%'),
  'micro,macro,nano,mega,mid');
select pg_temp.expect('tier edges', (select string_agg(creator_tier(x), ',') from unnest(array[9999,10000,99999,100000,499999,500000,999999,1000000]::bigint[]) x),
  'nano,micro,micro,mid,mid,macro,macro,mega');
select pg_temp.expect('overview: niches + top platform',
  (select array_to_string(niches, '/') || ' ' || top_platform || ' @' || top_handle from creator_overview where name = 'Kabir Menon (sample)'),
  'Education/Tech youtube @KabirTechSample');
select pg_temp.expect('overview: rate pivot', (select rate_youtube_video from creator_overview where name = 'Kabir Menon (sample)'), 120000.00::numeric);
select pg_temp.expect('metrics date stamped automatically', (select bool_and(metrics_updated_on = ist_today()) from creator_platforms where creator_id::text like '5a3b1e00-%'), true);
select pg_temp.expect('a stats snapshot per platform', (select count(*) from creator_metric_snapshots s join creator_platforms p on p.id = s.creator_platform_id where p.creator_id::text like '5a3b1e00-%'), 10::bigint);
select pg_temp.expect('founder sees payment details', (select upi_id from creator_payment_details where creator_id = '5a3b1e00-0000-4000-8000-000000000c01'), 'aarohi.sample@okaxis');
select pg_temp.expect('activity log keeps only last 4 of PAN',
  (select new_values->>'pan' from activity_log where table_name = 'creator_payment_details' and action = 'create'), '••••234K');
select pg_temp.expect_error('blacklist needs a reason',
  $q$update creators set is_blacklisted = true, blacklist_reason = ' ' where id = '5a3b1e00-0000-4000-8000-000000000c03'$q$);
select pg_temp.expect_error('PAN format checked',
  $q$update creator_payment_details set pan = 'ABC123' where creator_id = '5a3b1e00-0000-4000-8000-000000000c01'$q$);
select pg_temp.expect_error('same handle cannot belong to two creators (any case)',
  $q$insert into creator_platforms (creator_id, platform, handle) values ('5a3b1e00-0000-4000-8000-000000000c02', 'instagram', 'AAROHI.eats.sample')$q$);

-- rate change keeps history
update creator_rate_cards set valid_from = ist_today() - 30 where creator_id = '5a3b1e00-0000-4000-8000-000000000c01' and deliverable_type = 'reel';
select set_creator_rate('5a3b1e00-0000-4000-8000-000000000c01', 'reel', 11000);
select pg_temp.expect('new current rate', (select rate_reel from creator_overview where id = '5a3b1e00-0000-4000-8000-000000000c01'), 11000.00::numeric);
select pg_temp.expect('old rate kept with an end date',
  (select rate::text || ' until ' || (valid_to = ist_today() - 1) from creator_rate_cards where creator_id = '5a3b1e00-0000-4000-8000-000000000c01' and deliverable_type = 'reel' and valid_to is not null), '9000.00 until true');
select set_creator_rate('5a3b1e00-0000-4000-8000-000000000c01', 'reel', 11500);
select pg_temp.expect('same-day correction edits in place', (select count(*) from creator_rate_cards where creator_id = '5a3b1e00-0000-4000-8000-000000000c01' and deliverable_type = 'reel'), 2::bigint);

-- followers change → new snapshot is updated in place for today, tier changes
update creator_platforms set followers = 120000 where id = '5a3b1e00-0000-4000-8000-000000000c11';
select pg_temp.expect('tier follows the numbers', (select tier from creator_overview where id = '5a3b1e00-0000-4000-8000-000000000c01'), 'mid');
select pg_temp.expect('snapshot updated', (select followers from creator_metric_snapshots where creator_platform_id = '5a3b1e00-0000-4000-8000-000000000c11'), 120000::bigint);

-- duplicates by phone (any format) and handle (any case, with @ stripped by the app)
select pg_temp.expect('duplicate detection',
  (select string_agg(matched_on || '=' || creator_name, ',' order by matched_on) from creator_duplicates(array['098350-10001', '+91 9999999999'], array['instagram:SANA.STYLES.SAMPLE', 'youtube:nobody'])),
  'handle=Sana Qureshi (sample),phone=Aarohi Sinha (sample)');

-- bulk import: all-or-nothing, batch recorded, new niche created, rates set
select pg_temp.expect('import creates rows',
  (select created from import_creators('Old sheet', 'creators.csv', $j$[
    {"name":"Imported One","phone":"+91 90000 00001","city":"Patna","languages":["Hindi","Bhojpuri"],"niches":["food","Bhojpuri comedy"],
     "platforms":[{"platform":"instagram","handle":"imported.one","followers":"25000","avg_views":"9000","engagement_rate":"4.5"}],
     "rates":{"reel":"6000","story":"1500"},"raw":{"Name":"Imported One"}},
    {"name":"Imported Two","platforms":[{"platform":"youtube","handle":"ImportedTwo","followers":"3000"}]}
  ]$j$)), 2);
select pg_temp.expect('imported creator complete',
  (select tier || ' ' || array_to_string(niches, '/') || ' ' || rate_reel from creator_overview where name = 'Imported One'), 'micro Bhojpuri Comedy/Food 6000.00');
select pg_temp.expect('import batch + raw rows kept', (select rows_total || '/' || (select count(*) from import_rows r where r.batch_id = b.id) from import_batches b where target_table = 'creators'), '2/2');
select pg_temp.expect('import marked in activity log', (select count(*) from activity_log where table_name = 'creators' and source = 'import'), 2::bigint);
select pg_temp.expect_error('import is all-or-nothing',
  $q$select import_creators('x', 'x.csv', '[{"name":"Fine"},{"name":""}]')$q$);
select pg_temp.expect('nothing half-imported', (select count(*) from creators where name = 'Fine'), 0::bigint);

-- shortlists
insert into shortlists (id, name) values ('5a3b1e00-0000-4000-8000-0000000005a1', 'Ranchi food micro creators');
insert into shortlist_creators (shortlist_id, creator_id) values ('5a3b1e00-0000-4000-8000-0000000005a1', '5a3b1e00-0000-4000-8000-000000000c01');
select pg_temp.expect('shortlist entry in creator activity', (select count(*) from creator_activity('5a3b1e00-0000-4000-8000-000000000c01') where table_name = 'shortlist_creators'), 1::bigint);
select pg_temp.expect('creator activity covers platforms, rates, niches, payment', (select string_agg(distinct table_name, ',' order by table_name) from creator_activity('5a3b1e00-0000-4000-8000-000000000c01')),
  'creator_payment_details,creator_platforms,creator_rate_cards,creator_tags,creators,shortlist_creators');

-- manager: everything except payment details (and their history)
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select pg_temp.expect('manager: no payment details', (select count(*) from creator_payment_details), 0::bigint);
select pg_temp.expect('manager: no payment-detail history', (select count(*) from creator_activity('5a3b1e00-0000-4000-8000-000000000c01') where table_name = 'creator_payment_details'), 0::bigint);
select pg_temp.expect('manager: sees rates', (select rate_reel from creator_overview where id = '5a3b1e00-0000-4000-8000-000000000c03'), 28000.00::numeric);
select pg_temp.expect_error('manager cannot add payment details',
  $q$insert into creator_payment_details (creator_id, upi_id) values ('5a3b1e00-0000-4000-8000-000000000c02', 'x@upi')$q$);

-- freelancer: no sample creators, no shortlists, cannot import
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select pg_temp.expect('freelancer: no sample creators', (select count(*) from creator_overview where name like '%(sample)%'), 0::bigint);
select pg_temp.expect('freelancer: no shortlists', (select count(*) from shortlists), 0::bigint);
select pg_temp.expect_error('freelancer cannot import', $q$select import_creators('x', 'x.csv', '[{"name":"Nope"}]')$q$);
reset role;

-- removal
delete from shortlist_creators where shortlist_id = '5a3b1e00-0000-4000-8000-0000000005a1';
\i supabase/samples/remove_sample_creators.sql
\o /dev/null
select pg_temp.expect('sample creators removed', (select count(*) from creators where id::text like '5a3b1e00-%'), 0::bigint);
select pg_temp.expect('their platforms, rates, payment details gone',
  (select count(*) from creator_platforms where creator_id::text like '5a3b1e00-%') + (select count(*) from creator_rate_cards where creator_id::text like '5a3b1e00-%')
  + (select count(*) from creator_payment_details where creator_id::text like '5a3b1e00-%'), 0::bigint);
select pg_temp.expect('their history gone', (select count(*) from activity_log where coalesce(new_values->>'creator_id', old_values->>'creator_id') like '5a3b1e00-%' or record_id::text like '5a3b1e00-0000-4000-8000-000000000c%'), 0::bigint);
select pg_temp.expect('other creators untouched', (select count(*) from creators where name like 'Imported%'), 2::bigint);
select pg_temp.expect('no schema rule violations', (select count(*) from public.schema_rule_violations()), 0::bigint);
\o
\echo 'CREATORS CHECKS PASSED'
