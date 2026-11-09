-- Social Mog OS — feature 5: Production & content calendar.
-- A production item IS a deliverable (brand required, campaign optional), so a
-- campaign deliverable and its production work are the same record.

-- ─────────────────────────────────────────────────────────────
-- Pipeline stages from the brief. 'live' stays the stored value for Posted.
-- ─────────────────────────────────────────────────────────────
alter table public.deliverables drop constraint deliverables_stage_check;
update public.deliverables set stage = case stage
  when 'brief' then 'idea' when 'scripting' then 'script' when 'script_review' then 'script'
  when 'shoot' then 'shoot_scheduled' when 'changes' then 'revisions' else stage end;
alter table public.deliverables alter column stage set default 'idea';
alter table public.deliverables add constraint deliverables_stage_check check (stage in
  ('idea','script','script_approved','pre_production','shoot_scheduled','shot','editing','internal_review',
   'client_review','revisions','approved','scheduled','live','cancelled'));

alter table public.deliverables drop constraint deliverables_deliverable_type_check;
alter table public.deliverables add constraint deliverables_deliverable_type_check check (deliverable_type in
  ('reel','short','youtube_video','ad_film','photo_shoot','carousel','story_set','ugc_video',
   'story','post','live','photo','blog','other'));

alter table public.deliverables
  add column stage_changed_at timestamptz not null default now(),
  add column revision_count   int not null default 0 check (revision_count >= 0),
  add column revision_limit   int check (revision_limit >= 0),     -- overrides the brand's limit
  add column raw_footage_url  text,
  add column final_file_url   text,
  add column thumbnail_url    text;

alter table public.brands add column revision_limit int check (revision_limit >= 0);   -- from the brand's scope
-- Calendar colour slot (0–5, palette steps). Assigned in creation order so
-- neighbouring brands differ, and fixed so filtering never repaints a brand.
alter table public.brands add column calendar_color smallint check (calendar_color between 0 and 5);
update public.brands b set calendar_color = (x.n - 1) % 6
  from (select id, row_number() over (order by created_at, id) n from public.brands) x where x.id = b.id;
create or replace function public.brand_calendar_color()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.calendar_color is null then new.calendar_color := (select count(*) from brands) % 6; end if;
  return new;
end $$;
create trigger brands_calendar_color before insert on public.brands for each row execute function public.brand_calendar_color();
alter table public.org_settings add column stuck_after_days int not null default 3 check (stuck_after_days between 1 and 60);

-- Stage bookkeeping: time of each move (also in activity_log), revision rounds,
-- and approval kept in step with the stage (both ways).
create or replace function public.deliverable_tracker_sync()
returns trigger language plpgsql as $$
declare early text[] := array['idea','script','script_approved','pre_production','shoot_scheduled','shot','editing','internal_review'];
begin
  -- approval → stage
  if tg_op = 'INSERT' or new.approval_status is distinct from old.approval_status then
    if new.approval_status = 'approved' then
      new.approved_at := coalesce(new.approved_at, now());
      if new.stage not in ('approved','scheduled','live','cancelled') then new.stage := 'approved'; end if;
    elsif new.approval_status = 'pending' and new.stage = any(early) then new.stage := 'client_review';
    elsif new.approval_status = 'changes_requested' and new.stage not in ('live','cancelled') then new.stage := 'revisions';
    end if;
  end if;
  -- stage → approval, revision count, time stamps
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    if new.stage = 'client_review' and new.approval_status <> 'approved' then new.approval_status := 'pending'; end if;
    if new.stage = 'revisions' then
      new.approval_status := 'changes_requested';
      if tg_op = 'UPDATE' then new.revision_count := new.revision_count + 1; end if;
    end if;
    if new.stage = 'approved' and new.approval_status <> 'approved' then new.approval_status := 'approved'; new.approved_at := coalesce(new.approved_at, now()); end if;
  end if;
  if new.stage = 'live' and new.went_live_at is null then new.went_live_at := now(); end if;
  if new.stage <> 'live' then new.went_live_at := null; end if;
  return new;
end $$;

-- Campaign planner now creates items at 'idea'.
create or replace function public.set_creator_deliverables(p_campaign_creator uuid, p_type text, p_quantity int)
returns int language plpgsql security invoker set search_path = public as $$
declare cc record; v_have int; v_platform text; i int;
begin
  if p_quantity < 0 or p_quantity > 50 then raise exception 'Quantity must be between 0 and 50'; end if;
  select x.*, c.brand_id, c.platforms, cr.name as creator_name into cc
    from campaign_creators x join campaigns c on c.id = x.campaign_id join creators cr on cr.id = x.creator_id
   where x.id = p_campaign_creator;
  if not found then raise exception 'Creator is not on this campaign'; end if;
  select count(*) into v_have from deliverables
   where campaign_creator_id = p_campaign_creator and deliverable_type = p_type and not is_archived and stage <> 'cancelled';
  v_platform := case when p_type in ('youtube_video','short') then 'youtube' when p_type = 'ugc_video' then null
                     else coalesce(cc.platforms[1], 'instagram') end;
  for i in 1 .. greatest(p_quantity - v_have, 0) loop
    insert into deliverables (brand_id, campaign_id, campaign_creator_id, creator_id, title, deliverable_type, platform, stage)
    values (cc.brand_id, cc.campaign_id, p_campaign_creator, cc.creator_id,
            cc.creator_name || ' — ' || initcap(replace(p_type, '_', ' ')) || ' ' || (v_have + i), p_type, v_platform, 'idea');
  end loop;
  update deliverables set stage = 'cancelled'
   where id in (select id from deliverables
                 where campaign_creator_id = p_campaign_creator and deliverable_type = p_type and not is_archived
                   and stage not in ('cancelled','live')
                 order by created_at desc limit greatest(v_have - p_quantity, 0));
  return p_quantity;
end $$;

-- ─────────────────────────────────────────────────────────────
-- People on an item: scriptwriter, talent, shooter, editor.
-- Each is a team member (incl. freelancers with a login), a vendor, or a creator.
-- ─────────────────────────────────────────────────────────────
create table public.production_people (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.team_members(id),
  deliverable_id  uuid not null references public.deliverables(id),
  role            text not null check (role in ('scriptwriter','talent','shooter','editor')),
  team_member_id  uuid references public.team_members(id),
  vendor_id       uuid references public.vendors(id),
  creator_id      uuid references public.creators(id),
  check (num_nonnulls(team_member_id, vendor_id, creator_id) = 1)
);
create unique index production_people_unique on public.production_people
  (deliverable_id, role, coalesce(team_member_id, vendor_id, creator_id));
create index production_people_member_idx on public.production_people (team_member_id);
select public.enable_standard_table('public.production_people');

-- Anyone named on an item can see and work on it.
create or replace function public.can_access_deliverable(p_deliverable uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_deliverable is not null and (
    public.is_staff()
    or exists (
      select 1 from deliverables d
      where d.id = p_deliverable and (
            d.assignee_id = public.current_member_id()
         or d.editor_vendor_id in (select v.id from vendors v where v.team_member_id = public.current_member_id())
         or exists (select 1 from production_people pp where pp.deliverable_id = d.id and (
                      pp.team_member_id = public.current_member_id()
                   or pp.vendor_id in (select v.id from vendors v where v.team_member_id = public.current_member_id())))
         or (public.has_role('team_member') and d.campaign_id in
               (select m.campaign_id from campaign_members m where m.team_member_id = public.current_member_id())))
    )
  )
$$;
create policy role_select on public.production_people for select to authenticated using (public.can_access_deliverable(deliverable_id));
create policy staff_insert on public.production_people for insert to authenticated with check (public.is_staff());
create policy staff_update on public.production_people for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_delete on public.production_people for delete to authenticated using (public.is_staff());

-- ─────────────────────────────────────────────────────────────
-- Script versions (scripts table) + comments per version (incl. client's)
-- ─────────────────────────────────────────────────────────────
create table public.script_comments (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.team_members(id),
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  script_id    uuid not null references public.scripts(id),
  from_client  boolean not null default false,
  author_name  text,                          -- the client contact's name, when from_client
  body         text not null,
  is_resolved  boolean not null default false
);
create index script_comments_script_idx on public.script_comments (script_id);
select public.enable_standard_table('public.script_comments');
create policy role_select on public.script_comments for select to authenticated
  using (public.can_access_deliverable((select deliverable_id from public.scripts s where s.id = script_id)));
create policy role_insert on public.script_comments for insert to authenticated
  with check (public.can_access_deliverable((select deliverable_id from public.scripts s where s.id = script_id)));
create policy role_update on public.script_comments for update to authenticated
  using (public.can_access_deliverable((select deliverable_id from public.scripts s where s.id = script_id)))
  with check (public.can_access_deliverable((select deliverable_id from public.scripts s where s.id = script_id)));

-- ─────────────────────────────────────────────────────────────
-- Edit versions (links). The newest one is also the item's draft link,
-- which the campaign tracker shows.
-- ─────────────────────────────────────────────────────────────
create table public.edit_versions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.team_members(id),
  is_archived     boolean not null default false,
  archived_at     timestamptz,
  deliverable_id  uuid not null references public.deliverables(id),
  version         int not null,
  url             text not null check (url ~* '^https?://'),
  notes           text,
  unique (deliverable_id, version)
);
select public.enable_standard_table('public.edit_versions');
create policy role_select on public.edit_versions for select to authenticated using (public.can_access_deliverable(deliverable_id));
create policy role_insert on public.edit_versions for insert to authenticated with check (public.can_access_deliverable(deliverable_id));
create policy role_update on public.edit_versions for update to authenticated using (public.can_access_deliverable(deliverable_id)) with check (public.can_access_deliverable(deliverable_id));

create or replace function public.edit_version_to_draft()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update deliverables set draft_url = new.url
   where id = new.deliverable_id
     and new.version >= coalesce((select max(version) from edit_versions where deliverable_id = new.deliverable_id and not is_archived), 0);
  return new;
end $$;
create trigger edit_versions_to_draft after insert on public.edit_versions for each row execute function public.edit_version_to_draft();

-- ─────────────────────────────────────────────────────────────
-- Shoots: equipment list + call sheet notes
-- ─────────────────────────────────────────────────────────────
alter table public.shoots add column equipment text[] not null default '{}', add column call_sheet_notes text;

-- ─────────────────────────────────────────────────────────────
-- production_items — the board, item page, calendar and "My work".
-- Runs as the caller (RLS decides which items appear).
-- ─────────────────────────────────────────────────────────────
create or replace view public.production_items with (security_invoker = true) as
select
  d.id, d.created_at, d.updated_at, d.is_archived, d.brand_id, d.campaign_id, d.campaign_creator_id, d.creator_id, d.assignee_id,
  d.title, d.deliverable_type as format, d.platform, d.stage, d.stage_changed_at, d.approval_status, d.priority, d.brief,
  d.go_live_date as target_date, d.due_date, coalesce(d.due_date, d.go_live_date) as sort_date, d.went_live_at,
  d.draft_url, d.live_url, d.raw_footage_url, d.final_file_url, d.thumbnail_url,
  d.revision_count, coalesce(d.revision_limit, b.revision_limit) as revision_limit, d.revision_limit as item_revision_limit,
  (coalesce(d.revision_limit, b.revision_limit) is not null and d.revision_count > coalesce(d.revision_limit, b.revision_limit)) as over_revision_limit,
  b.name as brand_name, b.logo_path as brand_logo_path, b.calendar_color as brand_color, c.name as campaign_name, cr.name as creator_name,
  assignee.name as assignee_name,
  floor(extract(epoch from now() - d.stage_changed_at) / 86400)::int as days_in_stage,
  (d.stage not in ('live','cancelled','scheduled')
     and now() - d.stage_changed_at > make_interval(days => coalesce((select stuck_after_days from org_settings limit 1), 3))) as is_stuck,
  (d.go_live_date < public.ist_today() and d.stage not in ('live','cancelled')) as is_overdue,
  coalesce(ppl.people, '{}') as people, coalesce(ppl.member_ids, '{}') as people_member_ids,
  sh.shoot_id, sh.shoot_date,
  sc.script_version, sc.script_status,
  ev.edit_versions
from public.deliverables d
join public.brands b on b.id = d.brand_id
left join public.campaigns c on c.id = d.campaign_id
left join public.creators cr on cr.id = d.creator_id
left join public.team_directory assignee on assignee.id = d.assignee_id
left join lateral (
  select array_agg(pp.role || ':' || coalesce(td.name, v.name, pc.name, 'someone') order by pp.role) as people,
         array_agg(pp.team_member_id) filter (where pp.team_member_id is not null) as member_ids
  from public.production_people pp
  left join public.team_directory td on td.id = pp.team_member_id
  left join public.vendors v on v.id = pp.vendor_id
  left join public.creators pc on pc.id = pp.creator_id
  where pp.deliverable_id = d.id
) ppl on true
left join lateral (
  select s.id as shoot_id, s.shoot_date from public.shoot_deliverables x join public.shoots s on s.id = x.shoot_id
  where x.deliverable_id = d.id and not s.is_archived and s.status <> 'cancelled' order by s.shoot_date limit 1
) sh on true
left join lateral (
  select s.version as script_version, s.status as script_status from public.scripts s
  where s.deliverable_id = d.id and not s.is_archived order by s.version desc limit 1
) sc on true
left join lateral (select count(*) as edit_versions from public.edit_versions e where e.deliverable_id = d.id and not e.is_archived) ev on true
where not d.is_archived;

-- Shoots for the calendar (with what's being shot).
create or replace view public.shoot_calendar with (security_invoker = true) as
select s.id, s.title, s.brand_id, b.name as brand_name, b.calendar_color as brand_color, s.campaign_id, s.shoot_date, s.call_time, s.wrap_time, s.location, s.status,
       s.equipment, s.call_sheet_notes,
       (select array_agg(d.title order by d.title) from public.shoot_deliverables x join public.deliverables d on d.id = x.deliverable_id
         where x.shoot_id = s.id and not d.is_archived) as items,
       (select array_agg(x.deliverable_id) from public.shoot_deliverables x where x.shoot_id = s.id) as item_ids
from public.shoots s left join public.brands b on b.id = s.brand_id
where not s.is_archived;

-- ─────────────────────────────────────────────────────────────
-- Stage timing from the activity log: how long each item sat in each stage,
-- and the average per stage (e.g. edit turnaround).
-- ─────────────────────────────────────────────────────────────
create or replace view public.production_stage_durations with (security_invoker = true) as
with moves as (
  select a.record_id as deliverable_id, a.created_at as entered_at,
         coalesce(a.new_values->>'stage', 'idea') as stage
  from public.activity_log a
  where a.table_name = 'deliverables' and (a.action = 'create' or (a.action = 'status_change' and a.new_values ? 'stage'))
)
select deliverable_id, stage, entered_at,
       lead(entered_at) over (partition by deliverable_id order by entered_at) as left_at,
       extract(epoch from (coalesce(lead(entered_at) over (partition by deliverable_id order by entered_at), now()) - entered_at)) / 3600 as hours_in_stage,
       lead(entered_at) over (partition by deliverable_id order by entered_at) is null as is_current
from moves;

create or replace view public.production_stage_turnaround with (security_invoker = true) as
select stage, count(*) as times, round(avg(hours_in_stage)::numeric / 24, 1) as avg_days,
       round((percentile_cont(0.5) within group (order by hours_in_stage))::numeric / 24, 1) as median_days
from public.production_stage_durations
where not is_current and stage not in ('live','cancelled')
group by stage;

-- ─────────────────────────────────────────────────────────────
-- Read-only client calendar links (per brand). Only a SHA-256 of the token
-- is stored; the link itself is shown once when created.
-- ─────────────────────────────────────────────────────────────
create table public.calendar_shares (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.team_members(id),
  is_archived    boolean not null default false,
  archived_at    timestamptz,
  brand_id       uuid not null references public.brands(id),
  token_hash     text not null unique,
  include_shoots boolean not null default true,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  last_viewed_at timestamptz
);
select public.enable_standard_table('public.calendar_shares');
create policy staff_select on public.calendar_shares for select to authenticated using (public.is_staff());
create policy staff_insert on public.calendar_shares for insert to authenticated with check (public.is_staff());
create policy staff_update on public.calendar_shares for update to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function public.create_calendar_share(p_brand uuid, p_days int default 180, p_include_shoots boolean default true)
returns text language plpgsql security invoker set search_path = public as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_staff() then raise exception 'Only founders and managers can share calendars'; end if;
  insert into calendar_shares (brand_id, token_hash, include_shoots, expires_at)
  values (p_brand, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_include_shoots,
          case when p_days is null then null else now() + make_interval(days => p_days) end);
  return v_token;
end $$;

-- Public (no login). Returns ONLY: titles, format, platform, a client-friendly
-- status, dates and posted links — no money, briefs, notes, people or locations.
create or replace function public.shared_calendar(p_token text, p_from date, p_to date)
returns table (kind text, title text, format text, platform text, status text, on_date date, at_time time, live_url text, brand_name text)
language plpgsql stable security definer set search_path = public as $$
declare sh calendar_shares;
begin
  select * into sh from calendar_shares
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and revoked_at is null and not is_archived and (expires_at is null or expires_at > now());
  if not found then raise exception 'This calendar link is not valid or has expired'; end if;
  if p_to < p_from or p_to - p_from > 120 then raise exception 'Ask for at most 120 days at a time'; end if;
  return query
    select 'post'::text, d.title, d.deliverable_type, d.platform,
           case when d.stage in ('idea','script','script_approved','pre_production') then 'Planned'
                when d.stage in ('shoot_scheduled','shot','editing','internal_review') then 'In production'
                when d.stage in ('client_review','revisions') then 'Awaiting your review'
                when d.stage = 'approved' then 'Approved' when d.stage = 'scheduled' then 'Scheduled' else 'Posted' end,
           d.go_live_date, null::time, case when d.stage = 'live' then d.live_url end, b.name
    from deliverables d join brands b on b.id = d.brand_id
    where d.brand_id = sh.brand_id and not d.is_archived and d.stage <> 'cancelled'
      and d.go_live_date between p_from and p_to
    union all
    select 'shoot', 'Shoot day', null, null, case when s.status = 'done' then 'Done' else 'Planned' end,
           s.shoot_date, s.call_time, null, b.name
    from shoots s join brands b on b.id = s.brand_id
    where sh.include_shoots and s.brand_id = sh.brand_id and not s.is_archived and s.status <> 'cancelled'
      and s.shoot_date between p_from and p_to
    order by 6, 7 nulls first;
end $$;
create or replace function public.shared_calendar_brand(p_token text)
returns table (brand_name text, include_shoots boolean, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.name, s.include_shoots, s.expires_at from calendar_shares s join brands b on b.id = s.brand_id
  where s.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    and s.revoked_at is null and not s.is_archived and (s.expires_at is null or s.expires_at > now())
$$;
grant execute on function public.shared_calendar(text, date, date) to anon;
grant execute on function public.shared_calendar_brand(text) to anon;

-- Activity for one production item (stage moves, people, scripts, edits, comments).
create or replace function public.production_activity(p_item uuid)
returns table (id uuid, created_at timestamptz, action text, table_name text, record_id uuid,
               changed_fields text[], old_values jsonb, new_values jsonb, source text, actor_id uuid, actor_name text)
language sql stable security invoker set search_path = public as $$
  with children as (
    select 'production_people'::text t, id from production_people where deliverable_id = p_item
    union all select 'scripts', id from scripts where deliverable_id = p_item
    union all select 'script_comments', c.id from script_comments c join scripts s on s.id = c.script_id where s.deliverable_id = p_item
    union all select 'edit_versions', id from edit_versions where deliverable_id = p_item
    union all select 'deliverable_metrics', id from deliverable_metrics where deliverable_id = p_item
  )
  select a.id, a.created_at, a.action, a.table_name, a.record_id, a.changed_fields, a.old_values, a.new_values,
         a.source, a.created_by, coalesce(tm.name, case when a.created_by is null then 'System' else 'Former member' end)
  from activity_log a left join team_members tm on tm.id = a.created_by
  where (a.table_name = 'deliverables' and a.record_id = p_item)
     or (a.table_name, a.record_id) in (select t, id from children)
  order by a.created_at desc, a.id desc
  limit 300
$$;
