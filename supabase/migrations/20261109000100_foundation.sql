-- Social Mog OS — 0001 foundation
-- Shared helpers, people, settings, the activity log and import bookkeeping.
-- Conventions used by every table in this schema:
--   id uuid PK · created_at · updated_at · created_by (profiles.id)
--   is_archived + archived_at instead of hard deletes (business records)
--   status/stage values are text + CHECK constraints (easy to extend later)
--   money is numeric(14,2) in INR; totals are computed in views, never stored.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- People
-- ─────────────────────────────────────────────────────────────
-- One row per login. Created automatically when someone signs up (trigger below).
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  full_name     text not null default '',
  display_name  text,
  email         text not null,
  phone         text,
  avatar_path   text,                         -- storage path in the "avatars" bucket
  role          text not null default 'member'
                check (role in ('founder','admin','manager','member','freelancer','viewer')),
  is_active     boolean not null default true,
  title         text,                         -- e.g. "Co-founder", "Video editor"
  joined_on     date
);

-- ─────────────────────────────────────────────────────────────
-- Access helpers (used by every RLS policy)
-- ─────────────────────────────────────────────────────────────
create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles
  where id = auth.uid() and is_active and not is_archived
$$;

-- Team member = active login with an internal role. Freelancers and viewers get
-- their own narrower policies in a later feature (roles & permissions).
create or replace function public.is_team_member()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('founder','admin','manager','member'), false)
$$;

create or replace function public.has_role(variadic roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = any(roles), false)
$$;

-- ─────────────────────────────────────────────────────────────
-- Audit-field trigger: fills created_by / updated_at / archived_at
-- and stops anyone rewriting who created a record or when.
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_audit_fields()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := new.created_at;
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
  end if;

  -- archived_at follows the archived flag
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
  created_by     uuid references public.profiles(id),      -- who did it (null = system)
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

create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_action text;
  v_fields text[] := '{}'; v_o jsonb := '{}'; v_n jsonb := '{}';
  k text;
  v_source text := coalesce(nullif(current_setting('app.activity_source', true), ''), 'app');
  v_actor uuid := auth.uid();
begin
  if v_actor is not null and not exists (select 1 from profiles where id = v_actor) then
    v_actor := null;
  end if;

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
-- Settings
-- ─────────────────────────────────────────────────────────────
-- Exactly one row: the agency itself.
create table public.org_settings (
  id                         uuid primary key default gen_random_uuid(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  created_by                 uuid references public.profiles(id),
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
  created_by        uuid references public.profiles(id),
  user_id           uuid not null unique references public.profiles(id),
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
  created_by  uuid references public.profiles(id),
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
  created_by    uuid references public.profiles(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  source_name   text not null,                -- e.g. "Old Google Sheet", "Previous app export"
  target_table  text not null,
  file_path     text,                         -- storage path of the uploaded file
  status        text not null default 'uploaded'
                check (status in ('uploaded','previewed','committed','failed','rolled_back')),
  rows_total    int not null default 0,
  rows_valid    int not null default 0,
  rows_invalid  int not null default 0,
  committed_at  timestamptz,
  notes         text
);

-- Staging rows: the raw spreadsheet row is kept as-is (jsonb is right here —
-- it is untyped input, not business data) until it is validated and committed.
create table public.import_rows (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  batch_id      uuid not null references public.import_batches(id),
  row_number    int not null,
  raw           jsonb not null,
  status        text not null default 'pending' check (status in ('pending','valid','invalid','committed','skipped')),
  error         text,
  target_id     uuid,                         -- id of the record created from this row
  unique (batch_id, row_number)
);

-- ─────────────────────────────────────────────────────────────
-- New signup → profile row. The very first user becomes an active founder;
-- everyone after that starts INACTIVE (no access) until a founder turns them on.
-- (Also turn off open sign-ups in Supabase Auth settings — invite only.)
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_first boolean;
begin
  lock table public.profiles in share row exclusive mode;
  v_first := not exists (select 1 from public.profiles);
  insert into public.profiles (id, email, full_name, role, is_active, created_by)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when v_first then 'founder' else 'member' end,
    v_first,
    new.id
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
