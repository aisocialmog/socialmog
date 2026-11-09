-- Social Mog OS — feature 3: Creators
-- New migration on top of feature 1–2.

-- ─────────────────────────────────────────────────────────────
-- creators: photo, agency, would-work-again, blacklist, phone key
-- ─────────────────────────────────────────────────────────────
alter table public.creators
  add column photo_path        text,                    -- avatars bucket: creators/<id>/…
  add column manager_agency    text,                    -- talent agency name, if any
  add column would_work_again  boolean,                 -- null = not decided yet
  add column is_blacklisted    boolean not null default false,
  add column blacklist_reason  text,
  -- last 10 digits of the phone, for duplicate detection (+91 / spaces / dashes ignored)
  add column phone_key         text generated always as (nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')) stored;

alter table public.creators add constraint creators_blacklist_reason
  check (not is_blacklisted or nullif(trim(blacklist_reason), '') is not null);

-- "do not work with" is now the blacklist flag (with a reason); status is just the lifecycle
update public.creators set is_blacklisted = true, blacklist_reason = coalesce(blacklist_reason, 'Marked "do not work" before feature 3'), status = 'inactive'
 where status = 'do_not_work';
alter table public.creators drop constraint creators_status_check;
alter table public.creators add constraint creators_status_check check (status in ('prospect','active','inactive'));

create index creators_phone_key_idx on public.creators (phone_key) where phone_key is not null;
create index creators_city_idx on public.creators (lower(city));

-- ─────────────────────────────────────────────────────────────
-- platforms: handles unique per platform ignoring case; history of numbers
-- ─────────────────────────────────────────────────────────────
alter table public.creator_platforms drop constraint creator_platforms_platform_handle_key;
create unique index creator_platforms_handle_key on public.creator_platforms (platform, lower(handle)) where not is_archived;
alter table public.creator_platforms add constraint creator_platforms_er_range check (engagement_rate is null or engagement_rate between 0 and 100);

-- When followers / views / ER change, stamp the date and keep a snapshot for growth history.
create or replace function public.creator_platform_metrics()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.followers is distinct from old.followers or new.avg_views is distinct from old.avg_views
     or new.engagement_rate is distinct from old.engagement_rate then
    if tg_op = 'INSERT' or new.metrics_updated_on is not distinct from old.metrics_updated_on then
      new.metrics_updated_on := coalesce(case when tg_op = 'INSERT' then new.metrics_updated_on end, public.ist_today());
    end if;
  end if;
  return new;
end $$;
create trigger creator_platforms_metrics before insert or update on public.creator_platforms
  for each row execute function public.creator_platform_metrics();

create or replace function public.creator_platform_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.followers is not null or new.avg_views is not null then
    insert into creator_metric_snapshots (creator_platform_id, captured_on, followers, avg_views, engagement_rate)
    values (new.id, coalesce(new.metrics_updated_on, public.ist_today()), new.followers, new.avg_views, new.engagement_rate)
    on conflict (creator_platform_id, captured_on) do update
      set followers = excluded.followers, avg_views = excluded.avg_views, engagement_rate = excluded.engagement_rate;
  end if;
  return new;
end $$;
create trigger creator_platforms_snapshot after insert or update of followers, avg_views, engagement_rate on public.creator_platforms
  for each row execute function public.creator_platform_snapshot();

-- ─────────────────────────────────────────────────────────────
-- Tier from the biggest platform
-- ─────────────────────────────────────────────────────────────
create or replace function public.creator_tier(followers bigint)
returns text language sql immutable as $$
  select case
    when followers is null then null
    when followers < 10000 then 'nano'
    when followers < 100000 then 'micro'
    when followers < 500000 then 'mid'
    when followers < 1000000 then 'macro'
    else 'mega' end
$$;

-- ─────────────────────────────────────────────────────────────
-- Rate card: one current price per deliverable type; old prices kept
-- (valid_to set) so "date updated" and history are both available.
-- ─────────────────────────────────────────────────────────────
alter table public.creator_rate_cards alter column platform drop not null;
alter table public.creator_rate_cards add constraint creator_rate_cards_type_check
  check (deliverable_type in ('reel','story','post','youtube_video','short','ugc_video','live'));
create unique index creator_rate_cards_one_current on public.creator_rate_cards (creator_id, deliverable_type)
  where valid_to is null and not is_archived;

-- Set (or clear, with p_rate null) the current price for one deliverable type.
create or replace function public.set_creator_rate(p_creator uuid, p_type text, p_rate numeric, p_notes text default null)
returns void language plpgsql security invoker set search_path = public as $$
declare cur record; v_today date := public.ist_today();
begin
  select * into cur from creator_rate_cards
   where creator_id = p_creator and deliverable_type = p_type and valid_to is null and not is_archived;
  if found and cur.rate is not distinct from p_rate and cur.notes is not distinct from p_notes then return; end if;
  if found then
    if cur.valid_from = v_today then
      if p_rate is null then update creator_rate_cards set is_archived = true where id = cur.id;
      else update creator_rate_cards set rate = p_rate, notes = p_notes where id = cur.id; end if;
      return;
    end if;
    update creator_rate_cards set valid_to = v_today - 1 where id = cur.id;
  end if;
  if p_rate is not null then
    insert into creator_rate_cards (creator_id, deliverable_type, rate, valid_from, notes)
    values (p_creator, p_type, p_rate, v_today, p_notes);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Payment details: FOUNDERS ONLY (managers included before — now removed)
-- ─────────────────────────────────────────────────────────────
alter table public.creator_payment_details add column bank_name text;
drop policy staff_select on public.creator_payment_details;
drop policy staff_insert on public.creator_payment_details;
drop policy staff_update on public.creator_payment_details;
create policy founder_select on public.creator_payment_details for select to authenticated using (public.is_founder());
create policy founder_insert on public.creator_payment_details for insert to authenticated with check (public.is_founder());
create policy founder_update on public.creator_payment_details for update to authenticated using (public.is_founder()) with check (public.is_founder());
alter table public.creator_payment_details add constraint creator_payment_pan_format
  check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');
alter table public.creator_payment_details add constraint creator_payment_ifsc_format
  check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$');

comment on table  public.creator_payment_details is 'SENSITIVE: bank, UPI and tax details. Founders only (RLS). Activity log keeps only the last 4 characters.';
comment on column public.creator_payment_details.pan is 'SENSITIVE';
comment on column public.creator_payment_details.upi_id is 'SENSITIVE';
comment on column public.creator_payment_details.bank_account_number is 'SENSITIVE';
comment on column public.creator_payment_details.ifsc is 'SENSITIVE';
comment on column public.creator_payment_details.bank_account_name is 'SENSITIVE';
comment on column public.creator_payment_details.bank_name is 'SENSITIVE';

-- The activity log must not become a second copy of bank details:
-- sensitive columns are stored masked (only the last 4 characters).
create or replace function public.mask_sensitive(p_table text, v jsonb)
returns jsonb language sql immutable as $$
  select case when v is null or p_table <> 'creator_payment_details' then v else (
    select coalesce(jsonb_object_agg(k, case
      when k in ('pan','upi_id','bank_account_number','ifsc','bank_account_name','bank_name','gstin','legal_name')
           and jsonb_typeof(val) = 'string'
      then to_jsonb('••••' || right(val #>> '{}', 4)) else val end), '{}'::jsonb)
    from jsonb_each(v) as e(k, val)) end
$$;

create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_action text;
  v_fields text[] := '{}'; v_o jsonb := '{}'; v_n jsonb := '{}';
  k text;
  v_source text := coalesce(nullif(current_setting('app.activity_source', true), ''), 'app');
  v_actor uuid := public.current_member_id();
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    insert into activity_log (created_by, action, table_name, record_id, new_values, source)
    values (v_actor, 'create', tg_table_name, (v_new->>'id')::uuid, mask_sensitive(tg_table_name, v_new), v_source);
    return new;
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    insert into activity_log (created_by, action, table_name, record_id, old_values, source)
    values (v_actor, 'delete', tg_table_name, (v_old->>'id')::uuid, mask_sensitive(tg_table_name, v_old), v_source);
    return old;
  end if;

  v_old := to_jsonb(old); v_new := to_jsonb(new);
  for k in select jsonb_object_keys(v_new) loop
    continue when k in ('updated_at','archived_at','phone_key');
    if (v_old->k) is distinct from (v_new->k) then
      v_fields := v_fields || k;
      v_o := v_o || jsonb_build_object(k, v_old->k);
      v_n := v_n || jsonb_build_object(k, v_new->k);
    end if;
  end loop;
  if array_length(v_fields, 1) is null then return new; end if;

  v_action := case
    when 'is_archived' = any(v_fields) and (v_new->>'is_archived')::boolean then 'archive'
    when 'is_archived' = any(v_fields) then 'restore'
    when 'status' = any(v_fields) or 'stage' = any(v_fields) then 'status_change'
    else 'update' end;

  insert into activity_log (created_by, action, table_name, record_id, changed_fields, old_values, new_values, source)
  values (v_actor, v_action, tg_table_name, (v_new->>'id')::uuid, v_fields,
          mask_sensitive(tg_table_name, v_o), mask_sensitive(tg_table_name, v_n), v_source);
  return new;
end $$;

-- Managers may not see payment-detail history either.
create or replace function public.can_see_activity(p_table text, p_record uuid, p_actor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_founder() then true
    when public.has_role('manager') then p_table not in ('capital_entries','api_clients','webhook_subscriptions','backups','team_members','creator_payment_details')
    when public.is_active_member() then
      case p_table
        when 'tasks'         then public.can_access_task(p_record)
        when 'deliverables'  then public.can_access_deliverable(p_record)
        when 'campaigns'     then public.can_access_campaign(p_record)
        when 'shoots'        then public.can_access_shoot(p_record)
        when 'scripts'       then public.can_access_deliverable((select deliverable_id from scripts where id = p_record))
        when 'deliverable_reviews' then public.can_access_deliverable((select deliverable_id from deliverable_reviews where id = p_record))
        when 'comments'      then exists (select 1 from comments c where c.id = p_record and
                                    public.can_access_attachment_target(c.task_id, c.brand_id, c.creator_id, c.campaign_id, c.deliverable_id, c.invoice_id))
        else false
      end
    else false
  end
$$;

-- ─────────────────────────────────────────────────────────────
-- Niche tags (the editable list) — seeded; edit in Creators → … → Niches
-- ─────────────────────────────────────────────────────────────
insert into public.tags (kind, name) values
  ('niche','Food'), ('niche','Tech'), ('niche','Fashion'), ('niche','Comedy'), ('niche','Finance'), ('niche','Parenting'),
  ('niche','Beauty'), ('niche','Fitness'), ('niche','Travel'), ('niche','Lifestyle'), ('niche','Education'),
  ('niche','Gaming'), ('niche','Auto'), ('niche','Health'), ('niche','Regional')
on conflict (kind, name) do nothing;
create unique index tags_kind_lower_name on public.tags (kind, lower(name)) where not is_archived;

-- ─────────────────────────────────────────────────────────────
-- Shortlists — named groups of candidate creators. A shortlist can stand
-- alone now and is linked to a campaign (and brand) in feature 4.
-- ─────────────────────────────────────────────────────────────
create table public.shortlists (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.team_members(id),
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  name         text not null,
  brand_id     uuid references public.brands(id),
  campaign_id  uuid references public.campaigns(id),
  notes        text
);
create index shortlists_campaign_idx on public.shortlists (campaign_id);

create table public.shortlist_creators (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.team_members(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  shortlist_id  uuid not null references public.shortlists(id),
  creator_id    uuid not null references public.creators(id),
  status        text not null default 'shortlisted'
                check (status in ('shortlisted','proposed','client_approved','rejected')),
  position      int not null default 0,
  note          text,
  unique (shortlist_id, creator_id)
);
create index shortlist_creators_creator_idx on public.shortlist_creators (creator_id);

select public.enable_standard_table('public.shortlists');
select public.enable_standard_table('public.shortlist_creators');
create policy role_select on public.shortlists for select to authenticated
  using (public.is_staff() or public.can_access_campaign(campaign_id));
create policy staff_insert on public.shortlists for insert to authenticated with check (public.is_staff());
create policy staff_update on public.shortlists for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy role_select on public.shortlist_creators for select to authenticated
  using (public.is_staff() or exists (select 1 from public.shortlists s where s.id = shortlist_id and public.can_access_campaign(s.campaign_id)));
create policy staff_insert on public.shortlist_creators for insert to authenticated with check (public.is_staff());
create policy staff_update on public.shortlist_creators for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- ─────────────────────────────────────────────────────────────
-- creator_overview — everything the list, filters and cards need.
-- Runs as the caller; rates and money are empty for non-staff.
-- ─────────────────────────────────────────────────────────────
create or replace view public.creator_overview with (security_invoker = true) as
select
  c.id, c.created_at, c.updated_at, c.is_archived, c.name, c.photo_path, c.gender, c.city, c.state, c.languages,
  c.email, c.phone, c.whatsapp, c.phone_key, c.manager_name, c.manager_agency, c.manager_phone, c.manager_email,
  c.status, c.rating, c.would_work_again, c.is_blacklisted, c.blacklist_reason, c.owner_id, c.notes, c.import_batch_id,
  p.max_followers, public.creator_tier(p.max_followers) as tier,
  p.top_platform, p.top_handle, p.top_avg_views, p.top_engagement_rate, p.platforms, p.handles, p.metrics_updated_on,
  coalesce(n.niches, '{}') as niches, coalesce(n.niche_ids, '{}') as niche_ids,
  r.rate_reel, r.rate_story, r.rate_post, r.rate_youtube_video, r.rate_short, r.rate_ugc_video, r.rate_live,
  r.rates_updated_on, r.min_rate, r.max_rate,
  coalesce(h.campaigns, 0) as campaigns_count, h.last_campaign_on,
  coalesce(pay.paid, 0) as total_paid
from public.creators c
left join lateral (
  select max(cp.followers) as max_followers,
         (array_agg(cp.platform order by cp.followers desc nulls last))[1] as top_platform,
         (array_agg(cp.handle order by cp.followers desc nulls last))[1] as top_handle,
         (array_agg(cp.avg_views order by cp.followers desc nulls last))[1] as top_avg_views,
         (array_agg(cp.engagement_rate order by cp.followers desc nulls last))[1] as top_engagement_rate,
         array_agg(distinct cp.platform) as platforms,
         array_agg(cp.platform || ':' || lower(cp.handle)) as handles,
         max(cp.metrics_updated_on) as metrics_updated_on
  from public.creator_platforms cp where cp.creator_id = c.id and not cp.is_archived
) p on true
left join lateral (
  select array_agg(t.name order by t.name) as niches, array_agg(t.id order by t.name) as niche_ids
  from public.creator_tags ct join public.tags t on t.id = ct.tag_id and not t.is_archived
  where ct.creator_id = c.id
) n on true
left join lateral (
  select max(rate) filter (where deliverable_type = 'reel') as rate_reel,
         max(rate) filter (where deliverable_type = 'story') as rate_story,
         max(rate) filter (where deliverable_type = 'post') as rate_post,
         max(rate) filter (where deliverable_type = 'youtube_video') as rate_youtube_video,
         max(rate) filter (where deliverable_type = 'short') as rate_short,
         max(rate) filter (where deliverable_type = 'ugc_video') as rate_ugc_video,
         max(rate) filter (where deliverable_type = 'live') as rate_live,
         max(valid_from) as rates_updated_on, min(rate) as min_rate, max(rate) as max_rate
  from public.creator_rate_cards rc where rc.creator_id = c.id and rc.valid_to is null and not rc.is_archived
) r on true
left join lateral (
  select count(*) as campaigns, max(cm.start_date) as last_campaign_on
  from public.campaign_creators cc join public.campaigns cm on cm.id = cc.campaign_id
  where cc.creator_id = c.id and not cc.is_archived and cc.status <> 'dropped'
) h on true
left join lateral (
  select sum(t.gross) filter (where t.status = 'paid') as paid from public.creator_payout_totals t where t.creator_id = c.id
) pay on true;

-- Campaign history: every campaign a creator was on, fee, paid, output, views.
create or replace view public.creator_campaign_history with (security_invoker = true) as
select
  cc.id as campaign_creator_id, cc.creator_id, cc.campaign_id, cc.status as creator_status,
  cm.name as campaign_name, cm.status as campaign_status, cm.start_date, cm.end_date,
  b.id as brand_id, b.name as brand_name,
  f.agreed_fee,
  coalesce((select sum(t.gross) from public.creator_payout_totals t join public.creator_payouts po on po.id = t.payout_id
            where po.campaign_creator_id = cc.id and t.status = 'paid'), 0) as paid,
  (select count(*) from public.deliverables d where d.campaign_creator_id = cc.id and not d.is_archived) as deliverables,
  (select count(*) from public.deliverables d where d.campaign_creator_id = cc.id and not d.is_archived and d.stage = 'live') as live,
  (select sum(m.views) from public.deliverables d
     join lateral (select views from public.deliverable_metrics dm where dm.deliverable_id = d.id order by captured_on desc limit 1) m on true
   where d.campaign_creator_id = cc.id and not d.is_archived) as total_views
from public.campaign_creators cc
join public.campaigns cm on cm.id = cc.campaign_id
join public.brands b on b.id = cm.brand_id
left join public.campaign_creator_fees f on f.campaign_creator_id = cc.id
where not cc.is_archived;

-- Activity for a creator and everything hanging off it.
create or replace function public.creator_activity(p_creator uuid, p_limit int default 200)
returns table (id uuid, created_at timestamptz, action text, table_name text, record_id uuid,
               changed_fields text[], old_values jsonb, new_values jsonb, source text,
               actor_id uuid, actor_name text)
language sql stable security invoker set search_path = public as $$
  with children as (
    select 'creator_platforms'::text t, id from creator_platforms where creator_id = p_creator
    union all select 'creator_rate_cards', id from creator_rate_cards where creator_id = p_creator
    union all select 'creator_payment_details', id from creator_payment_details where creator_id = p_creator
    union all select 'shortlist_creators', id from shortlist_creators where creator_id = p_creator
    union all select 'campaign_creators', id from campaign_creators where creator_id = p_creator
  )
  select a.id, a.created_at, a.action, a.table_name, a.record_id, a.changed_fields, a.old_values, a.new_values,
         a.source, a.created_by, coalesce(tm.name, case when a.created_by is null then 'System' else 'Former member' end)
  from activity_log a
  left join team_members tm on tm.id = a.created_by
  where (a.table_name = 'creators' and a.record_id = p_creator)
     or (a.table_name, a.record_id) in (select t, id from children)
     or (a.table_name in ('creator_tags','creator_platforms','creator_rate_cards','shortlist_creators','campaign_creators')
         and coalesce(a.new_values->>'creator_id', a.old_values->>'creator_id') = p_creator::text)
  order by a.created_at desc, a.id desc
  limit greatest(1, least(p_limit, 1000))
$$;
create index activity_log_creator_ref_idx on public.activity_log
  ((coalesce(new_values->>'creator_id', old_values->>'creator_id')));

-- ─────────────────────────────────────────────────────────────
-- Bulk import
-- ─────────────────────────────────────────────────────────────
-- Which incoming phones / handles already belong to a creator?
-- p_handles are 'platform:handle' strings (handle without @, any case).
create or replace function public.creator_duplicates(p_phones text[], p_handles text[])
returns table (creator_id uuid, creator_name text, matched_on text, value text)
language sql stable security invoker set search_path = public as $$
  select c.id, c.name, 'phone', c.phone_key
  from creators c
  where not c.is_archived and c.phone_key = any (
    select nullif(right(regexp_replace(x, '\D', '', 'g'), 10), '') from unnest(coalesce(p_phones, '{}')) x)
  union all
  select c.id, c.name, 'handle', p.platform || ':' || lower(p.handle)
  from creator_platforms p join creators c on c.id = p.creator_id
  where not p.is_archived and not c.is_archived
    and (p.platform || ':' || lower(p.handle)) = any (select lower(x) from unnest(coalesce(p_handles, '{}')) x)
$$;

-- Import already-mapped rows in one go: all rows or none.
-- Each row: {name, phone, whatsapp, email, city, state, gender, manager_name, manager_phone,
--   manager_email, notes, rating, languages:[…], niches:[…],
--   platforms:[{platform, handle, followers, avg_views, engagement_rate, url}],
--   rates:{reel: 12000, …}, raw:{…original CSV row…}}
create or replace function public.import_creators(p_source text, p_file_name text, p_rows jsonb)
returns table (batch_id uuid, created int)
language plpgsql security invoker set search_path = public as $$
declare
  v_batch uuid; v_row jsonb; v_id uuid; v_n int := 0; v_i int := 0; v_tag uuid; v_niche text; v_pl jsonb; k text;
begin
  if not public.is_staff() then raise exception 'Only founders and managers can import creators'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Nothing to import'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import at most 5,000 rows at a time'; end if;
  perform set_config('app.activity_source', 'import', true);

  insert into import_batches (source_name, target_table, file_path, status, rows_total, rows_valid)
  values (coalesce(p_source, 'CSV upload'), 'creators', p_file_name, 'committed', jsonb_array_length(p_rows), jsonb_array_length(p_rows))
  returning id into v_batch;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    if nullif(trim(v_row->>'name'), '') is null then raise exception 'Row %: name is missing', v_i; end if;
    insert into creators (name, phone, whatsapp, email, city, state, gender, manager_name, manager_phone, manager_email,
                          notes, rating, languages, status, import_batch_id)
    values (trim(v_row->>'name'), nullif(v_row->>'phone',''), nullif(v_row->>'whatsapp',''), nullif(v_row->>'email',''),
            nullif(v_row->>'city',''), nullif(v_row->>'state',''), nullif(v_row->>'gender',''),
            nullif(v_row->>'manager_name',''), nullif(v_row->>'manager_phone',''), nullif(v_row->>'manager_email',''),
            nullif(v_row->>'notes',''), nullif(v_row->>'rating','')::smallint,
            coalesce(array(select jsonb_array_elements_text(v_row->'languages')), '{}'), 'prospect', v_batch)
    returning id into v_id;

    for v_pl in select * from jsonb_array_elements(coalesce(v_row->'platforms', '[]')) loop
      insert into creator_platforms (creator_id, platform, handle, url, followers, avg_views, engagement_rate)
      values (v_id, v_pl->>'platform', v_pl->>'handle', nullif(v_pl->>'url',''),
              nullif(v_pl->>'followers','')::bigint, nullif(v_pl->>'avg_views','')::bigint, nullif(v_pl->>'engagement_rate','')::numeric);
    end loop;

    for v_niche in select trim(x) from jsonb_array_elements_text(coalesce(v_row->'niches', '[]')) x where trim(x) <> '' loop
      select id into v_tag from tags where kind = 'niche' and lower(name) = lower(v_niche) and not is_archived;
      if v_tag is null then insert into tags (kind, name) values ('niche', initcap(v_niche)) returning id into v_tag; end if;
      insert into creator_tags (creator_id, tag_id) values (v_id, v_tag) on conflict do nothing;
      v_tag := null;
    end loop;

    for k in select jsonb_object_keys(coalesce(v_row->'rates', '{}')) loop
      if nullif(v_row->'rates'->>k, '') is not null then
        insert into creator_rate_cards (creator_id, deliverable_type, rate) values (v_id, k, (v_row->'rates'->>k)::numeric);
      end if;
    end loop;

    insert into import_rows (batch_id, row_number, raw, status, target_id)
    values (v_batch, v_i, coalesce(v_row->'raw', v_row), 'committed', v_id);
    v_n := v_n + 1;
  end loop;

  update import_batches set committed_at = now() where id = v_batch;
  return query select v_batch, v_n;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Creator photos live in the avatars bucket under creators/<creator id>/.
-- Founders & managers may upload them (members already can read avatars).
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute $p$create policy "staff upload creator photos" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'creators' and public.is_staff())$p$;
    execute $p$create policy "staff update creator photos" on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'creators' and public.is_staff())$p$;
  end if;
end $$;
