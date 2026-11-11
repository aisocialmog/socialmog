-- Social Mog OS — Japanese working methods as real features, plus presence
-- (who is doing what right now — the Ops Board reads it later).
--   andon · WIP limits · poka-yoke · jidoka · heijunka/muri · muda · kaizen · hansei · asa (morning brief)

-- thresholds a founder can change in Settings
alter table public.org_settings
  add column min_margin_pct       numeric(5,2) not null default 15,   -- jidoka: campaign margin below this stops automations
  add column fee_alert_multiple   numeric(4,1) not null default 3,    -- jidoka: creator fee this many times their usual
  add column overload_hours       numeric(5,1) not null default 45,   -- muri: weekly hours per person
  add column overload_gap_pct     numeric(5,1) not null default 40,   -- muri: one person this much busier than another
  add column hansei_hour          smallint not null default 18 check (hansei_hour between 0 and 23),   -- Friday, IST
  add column away_after_minutes   int not null default 30 check (away_after_minutes > 0),
  add column books_locked_through date,                               -- month-end close
  add column ops_webhook_url      text,
  add column ops_allowed_origin   text;

-- Automations run with this flag on (set only inside run_automation).
create or replace function public.is_system()
returns boolean language sql stable as $$ select coalesce(current_setting('app.system', true), '') = 'on' $$;

-- ─────────────────────────────────────────────────────────────
-- 1. Events out: a webhook to the Ops Board + a realtime "something changed" ping.
--    The ping carries no data; the board re-reads through its API key.
-- ─────────────────────────────────────────────────────────────
create or replace function public.emit_event(p_event text, p_payload jsonb default '{}')
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_url text := (select ops_webhook_url from org_settings limit 1); v_secret text;
  v_body jsonb := jsonb_build_object('event', p_event, 'sent_at', now(), 'data', p_payload);
begin
  begin execute 'select realtime.send($1, $2, $3, false)' using jsonb_build_object('event', p_event), 'changed', 'ops-board';
  exception when others then null; end;
  if v_url is null or v_url !~ '^https://' then return; end if;
  begin
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'ops_webhook_secret'$q$ into v_secret;
    execute 'select net.http_post(url := $1, headers := $2, body := $3)' using v_url,
      jsonb_build_object('Content-Type', 'application/json', 'X-SocialMog-Event', p_event,
        'X-SocialMog-Signature', encode(hmac(v_body::text, coalesce(v_secret, ''), 'sha256'), 'hex')), v_body;
  exception when others then raise notice 'webhook % not sent: %', p_event, sqlerrm; end;
end $$;
revoke execute on function public.emit_event(text, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Presence
-- ─────────────────────────────────────────────────────────────
create table public.presence (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.team_members(id),
  member_id     uuid not null unique references public.team_members(id),
  status        text not null default 'working'
                check (status in ('working','focus','in_shoot','in_meeting','on_break','off','blocked','away')),
  message       text,
  since         timestamptz not null default now(),
  expected_back timestamptz,
  last_seen_at  timestamptz not null default now(),
  before_away   text                                  -- what to go back to when they return
);
create table public.presence_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  member_id   uuid not null references public.team_members(id),
  status      text not null,
  message     text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  source      text not null default 'app' check (source in ('app','ops_board','focus','andon','auto'))
);
create index presence_log_member_idx on public.presence_log (member_id, started_at);
select public.enable_standard_table('public.presence', false), public.enable_standard_table('public.presence_log', false);
create policy member_select on public.presence for select to authenticated using (public.is_active_member());
create policy own_select on public.presence_log for select to authenticated using (public.is_staff() or member_id = public.current_member_id());

create or replace function public.set_presence_for(p_member uuid, p_status text, p_message text default null, p_expected_back timestamptz default null, p_source text default 'app')
returns void language plpgsql security definer set search_path = public as $$
declare v_old presence;
begin
  select * into v_old from presence where member_id = p_member;
  if v_old.status = p_status and v_old.message is not distinct from p_message and p_source = 'auto' then return; end if;
  insert into presence (member_id, status, message, expected_back, since, last_seen_at, before_away)
  values (p_member, p_status, p_message, p_expected_back, now(), now(), null)
  on conflict (member_id) do update set status = excluded.status, message = excluded.message, expected_back = excluded.expected_back,
    since = case when presence.status = excluded.status then presence.since else now() end,
    last_seen_at = case when p_source = 'auto' then presence.last_seen_at else now() end,
    before_away = case when excluded.status = 'away' then presence.status end;
  if v_old.status is distinct from p_status then
    update presence_log set ended_at = now() where member_id = p_member and ended_at is null;
    insert into presence_log (member_id, status, message, source) values (p_member, p_status, p_message, p_source);
    perform emit_event('status.changed', jsonb_build_object('member_id', p_member, 'name', (select name from team_members where id = p_member),
      'status', p_status, 'message', p_message, 'expected_back', p_expected_back));
  end if;
end $$;
revoke execute on function public.set_presence_for(uuid, text, text, timestamptz, text) from public, anon, authenticated;

create or replace function public.set_presence(p_status text, p_message text default null, p_expected_back timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_active_member() then raise exception 'Sign in first'; end if;
  perform set_presence_for(current_member_id(), p_status, nullif(btrim(p_message), ''), p_expected_back, case when p_status = 'focus' then 'focus' else 'app' end);
end $$;

-- The app calls this every few minutes while open. Coming back from Away restores the earlier status.
create or replace function public.presence_ping()
returns void language plpgsql security definer set search_path = public as $$
declare p presence;
begin
  select * into p from presence where member_id = current_member_id();
  if p.id is null then if is_active_member() then perform set_presence_for(current_member_id(), 'working'); end if;
  elsif p.status = 'away' then perform set_presence_for(p.member_id, coalesce(p.before_away, 'working'), p.message);
  else update presence set last_seen_at = now() where id = p.id; end if;
end $$;

create or replace function public.presence_auto_away()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select member_id, message from presence
           where status in ('working','focus','blocked')
             and last_seen_at < now() - make_interval(mins => (select away_after_minutes from org_settings limit 1)) loop
    perform set_presence_for(r.member_id, 'away', r.message, null, 'auto'); n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.presence_auto_away() from public, anon, authenticated;

-- Minutes worked and on break, per person per day (IST), from the log.
create or replace function public.presence_days(p_from date, p_to date)
returns table (member_id uuid, name text, day date, worked_minutes numeric, break_minutes numeric)
language sql stable security definer set search_path = public as $$
  select l.member_id, m.name, (l.started_at at time zone 'Asia/Kolkata')::date,
    coalesce(round(sum(extract(epoch from (coalesce(l.ended_at, now()) - l.started_at)) / 60) filter (where l.status in ('working','focus','in_shoot','in_meeting','blocked'))), 0),
    coalesce(round(sum(extract(epoch from (coalesce(l.ended_at, now()) - l.started_at)) / 60) filter (where l.status in ('on_break','away'))), 0)
  from presence_log l join team_members m on m.id = l.member_id
  where (l.started_at at time zone 'Asia/Kolkata')::date between p_from and p_to and (is_staff() or is_system() or l.member_id = current_member_id())
  group by 1, 2, 3 order by 3 desc, 2
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. Andon — "I'm blocked"
-- ─────────────────────────────────────────────────────────────
create table public.andons (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.team_members(id),
  task_id         uuid references public.tasks(id),
  deliverable_id  uuid references public.deliverables(id),
  campaign_id     uuid references public.campaigns(id),
  title           text,                          -- for alerts not tied to one record
  reason          text not null check (btrim(reason) <> ''),
  unblocker_id    uuid references public.team_members(id),
  source          text not null default 'person' check (source in ('person','automation')),
  automation_key  text,
  resolved_at     timestamptz,
  resolved_by     uuid references public.team_members(id),
  resolution_note text,
  resolve_minutes numeric(10,1) generated always as (extract(epoch from (resolved_at - created_at)) / 60) stored,   -- time to resolve
  check (num_nonnulls(task_id, deliverable_id, campaign_id) <= 1)
);
create index andons_open_idx on public.andons (created_at) where resolved_at is null;
select public.enable_standard_table('public.andons');
create policy role_select on public.andons for select to authenticated
  using (public.is_staff() or created_by = public.current_member_id() or unblocker_id = public.current_member_id());

create or replace view public.open_andons with (security_invoker = true) as
select a.id, a.created_at, a.reason, a.source, a.automation_key, a.unblocker_id, u.name as unblocker_name, a.created_by, r.name as raised_by_name,
  case when a.task_id is not null then 'tasks' when a.deliverable_id is not null then 'deliverables' when a.campaign_id is not null then 'campaigns' end as record_table,
  coalesce(a.task_id, a.deliverable_id, a.campaign_id) as record_id,
  coalesce(a.title, (select title from public.tasks where id = a.task_id), (select title from public.deliverables where id = a.deliverable_id),
           (select name from public.campaigns where id = a.campaign_id), 'Alert') as title,
  round(extract(epoch from (now() - a.created_at)) / 60) as minutes_open
from public.andons a
left join public.team_directory u on u.id = a.unblocker_id
left join public.team_directory r on r.id = a.created_by
where a.resolved_at is null;

create or replace function public.andon_raise(p_table text, p_id uuid, p_reason text, p_unblocker uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_me uuid := current_member_id(); v_title text := record_label(p_table, p_id); v_ok boolean;
begin
  v_ok := case p_table when 'tasks' then can_access_task(p_id) when 'deliverables' then can_access_deliverable(p_id)
                       when 'campaigns' then can_access_campaign(p_id) else false end;
  if not v_ok then raise exception 'You can’t raise an andon on this record'; end if;
  if exists (select 1 from andons where resolved_at is null and coalesce(task_id, deliverable_id, campaign_id) = p_id) then
    raise exception 'This is already marked blocked';
  end if;
  insert into andons (task_id, deliverable_id, campaign_id, reason, unblocker_id, created_by)
  values (case when p_table = 'tasks' then p_id end, case when p_table = 'deliverables' then p_id end, case when p_table = 'campaigns' then p_id end,
          btrim(p_reason), p_unblocker, v_me) returning id into v_id;
  perform notify_staff('andon', (select name from team_members where id = v_me) || ' is blocked: ' || coalesce(v_title, ''), p_reason, p_table, p_id, 'andon:' || v_id, true);
  perform notify(p_unblocker, 'andon', 'You can unblock: ' || coalesce(v_title, ''), p_reason, p_table, p_id, 'andon:' || v_id);
  perform set_presence_for(v_me, 'blocked', left(p_reason, 120), null, 'andon');
  perform emit_event('andon.raised', jsonb_build_object('id', v_id, 'title', v_title, 'reason', p_reason, 'raised_by', (select name from team_members where id = v_me)));
  return v_id;
end $$;

-- Raised by automations (jidoka). One open alert per automation + record.
create or replace function public.andon_system(p_key text, p_title text, p_reason text, p_table text default null, p_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if exists (select 1 from andons where resolved_at is null and automation_key = p_key
             and coalesce(task_id, deliverable_id, campaign_id) is not distinct from (case when p_table in ('tasks','deliverables','campaigns') then p_id end)
             and title is not distinct from p_title) then return; end if;
  insert into andons (task_id, deliverable_id, campaign_id, title, reason, source, automation_key)
  values (case when p_table = 'tasks' then p_id end, case when p_table = 'deliverables' then p_id end, case when p_table = 'campaigns' then p_id end,
          p_title, p_reason, 'automation', p_key) returning id into v_id;
  perform notify_staff('andon', 'Stopped: ' || p_title, p_reason, p_table, p_id, 'andon:' || v_id, true);
  perform emit_event('andon.raised', jsonb_build_object('id', v_id, 'title', p_title, 'reason', p_reason, 'raised_by', 'automation'));
end $$;
revoke execute on function public.andon_system(text, text, text, text, uuid) from public, anon, authenticated;

create or replace function public.andon_resolve(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a andons;
begin
  select * into a from andons where id = p_id and resolved_at is null;
  if a.id is null then raise exception 'That andon is already resolved'; end if;
  if not (is_staff() or a.created_by = current_member_id() or a.unblocker_id = current_member_id()) then raise exception 'You can’t resolve this andon'; end if;
  update andons set resolved_at = now(), resolved_by = current_member_id(), resolution_note = nullif(btrim(p_note), '') where id = p_id;
  if a.created_by is not null and not exists (select 1 from andons where created_by = a.created_by and resolved_at is null)
     and (select status from presence where member_id = a.created_by) = 'blocked' then
    perform set_presence_for(a.created_by, 'working', null, null, 'andon');
  end if;
  perform notify(a.created_by, 'andon', 'Unblocked: ' || coalesce(a.title, record_label(case when a.task_id is not null then 'tasks' when a.deliverable_id is not null then 'deliverables' else 'campaigns' end, coalesce(a.task_id, a.deliverable_id, a.campaign_id)), ''),
                 p_note, case when a.task_id is not null then 'tasks' when a.deliverable_id is not null then 'deliverables' when a.campaign_id is not null then 'campaigns' end,
                 coalesce(a.task_id, a.deliverable_id, a.campaign_id));
  perform emit_event('andon.resolved', jsonb_build_object('id', p_id, 'minutes', round(extract(epoch from (now() - a.created_at)) / 60)));
end $$;

-- ─────────────────────────────────────────────────────────────
-- 4. WIP limits, kaizen log, hansei
-- ─────────────────────────────────────────────────────────────
create table public.wip_limits (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  board       text not null check (board in ('tasks','production','campaigns')),
  column_key  text not null,
  max_items   int not null check (max_items > 0),
  unique (board, column_key)
);
create table public.kaizen_entries (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  is_archived boolean not null default false,
  archived_at timestamptz,
  problem     text not null,
  change_made text not null,
  result      text,
  entry_date  date not null default ((now() at time zone 'Asia/Kolkata')::date)
);
create table public.hansei_entries (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  member_id   uuid not null references public.team_members(id),
  week_start  date not null,                      -- the Monday
  went_well   text, went_wrong text, will_change text,
  unique (member_id, week_start)
);
select public.enable_standard_table('public.wip_limits'), public.enable_standard_table('public.kaizen_entries'), public.enable_standard_table('public.hansei_entries');
create policy member_select on public.wip_limits for select to authenticated using (public.is_active_member());
create policy staff_insert on public.wip_limits for insert to authenticated with check (public.is_staff());
create policy staff_update on public.wip_limits for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_delete on public.wip_limits for delete to authenticated using (public.is_staff());
create policy member_select on public.kaizen_entries for select to authenticated using (public.is_active_member());
create policy member_insert on public.kaizen_entries for insert to authenticated with check (public.is_active_member());
create policy own_update on public.kaizen_entries for update to authenticated
  using (public.is_staff() or created_by = public.current_member_id()) with check (public.is_staff() or created_by = public.current_member_id());
create policy role_select on public.hansei_entries for select to authenticated using (public.is_staff() or member_id = public.current_member_id());
create policy own_insert on public.hansei_entries for insert to authenticated with check (member_id = public.current_member_id());
create policy own_update on public.hansei_entries for update to authenticated using (member_id = public.current_member_id()) with check (member_id = public.current_member_id());

-- Is this founder's Friday reflection waiting? (from Friday hansei_hour IST until the week ends)
create or replace function public.hansei_due()
returns jsonb language sql stable security definer set search_path = public as $$
  with n as (select (now() at time zone 'Asia/Kolkata') ts), w as (select date_trunc('week', ts)::date ws, ts from n)
  select jsonb_build_object('week_start', w.ws, 'due',
    has_role('founder') and (w.ts >= w.ws + 4 + make_interval(hours => (select hansei_hour from org_settings limit 1)))
    and not exists (select 1 from hansei_entries h where h.member_id = current_member_id() and h.week_start = w.ws))
  from w
$$;
create or replace function public.hansei_prompt()
returns int language plpgsql security definer set search_path = public as $$
declare ws date := date_trunc('week', now() at time zone 'Asia/Kolkata')::date; n int;
begin
  select count(*) into n from (
    select notify(m.id, 'hansei', 'Hansei — Friday reflection', 'What went well? What went wrong? What will we change next week?', null, null, 'hansei:' || ws)
    from team_members m where m.role = 'founder' and m.status = 'active' and not m.is_archived
      and not exists (select 1 from hansei_entries h where h.member_id = m.id and h.week_start = ws)) x;
  return n;
end $$;
revoke execute on function public.hansei_prompt() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Heijunka & muri — the week's load per person
-- ─────────────────────────────────────────────────────────────
create or replace function public.workload_week(p_week_start date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o org_settings; v_people jsonb; v_warn jsonb := '[]'; v_sug jsonb := '[]'; hi record; lo record;
begin
  if not is_active_member() then raise exception 'Sign in first'; end if;
  select * into o from org_settings limit 1;
  create temp table if not exists _load (member_id uuid, name text, role text, day date, task_id uuid, hours numeric) on commit drop;
  truncate _load;
  insert into _load
  select m.id, m.name, m.role, t.due_date, t.id, coalesce(t.estimate_hours, 1)
  from team_members m
  left join task_assignees a on a.member_id = m.id
  left join tasks t on t.id = a.task_id and not t.is_archived and t.status <> 'done' and t.due_date between p_week_start and p_week_start + 6
  where not m.is_archived and m.status = 'active' and m.role <> 'freelancer' and (is_staff() or m.id = current_member_id());

  select coalesce(jsonb_agg(p order by (p->>'role' = 'founder') desc, p->>'name'), '[]') into v_people from (
    select jsonb_build_object('member_id', l.member_id, 'name', l.name, 'role', l.role,
      'tasks', count(l.task_id), 'hours', coalesce(sum(l.hours) filter (where l.task_id is not null), 0),
      'days', (select jsonb_agg(jsonb_build_object('day', d::date,
                 'tasks', (select count(*) from _load x where x.member_id = l.member_id and x.day = d::date and x.task_id is not null),
                 'hours', (select coalesce(sum(x.hours), 0) from _load x where x.member_id = l.member_id and x.day = d::date and x.task_id is not null)) order by d)
               from generate_series(p_week_start, p_week_start + 6, interval '1 day') d)) p
    from _load l group by l.member_id, l.name, l.role) s;

  if is_staff() then
    select coalesce(jsonb_agg(jsonb_build_object('member_id', member_id, 'name', name,
             'text', name || ' has ' || trim(to_char(h, 'FM990.0')) || ' hours this week — over the ' || trim(to_char(o.overload_hours, 'FM990')) || '-hour limit.')), '[]')
      into v_warn from (select member_id, name, sum(hours) filter (where task_id is not null) h from _load group by 1, 2) s where h > o.overload_hours;
    select member_id, name, coalesce(sum(hours) filter (where task_id is not null), 0) h into hi from _load group by 1, 2 order by 3 desc, 2 limit 1;
    select member_id, name, coalesce(sum(hours) filter (where task_id is not null), 0) h into lo from _load group by 1, 2 order by 3, 2 limit 1;
    if hi.member_id is distinct from lo.member_id and hi.h >= 4 and hi.h > lo.h * (1 + o.overload_gap_pct / 100) then
      v_warn := v_warn || jsonb_build_object('member_id', hi.member_id, 'name', hi.name, 'text', hi.name || ' has ' ||
        case when lo.h > 0 then round((hi.h / lo.h - 1) * 100) || '% more work than ' || lo.name else trim(to_char(hi.h, 'FM990.0')) || ' hours while ' || lo.name || ' has none' end || ' this week.');
    end if;
    if jsonb_array_length(v_warn) > 0 and hi.member_id is distinct from lo.member_id then
      -- suggest moving the least urgent single-owner tasks until the two are about level
      select coalesce(jsonb_agg(jsonb_build_object('task_id', id, 'title', title, 'hours', hrs, 'from_name', hi.name, 'to_id', lo.member_id, 'to_name', lo.name)), '[]') into v_sug
      from (select t.id, t.title, coalesce(t.estimate_hours, 1) hrs,
                   sum(coalesce(t.estimate_hours, 1)) over (order by array_position(array['low','normal','high','urgent'], t.priority), t.due_date desc, t.id) run
            from tasks t join _load l on l.task_id = t.id and l.member_id = hi.member_id
            where (select count(*) from task_assignees a where a.task_id = t.id) = 1) s
      where run <= (hi.h - lo.h) / 2;
    end if;
  end if;
  return jsonb_build_object('days', (select jsonb_agg(d::date order by d) from generate_series(p_week_start, p_week_start + 6, interval '1 day') d),
    'people', v_people, 'limit_hours', o.overload_hours, 'gap_pct', o.overload_gap_pct, 'warnings', v_warn, 'suggestions', v_sug);
end $$;
alter function public.workload_week(date) volatile;   -- it uses a scratch table

create or replace function public.task_move(p_task uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Only founders and managers can move work between people'; end if;
  delete from task_assignees where task_id = p_task and member_id <> p_to;
  update tasks set assignee_id = p_to where id = p_task;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 6. Muda — this week's waste
-- ─────────────────────────────────────────────────────────────
alter table public.recurring_expenses add column last_reviewed_on date;   -- "yes, we still use this"

create or replace function public.muda_week()
returns table (kind text, id uuid, title text, detail text, link text, fix text)
language sql stable security invoker set search_path = public as $$
  select 'reopened', t.id, t.title, 'Reopened ' || count(*) || case when count(*) = 1 then ' time' else ' times' end || ' this week', '/tasks/' || t.id, 'Open task'
  from activity_log a join tasks t on t.id = a.record_id
  where a.table_name = 'tasks' and a.action = 'status_change' and a.old_values->>'status' = 'done' and a.created_at > now() - interval '7 days' and not t.is_archived
  group by t.id, t.title
  union all
  select 'revisions', p.id, p.title, p.revision_count || ' revision rounds — limit is ' || p.revision_limit || ' · ' || p.brand_name, '/production/' || p.id, 'Open item'
  from production_items p where p.over_revision_limit and p.stage not in ('live','cancelled')
  union all
  select 'stuck', p.id, p.title, 'In ' || replace(p.stage, '_', ' ') || ' for ' || p.days_in_stage || ' days · ' || p.brand_name, '/production/' || p.id, 'Open item'
  from production_items p where p.is_stuck and p.days_in_stage > 3
  union all
  select 'overdue_invoice', i.invoice_id, coalesce(i.invoice_number, 'Invoice') || ' · ' || i.brand_name,
         '₹' || to_char(i.outstanding, 'FM99,99,99,990') || ' · ' || i.days_overdue || ' days overdue', '/money/invoices/' || i.invoice_id, 'Chase payment'
  from invoice_totals i where i.document_status = 'sent' and i.outstanding > 0 and i.days_overdue > 30
  union all
  select 'subscription', r.id, r.description, '₹' || to_char(r.amount + r.gst_amount, 'FM99,99,99,990') || ' a month · not confirmed in use for 90+ days', '/money/expenses', 'Still using'
  from recurring_expenses r
  where not r.is_archived and not r.is_paused and (r.end_date is null or r.end_date >= ist_today())
    and coalesce(r.last_reviewed_on, r.start_date) < ist_today() - 90
$$;

create or replace function public.subscription_reviewed(p_id uuid, p_stop boolean default false)
returns void language sql security invoker set search_path = public as $$
  update recurring_expenses set last_reviewed_on = ist_today(), is_paused = is_paused or p_stop where id = p_id
$$;

-- ─────────────────────────────────────────────────────────────
-- 7. Poka-yoke — stop the mistake before it is saved.
--    (A payment larger than the invoice balance, and an expense with no
--     category, are already refused by the money module.)
-- ─────────────────────────────────────────────────────────────
alter table public.invoices add column duplicate_ok boolean not null default false;   -- "yes, this second invoice is intended"

create or replace function public.pokayoke_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sub numeric; v_dup text;
begin
  if new.status <> 'sent' or old.status = 'sent' or new.is_opening then return new; end if;
  if new.gst_enabled and coalesce(new.gst_rate, 0) = 0 then
    raise exception 'Poka-yoke: GST is on for this invoice but the GST rate is missing. Set the rate (usually 18%%) or turn GST off.';
  end if;
  select coalesce(sum(quantity * rate), 0) into v_sub from invoice_items where invoice_id = new.id and not is_archived;
  select t.invoice_number into v_dup from invoice_totals t
   where t.brand_id = new.brand_id and t.invoice_id <> new.id and t.document_status = 'sent' and not t.is_opening and t.subtotal = v_sub
     and date_trunc('month', t.issue_date) = date_trunc('month', coalesce(new.issue_date, ist_today())) limit 1;
  if v_dup is not null and not new.duplicate_ok then
    raise exception 'Poka-yoke: possible duplicate — % is already sent to this brand for the same amount this month.', v_dup using errcode = 'P0D01';
  end if;
  return new;
end $$;
create trigger invoices_zz_pokayoke before update on public.invoices for each row execute function public.pokayoke_invoice();

create or replace function public.pokayoke_payout()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status <> 'paid' and new.creator_id is not null and not new.is_opening
     and not exists (select 1 from creator_payment_details d where d.creator_id = new.creator_id and not d.is_archived
                     and (nullif(btrim(d.upi_id), '') is not null or (nullif(btrim(d.bank_account_number), '') is not null and nullif(btrim(d.ifsc), '') is not null))) then
    raise exception 'Poka-yoke: % has no UPI ID or bank details saved. Add them on the creator’s page before marking this paid.', (select name from creators where id = new.creator_id);
  end if;
  return new;
end $$;
create trigger creator_payouts_zz_pokayoke before update on public.creator_payouts for each row execute function public.pokayoke_payout();

create or replace function public.pokayoke_campaign()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.status = 'completed' and old.status <> 'completed' and not new.is_historical then
    select count(*) into n from deliverables where campaign_id = new.id and not is_archived and stage not in ('live','cancelled');
    if n > 0 then raise exception 'Poka-yoke: % deliverable% not posted yet. Post or cancel % before completing the campaign.', n, case when n = 1 then ' is' else 's are' end, case when n = 1 then 'it' else 'them' end; end if;
  end if;
  return new;
end $$;
create trigger campaigns_zz_pokayoke before update on public.campaigns for each row execute function public.pokayoke_campaign();

-- ─────────────────────────────────────────────────────────────
-- 8. Jidoka — checks an automation runs before it continues.
--    Each returns true when it is safe to go on; otherwise it lights an andon.
-- ─────────────────────────────────────────────────────────────
create or replace function public.jidoka_margin(p_campaign uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_value numeric; v_cost numeric; v_min numeric := (select min_margin_pct from org_settings limit 1); v_pct numeric; v_name text;
begin
  select f.contract_value, c.name into v_value, v_name from campaigns c left join campaign_finances f on f.campaign_id = c.id where c.id = p_campaign;
  if coalesce(v_value, 0) <= 0 then return true; end if;
  select coalesce(sum(cf.agreed_fee), 0) into v_cost from campaign_creators cc join campaign_creator_fees cf on cf.campaign_creator_id = cc.id
   where cc.campaign_id = p_campaign and not cc.is_archived and cc.status <> 'dropped';
  v_cost := v_cost + coalesce((select sum(e.amount) from expenses e where e.campaign_id = p_campaign and not e.is_archived and e.payout_id is null), 0);
  v_pct := round((v_value - v_cost) / v_value * 100, 1);
  if v_pct >= v_min then return true; end if;
  perform andon_system('margin', 'Low margin: ' || v_name, 'Margin is ' || v_pct || '% — below the ' || trim(to_char(v_min, 'FM990.0')) || '% floor. Check the creator fees and costs.', 'campaigns', p_campaign);
  return false;
end $$;

create or replace function public.jidoka_fee(p_creator uuid, p_fee numeric, p_except uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_usual numeric; v_mult numeric := (select fee_alert_multiple from org_settings limit 1); v_name text;
begin
  select avg(cf.agreed_fee) into v_usual from campaign_creators cc join campaign_creator_fees cf on cf.campaign_creator_id = cc.id
   where cc.creator_id = p_creator and cf.agreed_fee > 0 and cc.id is distinct from p_except;
  if v_usual is null or p_fee < v_usual * v_mult then return true; end if;
  select name into v_name from creators where id = p_creator;
  perform andon_system('fee', 'Unusual fee: ' || v_name, 'Fee of ₹' || to_char(p_fee, 'FM99,99,99,990') || ' is ' || round(p_fee / v_usual, 1) || '× their usual ₹' || to_char(v_usual, 'FM99,99,99,990') || '. No payout was created — check the fee.');
  return false;
end $$;

-- balance_check() is founders-only; let automations read it too.
do $$ declare d text;
begin
  d := pg_get_functiondef('public.balance_check()'::regprocedure);
  if position('if not is_founder() then' in d) = 0 then raise exception 'balance_check() changed: update the jidoka patch'; end if;
  execute replace(d, 'if not is_founder() then', 'if not (is_founder() or is_system()) then');
end $$;

create or replace function public.jidoka_balance()
returns boolean language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if (select opening_locked_at from org_settings limit 1) is null then return true; end if;   -- books aren't opened yet
  select * into b from balance_check();
  if b.is_balanced then return true; end if;
  perform andon_system('balance', 'Money check doesn’t balance', 'Capital + profit and what the accounts hold differ by ₹' || to_char(abs(b.difference), 'FM99,99,99,990') || '. An entry is missing or wrong — money automations are paused until it balances.');
  return false;
end $$;
revoke execute on function public.jidoka_margin(uuid), public.jidoka_fee(uuid, numeric, uuid), public.jidoka_balance() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 9. Asa — the morning brief
-- ─────────────────────────────────────────────────────────────
create or replace function public.morning_brief()
returns jsonb language sql stable security invoker set search_path = public as $$
  with me as (select current_member_id() id, ist_today() d),
  shoots as (select jsonb_build_object('id', s.id, 'title', s.title, 'sub', concat_ws(' · ', to_char(s.call_time, 'FMHH12:MI am'), s.location), 'link', '/calendar') j
             from shoot_calendar s, me where s.shoot_date = me.d and s.status <> 'cancelled' order by s.call_time nulls last),
  tasks as (select jsonb_build_object('id', t.id, 'title', t.title, 'sub', case when t.is_overdue then 'Overdue' else coalesce(to_char(t.due_time, 'FMHH12:MI am'), 'Today') end, 'link', '/tasks/' || t.id) j, t.*
            from task_list t, me where not t.is_archived and t.status <> 'done' and t.due_date <= me.d and me.id = any(t.assignee_ids)
            order by array_position(array['urgent','high','normal','low'], t.priority), t.due_date),
  pay as (select jsonb_build_object('id', i.invoice_id, 'title', coalesce(i.invoice_number, 'Invoice') || ' · ' || i.brand_name,
            'sub', case when i.days_overdue > 0 then i.days_overdue || ' days overdue' else 'Due today' end, 'amount', i.outstanding, 'link', '/money/invoices/' || i.invoice_id) j
          from invoice_totals i, me where i.document_status = 'sent' and i.outstanding > 0 and i.due_date <= me.d order by i.due_date limit 8),
  po as (select jsonb_build_object('id', p.id, 'title', p.payee_name, 'sub', case when p.is_overdue then 'Overdue' else 'Due today' end, 'amount', p.net_payable, 'link', '/money/payouts/due') j
         from payout_list p, me where not p.is_archived and p.status in ('pending','approved') and p.due_date <= me.d order by p.due_date limit 8),
  an as (select jsonb_build_object('title', 'Unblock: ' || a.title, 'sub', coalesce(a.raised_by_name, 'An automation') || ' — ' || a.reason,
           'link', case a.record_table when 'tasks' then '/tasks/' || a.record_id when 'deliverables' then '/production/' || a.record_id when 'campaigns' then '/campaigns/' || a.record_id else '/' end) j
         from open_andons a order by a.created_at limit 1)
  select jsonb_build_object(
    'shoots', coalesce((select jsonb_agg(j) from shoots), '[]'), 'tasks', coalesce((select jsonb_agg(j) from tasks), '[]'),
    'payments_expected', coalesce((select jsonb_agg(j) from pay), '[]'), 'payouts_due', coalesce((select jsonb_agg(j) from po), '[]'),
    -- ichiban: an open andon first, then the most pressing task, then the first shoot
    'ichiban', coalesce((select j from an), (select j - 'id' from tasks limit 1), (select j - 'id' from shoots limit 1)))
$$;
