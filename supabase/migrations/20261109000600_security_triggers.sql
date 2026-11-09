-- Social Mog OS — 0006 Row Level Security, audit triggers, activity logging,
-- storage buckets. Applied to EVERY table in one place so nothing is missed.
-- A check at the end fails the migration if any public table lacks RLS.

-- ─────────────────────────────────────────────────────────────
-- 1. Audit-field + activity triggers
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
  -- high-volume/system tables that are not "business records" and are not activity-logged
  no_log text[] := array['activity_log','api_request_log','notifications','import_rows',
                         'ai_requests','user_preferences','reminders'];
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'activity_log'
  loop
    execute format('create trigger %I before insert or update on public.%I
                    for each row execute function public.set_audit_fields()', t || '_audit', t);
    if not (t = any(no_log)) then
      execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function public.log_activity()', t || '_activity', t);
    end if;
  end loop;
end $$;

-- Nobody can promote themselves or switch themselves back on.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.has_role('founder','admin') then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.is_archived is distinct from old.is_archived
       or new.email is distinct from old.email then
      raise exception 'Only a founder or admin can change role, access or email';
    end if;
  end if;
  -- an admin cannot create or demote founders
  if auth.uid() is not null and public.has_role('admin')
     and (new.role = 'founder') is distinct from (old.role = 'founder') then
    raise exception 'Only a founder can grant or remove the founder role';
  end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ─────────────────────────────────────────────────────────────
-- 2. Row Level Security
--    No DELETE policy on business tables → hard delete is impossible for
--    logged-in users; the app archives instead (is_archived = true).
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
  -- team members read & write, never delete
  business text[] := array[
    'brands','brand_contacts','retainers','retainer_scope_items','tags',
    'creators','creator_platforms','creator_metric_snapshots','creator_rate_cards','vendors',
    'campaigns','campaign_creators','deliverables','scripts','deliverable_reviews','deliverable_metrics',
    'shoots','calendar_events',
    'money_accounts','invoices','invoice_items','receipts','receipt_allocations',
    'expense_categories','expenses','creator_payouts','creator_payout_items','account_transfers','targets',
    'tasks','comments','files','automation_rules','reminders','ai_prompt_templates','ai_requests',
    'import_batches','import_rows','document_sequences'];
  -- pure link rows: team members may also remove a link (still activity-logged)
  links text[] := array['brand_tags','creator_tags','shoot_deliverables','shoot_crew'];
  -- founders & admins only
  restricted text[] := array['creator_payment_details','capital_entries','api_clients',
                             'webhook_subscriptions','backups'];
begin
  foreach t in array business || links || restricted || array[
      'profiles','org_settings','user_preferences','notifications','activity_log',
      'api_request_log','saved_views'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;

  foreach t in array business || links loop
    execute format('create policy team_select on public.%I for select to authenticated using (public.is_team_member())', t);
    execute format('create policy team_insert on public.%I for insert to authenticated with check (public.is_team_member())', t);
    execute format('create policy team_update on public.%I for update to authenticated using (public.is_team_member()) with check (public.is_team_member())', t);
  end loop;
  foreach t in array links loop
    execute format('create policy team_delete on public.%I for delete to authenticated using (public.is_team_member())', t);
  end loop;

  foreach t in array restricted loop
    execute format('create policy founders_select on public.%I for select to authenticated using (public.has_role(''founder'',''admin''))', t);
    execute format('create policy founders_insert on public.%I for insert to authenticated with check (public.has_role(''founder'',''admin''))', t);
    execute format('create policy founders_update on public.%I for update to authenticated using (public.has_role(''founder'',''admin'')) with check (public.has_role(''founder'',''admin''))', t);
  end loop;
end $$;

-- profiles: the team sees the team; you edit yourself; founders/admins edit anyone.
create policy team_select on public.profiles for select to authenticated
  using (public.is_team_member() or id = auth.uid());
create policy self_or_admin_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_role('founder','admin'))
  with check (id = auth.uid() or public.has_role('founder','admin'));

-- org settings: everyone on the team reads, founders/admins change.
create policy team_select on public.org_settings for select to authenticated using (public.is_team_member());
create policy founders_update on public.org_settings for update to authenticated
  using (public.has_role('founder','admin')) with check (public.has_role('founder','admin'));

-- your own preferences only
create policy own_all on public.user_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notifications: you read/mark your own; teammates can notify you (mentions)
create policy own_select on public.notifications for select to authenticated using (recipient_id = auth.uid());
create policy own_update on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy team_insert on public.notifications for insert to authenticated with check (public.is_team_member());

-- activity log: read-only for the team. Rows are written only by the trigger.
create policy team_select on public.activity_log for select to authenticated using (public.is_team_member());

-- API request log: founders/admins read; written by the API edge function (service role).
create policy founders_select on public.api_request_log for select to authenticated using (public.has_role('founder','admin'));

-- saved views: your own, plus ones shared with the team
create policy view_select on public.saved_views for select to authenticated
  using (public.is_team_member() and (created_by = auth.uid() or is_shared));
create policy view_insert on public.saved_views for insert to authenticated with check (public.is_team_member());
create policy view_update on public.saved_views for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

-- Safety net: fail the migration if any public table is missing RLS.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if missing is not null then
    raise exception 'RLS is not enabled on: %', missing;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 3. Storage buckets (private) — Supabase only
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values
      ('records', 'records', false),   -- contracts, bills, edits, invoice PDFs
      ('avatars', 'avatars', false),
      ('imports', 'imports', false),
      ('backups', 'backups', false)
    on conflict (id) do nothing;

    execute $p$create policy "team reads records" on storage.objects for select to authenticated
      using (bucket_id in ('records','avatars','imports') and public.is_team_member())$p$;
    execute $p$create policy "team uploads records" on storage.objects for insert to authenticated
      with check (bucket_id in ('records','avatars','imports') and public.is_team_member())$p$;
    execute $p$create policy "team updates records" on storage.objects for update to authenticated
      using (bucket_id in ('records','avatars','imports') and public.is_team_member())$p$;
    execute $p$create policy "founders read backups" on storage.objects for select to authenticated
      using (bucket_id = 'backups' and public.has_role('founder','admin'))$p$;
  end if;
end $$;
