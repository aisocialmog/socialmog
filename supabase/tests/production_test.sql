-- LOCAL TESTING ONLY: feature 5 checks. Runs after campaigns_test.sql (same database).
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

\i supabase/samples/sample_brands.sql
\i supabase/samples/sample_creators.sql
\i supabase/samples/sample_campaign.sql
\o /dev/null
update brands set revision_limit = 1 where id = '5a3b1e00-0000-4000-8000-0000000000b1';

set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');   -- founder
-- a production-only item (no campaign)
insert into deliverables (id, brand_id, title, deliverable_type, platform, go_live_date)
values ('5a3b1e00-0000-4000-8000-0000000ca901', '5a3b1e00-0000-4000-8000-0000000000b1', 'Chai Sutra — brand film', 'ad_film', 'youtube', ist_today() + 12);
select pg_temp.expect('new item starts at Idea', (select stage from deliverables where id = '5a3b1e00-0000-4000-8000-0000000ca901'), 'idea');
select pg_temp.expect('no campaign needed', (select campaign_id is null and brand_name = 'Chai Sutra (sample)' from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca901'), true);
select pg_temp.expect_error('formats are checked', $q$update deliverables set deliverable_type = 'podcast' where id = '5a3b1e00-0000-4000-8000-0000000ca901'$q$);

update deliverables set stage = 'script' where id = '5a3b1e00-0000-4000-8000-0000000ca901';
update deliverables set stage = 'editing' where id = '5a3b1e00-0000-4000-8000-0000000ca901';
select pg_temp.expect('every stage move is in the activity log with its time',
  (select string_agg(new_values->>'stage', '→' order by created_at) from activity_log where record_id = '5a3b1e00-0000-4000-8000-0000000ca901' and action = 'status_change'), 'script→editing');
select pg_temp.expect('stage durations computed from the log', (select count(*) from production_stage_durations where deliverable_id = '5a3b1e00-0000-4000-8000-0000000ca901'), 3::bigint);

-- stuck & overdue
reset role;
update deliverables set stage_changed_at = now() - interval '4 days' where id = '5a3b1e00-0000-4000-8000-0000000ca901';
set role authenticated;
select pg_temp.expect('stuck after 3 days in one stage', (select is_stuck::text || '/' || days_in_stage from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca901'), 'true/4');
update org_settings set stuck_after_days = 5;
select pg_temp.expect('threshold is a setting', (select is_stuck from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca901'), false);
update org_settings set stuck_after_days = 3;
select pg_temp.expect('past target post date flagged', (select is_overdue from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca204'), true);
select pg_temp.expect('turnaround view averages finished stages', (select count(*) > 0 from production_stage_turnaround), true);

-- revisions vs the brand's limit (1)
update deliverables set stage = 'client_review' where id = '5a3b1e00-0000-4000-8000-0000000ca901';
select pg_temp.expect('client review marks approval pending', (select approval_status from deliverables where id = '5a3b1e00-0000-4000-8000-0000000ca901'), 'pending');
update deliverables set stage = 'revisions' where id = '5a3b1e00-0000-4000-8000-0000000ca901';
update deliverables set stage = 'client_review' where id = '5a3b1e00-0000-4000-8000-0000000ca901';
select pg_temp.expect('one round = within limit', (select revision_count || '/' || over_revision_limit from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca901'), '1/false');
update deliverables set approval_status = 'changes_requested' where id = '5a3b1e00-0000-4000-8000-0000000ca901';
select pg_temp.expect('second round (via “changes asked”) goes over the limit', (select revision_count || '/' || over_revision_limit from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca901'), '2/true');
update deliverables set revision_limit = 3 where id = '5a3b1e00-0000-4000-8000-0000000ca901';
select pg_temp.expect('item limit overrides the brand’s', (select over_revision_limit from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca901'), false);

-- people: freelancer as editor gets access; script versions + client comments; edit versions → draft link
insert into production_people (deliverable_id, role, team_member_id) values ('5a3b1e00-0000-4000-8000-0000000ca901', 'editor', '10000000-0000-0000-0000-000000000005');
insert into production_people (deliverable_id, role, creator_id) values ('5a3b1e00-0000-4000-8000-0000000ca901', 'talent', '5a3b1e00-0000-4000-8000-000000000c01');
select pg_temp.expect_error('a person is one kind only', $q$insert into production_people (deliverable_id, role, team_member_id, creator_id) values ('5a3b1e00-0000-4000-8000-0000000ca901', 'shooter', '10000000-0000-0000-0000-000000000005', '5a3b1e00-0000-4000-8000-000000000c01')$q$);
select pg_temp.expect('people listed on the item', (select array_to_string(people, ',') from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca901'), 'editor:Farid Freelance,talent:Aarohi Sinha (sample)');
insert into scripts (id, deliverable_id, version, body) values ('5a3b1e00-0000-4000-8000-0000000ca911', '5a3b1e00-0000-4000-8000-0000000ca901', 1, '<p><strong>Hook:</strong> steam rising…</p>');
insert into scripts (deliverable_id, version, body) values ('5a3b1e00-0000-4000-8000-0000000ca901', 2, '<p>v2</p>');
select pg_temp.expect_error('script versions are unique', $q$insert into scripts (deliverable_id, version, body) values ('5a3b1e00-0000-4000-8000-0000000ca901', 2, 'dup')$q$);
insert into script_comments (script_id, from_client, author_name, body) values ('5a3b1e00-0000-4000-8000-0000000ca911', true, 'Priya Nair', 'Shorter hook please');
select pg_temp.expect('latest script version on the item', (select script_version from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca901'), 2);

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');   -- freelancer (editor)
select pg_temp.expect('freelancer: sees the item they edit', (select count(*) from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca901'), 1::bigint);
select pg_temp.expect('freelancer: in My work via people', (select count(*) from production_items where '10000000-0000-0000-0000-000000000005' = any(people_member_ids)), 1::bigint);
insert into edit_versions (deliverable_id, version, url) values ('5a3b1e00-0000-4000-8000-0000000ca901', 1, 'https://frame.example/v1');
select pg_temp.expect('freelancer: edit version becomes the draft link', (select draft_url from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca901'), 'https://frame.example/v1');
select pg_temp.expect('freelancer: can read the client comments', (select count(*) from script_comments where script_id = '5a3b1e00-0000-4000-8000-0000000ca911'), 1::bigint);
select pg_temp.expect('freelancer: still no other brand work', (select count(*) from production_items where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), 0::bigint);
select pg_temp.expect_error('freelancer: cannot share calendars', $q$select create_calendar_share('5a3b1e00-0000-4000-8000-0000000000b1')$q$);
select pg_temp.expect_error('edit links must be web links', $q$insert into edit_versions (deliverable_id, version, url) values ('5a3b1e00-0000-4000-8000-0000000ca901', 2, 'ftp://x')$q$);

-- shoots
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into shoots (id, title, brand_id, shoot_date, call_time, location, equipment, call_sheet_notes)
values ('5a3b1e00-0000-4000-8000-0000000ca921', 'Brand film shoot', '5a3b1e00-0000-4000-8000-0000000000b1', ist_today() + 4, '07:30', 'Bandra studio', '{FX3,2 lights,gimbal}', 'Breakfast at 7');
insert into shoot_deliverables (shoot_id, deliverable_id) values ('5a3b1e00-0000-4000-8000-0000000ca921', '5a3b1e00-0000-4000-8000-0000000ca901');
select pg_temp.expect('shoot on the item and calendar', (select shoot_date = ist_today() + 4 from production_items where id = '5a3b1e00-0000-4000-8000-0000000ca901')
  and (select array_to_string(equipment, ',') = 'FX3,2 lights,gimbal' from shoot_calendar where id = '5a3b1e00-0000-4000-8000-0000000ca921'), true);

-- client calendar link
create temp table tok as select create_calendar_share('5a3b1e00-0000-4000-8000-0000000000b1') as t;
select pg_temp.expect('only a hash of the token is stored', (select count(*) from calendar_shares where token_hash = (select t from tok)), 0::bigint);
reset role;
grant select on tok to anon;
set role anon;
select pg_temp.expect('anon: shared calendar shows the brand’s posts and shoots',
  (select string_agg(kind || ':' || status, ',' order by kind, status) from shared_calendar((select t from tok), ist_today() - 30, ist_today() + 30) where title in ('Chai Sutra — brand film', 'Shoot day', 'Aarohi — Diwali chai reel')),
  'post:Awaiting your review,post:Posted,shoot:Planned');
select pg_temp.expect('anon: no other brand', (select count(*) from shared_calendar((select t from tok), ist_today() - 30, ist_today() + 30) where brand_name <> 'Chai Sutra (sample)'), 0::bigint);
select pg_temp.expect_error('anon: wrong token refused', $q$select * from shared_calendar('nope', current_date, current_date + 7)$q$);
select pg_temp.expect_error('anon: at most 120 days', $q$select * from shared_calendar((select t from tok), current_date, current_date + 200)$q$);
select pg_temp.expect_error('anon: cannot read tables directly', $q$select * from deliverables$q$);
reset role;
update calendar_shares set revoked_at = now();
set role anon;
select pg_temp.expect_error('anon: revoked link stops working', $q$select * from shared_calendar((select t from tok), current_date, current_date + 7)$q$);
reset role;

-- clean up through the sample scripts (they now remove production rows too)
delete from production_people where deliverable_id = '5a3b1e00-0000-4000-8000-0000000ca901';
delete from edit_versions where deliverable_id = '5a3b1e00-0000-4000-8000-0000000ca901';
delete from script_comments where script_id in (select id from scripts where deliverable_id = '5a3b1e00-0000-4000-8000-0000000ca901');
delete from scripts where deliverable_id = '5a3b1e00-0000-4000-8000-0000000ca901';
delete from shoot_deliverables where shoot_id = '5a3b1e00-0000-4000-8000-0000000ca921';
delete from shoots where id = '5a3b1e00-0000-4000-8000-0000000ca921';
delete from deliverables where id = '5a3b1e00-0000-4000-8000-0000000ca901';
delete from calendar_shares;
\i supabase/samples/remove_sample_campaign.sql
\i supabase/samples/remove_sample_creators.sql
\i supabase/samples/remove_sample_brands.sql
\o /dev/null
select pg_temp.expect('samples removed cleanly', (select count(*) from brands where id::text like '5a3b1e00-%') + (select count(*) from deliverables where id::text like '5a3b1e00-%'), 0::bigint);
select pg_temp.expect('no schema rule violations', (select count(*) from public.schema_rule_violations()), 0::bigint);
\o
\echo 'PRODUCTION CHECKS PASSED'
