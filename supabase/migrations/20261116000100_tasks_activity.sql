-- Social Mog OS — feature 8: Tasks, time log, activity feed, notifications.
-- New tables are standardised (audit, activity log, RLS on) by the event
-- trigger from …000600; each one only needs its policies here.

-- ─────────────────────────────────────────────────────────────
-- 1. Tasks: statuses To do / In progress / Waiting on client / Done.
--    "Blocked" is the andon lantern (later migration), not a status.
-- ─────────────────────────────────────────────────────────────
alter table public.tasks drop constraint tasks_status_check;
alter table public.tasks drop column blocked_reason, drop column blocked_at;   -- also drops the check that used them
update public.tasks set is_archived = true, archived_at = now() where status = 'cancelled';
update public.tasks set status = 'todo' where status in ('blocked', 'cancelled');
alter table public.tasks
  add constraint tasks_status_check check (status in ('todo','in_progress','waiting_client','done')),
  add column due_time       time,
  add column estimate_hours numeric(5,2) check (estimate_hours >= 0),
  add column recurring_id   uuid,
  add constraint tasks_one_link check (num_nonnulls(brand_id, creator_id, campaign_id, deliverable_id, shoot_id, invoice_id) <= 1);

create or replace function public.task_prepare()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.completed_at := now();
  elsif new.status <> 'done' then new.completed_at := null; end if;
  return new;
end $$;
create trigger tasks_prepare before insert or update on public.tasks for each row execute function public.task_prepare();

-- More than one person on a task. tasks.assignee_id stays the lead; this table holds everyone.
create table public.task_assignees (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  task_id     uuid not null references public.tasks(id),
  member_id   uuid not null references public.team_members(id),
  unique (task_id, member_id)
);
create index task_assignees_member_idx on public.task_assignees (member_id);
insert into public.task_assignees (task_id, member_id) select id, assignee_id from public.tasks where assignee_id is not null;

create table public.task_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  is_archived boolean not null default false,
  archived_at timestamptz,
  task_id     uuid not null references public.tasks(id),
  title       text not null,
  is_done     boolean not null default false,
  position    int not null default 0
);
create index task_checklist_task_idx on public.task_checklist_items (task_id);

create table public.recurring_tasks (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.team_members(id),
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  title        text not null,                    -- "Send weekly report to Chai Sutra"
  description  text,
  frequency    text not null check (frequency in ('daily','weekly','monthly')),
  next_on      date not null,                    -- the next date a task is made for
  due_time     time,
  priority     text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_id  uuid references public.team_members(id),
  brand_id     uuid references public.brands(id),
  is_paused    boolean not null default false
);
alter table public.tasks add constraint tasks_recurring_fk foreign key (recurring_id) references public.recurring_tasks(id);

create table public.time_logs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.team_members(id),
  member_id        uuid not null references public.team_members(id),
  task_id          uuid not null references public.tasks(id),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_minutes numeric(8,2) generated always as (extract(epoch from (ended_at - started_at)) / 60) stored,
  source           text not null default 'timer' check (source in ('timer','focus','manual')),
  check (ended_at is null or ended_at >= started_at)
);
create unique index time_logs_one_running on public.time_logs (member_id) where ended_at is null;
create index time_logs_task_idx on public.time_logs (task_id);
create index time_logs_member_idx on public.time_logs (member_id, started_at);

-- ─────────────────────────────────────────────────────────────
-- 2. Who can see a task: staff, its creator, anyone assigned.
-- ─────────────────────────────────────────────────────────────
select public.enable_standard_table('public.task_assignees'), public.enable_standard_table('public.task_checklist_items'),
       public.enable_standard_table('public.recurring_tasks'), public.enable_standard_table('public.time_logs', false);

create or replace function public.can_access_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_task is not null and (
    public.is_staff()
    or exists (select 1 from tasks t where t.id = p_task
               and (t.assignee_id = public.current_member_id() or t.created_by = public.current_member_id()))
    or exists (select 1 from task_assignees a where a.task_id = p_task and a.member_id = public.current_member_id()))
$$;
drop policy role_select on public.tasks;
create policy role_select on public.tasks for select to authenticated
  using (public.is_staff() or assignee_id = public.current_member_id() or created_by = public.current_member_id() or public.can_access_task(id));
drop policy role_update on public.tasks;
create policy role_update on public.tasks for update to authenticated
  using (public.can_access_task(id)) with check (public.is_staff() or public.can_access_task(id));

create policy role_select on public.task_assignees for select to authenticated using (public.can_access_task(task_id));
create policy role_insert on public.task_assignees for insert to authenticated
  with check (public.is_staff() or (member_id = public.current_member_id() and public.can_access_task(task_id)));
create policy role_delete on public.task_assignees for delete to authenticated
  using (public.is_staff() or member_id = public.current_member_id());
create policy role_select on public.task_checklist_items for select to authenticated using (public.can_access_task(task_id));
create policy role_insert on public.task_checklist_items for insert to authenticated with check (public.can_access_task(task_id));
create policy role_update on public.task_checklist_items for update to authenticated using (public.can_access_task(task_id)) with check (public.can_access_task(task_id));
create policy staff_select on public.recurring_tasks for select to authenticated using (public.is_staff() or assignee_id = public.current_member_id());
create policy staff_insert on public.recurring_tasks for insert to authenticated with check (public.is_staff());
create policy staff_update on public.recurring_tasks for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy own_select on public.time_logs for select to authenticated using (public.is_staff() or member_id = public.current_member_id());
create policy own_insert on public.time_logs for insert to authenticated with check (member_id = public.current_member_id() and public.can_access_task(task_id));
create policy own_update on public.time_logs for update to authenticated using (member_id = public.current_member_id()) with check (member_id = public.current_member_id());

-- the lead assignee is always in the assignee list
create or replace function public.task_lead_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    insert into task_assignees (task_id, member_id) values (new.id, new.assignee_id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger tasks_lead_sync after insert or update of assignee_id on public.tasks for each row execute function public.task_lead_sync();

-- ─────────────────────────────────────────────────────────────
-- 3. Notifications
-- ─────────────────────────────────────────────────────────────
alter table public.notifications add column dedupe_key text unique;   -- the same reminder is never sent twice

-- Never notifies people about their own action.
create or replace function public.notify(p_to uuid, p_kind text, p_title text, p_body text default null,
                                         p_table text default null, p_record uuid default null, p_key text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_to is null or p_to = current_member_id() then return; end if;
  insert into notifications (recipient_id, kind, title, body, table_name, record_id, dedupe_key)
  values (p_to, p_kind, p_title, p_body, p_table, p_record, case when p_key is not null then p_key || ':' || p_to end)
  on conflict (dedupe_key) do nothing;
end $$;
revoke execute on function public.notify(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

create or replace function public.notify_staff(p_kind text, p_title text, p_body text default null, p_table text default null,
                                               p_record uuid default null, p_key text default null, p_founders_only boolean default false)
returns void language sql security definer set search_path = public as $$
  select notify(m.id, p_kind, p_title, p_body, p_table, p_record, p_key) from team_members m
  where not m.is_archived and m.status = 'active' and (m.role = 'founder' or (not p_founders_only and m.role = 'manager'))
$$;
revoke execute on function public.notify_staff(text, text, text, text, uuid, text, boolean) from public, anon, authenticated;

create or replace function public.task_assigned_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform notify(new.member_id, 'task_assigned', 'Task assigned to you', (select title from tasks where id = new.task_id), 'tasks', new.task_id);
  return new;
end $$;
create trigger task_assignees_notify after insert on public.task_assignees for each row execute function public.task_assigned_notify();

-- @mentions: "@Asha" or "@AshaRao" (the name without spaces) in a comment.
create or replace function public.comment_mentions_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare m record; v_table text; v_id uuid;
begin
  if position('@' in new.body) = 0 then return new; end if;
  select x.t, x.id into v_table, v_id from (values ('tasks', new.task_id), ('brands', new.brand_id), ('creators', new.creator_id),
    ('campaigns', new.campaign_id), ('deliverables', new.deliverable_id), ('invoices', new.invoice_id)) x(t, id) where x.id is not null;
  for m in select id, name from team_members where not is_archived and status = 'active' loop
    if lower(new.body) like '%@' || lower(regexp_replace(m.name, '\s', '', 'g')) || '%'
       or lower(new.body) ~ ('@' || lower(regexp_replace(split_part(m.name, ' ', 1), '\W', '', 'g')) || '\M') then
      perform notify(m.id, 'mention', coalesce((select name from team_members where id = current_member_id()), 'Someone') || ' mentioned you',
                     left(new.body, 140), v_table, v_id);
    end if;
  end loop;
  return new;
end $$;
create trigger comments_mentions after insert on public.comments for each row execute function public.comment_mentions_notify();

create or replace function public.invoice_paid_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select invoice_number, brand_name, total, outstanding into t from invoice_totals where invoice_id = new.invoice_id;
  if t.outstanding = 0 and t.total > 0 then
    perform notify_staff('invoice_paid', 'Invoice ' || coalesce(t.invoice_number, '') || ' is paid', t.brand_name, 'invoices', new.invoice_id, 'paid:' || new.invoice_id);
  end if;
  return new;
end $$;
create trigger receipt_allocations_paid_notify after insert or update on public.receipt_allocations
  for each row execute function public.invoice_paid_notify();

create or replace function public.deliverable_approved_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.approval_status = 'approved' and old.approval_status is distinct from 'approved' then
    perform notify(new.assignee_id, 'deliverable_approved', 'Client approved “' || new.title || '”', null, 'deliverables', new.id, 'approved:' || new.id);
    perform notify_staff('deliverable_approved', 'Client approved “' || new.title || '”', null, 'deliverables', new.id, 'approved:' || new.id);
  end if;
  return new;
end $$;
create trigger deliverables_approved_notify after update of approval_status on public.deliverables
  for each row execute function public.deliverable_approved_notify();

-- Run each morning: "due today" and (once per task) "overdue".
create or replace function public.notify_task_deadlines(p_today date default null)
returns int language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_today, ist_today()); r record; n int := 0;
begin
  for r in select t.id, t.title, t.due_date, a.member_id from tasks t join task_assignees a on a.task_id = t.id
           where not t.is_archived and t.status <> 'done' and t.due_date <= d loop
    if r.due_date = d then perform notify(r.member_id, 'task_due', 'Due today: ' || r.title, null, 'tasks', r.id, 'due:' || r.id || ':' || d);
    else perform notify(r.member_id, 'task_overdue', 'Overdue: ' || r.title, 'Was due ' || to_char(r.due_date, 'DD Mon YYYY'), 'tasks', r.id, 'overdue:' || r.id || ':' || r.due_date);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.notify_task_deadlines(date) from public, anon;

-- ─────────────────────────────────────────────────────────────
-- 4. Recurring tasks: one task per due date, then move next_on forward.
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_recurring_tasks(p_today date default null)
returns int language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_today, ist_today()); r recurring_tasks; n int := 0;
begin
  perform set_config('app.activity_source', 'automation', true);
  for r in select * from recurring_tasks where not is_archived and not is_paused and next_on <= d loop
    insert into tasks (title, description, priority, assignee_id, brand_id, due_date, due_time, recurring_id, source, created_by)
    values (r.title, r.description, r.priority, r.assignee_id, r.brand_id, r.next_on, r.due_time, r.id, 'automation', r.created_by);
    -- skip ahead past today so a long pause doesn't flood the list
    update recurring_tasks set next_on = (
      select min(x)::date from generate_series(r.next_on, d + interval '32 days',
        case r.frequency when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end) x where x::date > d)
    where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.create_recurring_tasks(date) from public, anon;

-- ─────────────────────────────────────────────────────────────
-- 5. Timer
-- ─────────────────────────────────────────────────────────────
create or replace function public.timer_stop()
returns void language sql security invoker set search_path = public as $$
  update time_logs set ended_at = now() where member_id = current_member_id() and ended_at is null
$$;
create or replace function public.timer_start(p_task uuid, p_source text default 'timer')
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  perform timer_stop();
  insert into time_logs (member_id, task_id, source) values (current_member_id(), p_task, p_source) returning id into v_id;
  update tasks set status = 'in_progress' where id = p_task and status = 'todo';
  return v_id;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 6. The list every task view reads
-- ─────────────────────────────────────────────────────────────
create or replace view public.task_list with (security_invoker = true) as
select t.id, t.created_at, t.updated_at, t.created_by, t.is_archived, t.title, t.description, t.status, t.priority,
  t.assignee_id, t.due_date, t.due_time, t.completed_at, t.estimate_hours, t.recurring_id, t.source,
  t.brand_id, t.creator_id, t.campaign_id, t.deliverable_id, t.invoice_id,
  (t.due_date < public.ist_today() and t.status <> 'done') as is_overdue,
  case when t.brand_id is not null then 'brands' when t.campaign_id is not null then 'campaigns' when t.deliverable_id is not null then 'deliverables'
       when t.invoice_id is not null then 'invoices' when t.creator_id is not null then 'creators' end as link_table,
  coalesce(t.brand_id, t.campaign_id, t.deliverable_id, t.invoice_id, t.creator_id) as link_id,
  coalesce((select name from public.brands where id = t.brand_id), (select name from public.campaigns where id = t.campaign_id),
           (select title from public.deliverables where id = t.deliverable_id),
           (select coalesce(invoice_number, 'Draft invoice') from public.invoices where id = t.invoice_id),
           (select name from public.creators where id = t.creator_id)) as link_name,
  coalesce(a.ids, '{}') as assignee_ids, coalesce(a.names, '{}') as assignee_names,
  coalesce(c.total, 0) as checklist_total, coalesce(c.done, 0) as checklist_done,
  coalesce((select round(sum(coalesce(l.duration_minutes, extract(epoch from (now() - l.started_at)) / 60))) from public.time_logs l where l.task_id = t.id), 0) as minutes_logged
from public.tasks t
left join lateral (select array_agg(x.member_id order by d.name) ids, array_agg(d.name order by d.name) names
                   from public.task_assignees x join public.team_directory d on d.id = x.member_id where x.task_id = t.id) a on true
left join lateral (select count(*) total, count(*) filter (where i.is_done) done
                   from public.task_checklist_items i where i.task_id = t.id and not i.is_archived) c on true;

-- ─────────────────────────────────────────────────────────────
-- 7. Activity feed: the whole log in one place, filtered by what you may see.
-- ─────────────────────────────────────────────────────────────
create or replace function public.record_label(p_table text, p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case p_table
    when 'brands' then (select name from brands where id = p_id)
    when 'creators' then (select name from creators where id = p_id)
    when 'campaigns' then (select name from campaigns where id = p_id)
    when 'deliverables' then (select title from deliverables where id = p_id)
    when 'tasks' then (select title from tasks where id = p_id)
    when 'shoots' then (select title from shoots where id = p_id)
    when 'invoices' then (select coalesce(i.invoice_number, 'Draft invoice') || ' · ' || b.name from invoices i join brands b on b.id = i.brand_id where i.id = p_id)
    when 'invoice_items' then (select coalesce(i.invoice_number, 'Draft invoice') from invoice_items x join invoices i on i.id = x.invoice_id where x.id = p_id)
    when 'receipts' then (select coalesce(b.name, 'Payment') from receipts r left join brands b on b.id = r.brand_id where r.id = p_id)
    when 'expenses' then (select description from expenses where id = p_id)
    when 'creator_payouts' then (select coalesce(c.name, v.name) from creator_payouts p left join creators c on c.id = p.creator_id left join vendors v on v.id = p.vendor_id where p.id = p_id)
    when 'money_accounts' then (select name from money_accounts where id = p_id)
    when 'task_checklist_items' then (select t.title from task_checklist_items x join tasks t on t.id = x.task_id where x.id = p_id)
    when 'comments' then (select left(body, 60) from comments where id = p_id)
    when 'scripts' then (select d.title from scripts s join deliverables d on d.id = s.deliverable_id where s.id = p_id)
    when 'campaign_creators' then (select c.name || ' · ' || k.name from campaign_creators x join creators c on c.id = x.creator_id join campaigns k on k.id = x.campaign_id where x.id = p_id)
    when 'retainers' then (select b.name from retainers r join brands b on b.id = r.brand_id where r.id = p_id)
  end
$$;

create or replace function public.activity_feed(p_from date, p_to date, p_actor uuid default null, p_tables text[] default null, p_limit int default 200)
returns table (id uuid, created_at timestamptz, action text, table_name text, record_id uuid, changed_fields text[],
               old_values jsonb, new_values jsonb, source text, actor_id uuid, actor_name text, reason text, record_name text)
language sql stable security definer set search_path = public as $$
  select a.id, a.created_at, a.action, a.table_name, a.record_id, a.changed_fields, a.old_values, a.new_values, a.source,
         a.created_by, coalesce(m.name, 'System'), a.reason, record_label(a.table_name, a.record_id)
  from activity_log a left join team_members m on m.id = a.created_by
  where a.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and a.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata')
    and (p_actor is null or a.created_by = p_actor)
    and (p_tables is null or a.table_name = any(p_tables))
    and can_see_activity(a.table_name, a.record_id, a.created_by)
  order by a.created_at desc limit least(greatest(p_limit, 1), 1000)
$$;

create or replace function public.task_activity(p_task uuid)
returns table (id uuid, created_at timestamptz, action text, table_name text, record_id uuid, changed_fields text[],
               old_values jsonb, new_values jsonb, source text, actor_id uuid, actor_name text, reason text)
language sql stable security definer set search_path = public as $$
  select a.id, a.created_at, a.action, a.table_name, a.record_id, a.changed_fields, a.old_values, a.new_values, a.source,
         a.created_by, coalesce(m.name, 'System'), a.reason
  from activity_log a left join team_members m on m.id = a.created_by
  where can_access_task(p_task) and (
        (a.table_name = 'tasks' and a.record_id = p_task)
     or (a.table_name = 'task_checklist_items' and a.record_id in (select id from task_checklist_items where task_id = p_task))
     or (a.table_name = 'comments' and a.record_id in (select id from comments where task_id = p_task)))
  order by a.created_at desc limit 300
$$;

-- Per person for one day (IST): tasks completed, hours logged, records created / updated.
-- Staff see everyone; others see themselves.
create or replace function public.work_summary(p_from date, p_to date)
returns table (member_id uuid, name text, role text, tasks_done bigint, hours_logged numeric, records_created bigint, records_updated bigint)
language sql stable security definer set search_path = public as $$
  with b as (select (p_from::timestamp at time zone 'Asia/Kolkata') f, ((p_to + 1)::timestamp at time zone 'Asia/Kolkata') t)
  select m.id, m.name, m.role,
    (select count(*) from tasks k, b where not k.is_archived and k.completed_at >= b.f and k.completed_at < b.t
       and (k.assignee_id = m.id or exists (select 1 from task_assignees x where x.task_id = k.id and x.member_id = m.id))),
    (select coalesce(round(sum(l.duration_minutes) / 60, 2), 0) from time_logs l, b where l.member_id = m.id and l.started_at >= b.f and l.started_at < b.t),
    (select count(*) from activity_log a, b where a.created_by = m.id and a.action = 'create' and a.created_at >= b.f and a.created_at < b.t),
    (select count(*) from activity_log a, b where a.created_by = m.id and a.action <> 'create' and a.created_at >= b.f and a.created_at < b.t)
  from team_members m
  where not m.is_archived and m.status = 'active' and (is_staff() or m.id = current_member_id())
  order by (m.role = 'founder') desc, m.name
$$;

-- ─────────────────────────────────────────────────────────────
-- 8. Server-to-server plumbing: call an Edge Function from the database.
--    Needs two Vault secrets (see README): project_url and cron_secret.
-- ─────────────────────────────────────────────────────────────
create or replace function public.call_edge(p_fn text, p_body jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'project_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'$q$ into v_secret;
  if v_url is null or v_secret is null then raise notice 'call_edge(%): Vault secrets project_url / cron_secret are not set', p_fn; return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3)'
    using v_url || '/functions/v1/' || p_fn, jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret), p_body;
exception when others then
  raise notice 'call_edge(%) skipped: %', p_fn, sqlerrm;
end $$;
revoke execute on function public.call_edge(text, jsonb) from public, anon, authenticated;

-- What the 9:00 am digest email says, per person. Only the server (service role) may read it.
create or replace function public.daily_digest_data(p_today date default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.name, 'email', m.email,
    'today', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due_time', t.due_time, 'priority', t.priority) order by t.due_time nulls last), '[]')
              from tasks t where not t.is_archived and t.status <> 'done' and t.due_date = coalesce(p_today, ist_today())
                and exists (select 1 from task_assignees a where a.task_id = t.id and a.member_id = m.id)),
    'overdue', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due_date', t.due_date) order by t.due_date), '[]')
              from tasks t where not t.is_archived and t.status <> 'done' and t.due_date < coalesce(p_today, ist_today())
                and exists (select 1 from task_assignees a where a.task_id = t.id and a.member_id = m.id)))), '[]')
  from team_members m where not m.is_archived and m.status = 'active'
$$;
revoke execute on function public.daily_digest_data(date) from public, anon, authenticated;
do $$ begin grant execute on function public.daily_digest_data(date) to service_role; exception when undefined_object then null; end $$;
