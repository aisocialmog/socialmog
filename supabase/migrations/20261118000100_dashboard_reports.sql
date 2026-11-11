-- Social Mog OS — feature 9: Dashboard and Reports. Read-only: every number
-- is calculated here from existing tables, so pages stay fast with thousands of rows.

-- record_label() is used by the feed; only answer for records the caller may see.
alter function public.record_label(text, uuid) rename to record_label_raw;
revoke execute on function public.record_label_raw(text, uuid) from public, anon, authenticated;
create or replace function public.record_label(p_table text, p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when can_see_activity(p_table, p_id, null) or is_system() then record_label_raw(p_table, p_id) end
$$;

-- The previous equal period: whole months compare with the months before; anything else with the same number of days before.
create or replace function public.previous_period(p_from date, p_to date, out prev_from date, out prev_to date)
language sql immutable as $$
  select case when extract(day from p_from) = 1 and p_to = (date_trunc('month', p_to) + interval '1 month - 1 day')::date
              then (p_from - make_interval(months => (extract(year from age(p_to + 1, p_from)) * 12 + extract(month from age(p_to + 1, p_from)))::int))::date
              else p_from - (p_to - p_from + 1) end,
         p_from - 1
$$;

-- ─────────────────────────────────────────────────────────────
-- KPI values for one period ("as of" its last day for point-in-time numbers).
-- Runs as the caller: people who can't see money get nulls from RLS.
-- ─────────────────────────────────────────────────────────────
create or replace function public.dashboard_values(p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with o as (select * from money_overview(p_from, p_to, 'invoice')),
  asof as (select least(p_to, ist_today()) d),
  wk as (select date_trunc('week', (select d from asof))::date ws)
  select jsonb_build_object(
    'revenue', o.revenue, 'cash_received', o.cash_received, 'expenses', o.expenses + o.creator_payouts, 'net_profit', o.net_profit,
    'outstanding', (select coalesce(sum(greatest(t.total - coalesce((select sum(a.amount) from receipt_allocations a join receipts r on r.id = a.receipt_id
                       where a.invoice_id = t.invoice_id and not a.is_archived and not r.is_archived and r.received_on <= p_to), 0), 0)), 0)
                    from invoice_totals t where t.document_status = 'sent' and t.issue_date <= p_to),
    'payouts_pending', (select coalesce(sum(p.amount), 0) from creator_payouts p where not p.is_archived and p.status <> 'cancelled'
                        and (p.created_at at time zone 'Asia/Kolkata')::date <= p_to and (p.paid_on is null or p.paid_on > p_to)),
    'total_capital', case when is_founder() then (select coalesce(sum(signed_amount), 0) from capital_list where not is_archived and entry_date <= p_to) end,
    'active_brands', (select count(*) from brands b where not b.is_archived and b.status = 'active' and (b.created_at at time zone 'Asia/Kolkata')::date <= asof.d),
    'live_campaigns', (select count(*) from campaigns c where not c.is_archived and not c.is_historical and c.status not in ('planning','cancelled')
                       and coalesce(c.start_date, p_from) <= p_to and coalesce(c.end_date, p_to) >= p_from),
    'content_posted', (select count(*) from deliverables d where not d.is_archived and (d.went_live_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
    'in_production', (select count(*) from deliverables d where not d.is_archived and d.stage <> 'cancelled' and (d.created_at at time zone 'Asia/Kolkata')::date <= asof.d
                      and (d.went_live_at is null or (d.went_live_at at time zone 'Asia/Kolkata')::date > asof.d)),
    'overdue_tasks', (select count(*) from tasks t where not t.is_archived and t.due_date < asof.d and (t.created_at at time zone 'Asia/Kolkata')::date <= asof.d
                      and (t.completed_at is null or (t.completed_at at time zone 'Asia/Kolkata')::date > asof.d)),
    'shoots_this_week', (select count(*) from shoots s, wk where not s.is_archived and s.status <> 'cancelled' and s.shoot_date between wk.ws and wk.ws + 6))
  from o, asof
$$;

create or replace function public.dashboard(p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare cur jsonb; prev jsonb; pp record; v_staff boolean := is_staff(); d date := ist_today();
  money_keys text[] := array['revenue','cash_received','expenses','net_profit','outstanding','payouts_pending','total_capital'];
  work_keys text[] := array['active_brands','live_campaigns','content_posted','in_production','overdue_tasks','shoots_this_week'];
begin
  if not is_active_member() then raise exception 'Sign in first'; end if;
  select * into pp from previous_period(p_from, p_to);
  cur := dashboard_values(p_from, p_to);
  -- "shoots this week" compares with last week; everything else with the previous equal period
  prev := dashboard_values(pp.prev_from, pp.prev_to) || jsonb_build_object('shoots_this_week', dashboard_values(d - 13, d - 7)->'shoots_this_week');
  return jsonb_build_object(
    'previous', jsonb_build_object('from', pp.prev_from, 'to', pp.prev_to),
    'money', case when v_staff then (select jsonb_object_agg(k, jsonb_build_object('value', cur->k, 'prev', prev->k)) from unnest(money_keys) k
                                     where k <> 'total_capital' or is_founder()) end,
    'work', (select jsonb_object_agg(k, jsonb_build_object('value', cur->k, 'prev', prev->k)) from unnest(work_keys) k),
    'charts', jsonb_build_object(
      'months', case when v_staff then (select jsonb_agg(jsonb_build_object('month', m::date,
          'revenue', (select coalesce(sum(amount), 0) from pnl_lines where basis = 'invoice' and line = 'revenue' and entry_date >= m::date and entry_date < (m + interval '1 month')::date),
          'expenses', (select coalesce(sum(amount), 0) from pnl_lines where basis = 'invoice' and line in ('creator_payout','direct_expense','overhead_expense') and entry_date >= m::date and entry_date < (m + interval '1 month')::date)) order by m)
        from generate_series(date_trunc('month', d) - interval '11 months', date_trunc('month', d), interval '1 month') m) else '[]' end,
      'brands', case when v_staff then (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'profit', x.profit)), '[]')
        from (select * from profit_by('brand', p_from, p_to, 'invoice') where id is not null order by profit desc limit 10) x) else '[]' end,
      'weeks', (select jsonb_agg(jsonb_build_object('week', w::date, 'posted',
          (select count(*) from deliverables dl where not dl.is_archived and (dl.went_live_at at time zone 'Asia/Kolkata')::date between w::date and w::date + 6)) order by w)
        from generate_series(greatest(date_trunc('week', p_from), date_trunc('week', p_to) - interval '25 weeks'), date_trunc('week', p_to), interval '1 week') w),
      'funnel', (select coalesce(jsonb_agg(jsonb_build_object('stage', stage, 'n', n) order by ord), '[]') from (
          select p.stage, count(*) n, array_position(array['idea','script','script_approved','pre_production','shoot_scheduled','shot','editing','internal_review','client_review','revisions','approved','scheduled','live'], p.stage) ord
          from production_items p where p.stage <> 'cancelled' and (p.stage <> 'live' or (p.went_live_at at time zone 'Asia/Kolkata')::date between p_from and p_to) group by p.stage) f)),
    'lists', jsonb_build_object(
      'shoots', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'sub', concat_ws(' · ', to_char(s.call_time, 'FMHH12:MI am'), s.location), 'link', '/calendar') order by s.call_time nulls last), '[]')
                 from shoot_calendar s where s.shoot_date = d and s.status <> 'cancelled'),
      'due_today', (select coalesce(jsonb_agg(j), '[]') from (
          select jsonb_build_object('id', t.id, 'title', t.title, 'sub', concat_ws(' · ', 'Task', array_to_string(t.assignee_names, ', ')), 'link', '/tasks/' || t.id) j from task_list t where not t.is_archived and t.status <> 'done' and t.due_date = d
          union all
          select jsonb_build_object('id', p.id, 'title', p.title, 'sub', concat_ws(' · ', case when p.target_date = d then 'Goes live' else 'Due' end, p.brand_name), 'link', '/production/' || p.id) from production_items p
          where p.stage not in ('live','cancelled') and d in (p.due_date, p.target_date)) x),
      'overdue_invoices', case when v_staff then (select coalesce(jsonb_agg(jsonb_build_object('id', i.invoice_id, 'title', coalesce(i.invoice_number, 'Invoice') || ' · ' || i.brand_name,
                 'sub', i.days_overdue || ' days overdue', 'amount', i.outstanding, 'link', '/money/invoices/' || i.invoice_id) order by i.days_overdue desc), '[]')
                 from invoice_totals i where i.document_status = 'sent' and i.outstanding > 0 and i.days_overdue > 0) else '[]' end,
      'renewals', case when v_staff then (select coalesce(jsonb_agg(jsonb_build_object('id', r.brand_id, 'title', b.name, 'sub', case when r.renewal_date < d then 'Renewal passed ' || (d - r.renewal_date) || ' days ago' else 'Renews in ' || (r.renewal_date - d) || ' days' end,
                 'amount', r.monthly_fee, 'link', '/brands/' || r.brand_id) order by r.renewal_date), '[]')
                 from retainers r join brands b on b.id = r.brand_id where not r.is_archived and r.status = 'active' and r.renewal_date <= d + 15) else '[]' end,
      'stuck', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'sub', initcap(replace(p.stage, '_', ' ')) || ' · ' || p.days_in_stage || ' days · ' || p.brand_name, 'link', '/production/' || p.id) order by p.days_in_stage desc), '[]')
                from production_items p where p.is_stuck)),
    'team', (select coalesce(jsonb_agg(to_jsonb(w)), '[]') from work_summary(p_from, p_to) w),
    'andons', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]') from open_andons a));
end $$;

-- ─────────────────────────────────────────────────────────────
-- Genchi genbutsu: the exact records behind a number.
-- p_id narrows to one brand / campaign / person; p_key to one stage.
-- ─────────────────────────────────────────────────────────────
create or replace function public.records_behind(p_metric text, p_from date, p_to date, p_id uuid default null, p_key text default null)
returns table (label text, sub text, on_date date, amount numeric, link text)
language plpgsql stable security invoker set search_path = public as $$
declare d date := least(p_to, ist_today()); ws date := date_trunc('week', ist_today())::date;
begin
  if p_metric in ('revenue','expenses','creator_payouts','direct_expenses','overhead_expenses','other_income','net_profit','profit') then
    return query
    select case l.source_table
             when 'invoices' then (select coalesce(i.invoice_number, 'Invoice') || ' · ' || i.brand_name from invoice_totals i where i.invoice_id = l.source_id)
             when 'creator_payouts' then (select p.payee_name || coalesce(' · ' || p.campaign_name, '') from payout_list p where p.id = l.source_id)
             when 'expenses' then (select e.description from expenses e where e.id = l.source_id)
             else coalesce((select b.name from brands b where b.id = l.brand_id), 'Other income') end,
           initcap(replace(l.line, '_', ' ')), l.entry_date,
           case when p_metric in ('net_profit','profit') and l.line not in ('revenue','other_income') then -l.amount else l.amount end,
           case l.source_table when 'invoices' then '/money/invoices/' when 'creator_payouts' then '/money/payouts/' when 'expenses' then '/money/expenses/' else '/money/payments/' end || l.source_id
    from pnl_lines l
    where l.basis = 'invoice' and l.entry_date between p_from and p_to
      and (p_id is null or p_id in (l.brand_id, l.campaign_id))
      and l.line = any(case p_metric when 'revenue' then array['revenue'] when 'creator_payouts' then array['creator_payout'] when 'direct_expenses' then array['direct_expense']
                         when 'overhead_expenses' then array['overhead_expense'] when 'other_income' then array['other_income']
                         when 'expenses' then array['creator_payout','direct_expense','overhead_expense']
                         when 'profit' then array['revenue','creator_payout','direct_expense']
                         else array['revenue','other_income','creator_payout','direct_expense','overhead_expense'] end)
    order by l.entry_date desc;
  elsif p_metric = 'cash_received' then
    return query select coalesce(r.brand_name, 'Other income'), concat_ws(' · ', r.mode, r.reference), r.received_on, r.amount_received, '/money/payments/' || r.id
      from payment_list r where not r.is_archived and r.received_on between p_from and p_to and (p_id is null or r.brand_id = p_id) order by r.received_on desc;
  elsif p_metric in ('outstanding','overdue_invoices') then
    return query select coalesce(i.invoice_number, 'Invoice') || ' · ' || i.brand_name, case when i.days_overdue > 0 then i.days_overdue || ' days overdue' else 'Due ' || to_char(i.due_date, 'DD Mon YYYY') end,
        i.issue_date, i.outstanding, '/money/invoices/' || i.invoice_id
      from invoice_totals i where i.document_status = 'sent' and i.outstanding > 0 and (p_metric = 'outstanding' or i.days_overdue > 0) and (p_id is null or i.brand_id = p_id) order by i.due_date;
  elsif p_metric = 'payouts_pending' then
    return query select p.payee_name, concat_ws(' · ', initcap(p.status), p.campaign_name), p.due_date, p.gross, '/money/payouts/' || p.id
      from payout_list p where not p.is_archived and p.status in ('pending','approved') order by p.due_date nulls last;
  elsif p_metric = 'total_capital' then
    return query select c.founder_name, initcap(replace(c.kind, '_', ' ')), c.entry_date, c.signed_amount, '/money/capital/' || c.id
      from capital_list c where not c.is_archived and c.entry_date <= d order by c.entry_date desc;
  elsif p_metric = 'active_brands' then
    return query select b.name, b.industry, null::date, null::numeric, '/brands/' || b.id from brands b where not b.is_archived and b.status = 'active' order by b.name;
  elsif p_metric = 'live_campaigns' then
    return query select c.name, (select name from brands where id = c.brand_id) || ' · ' || initcap(replace(c.status, '_', ' ')), c.start_date, null::numeric, '/campaigns/' || c.id
      from campaigns c where not c.is_archived and not c.is_historical and c.status not in ('planning','cancelled')
        and coalesce(c.start_date, p_from) <= p_to and coalesce(c.end_date, p_to) >= p_from and (p_id is null or c.brand_id = p_id) order by c.start_date;
  elsif p_metric in ('content_posted','in_production','stage') then
    return query select p.title, concat_ws(' · ', p.brand_name, initcap(replace(p.stage, '_', ' '))), coalesce((p.went_live_at at time zone 'Asia/Kolkata')::date, p.sort_date), null::numeric, '/production/' || p.id
      from production_items p
      where (p_id is null or p_id in (p.brand_id, p.campaign_id, p.creator_id))
        and case p_metric when 'content_posted' then (p.went_live_at at time zone 'Asia/Kolkata')::date between p_from and p_to
                          when 'in_production' then p.stage not in ('live','cancelled')
                          else p.stage = p_key and (p.stage <> 'live' or (p.went_live_at at time zone 'Asia/Kolkata')::date between p_from and p_to) end
      order by 3 desc nulls last;
  elsif p_metric in ('overdue_tasks','tasks_done') then
    return query select t.title, array_to_string(t.assignee_names, ', '), case when p_metric = 'tasks_done' then (t.completed_at at time zone 'Asia/Kolkata')::date else t.due_date end, null::numeric, '/tasks/' || t.id
      from task_list t where not t.is_archived and (p_id is null or p_id = any(t.assignee_ids))
        and case when p_metric = 'tasks_done' then (t.completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to else t.is_overdue end
      order by 3;
  elsif p_metric = 'hours_logged' then
    return query select t.title, initcap(l.source), (l.started_at at time zone 'Asia/Kolkata')::date, round(l.duration_minutes / 60, 2), '/tasks/' || t.id
      from time_logs l join tasks t on t.id = l.task_id
      where (l.started_at at time zone 'Asia/Kolkata')::date between p_from and p_to and (p_id is null or l.member_id = p_id) order by l.started_at desc;
  elsif p_metric = 'shoots_this_week' then
    return query select s.title, concat_ws(' · ', s.brand_name, s.location), s.shoot_date, null::numeric, '/calendar'::text
      from shoot_calendar s where s.status <> 'cancelled' and s.shoot_date between ws and ws + 6 order by s.shoot_date;
  else
    raise exception 'Unknown metric %', p_metric;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Reports. One function, nine reports; each returns
--   { sections: [ { title, columns: [{key,label,type}], rows: [...] } ] }
-- type: text | money | number | percent | days | date. Rows may carry
-- link (open the record) or metric/id (open the records behind the number).
-- Founders and managers only; the capital statement is founders only.
-- ─────────────────────────────────────────────────────────────
create or replace function public.rcols(variadic p text[])
returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('key', split_part(c, '|', 1), 'label', split_part(c, '|', 2), 'type', coalesce(nullif(split_part(c, '|', 3), ''), 'text')) order by i)
  from unnest(p) with ordinality x(c, i)
$$;

create or replace function public.report(p_name text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o record; pv record; pp record; s jsonb; s2 jsonb; d date := ist_today();
begin
  if not (is_staff() or is_system()) then raise exception 'Reports are for founders and managers'; end if;
  select * into pp from previous_period(p_from, p_to);

  if p_name = 'pnl' then
    select * into o from money_overview(p_from, p_to, 'invoice');
    select * into pv from money_overview(pp.prev_from, pp.prev_to, 'invoice');
    s := jsonb_build_array(
      jsonb_build_object('line', 'Revenue', 'amount', o.revenue, 'prev', pv.revenue, 'metric', 'revenue'),
      jsonb_build_object('line', 'Cost of creators', 'amount', -o.creator_payouts, 'prev', -pv.creator_payouts, 'metric', 'creator_payouts'),
      jsonb_build_object('line', 'Production costs', 'amount', -o.direct_expenses, 'prev', -pv.direct_expenses, 'metric', 'direct_expenses'),
      jsonb_build_object('line', 'Gross profit', 'amount', o.gross_profit, 'prev', pv.gross_profit, 'bold', true),
      jsonb_build_object('line', 'Overheads', 'amount', -o.overhead_expenses, 'prev', -pv.overhead_expenses, 'metric', 'overhead_expenses'),
      jsonb_build_object('line', 'Other income', 'amount', o.other_income, 'prev', pv.other_income, 'metric', 'other_income'),
      jsonb_build_object('line', 'Net profit', 'amount', o.net_profit, 'prev', pv.net_profit, 'bold', true, 'metric', 'net_profit'));
    return jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('title', 'Profit & Loss (invoice basis)',
      'columns', rcols('line|Line', 'amount|This period|money', 'prev|Previous period|money'), 'rows', s)));

  elsif p_name = 'brands' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.profit desc), '[]') into s from (
      select b.id, b.name, coalesce(p.revenue, 0) revenue, coalesce(p.profit, 0) profit, p.margin_pct margin,
        (select count(*) from campaigns c where c.brand_id = b.id and not c.is_archived and not c.is_historical and c.status <> 'cancelled'
           and coalesce(c.start_date, p_from) <= p_to and coalesce(c.end_date, p_to) >= p_from) campaigns,
        (select count(*) from deliverables dl where dl.brand_id = b.id and not dl.is_archived and (dl.went_live_at at time zone 'Asia/Kolkata')::date between p_from and p_to) content,
        '/brands/' || b.id link
      from brands b left join profit_by('brand', p_from, p_to, 'invoice') p on p.id = b.id
      where not b.is_archived and (p.id is not null or b.status = 'active')) x;
    return jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('title', 'Brands',
      'columns', rcols('name|Brand', 'revenue|Revenue|money', 'profit|Profit|money', 'margin|Margin|percent', 'campaigns|Campaigns|number', 'content|Content delivered|number'), 'rows', s)));

  elsif p_name = 'campaigns' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.profit desc nulls last), '[]') into s from (
      select c.id, c.name, b.name brand, m.views, m.engagements,
        case when m.views > 0 then round(m.engagements::numeric / m.views * 100, 2) end engagement_rate,
        coalesce(p.creator_payouts, 0) + coalesce(p.direct_expenses, 0) spend,
        case when m.views > 0 then round((coalesce(p.creator_payouts, 0) + coalesce(p.direct_expenses, 0)) / m.views, 2) end cpv,
        coalesce(p.revenue, 0) revenue, coalesce(p.profit, 0) profit, '/campaigns/' || c.id link
      from campaigns c join brands b on b.id = c.brand_id
      left join profit_by('campaign', p_from, p_to, 'invoice') p on p.id = c.id
      left join lateral (select sum(dp.views) views, sum(dp.engagements) engagements from deliverable_performance dp where dp.campaign_id = c.id) m on true
      where not c.is_archived and not c.is_historical and c.status <> 'cancelled'
        and (p.id is not null or (coalesce(c.start_date, p_from) <= p_to and coalesce(c.end_date, p_to) >= p_from))) x;
    return jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('title', 'Campaign performance',
      'columns', rcols('name|Campaign', 'brand|Brand', 'views|Views|number', 'engagements|Engagements|number', 'engagement_rate|Engagement|percent', 'spend|Spend|money', 'cpv|Cost per view|money2', 'revenue|Revenue|money', 'profit|Profit|money'), 'rows', s)));

  elsif p_name = 'creators' then
    -- best value first: lowest cost per view
    select coalesce(jsonb_agg(to_jsonb(x) order by x.cpv nulls last, x.total_paid desc), '[]') into s from (
      select cr.id, cr.name,
        (select count(distinct cc.campaign_id) from campaign_creators cc join campaigns c on c.id = cc.campaign_id
          where cc.creator_id = cr.id and not cc.is_archived and cc.status <> 'dropped' and not c.is_historical
            and coalesce(c.start_date, p_from) <= p_to and coalesce(c.end_date, p_to) >= p_from) campaigns,
        coalesce((select sum(p.amount) from creator_payouts p where p.creator_id = cr.id and not p.is_archived and p.status = 'paid' and not p.is_opening and p.paid_on between p_from and p_to), 0) total_paid,
        m.avg_views, m.avg_engagement,
        case when m.views > 0 and m.cost > 0 then round(m.cost / m.views, 2) end cpv, '/creators/' || cr.id link
      from creators cr
      left join lateral (select round(avg(dp.views)) avg_views, round(avg(dp.engagement_rate), 2) avg_engagement, sum(dp.views) views, sum(dp.cost) filter (where dp.views > 0) cost
                         from deliverable_performance dp where dp.creator_id = cr.id and dp.is_posted and (dp.went_live_at at time zone 'Asia/Kolkata')::date between p_from and p_to) m on true
      where not cr.is_archived) x where x.campaigns > 0 or x.total_paid > 0 or x.avg_views is not null;
    return jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('title', 'Creators — best value first',
      'columns', rcols('name|Creator', 'campaigns|Campaigns|number', 'total_paid|Total paid|money', 'avg_views|Average views|number', 'avg_engagement|Average engagement|percent', 'cpv|Cost per view|money2'), 'rows', s)));

  elsif p_name = 'production' then
    select coalesce(jsonb_agg(jsonb_build_object('stage', initcap(replace(x.stage, '_', ' ')), 'times', x.times, 'avg_days', x.avg_days, 'metric', 'stage', 'key', x.stage) order by x.ord), '[]') into s from (
      select sd.stage, count(*) times, round(avg(sd.hours_in_stage)::numeric / 24, 1) avg_days,
        array_position(array['idea','script','script_approved','pre_production','shoot_scheduled','shot','editing','internal_review','client_review','revisions','approved','scheduled'], sd.stage) ord
      from production_stage_durations sd
      where not sd.is_current and sd.stage not in ('live','cancelled') and (sd.left_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by sd.stage) x;
    select coalesce(jsonb_agg(to_jsonb(y) order by y.avg_revisions desc), '[]') into s2 from (
      select b.id, b.name, count(*) items, round(avg(dl.revision_count), 1) avg_revisions, b.revision_limit, '/brands/' || b.id link
      from deliverables dl join brands b on b.id = dl.brand_id
      where not dl.is_archived and dl.stage <> 'cancelled' and (dl.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by b.id, b.name, b.revision_limit) y;
    return jsonb_build_object('sections', jsonb_build_array(
      jsonb_build_object('title', 'Average days in each stage', 'columns', rcols('stage|Stage', 'times|Items that left it|number', 'avg_days|Average days|days'), 'rows', s),
      jsonb_build_object('title', 'Average revisions per brand', 'columns', rcols('name|Brand', 'items|Items|number', 'avg_revisions|Average revisions|days', 'revision_limit|Limit|number'), 'rows', s2)));

  elsif p_name = 'cashflow' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.week), '[]') into s from (
      select w::date week, coalesce(sum(l.amount) filter (where l.direction = 1), 0) money_in, coalesce(sum(l.amount) filter (where l.direction = -1), 0) money_out,
             coalesce(sum(l.amount * l.direction), 0) net
      from generate_series(date_trunc('week', p_from), date_trunc('week', p_to), interval '1 week') w
      left join money_ledger l on l.entry_date between greatest(w::date, p_from) and least(w::date + 6, p_to) and l.source_table in ('receipt','expense','capital')
        and (is_founder() or l.source_table <> 'capital')
      group by w) x;
    -- closing balance of each account at the end of every week in the range
    select coalesce(jsonb_agg(to_jsonb(y) order by y.week, y.account), '[]') into s2 from (
      select (w::date + 6) week, a.name account,
        coalesce((select sum(l.amount * l.direction) from money_ledger l where l.account_id = a.id and l.entry_date <= least(w::date + 6, p_to)), 0) balance, '/money/accounts/' || a.id link
      from generate_series(date_trunc('week', p_from), date_trunc('week', p_to), interval '1 week') w cross join money_accounts a where not a.is_archived) y;
    return jsonb_build_object('sections', jsonb_build_array(
      jsonb_build_object('title', 'Money in vs out by week', 'columns', rcols('week|Week starting|date', 'money_in|Money in|money', 'money_out|Money out|money', 'net|Net|money'), 'rows', s),
      jsonb_build_object('title', 'Account balances over time', 'columns', rcols('week|Week ending|date', 'account|Account', 'balance|Balance|money'), 'rows', s2)));

  elsif p_name = 'ageing' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.days_overdue desc), '[]') into s from (
      select coalesce(i.invoice_number, 'Invoice') invoice, i.brand_name brand, i.due_date, i.days_overdue,
        case when i.days_overdue = 0 then i.outstanding end not_due, case when i.days_overdue between 1 and 30 then i.outstanding end d30,
        case when i.days_overdue between 31 and 60 then i.outstanding end d60, case when i.days_overdue > 60 then i.outstanding end d61,
        i.outstanding, '/money/invoices/' || i.invoice_id link
      from invoice_totals i where i.document_status = 'sent' and i.outstanding > 0) x;
    select coalesce(jsonb_agg(to_jsonb(y) order by y.due_date nulls last), '[]') into s2 from (
      select p.payee_name payee, 'Payout · ' || initcap(p.status) kind, p.due_date, p.net_payable amount, '/money/payouts/' || p.id link
      from payout_list p where not p.is_archived and p.status in ('pending','approved')
      union all
      select e.description, 'Unpaid bill', e.expense_date, e.total, '/money/expenses/' || e.id from expenses e where not e.is_archived and e.status = 'unpaid') y;
    return jsonb_build_object('sections', jsonb_build_array(
      jsonb_build_object('title', 'Receivables ageing (today)', 'columns', rcols('invoice|Invoice', 'brand|Brand', 'due_date|Due|date', 'not_due|Not due|money', 'd30|1–30 days|money', 'd60|31–60 days|money', 'd61|61+ days|money', 'outstanding|Outstanding|money'), 'rows', s),
      jsonb_build_object('title', 'Payables (today)', 'columns', rcols('payee|Owed to', 'kind|Type', 'due_date|Due|date', 'amount|Amount|money'), 'rows', s2)));

  elsif p_name = 'capital' then
    if not (is_founder() or is_system()) then raise exception 'The capital statement is for founders only'; end if;
    select net_profit into o from money_overview(p_from, p_to, 'invoice');
    select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]') into s from (
      select f.name, coalesce(f.profit_share_pct, 0) share,
        coalesce(sum(e.share * e.sign) filter (where e.entry_date < p_from), 0) opening,
        coalesce(sum(e.share) filter (where e.entry_date between p_from and p_to and e.kind in ('opening_capital','capital_added')), 0) added,
        coalesce(sum(e.share) filter (where e.entry_date between p_from and p_to and e.kind = 'founder_withdrawal'), 0) withdrawn,
        coalesce(sum(e.share) filter (where e.entry_date between p_from and p_to and e.kind = 'profit_transferred'), 0) profit_share,
        coalesce(sum(e.share * e.sign) filter (where e.entry_date <= p_to), 0) closing,
        round(o.net_profit * coalesce(f.profit_share_pct, 0) / 100, 2) period_profit
      from team_members f
      left join lateral (select c.entry_date, c.kind, case when c.kind = 'founder_withdrawal' then -1 else 1 end sign,
                           case when c.founder_id = f.id then c.amount when c.founder_id is null then round(c.amount * coalesce(f.profit_share_pct, 0) / 100, 2) else 0 end share
                         from capital_entries c where not c.is_archived) e on true
      where f.role = 'founder' and not f.is_archived group by f.id, f.name, f.profit_share_pct) x;
    return jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('title', 'Capital statement per founder',
      'columns', rcols('name|Founder', 'share|Profit share|percent', 'opening|Opening|money', 'added|Added|money', 'withdrawn|Withdrawn|money', 'profit_share|Profit share credited|money', 'closing|Closing|money', 'period_profit|Share of this period’s profit (memo)|money'), 'rows', s,
      'note', 'Closing = opening + added − withdrawn + profit share credited. The memo column is this period’s net profit split by share; it is not in the closing figure until it is transferred.')));

  elsif p_name = 'team' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]') into s from (
      select w.member_id id, w.name, initcap(replace(w.role, '_', ' ')) role, w.tasks_done, w.hours_logged, w.records_created, w.records_updated,
        round(coalesce((select sum(pd.worked_minutes) from presence_days(p_from, p_to) pd where pd.member_id = w.member_id), 0) / 60, 1) hours_worked,
        round(coalesce((select sum(pd.break_minutes) from presence_days(p_from, p_to) pd where pd.member_id = w.member_id), 0) / 60, 1) hours_break,
        (select round(avg(a.resolve_minutes) / 60, 1) from andons a where a.created_by = w.member_id and a.resolved_at is not null and (a.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to) blocked_hours
      from work_summary(p_from, p_to) w) x;
    return jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('title', 'Team productivity',
      'columns', rcols('name|Person', 'role|Role', 'tasks_done|Tasks done|number', 'hours_logged|Hours logged on tasks|days', 'hours_worked|Hours at work|days', 'hours_break|Hours on break|days', 'records_created|Records created|number', 'records_updated|Records updated|number', 'blocked_hours|Avg hours to unblock|days'), 'rows', s)));
  end if;
  raise exception 'Unknown report %', p_name;
end $$;
