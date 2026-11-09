-- Social Mog OS — 0006 roles enforced in the database.
--
--   Founder      everything, including money, capital and team management
--   Manager      everything except capital (founder money in/out, opening balances),
--                team management, API keys and backups
--   Team member  their own tasks + campaigns they are on + production items on
--                those campaigns or assigned to them. No money tables at all.
--   Freelancer   only deliverables, tasks and shoots assigned to them.
--
-- The UI hides pages too, but THESE policies are the real lock: a request
-- for a row the role may not see simply returns nothing.
-- Note: no FORCE ROW LEVEL SECURITY — the SECURITY DEFINER helpers below run
-- as the table owner and must be able to read past RLS to answer questions.

-- ─────────────────────────────────────────────────────────────
-- 1. Standard triggers + RLS on every table (via the reusable hook)
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
  no_log text[] := array['api_request_log','notifications','import_rows','ai_requests','user_preferences','reminders'];
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'activity_log'
  loop
    perform public.enable_standard_table(format('public.%I', t)::regclass, not (t = any(no_log)));
  end loop;
end $$;
alter table public.activity_log enable row level security;

-- Any table created later in public gets the same treatment automatically.
create or replace function public.auto_standardise_new_tables()
returns event_trigger language plpgsql set search_path = public as $$
declare obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands()
             where command_tag = 'CREATE TABLE' and schema_name = 'public' and object_type = 'table'
  loop
    perform public.enable_standard_table(obj.objid::regclass, true);
  end loop;
end $$;

do $$
begin
  create event trigger standardise_new_tables on ddl_command_end
    when tag in ('CREATE TABLE') execute function public.auto_standardise_new_tables();
exception when insufficient_privilege then
  raise notice 'Event triggers not permitted here: call enable_standard_table() in each new migration instead.';
end $$;

-- ─────────────────────────────────────────────────────────────
-- 2. "Can I see this record?" — one function per kind of record
-- ─────────────────────────────────────────────────────────────
create or replace function public.can_access_campaign(p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_campaign is not null and (
    public.is_staff()
    or (public.has_role('team_member') and (
          exists (select 1 from campaign_members m
                  where m.campaign_id = p_campaign and m.team_member_id = public.current_member_id())
       or exists (select 1 from deliverables d
                  where d.campaign_id = p_campaign and d.assignee_id = public.current_member_id())))
  )
$$;

create or replace function public.can_access_deliverable(p_deliverable uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_deliverable is not null and (
    public.is_staff()
    or exists (
      select 1 from deliverables d
      where d.id = p_deliverable and (
            d.assignee_id = public.current_member_id()
         or d.editor_vendor_id in (select v.id from vendors v where v.team_member_id = public.current_member_id())
         or (public.has_role('team_member') and d.campaign_id in
               (select m.campaign_id from campaign_members m where m.team_member_id = public.current_member_id())))
    )
  )
$$;

create or replace function public.can_access_brand(p_brand uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_brand is not null and (
    public.is_staff()
    or exists (select 1 from campaigns c where c.brand_id = p_brand and public.can_access_campaign(c.id))
    or exists (select 1 from deliverables d where d.brand_id = p_brand and public.can_access_deliverable(d.id))
  )
$$;

create or replace function public.can_access_creator(p_creator uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_creator is not null and (
    public.is_staff()
    or exists (select 1 from campaign_creators cc where cc.creator_id = p_creator and public.can_access_campaign(cc.campaign_id))
    or exists (select 1 from deliverables d where d.creator_id = p_creator and public.can_access_deliverable(d.id))
  )
$$;

create or replace function public.can_access_shoot(p_shoot uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_shoot is not null and (
    public.is_staff()
    or exists (select 1 from shoot_crew c where c.shoot_id = p_shoot and c.team_member_id = public.current_member_id())
    or exists (select 1 from shoot_deliverables sd where sd.shoot_id = p_shoot and public.can_access_deliverable(sd.deliverable_id))
    or exists (select 1 from shoots s where s.id = p_shoot and public.can_access_campaign(s.campaign_id))
  )
$$;

create or replace function public.can_access_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_task is not null and (
    public.is_staff()
    or exists (select 1 from tasks t where t.id = p_task
               and (t.assignee_id = public.current_member_id() or t.created_by = public.current_member_id()))
  )
$$;

-- Comments and files hang off one record; you see them if you can see that record.
-- Anything attached to money (invoice, expense, payout) is staff-only.
create or replace function public.can_access_attachment_target(
  p_task uuid, p_brand uuid, p_creator uuid, p_campaign uuid, p_deliverable uuid,
  p_invoice uuid default null, p_expense uuid default null, p_payout uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or (
    public.is_active_member()
    and p_invoice is null and p_expense is null and p_payout is null
    and (p_task is null or public.can_access_task(p_task))
    and (p_brand is null or public.can_access_brand(p_brand))
    and (p_creator is null or public.can_access_creator(p_creator))
    and (p_campaign is null or public.can_access_campaign(p_campaign))
    and (p_deliverable is null or public.can_access_deliverable(p_deliverable))
    and num_nonnulls(p_task, p_brand, p_creator, p_campaign, p_deliverable) > 0
  )
$$;

-- Activity history follows the same rules as the record it describes.
create or replace function public.can_see_activity(p_table text, p_record uuid, p_actor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_founder() then true
    when public.has_role('manager') then p_table not in ('capital_entries','api_clients','webhook_subscriptions','backups','team_members')
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
-- 3. Guards for what non-staff may change on rows they can see
-- ─────────────────────────────────────────────────────────────
create or replace function public.protect_team_member_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- logged-in users who are not founders may only edit their own name, phone, photo, title
  if auth.uid() is not null and not public.is_founder() then
    if new.role is distinct from old.role or new.status is distinct from old.status
       or new.email is distinct from old.email or new.monthly_cost is distinct from old.monthly_cost
       or new.joined_date is distinct from old.joined_date or new.user_id is distinct from old.user_id
       or new.is_archived is distinct from old.is_archived then
      raise exception 'Only a founder can change role, status, email, joined date or monthly cost';
    end if;
  end if;
  -- never leave the agency without an active founder
  if old.role = 'founder' and old.status = 'active' and not old.is_archived
     and (new.role <> 'founder' or new.status <> 'active' or new.is_archived)
     and not exists (select 1 from team_members where id <> old.id and role = 'founder'
                     and status = 'active' and not is_archived) then
    raise exception 'There must always be at least one active founder';
  end if;
  return new;
end $$;
create trigger team_members_protect before update on public.team_members
  for each row execute function public.protect_team_member_fields();

-- Team members and freelancers can move work forward (stage, links, dates)
-- but cannot re-point it at another brand/campaign/person or archive it.
create or replace function public.guard_deliverable_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_staff() then
    if new.brand_id is distinct from old.brand_id or new.campaign_id is distinct from old.campaign_id
       or new.retainer_id is distinct from old.retainer_id or new.campaign_creator_id is distinct from old.campaign_creator_id
       or new.creator_id is distinct from old.creator_id or new.assignee_id is distinct from old.assignee_id
       or new.editor_vendor_id is distinct from old.editor_vendor_id or new.is_archived is distinct from old.is_archived then
      raise exception 'Only a founder or manager can reassign, re-link or archive a deliverable';
    end if;
  end if;
  return new;
end $$;
create trigger deliverables_guard before update on public.deliverables
  for each row execute function public.guard_deliverable_update();

-- ─────────────────────────────────────────────────────────────
-- 4. Policies
--    No DELETE policy on business tables → hard delete is impossible from
--    the app; records are archived (is_archived = true) instead.
-- ─────────────────────────────────────────────────────────────
do $$
declare t text; r record;
  -- money & admin data: founders + managers only
  staff_only text[] := array[
    'invoices','invoice_items','receipts','receipt_allocations','expenses','expense_categories',
    'creator_payouts','creator_payout_items','account_transfers','money_accounts','targets',
    'retainers','retainer_scope_items','creator_rate_cards','creator_payment_details',
    'campaign_finances','campaign_creator_fees','deliverable_fees','vendors',
    'creator_metric_snapshots','document_sequences','import_batches','import_rows',
    'automation_rules','reminders'];
  -- founders only
  founder_only text[] := array['capital_entries','api_clients','webhook_subscriptions','backups'];
  -- pure link rows staff may remove
  link_tables text[] := array['brand_tags','creator_tags','shoot_deliverables','shoot_crew','campaign_members'];
begin
  foreach t in array staff_only loop
    execute format('create policy staff_select on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy staff_update on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
  foreach t in array founder_only loop
    execute format('create policy founder_select on public.%I for select to authenticated using (public.is_founder())', t);
    execute format('create policy founder_insert on public.%I for insert to authenticated with check (public.is_founder())', t);
    execute format('create policy founder_update on public.%I for update to authenticated using (public.is_founder()) with check (public.is_founder())', t);
  end loop;

  -- staff write; others read only what their work touches
  for r in select * from (values
      ('brands',            'public.can_access_brand(id)'),
      ('brand_contacts',    'public.can_access_brand(brand_id)'),
      ('creators',          'public.can_access_creator(id)'),
      ('creator_platforms', 'public.can_access_creator(creator_id)'),
      ('campaigns',         'public.can_access_campaign(id)'),
      ('campaign_creators', 'public.can_access_campaign(campaign_id)'),
      ('campaign_members',  'public.can_access_campaign(campaign_id)'),
      ('shoots',            'public.can_access_shoot(id)'),
      ('shoot_deliverables','public.can_access_shoot(shoot_id)'),
      ('shoot_crew',        'public.can_access_shoot(shoot_id)'),
      ('calendar_events',   'public.is_active_member() and ((brand_id is null and campaign_id is null) or public.can_access_campaign(campaign_id) or public.can_access_brand(brand_id))'),
      ('tags',              'public.is_active_member()'),
      ('brand_tags',        'public.can_access_brand(brand_id)'),
      ('creator_tags',      'public.can_access_creator(creator_id)')
    ) as x(tbl, expr)
  loop
    execute format('create policy role_select on public.%I for select to authenticated using (%s)', r.tbl, r.expr);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.is_staff())', r.tbl);
    execute format('create policy staff_update on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', r.tbl);
  end loop;

  foreach t in array link_tables loop
    execute format('create policy staff_delete on public.%I for delete to authenticated using (public.is_staff())', t);
  end loop;

  -- production work: anyone who can see the deliverable can work on it
  foreach t in array array['scripts','deliverable_reviews','deliverable_metrics'] loop
    execute format('create policy role_select on public.%I for select to authenticated using (public.can_access_deliverable(deliverable_id))', t);
    execute format('create policy role_insert on public.%I for insert to authenticated with check (public.can_access_deliverable(deliverable_id))', t);
    execute format('create policy role_update on public.%I for update to authenticated using (public.can_access_deliverable(deliverable_id)) with check (public.can_access_deliverable(deliverable_id))', t);
  end loop;
end $$;

-- deliverables: staff create; anyone assigned can read & move them along
create policy role_select on public.deliverables for select to authenticated using (public.can_access_deliverable(id));
create policy staff_insert on public.deliverables for insert to authenticated with check (public.is_staff());
create policy role_update on public.deliverables for update to authenticated
  using (public.can_access_deliverable(id)) with check (public.can_access_deliverable(id));

-- tasks: staff see all; others see tasks assigned to them or that they created,
-- and can only create/keep tasks for themselves.
create policy role_select on public.tasks for select to authenticated
  using (public.is_staff() or assignee_id = public.current_member_id() or created_by = public.current_member_id());
create policy role_insert on public.tasks for insert to authenticated with check (
  public.is_staff() or (
    public.is_active_member()
    and (assignee_id is null or assignee_id = public.current_member_id())
    and invoice_id is null
    and (brand_id is null or public.can_access_brand(brand_id))
    and (creator_id is null or public.can_access_creator(creator_id))
    and (campaign_id is null or public.can_access_campaign(campaign_id))
    and (deliverable_id is null or public.can_access_deliverable(deliverable_id))
    and (shoot_id is null or public.can_access_shoot(shoot_id))));
create policy role_update on public.tasks for update to authenticated
  using (public.is_staff() or assignee_id = public.current_member_id() or created_by = public.current_member_id())
  with check (public.is_staff() or assignee_id = public.current_member_id()
              or (assignee_id is null and created_by = public.current_member_id()));

-- comments & files: visible with the record they belong to
create policy role_select on public.comments for select to authenticated
  using (public.can_access_attachment_target(task_id, brand_id, creator_id, campaign_id, deliverable_id, invoice_id));
create policy role_insert on public.comments for insert to authenticated
  with check (public.can_access_attachment_target(task_id, brand_id, creator_id, campaign_id, deliverable_id, invoice_id));
create policy own_update on public.comments for update to authenticated
  using (created_by = public.current_member_id() or public.is_staff())
  with check (public.can_access_attachment_target(task_id, brand_id, creator_id, campaign_id, deliverable_id, invoice_id));

create policy role_select on public.files for select to authenticated
  using (public.can_access_attachment_target(task_id, brand_id, creator_id, campaign_id, deliverable_id, invoice_id, expense_id, payout_id));
create policy role_insert on public.files for insert to authenticated
  with check (public.can_access_attachment_target(task_id, brand_id, creator_id, campaign_id, deliverable_id, invoice_id, expense_id, payout_id));
create policy own_update on public.files for update to authenticated
  using (created_by = public.current_member_id() or public.is_staff())
  with check (public.can_access_attachment_target(task_id, brand_id, creator_id, campaign_id, deliverable_id, invoice_id, expense_id, payout_id));

-- team_members: founders & managers see everyone (incl. monthly cost);
-- others see only their own row (colleagues' names come from team_directory).
create policy role_select on public.team_members for select to authenticated
  using (public.is_staff() or user_id = auth.uid());
create policy founder_insert on public.team_members for insert to authenticated with check (public.is_founder());
create policy self_or_founder_update on public.team_members for update to authenticated
  using (public.is_founder() or user_id = auth.uid())
  with check (public.is_founder() or user_id = auth.uid());

-- org settings: everyone reads (company name, GST state); staff edit
create policy member_select on public.org_settings for select to authenticated using (public.is_active_member());
create policy staff_update on public.org_settings for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- your own preferences only
create policy own_all on public.user_preferences for all to authenticated
  using (team_member_id = public.current_member_id()) with check (team_member_id = public.current_member_id());

-- notifications: read/mark your own; any member can notify a teammate (mentions)
create policy own_select on public.notifications for select to authenticated using (recipient_id = public.current_member_id());
create policy own_update on public.notifications for update to authenticated
  using (recipient_id = public.current_member_id()) with check (recipient_id = public.current_member_id());
create policy member_insert on public.notifications for insert to authenticated with check (public.is_active_member());

-- activity log: read-only, filtered like the records themselves; written only by the trigger
create policy role_select on public.activity_log for select to authenticated
  using (public.can_see_activity(table_name, record_id, created_by));

create policy founder_select on public.api_request_log for select to authenticated using (public.is_founder());

-- AI: templates readable by all members, edited by staff; requests visible to who ran them
create policy member_select on public.ai_prompt_templates for select to authenticated using (public.is_active_member());
create policy staff_insert on public.ai_prompt_templates for insert to authenticated with check (public.is_staff());
create policy staff_update on public.ai_prompt_templates for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy own_select on public.ai_requests for select to authenticated
  using (public.is_staff() or created_by = public.current_member_id());
create policy member_insert on public.ai_requests for insert to authenticated with check (public.is_active_member());

-- saved views: yours, plus ones shared with the team
create policy view_select on public.saved_views for select to authenticated
  using (public.is_active_member() and (created_by = public.current_member_id() or is_shared));
create policy view_insert on public.saved_views for insert to authenticated with check (public.is_active_member());
create policy view_update on public.saved_views for update to authenticated
  using (created_by = public.current_member_id()) with check (created_by = public.current_member_id());

-- ─────────────────────────────────────────────────────────────
-- 5. Team directory — names & photos of active colleagues for everyone
--    (assignee pickers, avatars) without exposing salary or contact details.
-- ─────────────────────────────────────────────────────────────
create view public.team_directory as
  select id, name, photo_path, role, title
  from public.team_members
  where status = 'active' and not is_archived and public.is_active_member();

-- ─────────────────────────────────────────────────────────────
-- 6. Global search (top bar). Runs as the caller, so RLS decides what
--    each role can find — a team member never finds an invoice.
-- ─────────────────────────────────────────────────────────────
create or replace function public.global_search(q text, max_results int default 20)
returns table (kind text, id uuid, title text, subtitle text)
language sql stable security invoker set search_path = public as $$
  with term as (
    select '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as t,
           lower(trim(q)) as raw
  ), hits as (
    select 'brand'::text kind, b.id, b.name title,
           concat_ws(' · ', b.industry, b.city) subtitle, b.name sort_key
    from brands b, term where not b.is_archived and b.name ilike term.t
    union all
    select 'creator', c.id, c.name,
           (select string_agg(p.platform || ' @' || p.handle, ' · ') from creator_platforms p where p.creator_id = c.id and not p.is_archived),
           c.name
    from creators c, term where not c.is_archived and (c.name ilike term.t
      or exists (select 1 from creator_platforms p where p.creator_id = c.id and p.handle ilike term.t))
    union all
    select 'campaign', c.id, c.name, concat_ws(' · ', b.name, c.code), c.name
    from campaigns c left join brands b on b.id = c.brand_id, term
    where not c.is_archived and (c.name ilike term.t or c.code ilike term.t)
    union all
    select 'invoice', i.id, coalesce(i.invoice_number, 'Draft invoice'), b.name, coalesce(i.invoice_number, '')
    from invoices i left join brands b on b.id = i.brand_id, term
    where not i.is_archived and (i.invoice_number ilike term.t or b.name ilike term.t)
  )
  select h.kind, h.id, h.title, h.subtitle
  from hits h, term
  where length(term.raw) >= 2
  order by (lower(h.sort_key) like term.raw || '%') desc, h.title
  limit greatest(1, least(max_results, 50))
$$;

create or replace function public.try_uuid(v text)
returns uuid language plpgsql immutable as $$
begin return v::uuid; exception when others then return null; end $$;

-- ─────────────────────────────────────────────────────────────
-- 7. Storage (private buckets) — Supabase only
--    avatars/<team_member_id>/…   : any member reads, you write your own
--    records/work/<deliverable_id>/… : whoever can see that deliverable
--    records/<anything else>      : founders & managers
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values
      ('records', 'records', false), ('avatars', 'avatars', false),
      ('imports', 'imports', false), ('backups', 'backups', false)
    on conflict (id) do nothing;

    execute $p$create policy "members read avatars" on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and public.is_active_member())$p$;
    execute $p$create policy "own avatar upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = public.current_member_id()::text or public.is_founder()))$p$;
    execute $p$create policy "own avatar update" on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = public.current_member_id()::text or public.is_founder()))$p$;

    execute $p$create policy "records by role" on storage.objects for select to authenticated
      using (bucket_id = 'records' and (public.is_staff() or ((storage.foldername(name))[1] = 'work'
             and public.can_access_deliverable(public.try_uuid((storage.foldername(name))[2])))))$p$;
    execute $p$create policy "records upload by role" on storage.objects for insert to authenticated
      with check (bucket_id = 'records' and (public.is_staff() or ((storage.foldername(name))[1] = 'work'
             and public.can_access_deliverable(public.try_uuid((storage.foldername(name))[2])))))$p$;

    execute $p$create policy "staff imports" on storage.objects for all to authenticated
      using (bucket_id = 'imports' and public.is_staff()) with check (bucket_id = 'imports' and public.is_staff())$p$;
    execute $p$create policy "founders read backups" on storage.objects for select to authenticated
      using (bucket_id = 'backups' and public.is_founder())$p$;
  end if;
end $$;

-- Safety net: fail the migration if any table breaks the rules.
do $$
declare v text;
begin
  select string_agg(table_name || ' (' || problem || ')', ', ') into v from public.schema_rule_violations();
  if v is not null then raise exception 'Schema rule violations: %', v; end if;
end $$;
