-- LOCAL TESTING ONLY: features 8–9 and the working methods. Runs after opening_test.sql
-- in the same database (its brands, invoices and people are still there).
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
-- read as the owner (people only see their own notifications)
create or replace function pg_temp.asowner(q text) returns text language plpgsql security definer as $$ declare r text; begin execute q into r; return r; end $$;
\set F1 '''00000000-0000-0000-0000-0000000000a1'''
\set F2 '''00000000-0000-0000-0000-0000000000a2'''
\set MGR '''00000000-0000-0000-0000-0000000000a3'''
\set TEAM '''00000000-0000-0000-0000-0000000000a4'''
create temp table ids as select
  (select id from team_members where email = 'founder1@example.com') f1, (select id from team_members where email = 'founder2@example.com') f2,
  '10000000-0000-0000-0000-000000000003'::uuid mgr, '10000000-0000-0000-0000-000000000004'::uuid team;
grant select on ids to authenticated;
update team_members set status = 'active' where email = 'founder2@example.com';   -- an earlier suite deactivated them
set role authenticated;

-- ── Tasks ───────────────────────────────────────────────────
select pg_temp.login(:F1);
insert into tasks (id, title, assignee_id, due_date, due_time, priority, brand_id, estimate_hours)
  select '70000000-0000-0000-0000-000000000001', 'Call Rohan', f2, ist_today(), '16:00', 'high', 'b0000000-0000-0000-0000-0000000000a1', 2 from ids;
insert into task_assignees (task_id, member_id) select '70000000-0000-0000-0000-000000000001', team from ids;
select pg_temp.expect('lead assignee is in the list', (select count(*) from task_assignees where task_id = '70000000-0000-0000-0000-000000000001'), 2::bigint);
select pg_temp.expect('task_list: names, link, not overdue', (select array_length(assignee_names, 1) || '|' || link_table || '|' || link_name || '|' || is_overdue from task_list where id = '70000000-0000-0000-0000-000000000001'), '2|brands|Masala Co|false');
select pg_temp.expect_error('a task links to one record only', $q$update tasks set campaign_id = (select id from campaigns limit 1) where id = '70000000-0000-0000-0000-000000000001'$q$);
select pg_temp.expect_error('old status "blocked" is gone', $q$update tasks set status = 'blocked' where id = '70000000-0000-0000-0000-000000000001'$q$);
select pg_temp.expect('assigning notifies the assignee, not the assigner',
  pg_temp.asowner($q$select count(*) filter (where recipient_id = (select f2 from ids)) || '/' || count(*) filter (where recipient_id = (select f1 from ids)) from notifications where kind = 'task_assigned' and record_id = '70000000-0000-0000-0000-000000000001'$q$), '1/0');
insert into task_checklist_items (task_id, title) values ('70000000-0000-0000-0000-000000000001', 'Check the cut');
insert into comments (task_id, body) values ('70000000-0000-0000-0000-000000000001', 'Can you join @Tara? cc @FounderTwo and mail x@founder.co');
select pg_temp.expect('@first-name and @FullName mention', pg_temp.asowner($q$select count(*) from notifications where kind = 'mention' and record_id = '70000000-0000-0000-0000-000000000001'$q$), '2');

select pg_temp.login(:TEAM);
select pg_temp.expect('team member sees a task they are added to', (select count(*) from tasks where id = '70000000-0000-0000-0000-000000000001'), 1::bigint);
select timer_start('70000000-0000-0000-0000-000000000001');
select pg_temp.expect('timer start moves To do → In progress', (select status from tasks where id = '70000000-0000-0000-0000-000000000001'), 'in_progress');
select timer_start('70000000-0000-0000-0000-000000000001', 'focus');
select pg_temp.expect('one running timer per person', (select count(*) filter (where ended_at is null) || '/' || count(*) from time_logs where member_id = (select team from ids)), '1/2');
select timer_stop();
select pg_temp.expect('stopped timer has a duration', (select count(*) from time_logs where member_id = (select team from ids) and duration_minutes is not null), 2::bigint);
select pg_temp.expect_error('team member can’t add other people', $q$insert into task_assignees (task_id, member_id) select '70000000-0000-0000-0000-000000000001', mgr from ids$q$);
select pg_temp.expect('team member’s summary is only themselves', (select count(*) from work_summary(ist_today(), ist_today())), 1::bigint);
select pg_temp.expect_error('team member can’t read the digest', $q$select daily_digest_data()$q$);
select pg_temp.expect_error('team member can’t call notify()', $q$select notify((select f1 from ids), 'x', 'x')$q$);

select pg_temp.login(:F1);
update tasks set status = 'done' where id = '70000000-0000-0000-0000-000000000001';
select pg_temp.expect('done stamps completed_at', (select completed_at is not null from tasks where id = '70000000-0000-0000-0000-000000000001'), true);
update tasks set status = 'todo' where id = '70000000-0000-0000-0000-000000000001';
select pg_temp.expect('reopening clears it', (select completed_at is null from tasks where id = '70000000-0000-0000-0000-000000000001'), true);
select pg_temp.expect('summary counts the work', (select tasks_done || '|' || (records_updated > 0) from work_summary(ist_today(), ist_today()) where member_id = (select f1 from ids)), '0|true');
select pg_temp.expect('feed returns named rows', (select count(*) > 0 from activity_feed(ist_today(), ist_today(), null, array['tasks']) where record_name = 'Call Rohan'), true);
select pg_temp.expect('task activity includes checklist and comments', (select count(distinct table_name) from task_activity('70000000-0000-0000-0000-000000000001')), 3::bigint);

-- recurring + deadlines
insert into recurring_tasks (id, title, frequency, next_on, assignee_id) select '71000000-0000-0000-0000-000000000001', 'Send weekly report to Masala Co', 'weekly', ist_today() - 14, f2 from ids;
select pg_temp.expect('recurring makes one task even after a gap', create_recurring_tasks(), 1);
select pg_temp.expect('next date jumps past today, same weekday', (select next_on = ist_today() + 7 from recurring_tasks where id = '71000000-0000-0000-0000-000000000001'), true);
select pg_temp.expect('nothing more to create today', create_recurring_tasks(), 0);
reset role;
select notify_task_deadlines(); select notify_task_deadlines();
select pg_temp.expect('deadline reminders are not repeated', (select count(*) from notifications where kind in ('task_due','task_overdue') and record_id = '70000000-0000-0000-0000-000000000001'), 2::bigint);
select pg_temp.expect('digest lists today’s and overdue tasks', (select jsonb_array_length(p->'today') || '/' || jsonb_array_length(p->'overdue') from jsonb_array_elements(daily_digest_data()) p where p->>'email' = 'founder2@example.com'), '1/1');
set role authenticated;

-- ── Andon, presence ─────────────────────────────────────────
select pg_temp.login(:TEAM);
select andon_raise('tasks', '70000000-0000-0000-0000-000000000001', 'Footage link is dead', (select f1 from ids));
select pg_temp.expect_error('no second andon on the same record', $q$select andon_raise('tasks', '70000000-0000-0000-0000-000000000001', 'again')$q$, '%already%');
select pg_temp.expect_error('no andon on a record you can’t see', $q$select andon_raise('campaigns', (select pg_temp.asowner('select id from campaigns c where not exists (select 1 from campaign_members m where m.campaign_id = c.id) limit 1'))::uuid, 'x')$q$);
select pg_temp.expect('raising sets presence to Blocked', (select status from presence where member_id = (select team from ids)), 'blocked');
select pg_temp.login(:F1);
select pg_temp.expect('founders are notified', pg_temp.asowner($q$select count(*) from notifications where kind = 'andon' and recipient_id in (select f1 from ids union select f2 from ids)$q$), '2');
select pg_temp.expect('lantern is lit', (select title || '|' || unblocker_name from open_andons where record_id = '70000000-0000-0000-0000-000000000001'), 'Call Rohan|Founder One');
select andon_resolve((select id from open_andons where record_id = '70000000-0000-0000-0000-000000000001'), 'Re-shared the link');
select pg_temp.expect('resolved: time logged, presence back', (select (resolve_minutes is not null) || '|' || (select status from presence where member_id = (select team from ids)) from andons where task_id = '70000000-0000-0000-0000-000000000001'), 'true|working');
select set_presence('in_meeting', 'Client call', now() + interval '1 hour');
select set_presence('on_break');
select pg_temp.expect('every status change is logged', (select count(*) || '/' || count(*) filter (where ended_at is null) from presence_log where member_id = (select f1 from ids)), '2/1');
select pg_temp.expect_error('unknown status refused', $q$select set_presence('napping')$q$);
select set_presence('working');
reset role;
update presence set last_seen_at = now() - interval '45 minutes' where member_id = (select f1 from ids);
select pg_temp.expect('auto-away after 30 quiet minutes', presence_auto_away(), 1);
set role authenticated;
select presence_ping();
select pg_temp.expect('coming back restores the earlier status', (select status from presence where member_id = (select f1 from ids)), 'working');
select pg_temp.expect('work and break minutes per day', (select count(*) from presence_days(ist_today(), ist_today()) where member_id = (select f1 from ids)), 1::bigint);

-- ── WIP, kaizen, hansei, workload, muda ─────────────────────
insert into wip_limits (board, column_key, max_items) values ('production', 'editing', 4);
select pg_temp.login(:TEAM);
select pg_temp.expect_error('team member can’t set WIP limits', $q$insert into wip_limits (board, column_key, max_items) values ('tasks', 'todo', 3)$q$);
insert into kaizen_entries (problem, change_made) values ('Lost drafts', 'One folder per campaign');
select pg_temp.expect('hansei isn’t asked of team members', (select (hansei_due()->>'due')::boolean), false);
select pg_temp.login(:F1);
insert into hansei_entries (member_id, week_start, will_change) select f1, date_trunc('week', ist_today())::date, 'Lock scripts by Wednesday' from ids;
select pg_temp.expect_error('one reflection per founder per week', $q$insert into hansei_entries (member_id, week_start) select f1, date_trunc('week', ist_today())::date from ids$q$);
select pg_temp.expect_error('can’t write another founder’s reflection', $q$insert into hansei_entries (member_id, week_start) select f2, date_trunc('week', ist_today())::date from ids$q$);
select pg_temp.expect('answered: no longer due', (select (hansei_due()->>'due')::boolean), false);
insert into tasks (title, assignee_id, due_date, estimate_hours, priority) select 'Big edit ' || g, f1, date_trunc('week', ist_today())::date + 2, 10, case when g = 1 then 'low' else 'high' end from ids, generate_series(1, 5) g;
select pg_temp.expect('overload and imbalance are flagged', (select jsonb_array_length(workload_week(date_trunc('week', ist_today())::date)->'warnings')), 2);
select pg_temp.expect('suggests the least urgent task first', (select workload_week(date_trunc('week', ist_today())::date)->'suggestions'->0->>'title'), 'Big edit 1');
select task_move((select id from tasks where title = 'Big edit 1'), (select f2 from ids));
select pg_temp.expect('moved task has one owner', (select assignee_names::text from task_list where title = 'Big edit 1'), '{"Founder Two"}');
select pg_temp.login(:TEAM);
select pg_temp.expect('team member sees only their own load', (select jsonb_array_length(workload_week(date_trunc('week', ist_today())::date)->'people')), 1);
select pg_temp.expect_error('team member can’t move work', $q$select task_move((select id from tasks limit 1), (select team from ids))$q$);
select pg_temp.login(:F1);
select pg_temp.expect('muda: the reopened task is listed', (select count(*) from muda_week() where kind = 'reopened' and title = 'Call Rohan'), 1::bigint);
select pg_temp.expect('morning brief has all five parts', (select count(*) from jsonb_object_keys(morning_brief())), 5::bigint);

-- ── Poka-yoke & jidoka ──────────────────────────────────────
insert into invoices (id, brand_id, gst_enabled, gst_rate) values ('10000000-0000-0000-0000-0000000009a1', 'b0000000-0000-0000-0000-0000000000a2', true, 0);
insert into invoice_items (invoice_id, position, description, quantity, rate) values ('10000000-0000-0000-0000-0000000009a1', 1, 'Reels', 1, 12345);
select pg_temp.expect_error('GST on but no rate', $q$update invoices set status = 'sent' where id = '10000000-0000-0000-0000-0000000009a1'$q$, '%GST rate is missing%');
update invoices set gst_rate = 18 where id = '10000000-0000-0000-0000-0000000009a1';
update invoices set status = 'sent' where id = '10000000-0000-0000-0000-0000000009a1';
insert into invoices (id, brand_id, gst_rate) values ('10000000-0000-0000-0000-0000000009a2', 'b0000000-0000-0000-0000-0000000000a2', 18);
insert into invoice_items (invoice_id, position, description, quantity, rate) values ('10000000-0000-0000-0000-0000000009a2', 1, 'Reels again', 1, 12345);
select pg_temp.expect_error('duplicate invoice: same brand, amount and month', $q$update invoices set status = 'sent' where id = '10000000-0000-0000-0000-0000000009a2'$q$, '%possible duplicate%');
update invoices set status = 'sent', duplicate_ok = true where id = '10000000-0000-0000-0000-0000000009a2';
select pg_temp.expect('…unless a person confirms it', (select status from invoices where id = '10000000-0000-0000-0000-0000000009a2'), 'sent');
select pg_temp.expect_error('jidoka checks aren’t callable from the app', $q$select jidoka_balance()$q$);
select pg_temp.expect_error('the system flag does not open balance_check to a manager… without the flag', $q$select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true), balance_check()$q$);
reset role;
insert into creators (id, name) values ('c0000000-0000-0000-0000-0000000000b9', 'Jidoka Creator');
with cc as (insert into campaign_creators (campaign_id, creator_id) select id, 'c0000000-0000-0000-0000-0000000000b9' from (select id from campaigns where not is_historical order by created_at limit 2) k returning id)
insert into campaign_creator_fees (campaign_creator_id, agreed_fee) select id, 10000 from cc;
select pg_temp.expect('usual fee passes, 3× fails',
  jidoka_fee((select id from creators where name = 'Jidoka Creator'), 15000)::text || jidoka_fee((select id from creators where name = 'Jidoka Creator'), 30000)::text
, 'truefalse');
select jidoka_fee((select id from creators where name = 'Jidoka Creator'), 30000);
select pg_temp.expect('the same alert is not raised twice', (select count(*) from andons where automation_key = 'fee'), 1::bigint);
select set_config('app.system', 'on', false);
select pg_temp.expect('jidoka balance check runs for the system', jidoka_balance() is not null, true);
select set_config('app.system', '', false);
set role authenticated;

-- ── Dashboard & reports ─────────────────────────────────────
select pg_temp.login(:F1);
select pg_temp.expect('previous period: whole month → month before', (select prev_from || '→' || prev_to from previous_period('2026-11-01', '2026-11-30')), '2026-10-01→2026-10-31');
select pg_temp.expect('previous period: quarter → quarter before', (select prev_from || '→' || prev_to from previous_period('2026-10-01', '2026-12-31')), '2026-07-01→2026-09-30');
select pg_temp.expect('previous period: 7 days → 7 days before', (select prev_from || '→' || prev_to from previous_period('2026-11-09', '2026-11-15')), '2026-11-02→2026-11-08');
create temp table dash as select dashboard('2026-04-01', '2027-03-31') j;
select pg_temp.expect('dashboard revenue = money overview', (select (j->'money'->'revenue'->>'value')::numeric from dash), (select revenue from money_overview('2026-04-01', '2027-03-31')));
select pg_temp.expect('dashboard outstanding = invoice totals', (select (j->'money'->'outstanding'->>'value')::numeric from dash), (select sum(outstanding) from invoice_totals where document_status = 'sent'));
select pg_temp.expect('founder sees capital; 12 months charted', (select (j->'money' ? 'total_capital') || '|' || jsonb_array_length(j->'charts'->'months') from dash), 'true|12');
select pg_temp.expect('go and see: revenue records add up to the KPI', (select sum(amount) from records_behind('revenue', '2026-04-01', '2027-03-31')), (select revenue from money_overview('2026-04-01', '2027-03-31')));
select pg_temp.expect('go and see: net profit records add up', (select sum(amount) from records_behind('net_profit', '2026-04-01', '2027-03-31')), (select net_profit from money_overview('2026-04-01', '2027-03-31')));
select pg_temp.expect('go and see: outstanding adds up', (select sum(amount) from records_behind('outstanding', '2026-04-01', '2027-03-31')), (select sum(outstanding) from invoice_totals where document_status = 'sent'));
select count(*) from unnest(array['cash_received','overdue_invoices','payouts_pending','total_capital','active_brands','live_campaigns','content_posted','in_production','overdue_tasks','tasks_done','hours_logged','shoots_this_week','expenses','profit']) m, lateral records_behind(m, '2026-04-01', '2027-03-31');
select count(*) from records_behind('stage', '2026-04-01', '2027-03-31', null, 'editing');
select pg_temp.expect('all nine reports run', (select count(*) from unnest(array['pnl','brands','campaigns','creators','production','cashflow','ageing','capital','team']) r where jsonb_array_length(report(r, '2026-04-01', '2027-03-31')->'sections') > 0), 9::bigint);
select pg_temp.expect('P&L report net profit = money overview', (select (r->>'amount')::numeric from jsonb_array_elements(report('pnl', '2026-04-01', '2027-03-31')->'sections'->0->'rows') r where r->>'line' = 'Net profit'), (select net_profit from money_overview('2026-04-01', '2027-03-31')));
select pg_temp.expect('capital statement closing = capital accounts', (select sum((r->>'closing')::numeric) from jsonb_array_elements(report('capital', '2020-01-01', '2030-12-31')->'sections'->0->'rows') r), (select sum(balance) from capital_accounts()));
select pg_temp.expect('ageing buckets add up to outstanding', (select sum(coalesce((r->>'not_due')::numeric, 0) + coalesce((r->>'d30')::numeric, 0) + coalesce((r->>'d60')::numeric, 0) + coalesce((r->>'d61')::numeric, 0)) from jsonb_array_elements(report('ageing', '2026-04-01', '2027-03-31')->'sections'->0->'rows') r), (select sum(outstanding) from invoice_totals where document_status = 'sent'));
select pg_temp.login(:MGR);
select pg_temp.expect('manager: money row without capital', (select (j ? 'revenue') || '|' || (j ? 'total_capital') from (select dashboard('2026-04-01', '2027-03-31')->'money' j) x), 'true|false');
select pg_temp.expect_error('manager: no capital statement', $q$select report('capital', '2026-04-01', '2027-03-31')$q$, '%founders only%');
select pg_temp.expect('manager: no capital records behind', (select count(*) from records_behind('total_capital', '2026-04-01', '2027-03-31')), 0::bigint);
select pg_temp.login(:TEAM);
select pg_temp.expect('team member: no money on the dashboard', (select dashboard('2026-04-01', '2027-03-31')->>'money'), null::text);
select pg_temp.expect_error('team member: no reports', $q$select report('pnl', '2026-04-01', '2027-03-31')$q$);
select pg_temp.expect('team member: no revenue records behind', (select count(*) from records_behind('revenue', '2026-04-01', '2027-03-31')), 0::bigint);
select pg_temp.expect('team member: record_label hides what they can’t see', record_label('expenses', (select id from expenses limit 1)), null::text);
reset role;

-- ── AI ──────────────────────────────────────────────────────
set role authenticated;
select pg_temp.login(:F1);
select pg_temp.expect('three providers, in priority order', (select string_agg(provider, '>' order by priority) from ai_usage()), 'Google Gemini>Groq>OpenRouter');
select pg_temp.expect_error('the app can’t write the AI log', $q$insert into ai_logs (task, provider, model) values ('x', 'x', 'x')$q$);
select pg_temp.expect_error('provider keys are never stored: secret name only', $q$update ai_providers set secret_name = 'sk-live-abc123' where priority = 1$q$);
select pg_temp.expect('creator matcher ranks without touching the AI', (select count(*) > 0 and bool_and(score between 0 and 100) from creator_match((select id from campaigns where not is_historical order by created_at limit 1))), true);
select pg_temp.expect('ask: grouped sum on an approved view', jsonb_typeof(ask_query('{"view":"invoice_totals","select":[{"column":"brand_name"},{"column":"total","agg":"sum"}],"filters":[{"column":"document_status","op":"=","value":"sent"}],"group_by":["brand_name"],"order_by":{"column":"sum_total","dir":"desc"},"limit":5}')), 'array');
select pg_temp.expect_error('ask: tables are off limits', $q$select ask_query('{"view":"capital_entries","select":[{"column":"amount"}]}')$q$, '%isn’t available%');
select pg_temp.expect_error('ask: unknown columns refused', $q$select ask_query('{"view":"invoice_totals","select":[{"column":"total; drop table tasks"}]}')$q$, '%Unknown column%');
select pg_temp.expect_error('ask: only safe comparisons', $q$select ask_query('{"view":"invoice_totals","select":[{"column":"total"}],"filters":[{"column":"total","op":"> 0; delete from tasks; --","value":"1"}]}')$q$, '%Unsupported comparison%');
select pg_temp.expect('ask: injected values stay quoted', ask_query('{"view":"invoice_totals","select":[{"column":"brand_name"}],"filters":[{"column":"brand_name","op":"=","value":"x'' or 1=1 --"}]}'), '[]'::jsonb);
select pg_temp.expect('ask: at most 100 rows', (select jsonb_array_length(ask_query('{"view":"task_list","select":[{"column":"title"}],"limit":100000}')) <= 100), true);
select pg_temp.expect('weekly numbers come from the database', (select weekly_numbers() ? 'this_week'), true);
select pg_temp.login(:TEAM);
select pg_temp.expect('ask runs as the asker: team member sees no invoices', ask_query('{"view":"invoice_totals","select":[{"column":"total"}]}'), '[]'::jsonb);
select pg_temp.expect('matcher is staff only', (select count(*) from creator_match((select pg_temp.asowner('select id from campaigns limit 1'))::uuid)), 0::bigint);
select pg_temp.expect_error('team member: no weekly numbers', $q$select weekly_numbers()$q$);
reset role;
select pg_temp.expect('no schema rule violations', (select count(*) from public.schema_rule_violations()), 0::bigint);
\o
\echo 'WORK CHECKS PASSED'
