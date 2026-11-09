-- LOCAL TESTING ONLY: feature 4 checks. Runs after creators_test.sql (same database).
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
\i supabase/samples/sample_campaign.sql
\o /dev/null

set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');   -- founder
select pg_temp.expect('expected margin = client budget − planned spends',
  (select expected_margin from campaign_summary where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), 150000.00::numeric);
select pg_temp.expect('actual creator spend = confirmed-or-later fees only (posted 30K + approved 56K; dropped & shortlisted excluded)',
  (select actual_creator_spend from campaign_summary where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), 86000.00::numeric);
select pg_temp.expect('profit = billing − payouts − production expenses (no invoices yet)',
  (select profit from campaign_summary where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), -8000.00::numeric);
select pg_temp.expect('views summed across posts', (select views from campaign_summary where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), 301500::numeric);
select pg_temp.expect('campaign engagement rate', (select engagement_rate from campaign_summary where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), 6.99::numeric);
select pg_temp.expect('cost per view = actual creator spend ÷ views', (select cost_per_view from campaign_summary where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), 0.2852::numeric);
select pg_temp.expect('post ER = (likes+comments+shares+saves) ÷ views', (select engagement_rate from deliverable_performance where deliverable_id = '5a3b1e00-0000-4000-8000-0000000ca201'), 7.50::numeric);
select pg_temp.expect('post cost = fee split over the creator’s deliverables', (select round(cost) from deliverable_performance where deliverable_id = '5a3b1e00-0000-4000-8000-0000000ca201'), 10000::numeric);
select pg_temp.expect('post CPV', (select cost_per_view from deliverable_performance where deliverable_id = '5a3b1e00-0000-4000-8000-0000000ca201'), 0.0543::numeric);
select pg_temp.expect('overdue: go-live passed and not posted', (select string_agg(title, ',') from deliverable_performance where is_overdue and campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), 'Sana — festive look reel');
select pg_temp.expect('summary counts', (select deliverables || '/' || posted || '/' || overdue from campaign_summary where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), '5/3/1');
select pg_temp.expect('brand shows 1 active campaign', (select active_campaigns from brand_overview where id = '5a3b1e00-0000-4000-8000-0000000000b1'), 1::bigint);

-- planned deliverables: 1 story → 3 → back to 1 (posted one is never cancelled)
select set_creator_deliverables('5a3b1e00-0000-4000-8000-0000000ca101', 'story', 3);
select pg_temp.expect('quantity up adds rows', (select count(*) from deliverables where campaign_creator_id = '5a3b1e00-0000-4000-8000-0000000ca101' and deliverable_type = 'story' and stage <> 'cancelled'), 3::bigint);
select set_creator_deliverables('5a3b1e00-0000-4000-8000-0000000ca101', 'story', 1);
select pg_temp.expect('quantity down cancels the unposted extras', (select string_agg(stage, ',' order by stage) from deliverables where campaign_creator_id = '5a3b1e00-0000-4000-8000-0000000ca101' and deliverable_type = 'story'), 'cancelled,cancelled,live');
select pg_temp.expect('cost per post re-splits after cancelling', (select round(cost) from deliverable_performance where deliverable_id = '5a3b1e00-0000-4000-8000-0000000ca201'), 10000::numeric);

-- tracker: approval drives stage; posting needs a link and clears the overdue warning
update deliverables set approval_status = 'changes_requested' where id = '5a3b1e00-0000-4000-8000-0000000ca205';
select pg_temp.expect('changes requested → stage "revisions"', (select stage from deliverables where id = '5a3b1e00-0000-4000-8000-0000000ca205'), 'revisions');
update deliverables set approval_status = 'approved' where id = '5a3b1e00-0000-4000-8000-0000000ca205';
select pg_temp.expect('approved → approved_at stamped', (select stage || '/' || (approved_at is not null) from deliverables where id = '5a3b1e00-0000-4000-8000-0000000ca205'), 'approved/true');
select pg_temp.expect_error('cannot mark posted without the live link',
  $q$update deliverables set stage = 'live' where id = '5a3b1e00-0000-4000-8000-0000000ca204'$q$);
update deliverables set stage = 'live', live_url = 'https://instagram.com/p/sana' where id = '5a3b1e00-0000-4000-8000-0000000ca204';
select pg_temp.expect('posted clears the overdue warning', (select overdue from campaign_summary where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), 0::bigint);
select pg_temp.expect('posting stamps went_live_at', (select went_live_at is not null from deliverables where id = '5a3b1e00-0000-4000-8000-0000000ca204'), true);

-- status changes, completed stamp, history
update campaigns set status = 'completed' where id = '5a3b1e00-0000-4000-8000-0000000ca001';
select pg_temp.expect('completed_at stamped', (select completed_at is not null from campaigns where id = '5a3b1e00-0000-4000-8000-0000000ca001'), true);
update campaigns set status = 'reporting' where id = '5a3b1e00-0000-4000-8000-0000000ca001';
select pg_temp.expect('completed_at cleared when reopened', (select completed_at is null from campaigns where id = '5a3b1e00-0000-4000-8000-0000000ca001'), true);
select pg_temp.expect_error('old status names rejected', $q$update campaigns set status = 'in_production' where id = '5a3b1e00-0000-4000-8000-0000000ca001'$q$);
update campaign_creator_fees set agreed_fee = 60000 where campaign_creator_id = '5a3b1e00-0000-4000-8000-0000000ca102';
select pg_temp.expect('campaign history covers creators, fees, deliverables',
  (select string_agg(distinct table_name, ',' order by table_name) from campaign_activity('5a3b1e00-0000-4000-8000-0000000ca001')),
  'campaign_creator_fees,campaign_creators,campaign_finances,campaign_promo_codes,campaigns,deliverable_metrics,deliverables');

-- shortlist → campaign
insert into shortlists (id, name) values ('5a3b1e00-0000-4000-8000-0000000ca501', 'Extra food creators');
insert into shortlist_creators (shortlist_id, creator_id) values
  ('5a3b1e00-0000-4000-8000-0000000ca501', '5a3b1e00-0000-4000-8000-000000000c05'),
  ('5a3b1e00-0000-4000-8000-0000000ca501', '5a3b1e00-0000-4000-8000-000000000c01');
select pg_temp.expect('shortlist adds only new creators', add_shortlist_to_campaign('5a3b1e00-0000-4000-8000-0000000ca501', '5a3b1e00-0000-4000-8000-0000000ca001'), 1);
select pg_temp.expect('shortlist now linked to the campaign', (select campaign_id::text from shortlists where id = '5a3b1e00-0000-4000-8000-0000000ca501'), '5a3b1e00-0000-4000-8000-0000000ca001');

-- team member put on the campaign: sees work, not money
reset role;
update team_members set status = 'active' where email = 'team@example.com';
insert into campaign_members (campaign_id, team_member_id) values ('5a3b1e00-0000-4000-8000-0000000ca001', '10000000-0000-0000-0000-000000000004');
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select pg_temp.expect('team: sees the campaign and its posts', (select count(*) from deliverable_performance where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001') > 0, true);
select pg_temp.expect('team: no money in the summary',
  (select coalesce(client_budget, actual_creator_spend, profit, cost_per_view) is null from campaign_summary where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), true);
select pg_temp.expect('team: no cost per post', (select bool_and(cost is null) from deliverable_performance where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), true);
update deliverables set draft_url = 'https://drive.example/v2' where id = '5a3b1e00-0000-4000-8000-0000000ca205';
insert into deliverable_metrics (deliverable_id, captured_on, views, likes) values ('5a3b1e00-0000-4000-8000-0000000ca204', ist_today(), 50000, 2000);
select pg_temp.expect('team: can update links and enter performance', (select views from deliverable_performance where deliverable_id = '5a3b1e00-0000-4000-8000-0000000ca204'), 50000::bigint);
select pg_temp.expect_error('team: cannot change a creator fee',
  $q$insert into campaign_creator_fees (campaign_creator_id, agreed_fee) values ('5a3b1e00-0000-4000-8000-0000000ca104', 1)$q$);
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select pg_temp.expect('freelancer: cannot see the campaign', (select count(*) from campaign_summary where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'), 0::bigint);
reset role;

-- removal, in the documented order
delete from shortlist_creators where shortlist_id = '5a3b1e00-0000-4000-8000-0000000ca501';
delete from shortlists where id = '5a3b1e00-0000-4000-8000-0000000ca501';
\i supabase/samples/remove_sample_campaign.sql
\i supabase/samples/remove_sample_creators.sql
\i supabase/samples/remove_sample_brands.sql
\o /dev/null
select pg_temp.expect('sample campaign removed with its deliverables',
  (select count(*) from campaigns where id::text like '5a3b1e00-%') + (select count(*) from deliverables where id::text like '5a3b1e00-%'), 0::bigint);
select pg_temp.expect('then sample creators and brands remove cleanly',
  (select count(*) from creators where id::text like '5a3b1e00-%') + (select count(*) from brands where id::text like '5a3b1e00-%'), 0::bigint);
select pg_temp.expect('no schema rule violations', (select count(*) from public.schema_rule_violations()), 0::bigint);
\o
\echo 'CAMPAIGNS CHECKS PASSED'
