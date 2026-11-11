-- Social Mog OS — feature 11: Automations. The database keeps itself up to date
-- with scheduled jobs (pg_cron) and triggers. Jidoka: when data looks wrong an
-- automation stops and lights an andon instead of carrying on.
-- Nothing here ever sends a message to a client or creator: those are drafts.

-- the unused first-draft tables are replaced by the registry below
alter table public.notifications drop column rule_id;
drop table public.reminders;
drop table public.automation_rules;

create table public.automations (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.team_members(id),
  key            text not null unique check (key ~ '^[a-z_]+$'),
  name           text not null,
  description    text not null,
  schedule       text,                 -- cron (UTC); null = runs the moment something happens
  schedule_label text not null,        -- the same, in words (IST)
  is_enabled     boolean not null default true,
  last_run_at    timestamptz,
  last_result    text,
  last_error     text
);
create table public.automation_runs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.team_members(id),
  automation_key text not null references public.automations(key),
  finished_at    timestamptz,
  result         text,
  error          text,
  was_manual     boolean not null default false
);
create index automation_runs_key_idx on public.automation_runs (automation_key, created_at desc);
create table public.task_templates (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.team_members(id),
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  title        text not null,
  anchor       text not null default 'start' check (anchor in ('start','end')),   -- which campaign date the due date counts from
  offset_days  int not null default 0,                                            -- negative = before
  is_active    boolean not null default true
);
select public.enable_standard_table('public.automations'), public.enable_standard_table('public.automation_runs', false), public.enable_standard_table('public.task_templates');
create policy staff_select on public.automations for select to authenticated using (public.is_staff());
create policy founder_update on public.automations for update to authenticated using (public.is_founder()) with check (public.is_founder());
create policy staff_select on public.automation_runs for select to authenticated using (public.is_staff());
create policy staff_select on public.task_templates for select to authenticated using (public.is_staff());
create policy staff_insert on public.task_templates for insert to authenticated with check (public.is_staff());
create policy staff_update on public.task_templates for update to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.task_templates (title, anchor, offset_days) values
  ('Share brief with creators', 'start', 0), ('Collect drafts', 'start', 7), ('Send report', 'end', 3);

alter table public.brands add column maybe_inactive_since date;   -- the "Inactive?" flag

create or replace function public.automation_on(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_enabled from automations where key = p_key), false)
$$;

-- ─────────────────────────────────────────────────────────────
-- 1. Automatic status updates
-- ─────────────────────────────────────────────────────────────
-- An invoice reads Overdue from the day after its due date by itself (invoice_totals).
-- This tells us on day 1, 7 and 15, and drafts a reminder for a person to approve.
create or replace function public.automation_invoice_overdue()
returns text language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from invoice_totals where document_status = 'sent' and outstanding > 0 and days_overdue in (1, 7, 15) loop
    perform notify_staff('invoice_overdue', coalesce(r.invoice_number, 'Invoice') || ' is ' || r.days_overdue || ' day' || case when r.days_overdue = 1 then '' else 's' end || ' overdue',
                         r.brand_name || ' · ₹' || to_char(r.outstanding, 'FM99,99,99,990'), 'invoices', r.invoice_id, 'overdue:' || r.invoice_id || ':' || r.days_overdue);
    insert into message_drafts (kind, to_name, channel, body, brand_id, invoice_id, dedupe_key)
    values ('payment_reminder', r.brand_name, 'email',
      'Hi team,' || E'\n\n' || 'A gentle reminder that invoice ' || coalesce(r.invoice_number, '') || ' for ₹' || to_char(r.outstanding, 'FM99,99,99,990') || ' was due on ' || to_char(r.due_date, 'DD Mon YYYY')
      || '. Could you share an expected payment date? Happy to resend the invoice if useful.' || E'\n\n' || 'Thank you,' || E'\n' || 'Social Mog',
      r.brand_id, r.invoice_id, 'inv:' || r.invoice_id || ':' || r.days_overdue)
    on conflict (dedupe_key) do nothing;
    n := n + 1;
  end loop;
  return n || ' overdue notice' || case when n = 1 then '' else 's' end || ', each with a reminder draft to approve';
end $$;

-- Campaign → Live when its first deliverable is posted (straight away, by trigger).
create or replace function public.campaign_live_on_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'live' and old.stage <> 'live' and new.campaign_id is not null and automation_on('campaign_status') then
    update campaigns set status = 'live' where id = new.campaign_id and status in ('planning','creator_outreach','production','content_review') and not is_historical;
  end if;
  return new;
end $$;
create trigger deliverables_campaign_live after update of stage on public.deliverables for each row execute function public.campaign_live_on_post();

-- Campaign → Reporting when its end date passes; a nudge to complete it once every creator is paid.
create or replace function public.automation_campaign_status()
returns text language plpgsql security definer set search_path = public as $$
declare n int; m int := 0; r record;
begin
  update campaigns set status = 'reporting' where status = 'live' and end_date < ist_today() and not is_archived and not is_historical;
  get diagnostics n = row_count;
  for r in select c.id, c.name from campaigns c where c.status in ('live','reporting') and not c.is_archived and not c.is_historical
           and exists (select 1 from campaign_creators cc where cc.campaign_id = c.id and not cc.is_archived and cc.status <> 'dropped')
           and not exists (select 1 from campaign_creators cc where cc.campaign_id = c.id and not cc.is_archived and cc.status not in ('paid','dropped')) loop
    perform notify_staff('campaign_complete', 'All creators are paid — mark “' || r.name || '” completed?', null, 'campaigns', r.id, 'complete:' || r.id);
    m := m + 1;
  end loop;
  return n || ' moved to Reporting, ' || m || ' ready to complete';
end $$;

-- Creator in campaign → Paid when their payout is paid.
create or replace function public.creator_paid_on_payout()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status <> 'paid' and new.campaign_creator_id is not null and automation_on('creator_paid')
     and not exists (select 1 from creator_payouts p where p.campaign_creator_id = new.campaign_creator_id and p.id <> new.id and not p.is_archived and p.status in ('pending','approved')) then
    update campaign_creators set status = 'paid' where id = new.campaign_creator_id and status <> 'dropped';
  end if;
  return new;
end $$;
create trigger creator_payouts_mark_paid after update of status on public.creator_payouts for each row execute function public.creator_paid_on_payout();

-- Brand → "Inactive?" after 60 days with no campaign, production or invoice.
create or replace function public.automation_brand_inactive()
returns text language plpgsql security definer set search_path = public as $$
declare n int; c int; r record;
begin
  create temp table if not exists _quiet (id uuid, name text) on commit drop; truncate _quiet;
  insert into _quiet select b.id, b.name from brands b
  where b.status = 'active' and not b.is_archived and b.created_at < now() - interval '60 days'
    and not exists (select 1 from campaigns x where x.brand_id = b.id and not x.is_archived and not x.is_historical and greatest(x.created_at, x.updated_at) > now() - interval '60 days')
    and not exists (select 1 from deliverables x where x.brand_id = b.id and not x.is_archived and greatest(x.created_at, x.stage_changed_at) > now() - interval '60 days')
    and not exists (select 1 from invoices x where x.brand_id = b.id and not x.is_archived and coalesce(x.issue_date, x.created_at::date) > ist_today() - 60);
  update brands set maybe_inactive_since = null where maybe_inactive_since is not null and id not in (select id from _quiet);
  get diagnostics c = row_count;
  for r in select q.* from _quiet q join brands b on b.id = q.id where b.maybe_inactive_since is null loop
    perform notify_staff('brand_inactive', 'Inactive? ' || r.name, 'No campaign, production or invoice in 60 days.', 'brands', r.id, 'inactive:' || r.id || ':' || ist_today());
  end loop;
  update brands set maybe_inactive_since = ist_today() where maybe_inactive_since is null and id in (select id from _quiet);
  get diagnostics n = row_count;
  return n || ' flagged “Inactive?”, ' || c || ' cleared';
end $$;

-- ─────────────────────────────────────────────────────────────
-- 2. Auto-created records
-- ─────────────────────────────────────────────────────────────
create or replace function public.automation_retainer_invoices()
returns text language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; d date := ist_today(); v_id uuid;
begin
  if not jidoka_balance() then return 'Stopped: the money balance check doesn’t match'; end if;
  for r in select t.id, b.name from retainers t join brands b on b.id = t.brand_id
           where t.status = 'active' and not t.is_archived and not b.is_archived and coalesce(t.billing_day, 1) = extract(day from d)
             and t.start_date <= d and (t.end_date is null or t.end_date >= d)
             and not exists (select 1 from invoices i where i.retainer_id = t.id and i.service_period_start = date_trunc('month', d)::date and i.status <> 'cancelled' and not i.is_archived) loop
    v_id := create_retainer_invoice(r.id, d);
    perform notify_staff('retainer_invoice', 'Retainer invoice drafted for ' || r.name, 'Review it and send.', 'invoices', v_id, 'retainer:' || v_id, true);
    n := n + 1;
  end loop;
  return n || ' draft invoice' || case when n = 1 then '' else 's' end || ' created for a founder to review';
end $$;

create or replace function public.automation_recurring_expenses()
returns text language plpgsql security definer set search_path = public as $$
begin
  if not jidoka_balance() then return 'Stopped: the money balance check doesn’t match'; end if;
  return create_recurring_expenses() || ' expense(s) created';
end $$;

-- A payout record when the client approves a creator's deliverable, at the agreed fee.
create or replace function public.payout_on_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fee numeric; v_total numeric; v_tds numeric;
begin
  if not (new.approval_status = 'approved' and old.approval_status is distinct from 'approved' and new.creator_id is not null and automation_on('payout_on_approval')) then return new; end if;
  begin
    if exists (select 1 from creator_payouts p where p.deliverable_id = new.id and not p.is_archived and p.status <> 'cancelled') then return new; end if;
    select cost into v_fee from deliverable_performance where deliverable_id = new.id;
    if coalesce(v_fee, 0) <= 0 then
      perform notify_staff('payout_missing_fee', 'No payout created for “' || new.title || '”', 'It was approved but no fee is agreed with the creator.', 'deliverables', new.id, 'nofee:' || new.id);
      return new;
    end if;
    select agreed_fee into v_total from campaign_creator_fees where campaign_creator_id = new.campaign_creator_id;
    -- jidoka: an unusual fee or a thin margin stops here with an andon; a person decides
    if not jidoka_fee(new.creator_id, coalesce(v_total, v_fee), new.campaign_creator_id) then return new; end if;
    if new.campaign_id is not null and not jidoka_margin(new.campaign_id) then return new; end if;
    select coalesce(d.tds_rate, o.default_creator_tds_rate, 0) into v_tds from org_settings o left join creator_payment_details d on d.creator_id = new.creator_id limit 1;
    perform set_config('app.activity_source', 'automation', true);
    insert into creator_payouts (creator_id, campaign_creator_id, campaign_id, deliverable_id, amount, tds_rate, due_date, description)
    values (new.creator_id, new.campaign_creator_id, new.campaign_id, new.id, round(v_fee, 2), coalesce(v_tds, 0), ist_today() + 15, 'Auto: “' || new.title || '” approved by the client');
    perform set_config('app.activity_source', '', true);
    perform notify_staff('payout_created', 'Payout created: ' || (select name from creators where id = new.creator_id), '₹' || to_char(v_fee, 'FM99,99,99,990') || ' for “' || new.title || '”. Approve it when ready.', 'deliverables', new.id, 'payout:' || new.id);
  exception when others then      -- never block the approval itself
    perform andon_system('payout_on_approval', 'Payout not created: ' || new.title, sqlerrm, 'deliverables', new.id);
  end;
  return new;
end $$;
create trigger deliverables_zz_payout after update of approval_status on public.deliverables for each row execute function public.payout_on_approval();

-- Tasks from templates when a campaign is created.
create or replace function public.campaign_template_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_historical or not automation_on('campaign_tasks') then return new; end if;
  insert into tasks (title, campaign_id, assignee_id, due_date, source, created_by)
  select t.title, new.id, new.owner_id,
         coalesce(case t.anchor when 'end' then new.end_date else new.start_date end, ist_today()) + t.offset_days, 'automation', new.created_by
  from task_templates t where t.is_active and not t.is_archived order by t.anchor desc, t.offset_days;
  return new;
end $$;
create trigger campaigns_template_tasks after insert on public.campaigns for each row execute function public.campaign_template_tasks();

-- ─────────────────────────────────────────────────────────────
-- 3. Reminders to us (in-app; the 9 am digest email carries the day's tasks)
-- ─────────────────────────────────────────────────────────────
create or replace function public.automation_reminders()
returns text language plpgsql security definer set search_path = public as $$
declare d date := ist_today(); n int := 0; r record;
begin
  for r in select * from invoice_totals where document_status = 'sent' and outstanding > 0 and due_date = d + 3 loop
    perform notify_staff('invoice_due', coalesce(r.invoice_number, 'Invoice') || ' is due in 3 days', r.brand_name || ' · ₹' || to_char(r.outstanding, 'FM99,99,99,990'), 'invoices', r.invoice_id, 'due3:' || r.invoice_id); n := n + 1;
  end loop;
  for r in select * from payout_list where not is_archived and status in ('pending','approved') and due_date between d and d + 6 loop
    perform notify_staff('payout_due', 'Payout due ' || to_char(r.due_date, 'Dy DD Mon') || ': ' || r.payee_name, '₹' || to_char(r.net_payable, 'FM99,99,99,990'), 'creator_payouts', r.id, 'payout:' || r.id || ':' || r.due_date); n := n + 1;
  end loop;
  for r in select s.id, s.title, s.location, s.call_time from shoots s where not s.is_archived and s.status not in ('cancelled','done') and s.shoot_date = d + 1 loop
    perform notify_staff('shoot_tomorrow', 'Shoot tomorrow: ' || r.title, concat_ws(' · ', to_char(r.call_time, 'FMHH12:MI am'), r.location), 'shoots', r.id, 'shoot:' || r.id || ':' || d);
    perform notify(c.team_member_id, 'shoot_tomorrow', 'Shoot tomorrow: ' || r.title, concat_ws(' · ', to_char(r.call_time, 'FMHH12:MI am'), r.location), 'shoots', r.id, 'shoot:' || r.id || ':' || d)
      from shoot_crew c where c.shoot_id = r.id and c.team_member_id is not null;
    n := n + 1;
  end loop;
  for r in select dl.id, dl.title, dl.assignee_id, b.name from deliverables dl join brands b on b.id = dl.brand_id
           where not dl.is_archived and dl.stage not in ('live','cancelled') and dl.go_live_date = d + 1 loop
    perform notify_staff('go_live_tomorrow', 'Goes live tomorrow: ' || r.title, r.name, 'deliverables', r.id, 'golive:' || r.id || ':' || d);
    perform notify(r.assignee_id, 'go_live_tomorrow', 'Goes live tomorrow: ' || r.title, r.name, 'deliverables', r.id, 'golive:' || r.id || ':' || d);
    n := n + 1;
  end loop;
  for r in select t.id, t.brand_id, t.renewal_date, b.name from retainers t join brands b on b.id = t.brand_id where t.status = 'active' and not t.is_archived and t.renewal_date = d + 15 loop
    perform notify_staff('retainer_renewal', 'Retainer renews in 15 days: ' || r.name, to_char(r.renewal_date, 'DD Mon YYYY'), 'brands', r.brand_id, 'renew:' || r.id || ':' || r.renewal_date); n := n + 1;
  end loop;
  return n + notify_task_deadlines(d) || ' reminders checked (repeats are never sent twice)';
end $$;

-- Monthly: who's follower counts are out of date.
create or replace function public.automation_creator_stats()
returns text language plpgsql security definer set search_path = public as $$
declare v_names text; n int;
begin
  select count(*), string_agg(o.name || coalesce(' (last updated ' || to_char(o.metrics_updated_on, 'DD Mon YYYY') || ')', ' (never updated)'), E'\n' order by o.metrics_updated_on nulls first)
    into n, v_names
  from creator_overview o where not o.is_archived and o.status = 'active' and (o.metrics_updated_on is null or o.metrics_updated_on < ist_today() - 30);
  if n = 0 then return 'Every active creator’s numbers are up to date'; end if;
  insert into tasks (title, description, due_date, source, assignee_id)
  values ('Update follower counts for ' || n || ' creator' || case when n = 1 then '' else 's' end, 'Out of date:' || E'\n' || v_names, ist_today() + 7, 'automation',
          (select id from team_members where role = 'founder' and status = 'active' and not is_archived order by created_at limit 1));
  return 'Task created listing ' || n || ' creator(s) to update';
end $$;

-- ─────────────────────────────────────────────────────────────
-- 4. Month-end close
-- ─────────────────────────────────────────────────────────────
-- Records dated in a closed month: only a founder may edit them, and only with a reason.
create or replace function public.books_lock_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lock date := (select books_locked_through from org_settings limit 1); v_date date := (to_jsonb(old)->>tg_argv[0])::date;
begin
  if v_lock is null or v_date is null or v_date > v_lock or is_system() or coalesce(current_setting('app.money_workflow', true), '') = 'on' or auth.uid() is null then return new; end if;
  if not is_founder() then raise exception 'The books are closed through %. Only a founder can change this record.', to_char(v_lock, 'DD Mon YYYY'); end if;
  if coalesce(nullif(btrim(to_jsonb(new)->>'change_reason'), ''), nullif(current_setting('app.change_reason', true), '')) is null then
    raise exception 'The books are closed through %. Give a reason to change this record.', to_char(v_lock, 'DD Mon YYYY');
  end if;
  return new;
end $$;
do $$ declare r record;
begin
  for r in select * from (values ('invoices','issue_date'), ('receipts','received_on'), ('expenses','expense_date'), ('creator_payouts','paid_on'), ('capital_entries','entry_date'), ('account_transfers','transfer_date')) x(t, c) loop
    -- "aa" sorts first: it must see the reason before the money guard moves it to the log
    execute format('create trigger %I before update on public.%I for each row execute function public.books_lock_guard(%L)', r.t || '_aa_books_lock', r.t, r.c);
  end loop;
end $$;

create or replace function public.automation_month_end_close()
returns text language plpgsql security definer set search_path = public as $$
declare v_end date := date_trunc('month', ist_today())::date - 1;
begin
  if not jidoka_balance() then return 'Stopped: the money balance check doesn’t match — books not closed'; end if;
  perform set_config('app.opening_lock_change', 'off', true);
  update org_settings set books_locked_through = v_end where books_locked_through is null or books_locked_through < v_end;
  perform call_edge('month-end', jsonb_build_object('from', date_trunc('month', v_end)::date, 'to', v_end));
  return 'Books closed through ' || to_char(v_end, 'DD Mon YYYY') || '; P&L and capital statement emailed to the founders';
end $$;

-- What the month-end email needs (service role only).
create or replace function public.month_end_data(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.system', 'on', true);
  return jsonb_build_object('pnl', report('pnl', p_from, p_to), 'capital', report('capital', p_from, p_to),
    'company', (select company_name from org_settings limit 1),
    'founders', (select coalesce(jsonb_agg(email), '[]') from team_members where role = 'founder' and status = 'active' and not is_archived));
end $$;
revoke execute on function public.month_end_data(date, date) from public, anon, authenticated;
do $$ begin grant execute on function public.month_end_data(date, date) to service_role; exception when undefined_object then null; end $$;

-- ─────────────────────────────────────────────────────────────
-- 5. The rest of the scheduled jobs
-- ─────────────────────────────────────────────────────────────
create or replace function public.automation_jidoka_checks()
returns text language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  if not jidoka_balance() then n := n + 1; end if;
  for r in select id from campaigns where not is_archived and not is_historical and status in ('creator_outreach','production','content_review','live') loop
    if not jidoka_margin(r.id) then n := n + 1; end if;
  end loop;
  return case when n = 0 then 'All clear' else n || ' problem' || case when n = 1 then '' else 's' end || ' found — andon lit' end;
end $$;
create or replace function public.automation_daily_digest() returns text language plpgsql security definer set search_path = public as $$
begin perform call_edge('daily-digest'); return 'Digest emails requested'; end $$;
create or replace function public.automation_weekly_insight() returns text language plpgsql security definer set search_path = public as $$
begin perform call_edge('ai_generate', '{"task":"weekly_insight"}'); return 'Insight draft requested — it waits on the AI Tools page'; end $$;
create or replace function public.automation_hansei_prompt() returns text language sql security definer set search_path = public as $$
  select hansei_prompt() || ' founder(s) prompted' $$;
create or replace function public.automation_recurring_tasks() returns text language sql security definer set search_path = public as $$
  select create_recurring_tasks() || ' task(s) created' $$;
create or replace function public.automation_presence_away() returns text language sql security definer set search_path = public as $$
  select presence_auto_away() || ' set to Away' $$;
create or replace function public.automation_none() returns text language sql as $$ select 'Runs by itself when the record changes — nothing to run by hand.'::text $$;

insert into public.automations (key, name, description, schedule, schedule_label) values
  ('invoice_overdue',     'Invoice → Overdue',            'Invoices read Overdue from the day after the due date. Tells us on day 1, 7 and 15 and drafts a reminder for us to approve.', '45 2 * * *', 'Daily 8:15 am'),
  ('campaign_status',     'Campaign status',              'Live when the first deliverable is posted; Reporting when the end date passes; a nudge to complete when every creator is paid.', '35 0 * * *', 'On posting · daily 6:05 am'),
  ('creator_paid',        'Creator → Paid',               'Marks the creator Paid on the campaign when their payout is paid.', null, 'When a payout is paid'),
  ('brand_inactive',      'Brand “Inactive?” flag',       'Flags an active brand with no campaign, production or invoice in 60 days.', '40 0 * * *', 'Daily 6:10 am'),
  ('retainer_invoices',   'Retainer invoice drafts',      'Drafts each active retainer’s invoice on its billing day, for a founder to review and send.', '30 0 * * *', 'Daily 6:00 am'),
  ('recurring_expenses',  'Recurring expenses',           'Creates subscriptions, rent and other recurring expenses on their date.', '32 0 * * *', 'Daily 6:02 am'),
  ('payout_on_approval',  'Payout on approval',           'Creates a pending payout at the agreed fee when the client approves a creator’s deliverable. Stops on an unusual fee or thin margin.', null, 'When a deliverable is approved'),
  ('campaign_tasks',      'Tasks from templates',         'Creates the template tasks when a campaign is created, dated from the campaign’s dates.', null, 'When a campaign is created'),
  ('recurring_tasks',     'Recurring tasks',              'Creates daily, weekly and monthly repeating tasks.', '31 0 * * *', 'Daily 6:01 am'),
  ('reminders',           'Reminders to us',              'Invoice due in 3 days, payouts due this week, shoots and go-lives tomorrow, retainer renewal in 15 days, tasks due and overdue.', '0 3 * * *', 'Daily 8:30 am'),
  ('daily_digest',        'Daily digest email',           'Emails each person their tasks for the day.', '30 3 * * *', 'Daily 9:00 am'),
  ('creator_stats',       'Creator stats refresh',        'A task listing active creators whose follower counts are over 30 days old.', '0 4 1 * *', '1st of the month 9:30 am'),
  ('month_end_close',     'Month-end close',              'Locks last month’s money records (edits need a founder and a reason) and emails the P&L and capital statement PDF to both founders.', '30 1 1 * *', '1st of the month 7:00 am'),
  ('jidoka_checks',       'Jidoka checks',                'Stops and lights the andon when a campaign’s margin is too thin or the money balance check doesn’t match.', '50 0 * * *', 'Daily 6:20 am'),
  ('weekly_insight',      'Weekly AI insight',            'Summarises last week’s numbers into 5 points and 3 suggestions, as a draft.', '30 2 * * 1', 'Mondays 8:00 am'),
  ('hansei_prompt',       'Hansei prompt',                'Asks each founder the three Friday questions.', '30 12 * * 5', 'Fridays 6:00 pm'),
  ('presence_away',       'Auto-away',                    'Sets a person Away after 30 minutes with no activity.', '*/10 * * * *', 'Every 10 minutes');

-- ─────────────────────────────────────────────────────────────
-- 6. The runner. Scheduled jobs and the "Run now" button both come through here.
-- ─────────────────────────────────────────────────────────────
create or replace function public.run_automation(p_key text, p_manual boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare a automations; v_result text; v_error text; v_run uuid; v_fn text;
begin
  if auth.uid() is not null and not is_founder() then raise exception 'Only a founder can run automations'; end if;
  select * into a from automations where key = p_key;
  if a.id is null then raise exception 'Unknown automation %', p_key; end if;
  if not a.is_enabled and not p_manual then return 'Off'; end if;
  v_fn := case when a.schedule is null then 'automation_none' else 'automation_' || p_key end;
  insert into automation_runs (automation_key, was_manual, created_by) values (p_key, p_manual, current_member_id()) returning id into v_run;
  perform set_config('app.system', 'on', true); perform set_config('app.activity_source', 'automation', true);
  begin
    execute format('select public.%I()', v_fn) into v_result;
  exception when others then          -- everything that run changed is undone; say so loudly
    v_error := sqlerrm;
  end;
  if v_error is not null then perform andon_system('automation_error', 'Automation failed: ' || a.name, v_error); end if;
  perform set_config('app.system', '', true); perform set_config('app.activity_source', '', true);
  update automations set last_run_at = now(), last_result = coalesce(v_result, 'Failed'), last_error = v_error where id = a.id;
  update automation_runs set finished_at = now(), result = v_result, error = v_error where id = v_run;
  return coalesce(v_result, 'Failed: ' || v_error);
end $$;
revoke execute on function public.run_automation(text, boolean) from public, anon;
do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'automation\_%' and p.proname <> 'automation_on' or p.proname in ('campaign_live_on_post','creator_paid_on_payout','payout_on_approval','campaign_template_tasks')) loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

create or replace function public.automations_list()
returns table (key text, name text, description text, schedule_label text, is_enabled boolean, last_run_at timestamptz, last_result text, last_error text, runs_by_hand boolean)
language sql stable security invoker set search_path = public as $$
  select key, name, description, schedule_label, is_enabled, last_run_at, last_result, last_error, schedule is not null from automations order by created_at, name
$$;

-- Register every scheduled automation with pg_cron (replaces the one job from the money module).
do $$ declare a record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then raise notice 'pg_cron is not enabled: turn it on (Database → Extensions) and re-run this block.'; return; end if;
  begin perform cron.unschedule('social-mog-recurring-expenses'); exception when others then null; end;
  for a in select key, schedule from public.automations where schedule is not null loop
    perform cron.schedule('smog-' || a.key, a.schedule, format('select public.run_automation(%L, false)', a.key));
  end loop;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;
