-- Social Mog OS — feature 7: Opening balances & import (one-time setup wizard).
-- Founders only.
--   go-live date   everything before it is history; from it onwards is tracked in detail
--   opening capital  profit made before go-live + each founder's own money, saved as
--                    capital_entries "Opening capital" dated the day before go-live.
--                    It is capital, never revenue: no report counts it as profit.
--   opening balances each account's actual balance on the go-live date
--   open items      unpaid invoices / unpaid creator & freelancer dues from before
--                    go-live, flagged is_opening: they are tracked and collected / paid,
--                    but never count as revenue or cost of the new period
--   history         old brands / past campaigns from CSV; their money sits in
--                    campaign budgets (is_historical), which no money report reads
-- The check: account balances + owed to us − we owe = opening capital.

alter table public.org_settings
  add column go_live_date      date,
  add column opening_locked_at timestamptz,
  add column opening_locked_by uuid references public.team_members(id);

alter table public.capital_entries
  add column opening_part text check (opening_part in ('accumulated_profit','founder_money','adjustment')),
  add constraint capital_entries_opening_part_rule check (opening_part is null or kind = 'opening_capital');
-- an opening adjustment may be negative (capital was overstated)
alter table public.capital_entries drop constraint capital_entries_amount_check;
alter table public.capital_entries add constraint capital_entries_amount_check
  check (amount > 0 or (opening_part = 'adjustment' and amount <> 0));

alter table public.invoices        add column is_opening boolean not null default false;
alter table public.creator_payouts add column is_opening boolean not null default false;
alter table public.campaigns       add column is_historical boolean not null default false;

-- ─────────────────────────────────────────────────────────────
-- Guards
-- ─────────────────────────────────────────────────────────────
create or replace function public.opening_settings_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.go_live_date, new.opening_locked_at, new.opening_locked_by) is distinct from
     (old.go_live_date, old.opening_locked_at, old.opening_locked_by) then
    if auth.uid() is not null and not is_founder() then
      raise exception 'Only founders can change the go-live date or the opening balances lock';
    end if;
    if old.opening_locked_at is not null and new.opening_locked_at is not null
       and new.go_live_date is distinct from old.go_live_date then
      raise exception 'Opening balances are locked — unlock them first';
    end if;
  end if;
  return new;
end $$;
create trigger org_settings_opening_guard before update on public.org_settings
  for each row execute function public.opening_settings_guard();

-- Opening items can only be added by a founder, while the wizard is unlocked.
create or replace function public.opening_item_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare s org_settings;
begin
  if not new.is_opening or (tg_op = 'UPDATE' and old.is_opening) then return new; end if;
  select * into s from org_settings limit 1;
  if auth.uid() is not null and not is_founder() then raise exception 'Only founders add opening balances'; end if;
  if s.go_live_date is null then raise exception 'Set the go-live date first'; end if;
  if s.opening_locked_at is not null then raise exception 'Opening balances are locked — unlock them first'; end if;
  if tg_table_name = 'invoices' then
    if new.invoice_number is null then raise exception 'Give the old invoice its original number'; end if;
    if new.issue_date is null or new.issue_date >= s.go_live_date then
      raise exception 'An opening invoice is dated before go-live (%)', to_char(s.go_live_date, 'DD Mon YYYY');
    end if;
    new.gst_enabled := false;   -- the amount owed is entered as one figure, GST included
    new.status := 'sent';
  end if;
  return new;
end $$;
create trigger invoices_opening_guard before insert or update on public.invoices
  for each row execute function public.opening_item_guard();
create trigger creator_payouts_opening_guard before insert or update on public.creator_payouts
  for each row execute function public.opening_item_guard();

-- ─────────────────────────────────────────────────────────────
-- Views: opening items are tracked but never revenue / cost; history is flagged
-- ─────────────────────────────────────────────────────────────
create or replace view public.invoice_totals with (security_invoker = true) as
with items as (
  select invoice_id, sum(amount) subtotal, count(*) lines from public.invoice_items where not is_archived group by invoice_id
), paid as (
  select a.invoice_id, sum(a.amount) paid, max(r.received_on) last_paid_on
  from public.receipt_allocations a join public.receipts r on r.id = a.receipt_id
  where not a.is_archived and not r.is_archived group by a.invoice_id
), org as (select state_code from public.org_settings limit 1),
base as (
  select i.*, coalesce(it.subtotal, 0) as sub, coalesce(it.lines, 0) as lines,
    case when i.gst_enabled then round(coalesce(it.subtotal, 0) * i.gst_rate / 100, 2) else 0 end as gst,
    (i.place_of_supply_code is not null and org.state_code is not null and i.place_of_supply_code <> org.state_code) as inter,
    coalesce(p.paid, 0) as paid_amt, p.last_paid_on as lpo
  from public.invoices i
  left join items it on it.invoice_id = i.id
  left join paid p on p.invoice_id = i.id
  left join org on true
  where not i.is_archived
)
select
  b.id as invoice_id, b.brand_id, b.campaign_id, b.retainer_id, b.invoice_number,
  b.issue_date, b.due_date, b.status as document_status,
  b.sub                                                    as subtotal,
  b.gst                                                    as gst_total,
  b.inter                                                  as is_interstate,
  b.sub + b.gst                                            as total,
  b.paid_amt                                               as paid,
  case when b.status = 'sent' then greatest(b.sub + b.gst - b.paid_amt, 0) else 0 end as outstanding,
  b.lpo                                                    as last_paid_on,
  case
    when b.status = 'cancelled' then 'cancelled'
    when b.status = 'draft' then 'draft'
    when b.sub + b.gst > 0 and b.paid_amt >= b.sub + b.gst then 'paid'
    when b.due_date < public.ist_today() then 'overdue'
    when b.paid_amt > 0 then 'partly_paid'
    else 'sent' end                                        as payment_status,
  case when b.status = 'sent' and b.paid_amt < b.sub + b.gst then greatest(public.ist_today() - b.due_date, 0) else 0 end as days_overdue,
  -- new in feature 6
  case when b.inter then 0 else round(b.gst / 2, 2) end    as cgst,
  case when b.inter then 0 else b.gst - round(b.gst / 2, 2) end as sgst,
  case when b.inter then b.gst else 0 end                  as igst,
  b.gst_enabled, b.gst_rate, b.tds_rate,
  round(b.sub * b.tds_rate / 100, 2)                       as tds_expected,
  b.sub + b.gst - round(b.sub * b.tds_rate / 100, 2)       as net_expected,
  case when b.status = 'sent' then public.ist_today() - b.issue_date end as age_days,
  b.lines, b.kind, b.place_of_supply_code, b.service_period_start, b.service_period_end,
  b.sent_at, b.cancel_reason, b.cancelled_at, b.notes, b.created_at, b.updated_at,
  (select name from public.brands where id = b.brand_id)       as brand_name,
  (select name from public.campaigns where id = b.campaign_id) as campaign_name
,
  b.is_opening
from base b;

create or replace view public.pnl_lines with (security_invoker = true) as
  select 'invoice'::text as basis, 'revenue'::text as line, t.issue_date as entry_date, t.subtotal as amount,
         t.brand_id, t.campaign_id, 'invoices'::text as source_table, t.invoice_id as source_id
  from public.invoice_totals t where t.document_status = 'sent' and not t.is_opening
union all
  select 'cash', 'revenue', r.received_on, round(a.amount * t.subtotal / nullif(t.total, 0), 2),
         t.brand_id, t.campaign_id, 'receipts', r.id
  from public.receipt_allocations a join public.receipts r on r.id = a.receipt_id join public.invoice_totals t on t.invoice_id = a.invoice_id
  where not a.is_archived and not r.is_archived and t.document_status = 'sent' and not t.is_opening
union all
  select b.basis, 'other_income', r.received_on, r.amount_received, r.brand_id, null, 'receipts', r.id
  from public.receipts r cross join (values ('invoice'), ('cash')) b(basis)
  where not r.is_archived and r.category = 'other_income'
union all
  select 'invoice', 'creator_payout', coalesce(p.paid_on, p.due_date, (p.created_at at time zone 'Asia/Kolkata')::date), p.amount,
         p.brand_id, p.campaign_id, 'creator_payouts', p.id
  from public.creator_payouts p where not p.is_archived and p.status <> 'cancelled' and not p.is_opening
union all
  select 'cash', 'creator_payout', p.paid_on, p.amount, p.brand_id, p.campaign_id, 'creator_payouts', p.id
  from public.creator_payouts p where not p.is_archived and p.status = 'paid' and not p.is_opening
union all
  select 'invoice', case c.treatment when 'direct' then 'direct_expense' else 'overhead_expense' end, e.expense_date, e.amount,
         e.brand_id, e.campaign_id, 'expenses', e.id
  from public.expenses e join public.expense_categories c on c.id = e.category_id
  where not e.is_archived and e.payout_id is null and c.treatment in ('direct','overhead')
union all
  select 'cash', case c.treatment when 'direct' then 'direct_expense' else 'overhead_expense' end, e.paid_on, e.amount,
         e.brand_id, e.campaign_id, 'expenses', e.id
  from public.expenses e join public.expense_categories c on c.id = e.category_id
  where not e.is_archived and e.payout_id is null and c.treatment in ('direct','overhead') and e.status = 'paid';

create or replace view public.gst_register with (security_invoker = true) as
select t.invoice_id, t.invoice_number, t.issue_date, t.brand_id, b.billing_name, b.name as brand_name, b.gstin as brand_gstin,
  t.place_of_supply_code, b.state as brand_state, t.is_interstate, t.gst_rate,
  t.subtotal as taxable_value, t.cgst, t.sgst, t.igst, t.gst_total, t.total
from public.invoice_totals t join public.brands b on b.id = t.brand_id
where t.document_status = 'sent' and not t.is_opening;

create or replace function public.money_overview(p_from date, p_to date, p_basis text default 'invoice')
returns table (
  revenue_invoiced numeric, revenue numeric, cash_received numeric, other_income numeric,
  creator_payouts numeric, direct_expenses numeric, overhead_expenses numeric, expenses numeric,
  gross_profit numeric, net_profit numeric, gross_margin_pct numeric, net_margin_pct numeric,
  gst_output numeric, gst_input numeric,
  outstanding numeric, overdue numeric, outstanding_invoices bigint,
  age_0_30 numeric, age_31_60 numeric, age_61_plus numeric,
  payouts_pending numeric, payouts_pending_count bigint, payouts_overdue_count bigint,
  unpaid_expenses numeric)
language sql stable security invoker set search_path = public as $$
  with l as (
    select line, sum(amount) amt from pnl_lines
    where basis = case when p_basis = 'cash' then 'cash' else 'invoice' end and entry_date between p_from and p_to
    group by line
  ), v as (
    select coalesce(sum(amt) filter (where line = 'revenue'), 0) rev,
           coalesce(sum(amt) filter (where line = 'other_income'), 0) oth,
           coalesce(sum(amt) filter (where line = 'creator_payout'), 0) po,
           coalesce(sum(amt) filter (where line = 'direct_expense'), 0) dir,
           coalesce(sum(amt) filter (where line = 'overhead_expense'), 0) ovh
    from l
  ), o as (
    select coalesce(sum(outstanding), 0) outs,
           coalesce(sum(outstanding) filter (where payment_status = 'overdue'), 0) ovd,
           count(*) filter (where outstanding > 0) n,
           coalesce(sum(outstanding) filter (where age_days <= 30), 0) a1,
           coalesce(sum(outstanding) filter (where age_days between 31 and 60), 0) a2,
           coalesce(sum(outstanding) filter (where age_days > 60), 0) a3
    from invoice_totals where document_status = 'sent'
  )
  select
    (select coalesce(sum(subtotal), 0) from invoice_totals where document_status = 'sent' and not is_opening and issue_date between p_from and p_to),
    v.rev,
    (select coalesce(sum(amount_received), 0) from receipts where not is_archived and received_on between p_from and p_to),
    v.oth, v.po, v.dir, v.ovh, v.dir + v.ovh,
    v.rev - v.po - v.dir,
    v.rev - v.po - v.dir - v.ovh + v.oth,
    case when v.rev > 0 then round((v.rev - v.po - v.dir) / v.rev * 100, 1) end,
    case when v.rev > 0 then round((v.rev - v.po - v.dir - v.ovh + v.oth) / v.rev * 100, 1) end,
    (select coalesce(sum(gst_total), 0) from invoice_totals where document_status = 'sent' and not is_opening and issue_date between p_from and p_to),
    (select coalesce(sum(e.gst_amount), 0) from expenses e where not e.is_archived and e.expense_date between p_from and p_to),
    o.outs, o.ovd, o.n, o.a1, o.a2, o.a3,
    (select coalesce(sum(net_payable), 0) from creator_payout_totals where status in ('pending','approved')),
    (select count(*) from creator_payout_totals where status in ('pending','approved')),
    (select count(*) from creator_payout_totals where status in ('pending','approved') and due_date < ist_today()),
    (select coalesce(sum(total), 0) from expenses where not is_archived and status = 'unpaid')
  from v, o
$$;

create or replace view public.brand_overview with (security_invoker = true) as
select
  b.id, b.created_at, b.updated_at, b.created_by, b.is_archived, b.archived_at,
  b.name, b.billing_name, b.logo_path, b.industry, b.website, b.instagram_handle, b.youtube_handle,
  b.engagement_type, b.status, b.source, b.owner_id, owner.name as owner_name, owner.photo_path as owner_photo_path,
  b.city, b.state, b.state_code, b.gstin, b.pan, b.billing_address, b.payment_terms_days, b.notes,
  coalesce(money.billed, 0)      as lifetime_revenue,
  coalesce(money.received, 0)    as received,
  coalesce(money.outstanding, 0) as outstanding,
  coalesce(money.overdue, 0)     as overdue,
  coalesce(camp.active, 0)       as active_campaigns,
  coalesce(camp.total, 0)        as total_campaigns,
  pc.id as primary_contact_id, pc.name as primary_contact_name, pc.email as primary_contact_email,
  pc.phone as primary_contact_phone,
  r.id as retainer_id, r.status as retainer_status, r.monthly_fee, r.start_date as retainer_start_date,
  r.billing_day, r.renewal_date,
  (r.renewal_date - public.ist_today())                           as days_to_renewal,
  coalesce(r.status = 'active' and r.renewal_date - public.ist_today() <= 15, false) as renewal_warning,
  -- history imported by the opening wizard: shown on the brand page, never in money reports
  coalesce(hist.revenue, 0) as historical_revenue, coalesce(hist.campaigns, 0) as historical_campaigns
from public.brands b
left join public.team_members owner on owner.id = b.owner_id
left join lateral (
  select sum(t.subtotal) filter (where t.document_status = 'sent' and not t.is_opening) as billed,
         sum(t.paid)                                                    as received,
         sum(t.outstanding) filter (where t.document_status = 'sent') as outstanding,
         sum(t.outstanding) filter (where t.payment_status like '%overdue') as overdue
  from public.invoice_totals t where t.brand_id = b.id
) money on true
left join lateral (
  select count(*) filter (where c.status in ('creator_outreach','production','content_review','live','reporting')) as active,
         count(*) filter (where c.status <> 'cancelled') as total
  from public.campaigns c where c.brand_id = b.id and not c.is_archived
) camp on true
left join lateral (
  select c.id, c.name, c.email, c.phone from public.brand_contacts c
  where c.brand_id = b.id and not c.is_archived
  order by c.is_primary desc, c.created_at limit 1
) pc on true
left join lateral (
  select * from public.retainers x
  where x.brand_id = b.id and not x.is_archived and x.status in ('draft','active','paused')
  order by (x.status = 'active') desc, x.start_date desc limit 1
) r on true
left join lateral (
  select sum(f.contract_value) as revenue, count(*) as campaigns
  from public.campaigns c left join public.campaign_finances f on f.campaign_id = c.id
  where c.brand_id = b.id and c.is_historical and not c.is_archived
) hist on true;

create or replace view public.brand_financials with (security_invoker = true) as
select b.id as brand_id, b.name,
  coalesce(sum(t.subtotal) filter (where t.document_status = 'sent' and not t.is_opening), 0) as billed,
  coalesce(sum(t.paid), 0)                                                  as received,
  coalesce(sum(t.outstanding) filter (where t.document_status = 'sent'), 0) as outstanding,
  coalesce(sum(t.outstanding) filter (where t.payment_status like '%overdue'), 0) as overdue,
  (select count(*) from public.campaigns c where c.brand_id = b.id and not c.is_archived) as campaigns,
  (select count(*) from public.campaigns c where c.brand_id = b.id and not c.is_archived
     and c.status in ('creator_outreach','production','content_review','live','reporting')) as active_campaigns
from public.brands b
left join public.invoice_totals t on t.brand_id = b.id
where not b.is_archived
group by b.id;

create or replace view public.campaign_summary with (security_invoker = true) as
select
  c.id as campaign_id, c.brand_id, b.name as brand_name, b.logo_path as brand_logo_path,
  c.name, c.code, c.kind, c.objective, c.status, c.platforms, c.start_date, c.end_date, c.owner_id,
  owner.name as owner_name, c.is_archived, c.updated_at, c.created_at, c.completed_at,
  fin.contract_value as client_budget, fin.creator_budget as planned_creator_spend, fin.production_budget as planned_production_spend,
  case when fin.contract_value is not null then fin.contract_value - coalesce(fin.creator_budget,0) - coalesce(fin.production_budget,0) end as expected_margin,
  cc.creators, cc.confirmed_creators, cc.actual_creator_spend,
  coalesce(inv.billed, 0) as client_billing, coalesce(inv.received, 0) as received,
  coalesce(po.payouts, 0) as creator_payouts, coalesce(ex.expenses, 0) as production_expenses,
  case when public.is_staff() then coalesce(inv.billed,0) - coalesce(po.payouts,0) - coalesce(ex.expenses,0) end as profit,
  dv.deliverables, dv.posted, dv.overdue, dv.approved,
  pf.views, pf.reach, pf.engagements, pf.likes, pf.comments, pf.shares, pf.saves, pf.link_clicks, pf.conversions,
  case when coalesce(pf.views,0) > 0 then round(pf.engagements::numeric / pf.views * 100, 2) end as engagement_rate,
  case when coalesce(pf.views,0) > 0 and cc.actual_creator_spend is not null then round(cc.actual_creator_spend / pf.views, 4) end as cost_per_view,
  case when coalesce(pf.views,0) > 0 and fin.contract_value is not null then round(fin.contract_value / pf.views, 4) end as client_cost_per_view,
  c.is_historical
from public.campaigns c
join public.brands b on b.id = c.brand_id
left join public.team_members owner on owner.id = c.owner_id
left join public.campaign_finances fin on fin.campaign_id = c.id
left join lateral (
  select count(*) filter (where x.status <> 'dropped') as creators,
         count(*) filter (where public.creator_status_confirmed(x.status)) as confirmed_creators,
         sum(f.agreed_fee) filter (where public.creator_status_confirmed(x.status)) as actual_creator_spend
  from public.campaign_creators x left join public.campaign_creator_fees f on f.campaign_creator_id = x.id
  where x.campaign_id = c.id and not x.is_archived
) cc on true
left join lateral (
  select sum(t.subtotal) filter (where t.document_status = 'sent') as billed, sum(t.paid) as received
  from public.invoice_totals t where t.campaign_id = c.id
) inv on true
left join lateral (select sum(t.gross) as payouts from public.creator_payout_totals t where t.campaign_id = c.id) po on true
left join lateral (select sum(e.amount) as expenses from public.expenses e join public.expense_categories k on k.id = e.category_id
                   where e.campaign_id = c.id and not e.is_archived and e.payout_id is null and k.treatment in ('direct','overhead')) ex on true
left join lateral (
  select count(*) filter (where p.stage <> 'cancelled') as deliverables, count(*) filter (where p.is_posted) as posted,
         count(*) filter (where p.is_overdue) as overdue, count(*) filter (where p.approval_status = 'approved') as approved
  from public.deliverable_performance p where p.campaign_id = c.id
) dv on true
left join lateral (
  select sum(p.views) as views, sum(p.reach) as reach, sum(p.engagements) as engagements,
         sum(p.likes) as likes, sum(p.comments) as comments, sum(p.shares) as shares, sum(p.saves) as saves,
         sum(p.link_clicks) as link_clicks, sum(p.conversions) as conversions
  from public.deliverable_performance p where p.campaign_id = c.id
) pf on true;

create or replace view public.creator_campaign_history with (security_invoker = true) as
select
  cc.id as campaign_creator_id, cc.creator_id, cc.campaign_id, cc.status as creator_status,
  cm.name as campaign_name, cm.status as campaign_status, cm.start_date, cm.end_date,
  b.id as brand_id, b.name as brand_name,
  f.agreed_fee,
  coalesce((select sum(t.gross) from public.creator_payout_totals t join public.creator_payouts po on po.id = t.payout_id
            where po.campaign_creator_id = cc.id and t.status = 'paid'), 0) as paid,
  (select count(*) from public.deliverables d where d.campaign_creator_id = cc.id and not d.is_archived) as deliverables,
  (select count(*) from public.deliverables d where d.campaign_creator_id = cc.id and not d.is_archived and d.stage = 'live') as live,
  (select sum(m.views) from public.deliverables d
     join lateral (select views from public.deliverable_metrics dm where dm.deliverable_id = d.id order by captured_on desc limit 1) m on true
   where d.campaign_creator_id = cc.id and not d.is_archived) as total_views,
  cm.is_historical
from public.campaign_creators cc
join public.campaigns cm on cm.id = cc.campaign_id
join public.brands b on b.id = cm.brand_id
left join public.campaign_creator_fees f on f.campaign_creator_id = cc.id
where not cc.is_archived;
-- ─────────────────────────────────────────────────────────────
-- The wizard's functions (founders only; refused while locked)
-- ─────────────────────────────────────────────────────────────
create or replace function public.opening_assert_open(p_need_date boolean default true)
returns date language plpgsql stable security invoker set search_path = public as $$
declare s org_settings;
begin
  if not is_founder() then raise exception 'Only founders can set opening balances'; end if;
  select * into s from org_settings limit 1;
  if s.opening_locked_at is not null then raise exception 'Opening balances are locked — unlock them first'; end if;
  if p_need_date and s.go_live_date is null then raise exception 'Set the go-live date first'; end if;
  return s.go_live_date;
end $$;

-- Step 1. Moving the date moves the opening entries and account opening dates with it.
create or replace function public.opening_set_go_live(p_date date)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform opening_assert_open(false);
  if p_date is null then raise exception 'Pick a go-live date'; end if;
  if exists (select 1 from invoices where is_opening and not is_archived and issue_date >= p_date) then
    raise exception 'An opening invoice is dated on or after that day — change or remove it first';
  end if;
  update org_settings set go_live_date = p_date where singleton;
  update capital_entries set entry_date = p_date - 1, change_reason = 'Opening balances wizard: go-live date changed'
   where opening_part is not null and not is_archived and entry_date <> p_date - 1;
  update money_accounts set opening_date = p_date, change_reason = 'Opening balances wizard: go-live date changed'
   where not is_archived and opening_date <> p_date;
end $$;

-- Step 2. p_rows: [{"founder_id": "...", "accumulated_profit": 1000, "own_money": 5000}, ...]
-- Replaces what the wizard saved before. Dated the day before go-live.
create or replace function public.opening_save_capital(p_rows jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare v_live date := opening_assert_open(); r jsonb; v_f uuid; v_p numeric; v_m numeric;
begin
  update capital_entries set is_archived = true, change_reason = 'Opening balances wizard: capital re-entered'
   where opening_part in ('accumulated_profit','founder_money') and not is_archived;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_f := (r->>'founder_id')::uuid;
    v_p := coalesce((r->>'accumulated_profit')::numeric, 0);
    v_m := coalesce((r->>'own_money')::numeric, 0);
    if v_p < 0 or v_m < 0 then raise exception 'Amounts can’t be negative — use an opening adjustment for a loss'; end if;
    if v_p > 0 then
      insert into capital_entries (kind, opening_part, founder_id, entry_date, amount, notes)
      values ('opening_capital', 'accumulated_profit', v_f, v_live - 1, v_p, 'Share of profit made before go-live');
    end if;
    if v_m > 0 then
      insert into capital_entries (kind, opening_part, founder_id, entry_date, amount, notes)
      values ('opening_capital', 'founder_money', v_f, v_live - 1, v_m, 'Founder’s own money put in before go-live');
    end if;
  end loop;
end $$;

-- Step 3. p_rows: [{"account_id": "...", "balance": 12000}, ...] — the real balance on go-live day.
create or replace function public.opening_set_balances(p_rows jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare v_live date := opening_assert_open(); r jsonb;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    update money_accounts set opening_balance = coalesce((r->>'balance')::numeric, 0), opening_date = v_live,
           change_reason = 'Opening balances wizard'
     where id = (r->>'account_id')::uuid
       and (opening_balance, opening_date) is distinct from (coalesce((r->>'balance')::numeric, 0), v_live);
  end loop;
end $$;

-- The difference, explained in a note. Positive = more capital, negative = less.
create or replace function public.opening_add_adjustment(p_amount numeric, p_note text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_live date := opening_assert_open(); v_id uuid;
begin
  if coalesce(p_amount, 0) = 0 then raise exception 'The adjustment can’t be zero'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Add a note saying what the adjustment is for'; end if;
  insert into capital_entries (kind, opening_part, founder_id, entry_date, amount, notes)
  values ('opening_capital', 'adjustment', null, v_live - 1, p_amount, btrim(p_note)) returning id into v_id;
  return v_id;
end $$;

-- Step 4a. An invoice still unpaid on go-live day. p_amount = what is still owed (GST included).
create or replace function public.opening_add_invoice(
  p_brand uuid, p_number text, p_issue_date date, p_due_date date, p_amount numeric, p_note text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  perform opening_assert_open();
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount still owed'; end if;
  insert into invoices (brand_id, invoice_number, issue_date, due_date, status, is_opening, gst_enabled, notes)
  values (p_brand, btrim(p_number), p_issue_date, coalesce(p_due_date, p_issue_date), 'sent', true, false,
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Opening balance — unpaid on the go-live date'))
  returning id into v_id;
  insert into invoice_items (invoice_id, position, description, quantity, rate)
  values (v_id, 1, 'Opening balance — amount still owed from before go-live', 1, p_amount);
  return v_id;
end $$;

-- Step 4b. A creator / freelancer due still unpaid on go-live day.
create or replace function public.opening_add_payout(
  p_creator uuid, p_vendor uuid, p_amount numeric, p_tds_rate numeric default 0, p_due_date date default null, p_description text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  perform opening_assert_open();
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount still owed'; end if;
  insert into creator_payouts (creator_id, vendor_id, amount, tds_rate, due_date, status, is_opening, description)
  values (p_creator, p_vendor, p_amount, coalesce(p_tds_rate, 0), p_due_date, 'pending', true,
          coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'Opening balance — due from before go-live'))
  returning id into v_id;
  return v_id;
end $$;

-- Take back something entered in the wizard by mistake.
-- p_kind: 'invoice' | 'payout' | 'adjustment'
create or replace function public.opening_remove(p_kind text, p_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform opening_assert_open();
  if p_kind = 'invoice' then
    if exists (select 1 from receipt_allocations a join receipts r on r.id = a.receipt_id
               where a.invoice_id = p_id and not a.is_archived and not r.is_archived) then
      raise exception 'Money has already been received against this invoice';
    end if;
    update invoices set is_archived = true, change_reason = 'Removed in the opening balances wizard' where id = p_id and is_opening;
  elsif p_kind = 'payout' then
    if exists (select 1 from creator_payouts where id = p_id and status = 'paid') then raise exception 'This due has already been paid'; end if;
    update creator_payouts set is_archived = true, change_reason = 'Removed in the opening balances wizard' where id = p_id and is_opening;
  elsif p_kind = 'adjustment' then
    update capital_entries set is_archived = true, change_reason = 'Removed in the opening balances wizard' where id = p_id and opening_part = 'adjustment';
  else raise exception 'Unknown kind %', p_kind;
  end if;
end $$;

-- Everything the wizard and its summary show, as one document.
--   difference = (accounts + receivables − payables) − opening capital     (0 = it balances)
-- Figures are "as at go-live": later payments don't change this summary.
create or replace function public.opening_state()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare s org_settings; v jsonb; v_cap numeric; v_acc numeric; v_rec numeric; v_pay numeric;
begin
  if not is_founder() then raise exception 'Only founders can see opening balances'; end if;
  select * into s from org_settings limit 1;
  select coalesce(sum(amount), 0) into v_cap from capital_entries where kind = 'opening_capital' and not is_archived;
  select coalesce(sum(opening_balance), 0) into v_acc from money_accounts where not is_archived;
  select coalesce(sum(t.total), 0) into v_rec from invoice_totals t where t.is_opening and t.document_status = 'sent';
  select coalesce(sum(amount), 0) into v_pay from creator_payouts where is_opening and not is_archived and status <> 'cancelled';
  v := jsonb_build_object(
    'go_live_date', s.go_live_date, 'locked_at', s.opening_locked_at,
    'locked_by_name', (select name from team_members where id = s.opening_locked_by),
    'founders', coalesce((select jsonb_agg(jsonb_build_object(
        'founder_id', f.id, 'name', f.name, 'profit_share_pct', coalesce(f.profit_share_pct, 0),
        'accumulated_profit', coalesce((select sum(amount) from capital_entries c where c.founder_id = f.id and c.opening_part = 'accumulated_profit' and not c.is_archived), 0),
        'own_money', coalesce((select sum(amount) from capital_entries c where c.founder_id = f.id and c.opening_part = 'founder_money' and not c.is_archived), 0),
        -- company-level opening entries (adjustments, entries made outside the wizard) split by profit share
        'other', coalesce((select sum(case when c.founder_id = f.id then c.amount else round(c.amount * coalesce(f.profit_share_pct, 0) / 100, 2) end)
                           from capital_entries c where c.kind = 'opening_capital' and not c.is_archived
                             and (c.founder_id is null or (c.founder_id = f.id and coalesce(c.opening_part, 'adjustment') = 'adjustment'))), 0),
        'total', coalesce((select sum(case when c.founder_id = f.id then c.amount else round(c.amount * coalesce(f.profit_share_pct, 0) / 100, 2) end)
                           from capital_entries c where c.kind = 'opening_capital' and not c.is_archived
                             and (c.founder_id is null or c.founder_id = f.id)), 0)
      ) order by f.name) from team_members f where f.role = 'founder' and not f.is_archived), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'amount', c.amount, 'note', c.notes) order by c.created_at)
      from capital_entries c where c.opening_part = 'adjustment' and not c.is_archived), '[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('account_id', a.id, 'name', a.name, 'kind', a.kind,
        'opening_balance', a.opening_balance, 'opening_date', a.opening_date) order by a.is_default desc, a.name)
      from money_accounts a where not a.is_archived), '[]'::jsonb),
    'receivables', coalesce((select jsonb_agg(jsonb_build_object('invoice_id', t.invoice_id, 'invoice_number', t.invoice_number,
        'brand_id', t.brand_id, 'brand_name', t.brand_name, 'issue_date', t.issue_date, 'due_date', t.due_date,
        'amount', t.total, 'outstanding', t.outstanding) order by t.issue_date)
      from invoice_totals t where t.is_opening and t.document_status = 'sent'), '[]'::jsonb),
    'payables', coalesce((select jsonb_agg(jsonb_build_object('payout_id', p.id, 'payee_name', p.payee_name, 'payee_kind', p.payee_kind,
        'creator_id', p.creator_id, 'vendor_id', p.vendor_id, 'description', p.description, 'due_date', p.due_date,
        'amount', p.gross, 'tds_rate', p.tds_rate, 'status', p.status) order by p.created_at)
      from payout_list p join creator_payouts x on x.id = p.id where x.is_opening and not p.is_archived and p.status <> 'cancelled'), '[]'::jsonb),
    'totals', jsonb_build_object('capital', v_cap, 'accounts', v_acc, 'receivables', v_rec, 'payables', v_pay,
        'net_position', v_acc + v_rec - v_pay, 'difference', v_acc + v_rec - v_pay - v_cap,
        'is_balanced', abs(v_acc + v_rec - v_pay - v_cap) < 1));
  return v;
end $$;

-- Finish: lock. Refused while the check doesn't balance.
create or replace function public.opening_lock()
returns void language plpgsql security invoker set search_path = public as $$
declare v_diff numeric;
begin
  perform opening_assert_open();
  v_diff := (opening_state()->'totals'->>'difference')::numeric;
  if abs(v_diff) >= 1 then
    raise exception 'The opening balances are ₹% apart — fix them or add an opening adjustment first', abs(v_diff);
  end if;
  update org_settings set opening_locked_at = now(), opening_locked_by = current_member_id() where singleton;
end $$;

-- Re-open: a founder who has just typed their password (the app signs in again
-- with it, and the login token then says "password, a moment ago").
create or replace function public.opening_unlock()
returns void language plpgsql security invoker set search_path = public as $$
declare v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb; v_at bigint;
begin
  if not is_founder() then raise exception 'Only founders can re-open opening balances'; end if;
  select max((a->>'timestamp')::bigint) into v_at
  from jsonb_array_elements(case when jsonb_typeof(v_claims->'amr') = 'array' then v_claims->'amr' else '[]'::jsonb end) a
  where a->>'method' = 'password';
  if v_at is null or extract(epoch from now()) - v_at > 600 then
    raise exception 'Confirm with your password to re-open opening balances';
  end if;
  update org_settings set opening_locked_at = null, opening_locked_by = null where singleton;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Step 5. History import (records only). Each takes the mapped CSV rows as
-- JSON and returns {"created": n, "skipped": n, "errors": [{"row": 3, "name": "...", "problem": "..."}]}.
-- Row numbers count from 1 (the first data row). Dates are YYYY-MM-DD.
-- ─────────────────────────────────────────────────────────────
-- brands: name*, billing_name, industry, city, state, gstin, website, instagram_handle,
--         contact_name, contact_email, contact_phone, notes. Existing names are skipped.
create or replace function public.import_history_brands(p_rows jsonb, p_source text default 'CSV')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare r jsonb; n int := 0; v_created int := 0; v_skipped int := 0; v_err jsonb := '[]'; v_batch uuid; v_id uuid; v_name text; v_gstin text;
begin
  if not is_founder() then raise exception 'Only founders can import history'; end if;
  perform set_config('app.activity_source', 'import', true);
  insert into import_batches (source_name, target_table, status, rows_total)
  values (coalesce(p_source, 'CSV'), 'brands', 'committed', jsonb_array_length(coalesce(p_rows, '[]'::jsonb))) returning id into v_batch;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    n := n + 1; v_name := nullif(btrim(coalesce(r->>'name', '')), '');
    begin
      if v_name is null then raise exception 'No brand name'; end if;
      if exists (select 1 from brands where lower(name) = lower(v_name)) then v_skipped := v_skipped + 1; continue; end if;
      v_gstin := upper(nullif(btrim(coalesce(r->>'gstin', '')), ''));
      if v_gstin is not null and v_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' then
        v_err := v_err || jsonb_build_object('row', n, 'name', v_name, 'problem', 'GSTIN doesn’t look right — imported without it'); v_gstin := null;
      end if;
      insert into brands (name, billing_name, industry, city, state, gstin, state_code, website, instagram_handle, status, notes, import_batch_id)
      values (v_name, nullif(btrim(coalesce(r->>'billing_name', '')), ''), nullif(btrim(coalesce(r->>'industry', '')), ''),
              nullif(btrim(coalesce(r->>'city', '')), ''), nullif(btrim(coalesce(r->>'state', '')), ''), v_gstin, left(v_gstin, 2),
              nullif(btrim(coalesce(r->>'website', '')), ''), nullif(ltrim(btrim(coalesce(r->>'instagram_handle', '')), '@'), ''),
              'ended', nullif(btrim(coalesce(r->>'notes', '')), ''), v_batch)
      returning id into v_id;
      if nullif(btrim(coalesce(r->>'contact_name', '')), '') is not null then
        insert into brand_contacts (brand_id, name, email, phone, is_primary)
        values (v_id, btrim(r->>'contact_name'), nullif(btrim(coalesce(r->>'contact_email', '')), ''), nullif(btrim(coalesce(r->>'contact_phone', '')), ''), true);
      end if;
      v_created := v_created + 1;
    exception when others then
      v_err := v_err || jsonb_build_object('row', n, 'name', coalesce(v_name, ''), 'problem', sqlerrm);
    end;
  end loop;
  update import_batches set rows_valid = v_created, rows_invalid = jsonb_array_length(v_err), committed_at = now() where id = v_batch;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'errors', v_err, 'batch_id', v_batch);
end $$;

-- past campaigns: brand* (must exist), name*, start_date, end_date, kind
-- (influencer | production | full_marketing_month | ugc), client_fee, creator_spend, notes.
-- Saved as completed, is_historical. The money goes into the campaign's budget
-- figures only — no invoice, payout or expense is made, so no money report sees it.
create or replace function public.import_history_campaigns(p_rows jsonb, p_source text default 'CSV')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare r jsonb; n int := 0; v_created int := 0; v_skipped int := 0; v_err jsonb := '[]'; v_batch uuid; v_id uuid; v_brand uuid;
  v_name text; v_kind text; v_start date; v_end date; v_live date;
begin
  if not is_founder() then raise exception 'Only founders can import history'; end if;
  select go_live_date into v_live from org_settings limit 1;
  perform set_config('app.activity_source', 'import', true);
  insert into import_batches (source_name, target_table, status, rows_total)
  values (coalesce(p_source, 'CSV'), 'campaigns', 'committed', jsonb_array_length(coalesce(p_rows, '[]'::jsonb))) returning id into v_batch;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    n := n + 1; v_name := nullif(btrim(coalesce(r->>'name', '')), '');
    begin
      if v_name is null then raise exception 'No campaign name'; end if;
      select id into v_brand from brands where lower(name) = lower(btrim(coalesce(r->>'brand', ''))) order by is_archived limit 1;
      if v_brand is null then raise exception 'Brand “%” not found — import the brand first', coalesce(r->>'brand', ''); end if;
      if exists (select 1 from campaigns where brand_id = v_brand and lower(name) = lower(v_name)) then v_skipped := v_skipped + 1; continue; end if;
      v_start := nullif(btrim(coalesce(r->>'start_date', '')), '')::date;
      v_end := nullif(btrim(coalesce(r->>'end_date', '')), '')::date;
      if v_live is not null and coalesce(v_start, v_end) >= v_live then
        raise exception 'Starts on or after go-live — add it as a normal campaign';
      end if;
      v_kind := lower(nullif(btrim(coalesce(r->>'kind', '')), ''));
      if v_kind is null or v_kind not in ('influencer','production','full_marketing_month','ugc') then v_kind := 'influencer'; end if;
      insert into campaigns (brand_id, name, kind, status, start_date, end_date, brief, is_historical)
      values (v_brand, v_name, v_kind, 'completed', v_start, coalesce(v_end, v_start), nullif(btrim(coalesce(r->>'notes', '')), ''), true)
      returning id into v_id;
      insert into campaign_finances (campaign_id, contract_value, creator_budget)
      values (v_id, nullif(btrim(coalesce(r->>'client_fee', '')), '')::numeric, nullif(btrim(coalesce(r->>'creator_spend', '')), '')::numeric)
      on conflict (campaign_id) do update set contract_value = excluded.contract_value, creator_budget = excluded.creator_budget;
      v_created := v_created + 1;
    exception when others then
      v_err := v_err || jsonb_build_object('row', n, 'name', coalesce(v_name, ''), 'problem', sqlerrm);
    end;
  end loop;
  update import_batches set rows_valid = v_created, rows_invalid = jsonb_array_length(v_err), committed_at = now() where id = v_batch;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'errors', v_err, 'batch_id', v_batch);
end $$;

-- who was on a past campaign: brand*, campaign*, creator* (all must exist), fee.
create or replace function public.import_history_campaign_creators(p_rows jsonb, p_source text default 'CSV')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare r jsonb; n int := 0; v_created int := 0; v_skipped int := 0; v_err jsonb := '[]'; v_batch uuid; v_camp uuid; v_creator uuid; v_cc uuid; v_name text;
begin
  if not is_founder() then raise exception 'Only founders can import history'; end if;
  perform set_config('app.activity_source', 'import', true);
  insert into import_batches (source_name, target_table, status, rows_total)
  values (coalesce(p_source, 'CSV'), 'campaign_creators', 'committed', jsonb_array_length(coalesce(p_rows, '[]'::jsonb))) returning id into v_batch;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    n := n + 1; v_name := btrim(coalesce(r->>'creator', ''));
    begin
      select c.id into v_camp from campaigns c join brands b on b.id = c.brand_id
       where c.is_historical and lower(c.name) = lower(btrim(coalesce(r->>'campaign', '')))
         and (nullif(btrim(coalesce(r->>'brand', '')), '') is null or lower(b.name) = lower(btrim(r->>'brand'))) limit 1;
      if v_camp is null then raise exception 'Past campaign “%” not found — import the campaigns first', coalesce(r->>'campaign', ''); end if;
      select id into v_creator from creators where lower(name) = lower(v_name) order by is_archived limit 1;
      if v_creator is null then raise exception 'Creator “%” not found — import creators first', v_name; end if;
      if exists (select 1 from campaign_creators where campaign_id = v_camp and creator_id = v_creator) then v_skipped := v_skipped + 1; continue; end if;
      insert into campaign_creators (campaign_id, creator_id, status) values (v_camp, v_creator, 'paid') returning id into v_cc;
      if nullif(btrim(coalesce(r->>'fee', '')), '') is not null then
        insert into campaign_creator_fees (campaign_creator_id, agreed_fee) values (v_cc, (r->>'fee')::numeric)
        on conflict (campaign_creator_id) do update set agreed_fee = excluded.agreed_fee;
      end if;
      v_created := v_created + 1;
    exception when others then
      v_err := v_err || jsonb_build_object('row', n, 'name', v_name, 'problem', sqlerrm);
    end;
  end loop;
  update import_batches set rows_valid = v_created, rows_invalid = jsonb_array_length(v_err), committed_at = now() where id = v_batch;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'errors', v_err, 'batch_id', v_batch);
end $$;
