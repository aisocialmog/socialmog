-- Social Mog OS — feature 13: settings, security, backups, trash, health check.

-- ─────────────────────────────────────────────────────────────
-- 1. Settings
-- ─────────────────────────────────────────────────────────────
alter table public.org_settings
  add column invoice_number_digits smallint not null default 3 check (invoice_number_digits between 3 and 6),   -- SM/26-27/001
  add column require_founder_mfa   boolean  not null default true;
alter table public.user_preferences drop constraint user_preferences_theme_check;
update public.user_preferences set theme = 'auto' where theme = 'system';
alter table public.user_preferences
  add constraint user_preferences_theme_check check (theme in ('dark','washi','auto')),   -- auto = follow the time of day
  add column fuji_header boolean not null default true;
create policy own_select on public.user_preferences for select to authenticated using (team_member_id = public.current_member_id());
create policy own_insert on public.user_preferences for insert to authenticated with check (team_member_id = public.current_member_id());
create policy own_update on public.user_preferences for update to authenticated using (team_member_id = public.current_member_id()) with check (team_member_id = public.current_member_id());

-- invoice numbers use the chosen number of digits (never cut a long number short)
do $$ declare d text := pg_get_functiondef('public.invoice_prepare()'::regprocedure);
  old text := 'case when v_n < 1000 then lpad(v_n::text, 3, ''0'') else v_n::text end';
begin
  if position(old in d) = 0 then raise exception 'invoice_prepare() changed: update the numbering patch'; end if;
  execute replace(d, old, 'case when length(v_n::text) < coalesce((select invoice_number_digits from org_settings limit 1), 3) then lpad(v_n::text, coalesce((select invoice_number_digits from org_settings limit 1), 3), ''0'') else v_n::text end');
end $$;

-- Editable lists. Lead sources are new; stages, campaign types and deliverable
-- formats keep their fixed keys (reports and automations depend on them) but their names can be changed.
create table public.list_items (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  is_archived boolean not null default false,
  archived_at timestamptz,
  kind        text not null check (kind in ('lead_source')),
  name        text not null check (btrim(name) <> ''),
  unique (kind, name)
);
create table public.list_labels (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  kind        text not null check (kind in ('stage','campaign_kind','format')),
  key         text not null,
  label       text not null check (btrim(label) <> ''),
  unique (kind, key)
);
select public.enable_standard_table('public.list_items'), public.enable_standard_table('public.list_labels');
create policy member_select on public.list_items for select to authenticated using (public.is_active_member());
create policy staff_insert on public.list_items for insert to authenticated with check (public.is_staff());
create policy staff_update on public.list_items for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy member_select on public.list_labels for select to authenticated using (public.is_active_member());
create policy staff_insert on public.list_labels for insert to authenticated with check (public.is_staff());
create policy staff_update on public.list_labels for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_delete on public.list_labels for delete to authenticated using (public.is_staff());   -- "back to the default name"
insert into public.list_items (kind, name) values ('lead_source','Referral'), ('lead_source','Inbound'), ('lead_source','Outreach'), ('lead_source','Instagram'), ('lead_source','LinkedIn'), ('lead_source','Event');

-- ─────────────────────────────────────────────────────────────
-- 2. Security: two-factor for founders, and "re-enter your password"
-- ─────────────────────────────────────────────────────────────
create or replace function public.jwt_claims()
returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;

-- A founder who hasn't passed the authenticator-app check (aal2) is treated as a team member by the database,
-- so nothing privileged is readable until they do. No JWT at all (local tests, server jobs) is not checked.
create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select case when t.role = 'founder' and coalesce((select require_founder_mfa from org_settings limit 1), true)
                   and (public.jwt_claims() ? 'aal') and public.jwt_claims()->>'aal' <> 'aal2'   -- every Supabase login token carries aal
              then 'team_member' else t.role end
  from public.team_members t where t.user_id = auth.uid() and t.status = 'active' and not t.is_archived
$$;

-- True when this login used the password in the last few minutes (Google-only founders must set a password first).
create or replace function public.recent_password(p_seconds int default 600)
returns boolean language plpgsql stable as $$
declare v_claims jsonb := public.jwt_claims(); v_at bigint;
begin
  if v_claims is null or v_claims->>'role' = 'service_role' then return true; end if;   -- not a person's login: nothing to re-check
  select max((a->>'timestamp')::bigint) into v_at
  from jsonb_array_elements(case when jsonb_typeof(v_claims->'amr') = 'array' then v_claims->'amr' else '[]'::jsonb end) a where a->>'method' = 'password';
  return v_at is not null and extract(epoch from now()) - v_at <= p_seconds;
end $$;
create or replace function public.assert_recent_password()
returns void language plpgsql stable as $$
begin
  if not public.recent_password() then raise exception 'Re-enter your password to continue' using errcode = 'P0R01'; end if;
end $$;
-- the app asks this before it shows a password prompt
create or replace function public.password_is_recent() returns boolean language sql stable as $$ select public.recent_password() $$;

-- creator bank and UPI details: founders, and only right after re-entering the password
drop policy founder_select on public.creator_payment_details;
create policy founder_select on public.creator_payment_details for select to authenticated using (public.is_founder() and public.recent_password());

-- API keys: creating or rotating one needs the password too
do $$ declare d text; f text;
begin
  foreach f in array array['public.ops_key_create(text)', 'public.ops_key_rotate(uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('if not is_founder() then' in d) > 0 then
      execute replace(d, 'if not is_founder() then', 'perform assert_recent_password(); if not is_founder() then');
    else   -- rotate: the check sits in ops_key_create, which it calls
      null;
    end if;
  end loop;
end $$;

-- editing a closed month: a founder, with a reason, and a fresh password
create or replace function public.books_lock_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lock date := (select books_locked_through from org_settings limit 1); v_date date := (to_jsonb(old)->>tg_argv[0])::date;
begin
  if v_lock is null or v_date is null or v_date > v_lock or is_system() or coalesce(current_setting('app.money_workflow', true), '') = 'on' or auth.uid() is null then return new; end if;
  if not is_founder() then raise exception 'The books are closed through %. Only a founder can change this record.', to_char(v_lock, 'DD Mon YYYY'); end if;
  if coalesce(nullif(btrim(to_jsonb(new)->>'change_reason'), ''), nullif(current_setting('app.change_reason', true), '')) is null then
    raise exception 'The books are closed through %. Give a reason to change this record.', to_char(v_lock, 'DD Mon YYYY');
  end if;
  perform assert_recent_password();
  return new;
end $$;

-- every table, its security switches and policies — and what is wrong with it
create or replace function public.security_report()
returns table (table_name text, rls_enabled boolean, policies int, open_policies int, anon_policies int, issue text)
language sql stable security definer set search_path = public as $$
  select c.relname::text, c.relrowsecurity,
    (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::int,
    (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.cmd in ('SELECT','ALL') and coalesce(btrim(p.qual), 'true') in ('true', '(true)'))::int,
    (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and (p.roles && array['anon'::name, 'public'::name]))::int,
    nullif(concat_ws('; ',
      case when not c.relrowsecurity then 'Row Level Security is OFF' end,
      case when not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) then 'no policies — nobody can use it' end,
      case when exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.cmd in ('SELECT','ALL') and coalesce(btrim(p.qual), 'true') in ('true', '(true)')) then 'a policy lets everyone read it' end,
      case when exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and (p.roles && array['anon'::name, 'public'::name])) then 'a policy applies to signed-out visitors' end), '')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and (is_founder() or is_system() or auth.uid() is null)
  order by 6 nulls last, 1
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. Trash: archived records can come back for 30 days
-- ─────────────────────────────────────────────────────────────
create or replace function public.trash_sources()
returns table (tbl text, noun text, label_expr text, money boolean) language sql immutable as $$
  select * from (values
    ('brands','Brand','name',false), ('creators','Creator','name',false), ('campaigns','Campaign','name',false),
    ('deliverables','Production item','title',false), ('tasks','Task','title',false), ('files','File','file_name',false),
    ('vendors','Vendor','name',false), ('retainers','Retainer','title',false), ('tags','Tag','name',false),
    ('kaizen_entries','Kaizen entry','problem',false), ('task_templates','Task template','title',false),
    ('invoices','Invoice','coalesce(invoice_number, ''Draft invoice'')',true), ('expenses','Expense','description',true),
    ('creator_payouts','Payout','coalesce(description, ''Payout'')',true), ('money_accounts','Account','name',true),
    ('recurring_expenses','Recurring expense','description',true)) t(tbl, noun, label_expr, money)
$$;

create or replace function public.trash_list()
returns table (table_name text, record_id uuid, noun text, label text, archived_at timestamptz, days_left int)
language plpgsql stable security invoker set search_path = public as $$
declare s record;
begin
  if not is_staff() then raise exception 'Trash is for founders and managers'; end if;
  for s in select * from trash_sources() loop
    return query execute format(
      'select %L::text, id, %L::text, (%s)::text, archived_at, greatest(30 - extract(day from now() - archived_at)::int, 0) from public.%I where is_archived and archived_at > now() - interval ''30 days'' order by archived_at desc limit 200',
      s.tbl, s.noun, s.label_expr, s.tbl);
  end loop;
end $$;

create or replace function public.trash_restore(p_table text, p_id uuid, p_reason text default null)
returns void language plpgsql security invoker set search_path = public as $$
declare s record; v_at timestamptz; v_has_reason boolean;
begin
  if not is_staff() then raise exception 'Only founders and managers can restore records'; end if;
  select * into s from trash_sources() where tbl = p_table;
  if s.tbl is null then raise exception 'That kind of record can’t be restored from here'; end if;
  execute format('select archived_at from public.%I where id = $1 and is_archived', p_table) into v_at using p_id;
  if v_at is null then raise exception 'That record isn’t in the trash'; end if;
  if v_at < now() - interval '30 days' then raise exception 'It was archived more than 30 days ago. Ask a founder to bring it back from a backup.'; end if;
  if s.money and length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a short reason — money records keep a history'; end if;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = 'change_reason') into v_has_reason;
  execute format('update public.%I set is_archived = false%s where id = $1', p_table, case when v_has_reason and s.money then format(', change_reason = %L', btrim(p_reason)) else '' end) using p_id;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 4. Health check: totals against the records behind them
-- ─────────────────────────────────────────────────────────────
create or replace function public.health_check()
returns table (area text, check_name text, expected numeric, actual numeric, ok boolean, detail text)
language plpgsql stable security invoker set search_path = public as $$
declare v_exp numeric; v_act numeric; v_from date := ist_today() - 3650; v_to date := ist_today();
  v_ob record;
begin
  if not is_staff() then raise exception 'The health check is for founders and managers'; end if;

  select coalesce(sum(i.quantity * i.rate), 0) into v_exp from invoice_items i join invoices v on v.id = i.invoice_id where v.status = 'sent' and not v.is_archived and not i.is_archived;
  select coalesce(sum(subtotal), 0) into v_act from invoice_totals where document_status = 'sent';
  return query select 'Invoices', 'Invoice subtotals = the lines on sent invoices', v_exp, v_act, abs(v_exp - v_act) < 0.01, 'Sum of quantity × rate on every sent invoice';

  select coalesce(sum(a.amount), 0) into v_exp from receipt_allocations a join receipts r on r.id = a.receipt_id join invoices v on v.id = a.invoice_id
   where not a.is_archived and not r.is_archived and v.status = 'sent' and not v.is_archived;
  select coalesce(sum(paid), 0) into v_act from invoice_totals where document_status = 'sent';
  return query select 'Invoices', 'Paid on invoices = payments applied to them', v_exp, v_act, abs(v_exp - v_act) < 0.01, 'Every rupee applied to an invoice comes from a payment';

  select coalesce(sum(outstanding), 0) into v_exp from invoice_totals where document_status = 'sent';
  select coalesce(max(outstanding), 0) into v_act from money_overview(v_from, v_to);
  return query select 'Money', 'Receivables on the overview = unpaid invoices', v_exp, v_act, abs(v_exp - v_act) < 0.01, 'Owed to us today';

  select coalesce(sum(subtotal), 0) into v_exp from invoice_totals where document_status = 'sent' and not is_opening;
  select coalesce(sum(amount), 0) into v_act from pnl_lines where basis = 'invoice' and line = 'revenue';
  return query select 'Money', 'Revenue on the P&L = invoiced amounts (before GST)', v_exp, v_act, abs(v_exp - v_act) < 0.01, 'Opening-balance invoices are not revenue';

  select coalesce(sum(amount * direction), 0) into v_exp from money_ledger;
  select coalesce(sum(balance), 0) into v_act from account_balances();
  return query select 'Money', 'Account balances = opening balances + every movement', v_exp, v_act, abs(v_exp - v_act) < 0.01, 'Receipts, expenses, capital and transfers';

  select coalesce(sum(net_payable), 0) into v_exp from payout_list where not is_archived and status in ('pending','approved');
  select coalesce(max(payouts_pending), 0) into v_act from money_overview(v_from, v_to);
  return query select 'Money', 'Payouts pending = unpaid payouts', v_exp, v_act, abs(v_exp - v_act) < 0.01, 'Net of TDS and GST';

  select count(*) into v_exp from creator_payouts where not is_archived and status = 'paid';
  select count(*) into v_act from expenses where not is_archived and payout_id is not null;
  return query select 'Money', 'Every paid payout has its expense', v_exp, v_act, v_exp = v_act, 'Paying a payout creates the expense';

  select count(*) into v_act from payment_list where not is_archived and unapplied < 0;
  return query select 'Money', 'No payment applied for more than it was', 0::numeric, v_act, v_act = 0, 'Applied amount against received + TDS';

  select count(*) into v_act from invoices where status = 'sent' and not is_archived and invoice_number is null;
  return query select 'Invoices', 'Every sent invoice has a number', 0::numeric, v_act, v_act = 0, '';

  if is_founder() then
    select coalesce(sum(signed_amount), 0) into v_exp from capital_list where not is_archived;
    select coalesce(sum(balance), 0) into v_act from capital_accounts();
    return query select 'Capital', 'Per-founder capital adds up to the capital entries', v_exp, v_act, abs(v_exp - v_act) < 0.01, 'Profit shares must add up to 100%';
    if (select opening_locked_at from org_settings limit 1) is not null then
      select * into v_ob from balance_check();
      return query select 'Capital', 'The books balance', 0::numeric, v_ob.difference, v_ob.is_balanced, 'Capital + profit = accounts + owed to us − we owe';
    end if;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 5. Backups
-- ─────────────────────────────────────────────────────────────
create or replace function public.backup_tables()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
$$;
revoke execute on function public.backup_tables() from public, anon, authenticated;
do $$ begin grant execute on function public.backup_tables() to service_role; exception when undefined_object then null; end $$;

create or replace function public.automation_nightly_backup() returns text language plpgsql security definer set search_path = public as $$
begin perform call_edge('admin', '{"action":"nightly"}'); return 'Backup requested — see Settings → Data for the result'; end $$;
create or replace function public.automation_weekly_backup_email() returns text language plpgsql security definer set search_path = public as $$
begin perform call_edge('admin', '{"action":"weekly_email"}'); return 'Weekly backup link requested for both founders'; end $$;
revoke execute on function public.automation_nightly_backup(), public.automation_weekly_backup_email() from public, anon, authenticated;

insert into public.automations (key, name, description, schedule, schedule_label) values
  ('nightly_backup',      'Nightly backup',        'Exports every table (CSV and JSON) into a private storage bucket and keeps the last 30 days.', '30 20 * * *', 'Daily 2:00 am'),
  ('weekly_backup_email', 'Weekly backup link',    'Emails both founders a link to the latest backup (valid 7 days).', '30 3 * * 0', 'Sundays 9:00 am');
do $$ declare a record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  for a in select key, schedule from public.automations where key in ('nightly_backup','weekly_backup_email') loop
    perform cron.schedule('smog-' || a.key, a.schedule, format('select public.run_automation(%L, false)', a.key));
  end loop;
exception when others then raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;
