-- Social Mog OS — 0001 foundation
-- Team & roles, access helpers, the activity log, and the reusable
-- enable_standard_table() that every table (now and later) goes through.
--
-- Conventions used by every table in this schema:
--   id uuid PK · created_at · updated_at · created_by (team_members.id)
--   is_archived + archived_at instead of hard deletes (business records)
--   status/stage values are text + CHECK constraints (easy to extend later)
--   money is numeric(14,2) in INR; totals are computed in views, never stored.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Team members (feature 1)
-- A row exists BEFORE the person can log in: a founder invites by email,
-- which creates this row; when the login is created (invite accepted, or
-- Google sign-in for that email) it is linked through user_id.
-- No row = no access, even if someone somehow gets a login.
-- ─────────────────────────────────────────────────────────────
create table public.team_members (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.team_members(id),
  is_archived        boolean not null default false,
  archived_at        timestamptz,
  user_id            uuid unique references auth.users(id) on delete set null,  -- the Supabase login
  name               text not null,
  email              text not null,
  phone              text,
  photo_path         text,                    -- storage path in the "avatars" bucket
  role               text not null default 'team_member'
                     check (role in ('founder','manager','team_member','freelancer')),
  status             text not null default 'active' check (status in ('active','inactive')),
  joined_date        date not null default ((now() at time zone 'Asia/Kolkata')::date),
  monthly_cost       numeric(14,2) check (monthly_cost >= 0),   -- salary, if salaried (founders & managers only see this)
  title              text,                    -- "Co-founder", "Video editor"
  invited_at         timestamptz,
  first_signed_in_at timestamptz
);
create unique index team_members_email_key on public.team_members (lower(email));

-- ─────────────────────────────────────────────────────────────
-- Access helpers. SECURITY DEFINER so they can read team_members
-- without tripping over its own RLS. Used by every policy.
-- ─────────────────────────────────────────────────────────────
create or replace function public.current_member_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.team_members
  where user_id = auth.uid() and status = 'active' and not is_archived
$$;

-- founder | manager | team_member | freelancer | null (no access)
create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.team_members
  where user_id = auth.uid() and status = 'active' and not is_archived
$$;

create or replace function public.has_role(variadic roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = any(roles), false)
$$;

-- any active team member, whatever the role
create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_app_role() is not null
$$;

-- founders + managers: the whole business (managers minus capital)
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('founder','manager')
$$;

create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('founder')
$$;

-- ─────────────────────────────────────────────────────────────
-- Audit fields: created_by / updated_at / archived_at, and nobody can
-- rewrite who created a record or when.
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_audit_fields()
returns trigger language plpgsql as $$
declare v_me uuid := public.current_member_id();
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := new.created_at;
    if v_me is not null then new.created_by := v_me; end if;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
  end if;

  if (to_jsonb(new) ? 'is_archived') then
    if (to_jsonb(new)->>'is_archived')::boolean
       and (tg_op = 'INSERT' or not (to_jsonb(old)->>'is_archived')::boolean) then
      new := jsonb_populate_record(new, jsonb_build_object('archived_at', now()));
    elsif not (to_jsonb(new)->>'is_archived')::boolean then
      new := jsonb_populate_record(new, jsonb_build_object('archived_at', null));
    end if;
  end if;
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Activity log — every create / edit / status change / archive / delete
-- ─────────────────────────────────────────────────────────────
create table public.activity_log (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.team_members(id),    -- who did it (null = system)
  action         text not null
                 check (action in ('create','update','status_change','archive','restore','delete')),
  table_name     text not null,
  record_id      uuid not null,
  changed_fields text[] not null default '{}',
  old_values     jsonb,          -- only the fields that changed (full row on delete)
  new_values     jsonb,          -- only the fields that changed (full row on create)
  source         text not null default 'app'
                 check (source in ('app','import','api','automation','system'))
);
create index activity_log_record_idx on public.activity_log (table_name, record_id, created_at desc);
create index activity_log_actor_idx  on public.activity_log (created_by, created_at desc);
create index activity_log_time_idx   on public.activity_log (created_at desc);

-- Imports / the API / automations set this for their transaction:
--   select set_config('app.activity_source', 'import', true);
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
    values (v_actor, 'create', tg_table_name, (v_new->>'id')::uuid, v_new, v_source);
    return new;
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    insert into activity_log (created_by, action, table_name, record_id, old_values, source)
    values (v_actor, 'delete', tg_table_name, (v_old->>'id')::uuid, v_old, v_source);
    return old;
  end if;

  v_old := to_jsonb(old); v_new := to_jsonb(new);
  for k in select jsonb_object_keys(v_new) loop
    continue when k in ('updated_at','archived_at');
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
  values (v_actor, v_action, tg_table_name, (v_new->>'id')::uuid, v_fields, v_o, v_n, v_source);
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────
-- THE reusable hook for every table, now and in later features:
--   select public.enable_standard_table('public.my_new_table');
-- It checks the table has the standard columns, attaches the audit-field
-- trigger and the activity-log trigger, and turns RLS on (with no policies,
-- a new table is closed to everyone until its policies are written).
-- An event trigger (0006) also runs this automatically for any CREATE TABLE.
-- ─────────────────────────────────────────────────────────────
create or replace function public.enable_standard_table(tbl regclass, log_changes boolean default true)
returns void language plpgsql set search_path = public as $$
declare
  v_name text := (select relname from pg_class where oid = tbl);
  v_missing text;
begin
  select string_agg(c, ', ') into v_missing
  from unnest(array['id','created_at','updated_at','created_by']) c
  where not exists (select 1 from pg_attribute a where a.attrelid = tbl and a.attname = c and not a.attisdropped);
  if v_missing is not null then
    raise exception 'Table % is missing standard column(s): %', v_name, v_missing;
  end if;

  if exists (select 1 from pg_trigger where tgrelid = tbl and tgname = v_name || '_audit') then
    execute format('drop trigger %I on %s', v_name || '_audit', tbl);
  end if;
  execute format('create trigger %I before insert or update on %s for each row execute function public.set_audit_fields()',
                 v_name || '_audit', tbl);
  if exists (select 1 from pg_trigger where tgrelid = tbl and tgname = v_name || '_activity') then
    execute format('drop trigger %I on %s', v_name || '_activity', tbl);
  end if;
  if log_changes then
    execute format('create trigger %I after insert or update or delete on %s for each row execute function public.log_activity()',
                   v_name || '_activity', tbl);
  end if;
  execute format('alter table %s enable row level security', tbl);
end $$;

-- Reports any public table that breaks the rules (used by tests and Settings → Security).
create or replace function public.schema_rule_violations()
returns table (table_name text, problem text) language sql stable as $$
  select c.relname::text, 'RLS is off'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  union all
  select c.relname::text, 'no audit trigger'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'activity_log'
    and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = c.relname || '_audit')
  union all
  select c.relname::text, 'RLS on but no policies (nobody can use it)'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
$$;

-- ─────────────────────────────────────────────────────────────
-- Settings
-- ─────────────────────────────────────────────────────────────
create table public.org_settings (
  id                         uuid primary key default gen_random_uuid(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  created_by                 uuid references public.team_members(id),
  singleton                  boolean not null default true unique check (singleton),
  company_name               text not null default 'Social Mog',
  legal_name                 text,
  gstin                      text,
  pan                        text,
  state_code                 text,           -- GST state code, decides CGST+SGST vs IGST
  address                    text,
  email                      text,
  phone                      text,
  logo_path                  text,
  invoice_prefix             text not null default 'SM',
  default_gst_rate           numeric(5,2) not null default 18,
  default_payment_terms_days int not null default 30,
  default_creator_tds_rate   numeric(5,2) not null default 10,
  timezone                   text not null default 'Asia/Kolkata',
  currency                   text not null default 'INR',
  seasonal_effects_default   boolean not null default true
);

create table public.user_preferences (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.team_members(id),
  team_member_id    uuid not null unique references public.team_members(id),
  theme             text not null default 'dark' check (theme in ('dark','washi','system')),
  seasonal_effects  boolean not null default true,
  reduce_motion     boolean not null default false,
  default_period    text not null default 'this_month',
  sidebar_collapsed boolean not null default false
);

-- Numbering for invoices etc., per financial year ("SM/2026-27/0042").
create table public.document_sequences (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  doc_type    text not null check (doc_type in ('invoice','proforma','credit_note','payout_voucher')),
  fy_label    text not null,                  -- '2026-27'
  next_value  int not null default 1,
  unique (doc_type, fy_label)
);

-- ─────────────────────────────────────────────────────────────
-- Imports (feature 7) — defined early so business tables can point at a batch
-- ─────────────────────────────────────────────────────────────
create table public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.team_members(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  source_name   text not null,
  target_table  text not null,
  file_path     text,
  status        text not null default 'uploaded'
                check (status in ('uploaded','previewed','committed','failed','rolled_back')),
  rows_total    int not null default 0,
  rows_valid    int not null default 0,
  rows_invalid  int not null default 0,
  committed_at  timestamptz,
  notes         text
);

-- Staging rows: the raw spreadsheet row is kept as-is (jsonb is right here —
-- it is untyped input, not business data) until validated and committed.
create table public.import_rows (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.team_members(id),
  batch_id      uuid not null references public.import_batches(id),
  row_number    int not null,
  raw           jsonb not null,
  status        text not null default 'pending' check (status in ('pending','valid','invalid','committed','skipped')),
  error         text,
  target_id     uuid,
  unique (batch_id, row_number)
);

-- ─────────────────────────────────────────────────────────────
-- Linking logins to team members (invite-only)
-- ─────────────────────────────────────────────────────────────
-- A login is created (founder's invite, Supabase dashboard invite, or Google
-- for an invited email) → attach it to the team member with that email.
-- An email nobody invited gets a login with NO team member → no access.
create or replace function public.link_login_to_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.team_members
     set user_id = new.id,
         invited_at = coalesce(invited_at, now())
   where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_login_to_member();

-- Remember the first real sign-in (shows "Invited" vs "Joined" in Settings → Team).
create or replace function public.note_first_sign_in()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.last_sign_in_at is not null and old.last_sign_in_at is distinct from new.last_sign_in_at then
    update public.team_members set first_signed_in_at = new.last_sign_in_at
     where user_id = new.id and first_signed_in_at is null;
  end if;
  return new;
end $$;

create trigger on_auth_user_signed_in
  after update of last_sign_in_at on auth.users
  for each row execute function public.note_first_sign_in();
