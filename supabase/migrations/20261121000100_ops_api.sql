-- Social Mog OS — feature 12: the Ops Board integration.
-- A separate website reads live data through the `ops` Edge Function using its
-- own API key. Read-only, except one call that sets a founder's presence.
-- Money leaves here only as totals — never an individual creator's payment.

alter table public.api_clients add column rate_limit_per_min int not null default 60 check (rate_limit_per_min > 0);

-- ── Keys: shown once, stored only as a SHA-256 hash ──────────
create or replace function public.ops_key_create(p_name text default 'Ops Board')
returns text language plpgsql security definer set search_path = public, extensions as $$   -- pgcrypto lives in "extensions" on Supabase
declare v_key text := 'smog_ops_' || encode(gen_random_bytes(24), 'hex');
begin
  if not is_founder() then raise exception 'Only a founder can create API keys'; end if;
  insert into api_clients (name, key_prefix, key_hash, scopes)
  values (coalesce(nullif(btrim(p_name), ''), 'Ops Board'), left(v_key, 14), encode(digest(v_key, 'sha256'), 'hex'), array['ops:read','presence:write']);
  return v_key;
end $$;
create or replace function public.ops_key_revoke(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_founder() then raise exception 'Only a founder can revoke API keys'; end if;
  update api_clients set revoked_at = now() where id = p_id and revoked_at is null;
end $$;
-- Rotate = a new key now, the old one stops working now.
create or replace function public.ops_key_rotate(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select name into v_name from api_clients where id = p_id and revoked_at is null;
  if v_name is null then raise exception 'That key is already revoked'; end if;
  perform ops_key_revoke(p_id);
  return ops_key_create(v_name);
end $$;

-- Called by the Edge Function for every request: is the key good, and within its rate limit?
create or replace function public.ops_authenticate(p_key_hash text, p_method text, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c api_clients; v_recent int; v_origin text := (select ops_allowed_origin from org_settings limit 1);
begin
  select * into c from api_clients where key_hash = p_key_hash and revoked_at is null and not is_archived and (expires_at is null or expires_at > now());
  if c.id is null then return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unknown or revoked API key', 'allowed_origin', v_origin); end if;
  select count(*) into v_recent from api_request_log where api_client_id = c.id and created_at > now() - interval '1 minute';
  if v_recent >= c.rate_limit_per_min then
    insert into api_request_log (api_client_id, method, path, status_code) values (c.id, p_method, left(p_path, 200), 429);
    return jsonb_build_object('ok', false, 'status', 429, 'error', 'Rate limit reached — try again in a minute', 'allowed_origin', v_origin);
  end if;
  insert into api_request_log (api_client_id, method, path, status_code) values (c.id, p_method, left(p_path, 200), 200);
  update api_clients set last_used_at = now() where id = c.id;
  return jsonb_build_object('ok', true, 'client_id', c.id, 'allowed_origin', v_origin, 'limit', c.rate_limit_per_min, 'remaining', c.rate_limit_per_min - v_recent - 1);
end $$;

-- ── What the endpoints return ────────────────────────────────
create or replace function public.ops_presence()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.name, 'status', coalesce(p.status, 'off'), 'message', p.message,
           'since', p.since, 'expected_back', p.expected_back) order by m.created_at), '[]')
  from team_members m left join presence p on p.member_id = m.id
  where m.role = 'founder' and m.status = 'active' and not m.is_archived
$$;

create or replace function public.ops_today()
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select ist_today() d)
  select jsonb_build_object('date', d.d,
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('title', t.title, 'status', t.status, 'priority', t.priority, 'due_time', t.due_time, 'overdue', t.due_date < d.d,
                'assignees', (select coalesce(jsonb_agg(m.name), '[]') from task_assignees a join team_members m on m.id = a.member_id where a.task_id = t.id))
                order by t.due_date, t.due_time nulls last), '[]')
              from tasks t where not t.is_archived and t.status <> 'done' and t.due_date <= d.d),
    'shoots', (select coalesce(jsonb_agg(jsonb_build_object('title', s.title, 'brand', b.name, 'call_time', s.call_time, 'location', s.location, 'status', s.status) order by s.call_time nulls last), '[]')
               from shoots s left join brands b on b.id = s.brand_id where not s.is_archived and s.status <> 'cancelled' and s.shoot_date = d.d),
    'deadlines', (select coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'brand', b.name, 'stage', x.stage, 'kind', case when x.go_live_date = d.d then 'go_live' else 'due' end)), '[]')
                  from deliverables x join brands b on b.id = x.brand_id where not x.is_archived and x.stage not in ('live','cancelled') and d.d in (x.due_date, x.go_live_date)),
    'andons', (select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'reason', a.reason, 'raised_by', coalesce(r.name, 'Automation'), 'waiting_on', u.name, 'raised_at', a.created_at, 'minutes_open', a.minutes_open) order by a.created_at), '[]')
               from open_andons a left join team_members r on r.id = a.created_by left join team_members u on u.id = a.unblocker_id))
  from d
$$;

-- Totals only. range: this_week | last_week | this_month | last_month | custom (with from/to).
create or replace function public.ops_summary(p_range text default 'this_week', p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := ist_today(); f date; t date; v jsonb;
begin
  case p_range
    when 'this_week' then f := date_trunc('week', d)::date; t := f + 6;
    when 'last_week' then f := date_trunc('week', d)::date - 7; t := f + 6;
    when 'this_month' then f := date_trunc('month', d)::date; t := (f + interval '1 month')::date - 1;
    when 'last_month' then f := (date_trunc('month', d) - interval '1 month')::date; t := date_trunc('month', d)::date - 1;
    when 'custom' then
      if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'custom needs from and to (YYYY-MM-DD), at most a year apart'; end if;
      f := p_from; t := p_to;
    else raise exception 'range must be this_week, last_week, this_month, last_month or custom';
  end case;
  perform set_config('app.system', 'on', true);
  v := dashboard_values(f, t);
  return jsonb_build_object('range', p_range, 'from', f, 'to', t,
    'revenue', v->'revenue', 'profit', v->'net_profit', 'cash_received', v->'cash_received', 'expenses', v->'expenses',
    'content_posted', v->'content_posted', 'campaigns_live', v->'live_campaigns',
    'founders', (select coalesce(jsonb_agg(jsonb_build_object('member_id', w.member_id, 'name', w.name, 'tasks_done', w.tasks_done,
        'hours_worked', round(coalesce((select sum(p.worked_minutes) from presence_days(f, t) p where p.member_id = w.member_id), 0) / 60, 1),
        'break_hours', round(coalesce((select sum(p.break_minutes) from presence_days(f, t) p where p.member_id = w.member_id), 0) / 60, 1))), '[]')
      from work_summary_system(f, t) w where w.role = 'founder'));
end $$;

-- work_summary() answers per caller; the API needs every founder.
create or replace function public.work_summary_system(p_from date, p_to date)
returns table (member_id uuid, name text, role text, tasks_done bigint)
language sql stable security definer set search_path = public as $$
  select m.id, m.name, m.role,
    (select count(*) from tasks k where not k.is_archived and (k.completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
       and exists (select 1 from task_assignees x where x.task_id = k.id and x.member_id = m.id))
  from team_members m where not m.is_archived and m.status = 'active'
$$;

-- The feed in plain language. Payouts, payment details, capital and salaries never appear.
create or replace function public.ops_activity(p_limit int default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('at', x.created_at, 'who', x.who, 'text', x.who || ' ' || x.what, 'record_type', x.table_name) order by x.created_at desc), '[]')
  from (
    select a.created_at, a.table_name, coalesce(m.name, 'System') who,
      case
        when a.table_name = 'receipts' and a.action = 'create' then 'recorded ₹' || to_char((a.new_values->>'amount_received')::numeric, 'FM99,99,99,990') || ' payment from ' || coalesce(record_label_raw('receipts', a.record_id), 'a client')
        when a.action = 'status_change' and a.table_name = 'tasks' and a.new_values->>'status' = 'done' then 'completed “' || l.label || '”'
        when a.action = 'status_change' then 'moved “' || l.label || '” to ' || initcap(replace(coalesce(a.new_values->>'stage', a.new_values->>'status'), '_', ' '))
        when a.action = 'create' then 'added ' || n.noun || ' “' || l.label || '”'
        when a.action = 'archive' then 'archived ' || n.noun || ' “' || l.label || '”'
        else 'updated ' || n.noun || ' “' || l.label || '”' end what
    from activity_log a
    left join team_members m on m.id = a.created_by
    cross join lateral (select record_label_raw(a.table_name, a.record_id) label) l
    cross join lateral (select case a.table_name when 'brands' then 'brand' when 'creators' then 'creator' when 'campaigns' then 'campaign' when 'deliverables' then 'production item'
                                 when 'tasks' then 'task' when 'shoots' then 'shoot' when 'invoices' then 'invoice' else 'record' end noun) n
    where a.table_name in ('brands','creators','campaigns','deliverables','tasks','shoots','invoices','receipts') and l.label is not null
    order by a.created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) x
$$;

-- The one write: a founder's own presence. Identified by email or member id.
create or replace function public.ops_set_status(p_founder text, p_status text, p_message text default null, p_expected_back timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from team_members where role = 'founder' and status = 'active' and not is_archived and (lower(email) = lower(p_founder) or id::text = p_founder);
  if v_id is null then raise exception 'founder must be a founder’s email or member id'; end if;
  if p_status not in ('working','focus','in_shoot','in_meeting','on_break','off','blocked') then raise exception 'status must be one of working, focus, in_shoot, in_meeting, on_break, off, blocked'; end if;
  perform set_presence_for(v_id, p_status, nullif(btrim(left(p_message, 200)), ''), p_expected_back, 'ops_board');
  return (select p from jsonb_array_elements(ops_presence()) p where p->>'member_id' = v_id::text);
end $$;

do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('ops_authenticate','ops_presence','ops_today','ops_summary','ops_activity','ops_set_status','work_summary_system') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    begin execute format('grant execute on function %s to service_role', f); exception when undefined_object then null; end;
  end loop;
end $$;

-- ── Webhooks for money and campaign milestones (status and andon events already fire) ──
create or replace function public.invoice_paid_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select invoice_number, brand_name, total, outstanding into t from invoice_totals where invoice_id = new.invoice_id;
  if t.outstanding = 0 and t.total > 0 then
    perform notify_staff('invoice_paid', 'Invoice ' || coalesce(t.invoice_number, '') || ' is paid', t.brand_name, 'invoices', new.invoice_id, 'paid:' || new.invoice_id);
    perform emit_event('invoice.paid', jsonb_build_object('invoice_number', t.invoice_number, 'brand', t.brand_name, 'total', t.total));
  end if;
  return new;
end $$;
create or replace function public.campaign_completed_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status <> 'completed' and not new.is_historical then
    perform emit_event('campaign.completed', jsonb_build_object('campaign', new.name, 'brand', (select name from brands where id = new.brand_id)));
  end if;
  return new;
end $$;
create trigger campaigns_completed_event after update of status on public.campaigns for each row execute function public.campaign_completed_event();
revoke execute on function public.campaign_completed_event() from public, anon, authenticated;

-- A ping on the public "ops-board" channel whenever the feed grows, so the board can refresh at once.
create or replace function public.activity_ping()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.table_name in ('brands','creators','campaigns','deliverables','tasks','shoots','invoices','receipts') then
    begin execute 'select realtime.send($1, $2, $3, false)' using jsonb_build_object('event', 'activity'), 'changed', 'ops-board'; exception when others then null; end;
  end if;
  return new;
end $$;
create trigger activity_log_ping after insert on public.activity_log for each row execute function public.activity_ping();

-- ── Realtime: presence and the activity log stream to signed-in clients (RLS applies) ──
do $$ begin
  alter publication supabase_realtime add table public.presence;
  alter publication supabase_realtime add table public.activity_log;
exception when others then raise notice 'Realtime publication not changed here: %', sqlerrm;
end $$;
