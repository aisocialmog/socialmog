-- Social Mog OS — feature 10: AI. Calls happen only in the ai_generate Edge
-- Function; provider keys are Supabase secrets and never reach the browser.
-- Every AI result is a draft until a person accepts it.

-- ai_requests becomes the call log the brief asks for.
alter table public.ai_requests rename to ai_logs;
alter table public.ai_logs rename column feature to task;
alter table public.ai_logs
  add column cached boolean not null default false,
  add column success boolean generated always as (status = 'succeeded') stored;
drop trigger if exists ai_requests_audit on public.ai_logs;
select public.enable_standard_table('public.ai_logs', false);
drop policy member_insert on public.ai_logs;              -- only the server writes the log
create index ai_logs_day_idx on public.ai_logs (created_at desc);

create table public.ai_providers (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.team_members(id),
  name         text not null unique,
  base_url     text not null check (base_url ~ '^https://'),      -- OpenAI-compatible
  model        text not null,
  secret_name  text not null check (secret_name ~ '^[A-Z][A-Z0-9_]*$'),   -- the Supabase secret holding the key (never the key itself)
  priority     int not null default 1,
  is_enabled   boolean not null default true,
  daily_limit  int not null default 1000 check (daily_limit >= 0)  -- the provider's free requests per day
);
create table public.ai_cache (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  hash        text not null unique,                -- sha-256 of task + prompt (after the privacy filter)
  task        text not null,
  provider    text not null,
  output      text not null,
  expires_at  timestamptz not null
);
create table public.ai_insights (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  week_start  date not null unique,                -- the Monday of the week summarised
  numbers     jsonb not null,                      -- from the database, not the AI
  body        text not null,
  status      text not null default 'draft' check (status in ('draft','accepted','discarded'))
);
-- Messages to brands and creators. Always a draft for a person to approve; nothing is sent from here.
create table public.message_drafts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  kind        text not null check (kind in ('payment_reminder','creator_outreach','client_update','creator_reminder')),
  to_name     text not null,
  channel     text not null default 'email' check (channel in ('email','whatsapp','dm')),
  body        text not null,
  status      text not null default 'draft' check (status in ('draft','approved','discarded')),
  brand_id    uuid references public.brands(id),
  creator_id  uuid references public.creators(id),
  invoice_id  uuid references public.invoices(id),
  dedupe_key  text unique
);
select public.enable_standard_table('public.ai_providers'), public.enable_standard_table('public.ai_cache', false),
       public.enable_standard_table('public.ai_insights'), public.enable_standard_table('public.message_drafts');
create policy member_select on public.ai_providers for select to authenticated using (public.is_active_member());
create policy founder_insert on public.ai_providers for insert to authenticated with check (public.is_founder());
create policy founder_update on public.ai_providers for update to authenticated using (public.is_founder()) with check (public.is_founder());
create policy founder_select on public.ai_cache for select to authenticated using (public.is_founder());
create policy staff_select on public.ai_insights for select to authenticated using (public.is_staff());
create policy staff_insert on public.ai_insights for insert to authenticated with check (public.is_staff());
create policy staff_update on public.ai_insights for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_select on public.message_drafts for select to authenticated using (public.is_staff());
create policy staff_insert on public.message_drafts for insert to authenticated with check (public.is_staff());
create policy staff_update on public.message_drafts for update to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.ai_providers (name, base_url, model, secret_name, priority, daily_limit) values
  ('Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/', 'gemini-2.0-flash', 'GEMINI_API_KEY', 1, 1500),
  ('Groq', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile', 'GROQ_API_KEY', 2, 1000),
  ('OpenRouter', 'https://openrouter.ai/api/v1', 'meta-llama/llama-3.3-70b-instruct:free', 'OPENROUTER_API_KEY', 3, 50);

alter table public.campaigns add column report_summary text;   -- accepted AI summary for the client report

-- Today's use and what is left of each provider's free quota (IST day).
create or replace function public.ai_usage()
returns table (provider text, model text, priority int, is_enabled boolean, calls bigint, failures bigint, tokens bigint, daily_limit int, remaining int)
language sql stable security definer set search_path = public as $$
  select p.name, p.model, p.priority, p.is_enabled, count(l.id) filter (where not l.cached), count(l.id) filter (where l.status = 'failed'),
         coalesce(sum(coalesce(l.tokens_in, 0) + coalesce(l.tokens_out, 0)), 0)::bigint, p.daily_limit,
         greatest(p.daily_limit - count(l.id) filter (where not l.cached), 0)::int
  from ai_providers p
  left join ai_logs l on l.provider = p.name and l.created_at >= (ist_today()::timestamp at time zone 'Asia/Kolkata')
  where is_active_member() or is_system()
  group by p.id order by p.priority
$$;

create or replace function public.ai_usage_daily(p_days int default 14)
returns table (day date, provider text, task text, calls bigint, cached bigint, failures bigint, tokens bigint)
language sql stable security definer set search_path = public as $$
  select (l.created_at at time zone 'Asia/Kolkata')::date, l.provider, l.task, count(*), count(*) filter (where l.cached), count(*) filter (where l.status = 'failed'),
         coalesce(sum(coalesce(l.tokens_in, 0) + coalesce(l.tokens_out, 0)), 0)::bigint
  from ai_logs l where is_staff() and l.created_at > now() - make_interval(days => least(p_days, 90))
  group by 1, 2, 3 order by 1 desc, 2, 3
$$;

-- ─────────────────────────────────────────────────────────────
-- Creator matcher: the ranking is ours, from the database. The AI only words the reasons.
--   niche 30 · rate fit 25 · performance 25 · platform 10 · city 10
-- ─────────────────────────────────────────────────────────────
create or replace function public.creator_match(p_campaign uuid, p_limit int default 15)
returns table (creator_id uuid, name text, score int, tier text, city text, niches text[], platform text, followers bigint, avg_views bigint,
               engagement_rate numeric, rate numeric, past_campaigns bigint, avg_cpv numeric, rating numeric, facts text)
language sql stable security invoker set search_path = public as $$
  with k as (
    select c.id, c.platforms, b.city, b.industry, f.creator_budget,
           (select array_agg(lower(t.name)) from brand_tags bt join tags t on t.id = bt.tag_id where bt.brand_id = b.id) tags,
           greatest((select count(*) from campaign_creators x where x.campaign_id = c.id and not x.is_archived and x.status <> 'dropped'), 3) slots
    from campaigns c join brands b on b.id = c.brand_id left join campaign_finances f on f.campaign_id = c.id where c.id = p_campaign and is_staff()
  ), s as (
    select o.*, k.creator_budget, k.slots,
      (select count(*) from unnest(o.niches) n where lower(n) = any(coalesce(k.tags, '{}')) or lower(n) = lower(coalesce(k.industry, '')) or lower(coalesce(k.industry, '')) like '%' || lower(n) || '%') niche_hits,
      (o.city is not null and lower(o.city) = lower(coalesce(k.city, ''))) same_city,
      (o.platforms && k.platforms) on_platform,
      (select round(avg(dp.cost_per_view), 2) from deliverable_performance dp where dp.creator_id = o.id and dp.cost_per_view is not null) cpv
    from creator_overview o, k
    where not o.is_archived and not o.is_blacklisted and o.status <> 'inactive'
      and not exists (select 1 from campaign_creators x where x.campaign_id = k.id and x.creator_id = o.id and not x.is_archived)
  ), r as (
    select s.*,
      least(s.niche_hits, 2) * 15 as p_niche,
      case when s.min_rate is null or s.creator_budget is null then 10
           else greatest(0, least(25, round(25 * (1 - (s.min_rate - s.creator_budget / s.slots) / nullif(s.creator_budget / s.slots, 0))))) end::int as p_rate,
      (least(coalesce(s.top_engagement_rate, 0), 8) / 8 * 12 + least(s.campaigns_count, 3) * 2 + coalesce(s.rating, 3) / 5 * 4
        + case when s.cpv is null then 1 when s.cpv <= 0.5 then 3 when s.cpv <= 1 then 2 else 0 end)::int as p_perf,
      case when s.on_platform then 10 else 0 end as p_platform, case when s.same_city then 10 else 0 end as p_city
    from s
  )
  select r.id, r.name, (r.p_niche + r.p_rate + r.p_perf + r.p_platform + r.p_city)::int, r.tier, r.city, r.niches, r.top_platform, r.max_followers, r.top_avg_views,
    r.top_engagement_rate, r.min_rate, r.campaigns_count, r.cpv, r.rating,
    concat_ws('; ', case when r.niche_hits > 0 then 'niche matches the brand' end, case when r.same_city then 'same city as the brand' end,
      case when r.on_platform then 'active on the campaign’s platform' end,
      case when r.min_rate is not null and r.creator_budget is not null then 'lowest rate ₹' || r.min_rate::int || ' vs about ₹' || round(r.creator_budget / r.slots)::int || ' budget per creator' end,
      case when r.top_engagement_rate is not null then r.top_engagement_rate || '% engagement' end,
      case when r.campaigns_count > 0 then r.campaigns_count || ' past campaigns with us' end, case when r.cpv is not null then 'past cost per view ₹' || r.cpv end)
  from r order by 3 desc, r.top_engagement_rate desc nulls last limit least(p_limit, 50)
$$;

-- ─────────────────────────────────────────────────────────────
-- Ask Social Mog: the AI proposes a structured query; this builds and runs it.
-- Only SELECT, only on approved views, only real columns, values always quoted,
-- at most 100 rows — and it runs as the person asking, so RLS still applies.
-- ─────────────────────────────────────────────────────────────
create or replace function public.ask_views()
returns text[] language sql immutable as $$
  select array['brand_financials','brand_overview','campaign_summary','creator_overview','invoice_totals','payment_list','expense_list','payout_list','production_items','task_list','deliverable_performance']
$$;

create or replace function public.ask_schema()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(v, (select jsonb_agg(c.column_name || ':' || c.data_type order by c.ordinal_position) from information_schema.columns c
                               where c.table_schema = 'public' and c.table_name = v and c.data_type not in ('jsonb','ARRAY','uuid')))
  from unnest(ask_views()) v where is_active_member()
$$;

create or replace function public.ask_query(p_spec jsonb)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v_view text := p_spec->>'view'; v_cols text[]; v_sel text[] := '{}'; v_where text[] := '{}'; v_group text[] := '{}';
  x jsonb; c text; agg text; op text; v_order text; v_sql text; v_out jsonb; v_limit int := least(greatest(coalesce((p_spec->>'limit')::int, 20), 1), 100);
begin
  if v_view is null or not (v_view = any(ask_views())) then raise exception 'That data isn’t available to Ask'; end if;
  select array_agg(column_name::text) into v_cols from information_schema.columns where table_schema = 'public' and table_name = v_view;
  for x in select * from jsonb_array_elements(coalesce(p_spec->'select', '[]')) loop
    c := x->>'column'; agg := lower(x->>'agg');
    if c is distinct from '*' and not (c = any(v_cols)) then raise exception 'Unknown column %', c; end if;
    if agg is null then if c = '*' then raise exception 'Pick columns'; end if; v_sel := v_sel || format('%I', c);
    elsif agg = 'count' then v_sel := v_sel || 'count(*) as count';
    elsif agg in ('sum','avg','min','max') and c <> '*' then v_sel := v_sel || format('round(%s(%I)::numeric, 2) as %I', agg, c, agg || '_' || c);
    else raise exception 'Unsupported calculation %', agg; end if;
  end loop;
  if array_length(v_sel, 1) is null then raise exception 'Nothing to select'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_spec->'filters', '[]')) loop
    c := x->>'column'; op := lower(x->>'op');
    if not (c = any(v_cols)) then raise exception 'Unknown column %', c; end if;
    if op not in ('=','!=','>','>=','<','<=','ilike') then raise exception 'Unsupported comparison %', op; end if;
    v_where := v_where || case when op = 'ilike' then format('%I::text ilike %L', c, '%' || (x->>'value') || '%') else format('%I %s %L', c, op, x->>'value') end;
  end loop;
  for c in select jsonb_array_elements_text(coalesce(p_spec->'group_by', '[]')) loop
    if not (c = any(v_cols)) then raise exception 'Unknown column %', c; end if;
    v_group := v_group || format('%I', c);
  end loop;
  if p_spec->'order_by'->>'column' is not null then
    c := p_spec->'order_by'->>'column';
    -- a real column, or the name of a calculated column from the select list
    if not (c = any(v_cols) or c = 'count' or c ~ '^(sum|avg|min|max)_' and substring(c from '^[a-z]+_(.*)$') = any(v_cols)) then raise exception 'Unknown sort column %', c; end if;
    v_order := format(' order by %I %s nulls last', c, case when lower(p_spec->'order_by'->>'dir') = 'asc' then 'asc' else 'desc' end);
  end if;
  v_sql := format('select %s from public.%I', array_to_string(v_sel, ', '), v_view)
    || case when array_length(v_where, 1) > 0 then ' where ' || array_to_string(v_where, ' and ') else '' end
    || case when array_length(v_group, 1) > 0 then ' group by ' || array_to_string(v_group, ', ') else '' end
    || coalesce(v_order, '') || ' limit ' || v_limit;
  execute 'select coalesce(jsonb_agg(t), ''[]'') from (' || v_sql || ') t' into v_out;
  return v_out;
end $$;

-- Last week's numbers for the Monday insight (and the week before, to compare).
create or replace function public.weekly_numbers(p_today date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ws date := date_trunc('week', coalesce(p_today, ist_today()))::date - 7;
begin
  if not (is_staff() or is_system()) then raise exception 'Not allowed'; end if;
  return jsonb_build_object('week_start', ws, 'week_end', ws + 6,
    'this_week', dashboard_values(ws, ws + 6) - 'total_capital', 'week_before', dashboard_values(ws - 7, ws - 1) - 'total_capital',
    'top_brands_by_profit', (select coalesce(jsonb_agg(jsonb_build_object('brand', name, 'profit', profit)), '[]') from (select name, profit from profit_by('brand', ws, ws + 6) where id is not null order by profit desc limit 3) b),
    'overdue_invoices', (select count(*) from invoice_totals where document_status = 'sent' and outstanding > 0 and days_overdue > 0),
    'stuck_items', (select count(*) from production_items where is_stuck),
    'open_andons', (select count(*) from andons where resolved_at is null));
end $$;

-- The scheduler's way in (service role only).
create or replace function public.weekly_numbers_system()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.system', 'on', true);
  return weekly_numbers();
end $$;
revoke execute on function public.weekly_numbers_system() from public, anon, authenticated;
do $$ begin grant execute on function public.weekly_numbers_system() to service_role; exception when undefined_object then null; end $$;
