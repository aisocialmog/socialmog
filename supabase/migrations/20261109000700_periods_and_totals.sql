-- Social Mog OS — 0007 periods (IST, Indian financial year) and calculated totals.
-- All views use security_invoker so the caller's RLS applies.

-- ─────────────────────────────────────────────────────────────
-- Periods
-- ─────────────────────────────────────────────────────────────
create or replace function public.ist_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- Financial year start (1 April) for a date.
create or replace function public.fy_start(d date)
returns date language sql immutable as $$
  select make_date(case when extract(month from d) >= 4 then extract(year from d)::int
                        else extract(year from d)::int - 1 end, 4, 1)
$$;

-- '2026-27'
create or replace function public.fy_label(d date)
returns text language sql immutable as $$
  select extract(year from public.fy_start(d))::int || '-' ||
         lpad(((extract(year from public.fy_start(d))::int + 1) % 100)::text, 2, '0')
$$;

-- period: this_week | last_week | this_month | last_month | this_quarter | last_quarter
--         this_fy | last_fy | custom   (weeks run Monday–Sunday; quarters are FY quarters)
create or replace function public.period_bounds(
  period text, custom_from date default null, custom_to date default null, today date default null)
returns table (start_date date, end_date date)
language plpgsql stable as $$
declare
  t date := coalesce(today, public.ist_today());
  wk date := t - (extract(isodow from t)::int - 1);
  mo date := date_trunc('month', t)::date;
  fy date := public.fy_start(t);
  months_in int := (extract(year from t)::int - extract(year from fy)::int) * 12
                   + extract(month from t)::int - 4;
  q  date := (fy + make_interval(months => (months_in / 3) * 3))::date;
begin
  case period
    when 'this_week'    then return query select wk, wk + 6;
    when 'last_week'    then return query select wk - 7, wk - 1;
    when 'this_month'   then return query select mo, (mo + interval '1 month')::date - 1;
    when 'last_month'   then return query select (mo - interval '1 month')::date, mo - 1;
    when 'this_quarter' then return query select q, (q + interval '3 months')::date - 1;
    when 'last_quarter' then return query select (q - interval '3 months')::date, q - 1;
    when 'this_fy'      then return query select fy, (fy + interval '1 year')::date - 1;
    when 'last_fy'      then return query select (fy - interval '1 year')::date, fy - 1;
    when 'custom' then
      if custom_from is null or custom_to is null or custom_to < custom_from then
        raise exception 'custom period needs a from date on or before the to date';
      end if;
      return query select custom_from, custom_to;
    else raise exception 'unknown period %', period;
  end case;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Invoices: subtotal, GST split, total, paid, outstanding, derived status
-- ─────────────────────────────────────────────────────────────
create or replace view public.invoice_totals with (security_invoker = true) as
with items as (
  select invoice_id, sum(amount) subtotal, sum(gst_amount) gst
  from public.invoice_items where not is_archived group by invoice_id
), paid as (
  select a.invoice_id, sum(a.amount) paid, max(r.received_on) last_paid_on
  from public.receipt_allocations a join public.receipts r on r.id = a.receipt_id
  where not a.is_archived and not r.is_archived group by a.invoice_id
), org as (select state_code from public.org_settings limit 1)
select
  i.id as invoice_id, i.brand_id, i.campaign_id, i.retainer_id, i.invoice_number,
  i.issue_date, i.due_date, i.status as document_status,
  coalesce(it.subtotal, 0)                                   as subtotal,
  coalesce(it.gst, 0)                                        as gst_total,
  (i.place_of_supply_code is not null and org.state_code is not null
     and i.place_of_supply_code <> org.state_code)           as is_interstate,
  coalesce(it.subtotal, 0) + coalesce(it.gst, 0)             as total,
  coalesce(p.paid, 0)                                        as paid,
  greatest(coalesce(it.subtotal,0) + coalesce(it.gst,0) - coalesce(p.paid,0), 0) as outstanding,
  p.last_paid_on,
  case
    when i.status = 'void'  then 'void'
    when i.status = 'draft' then 'draft'
    when coalesce(p.paid,0) >= coalesce(it.subtotal,0) + coalesce(it.gst,0)
         and coalesce(it.subtotal,0) > 0                     then 'paid'
    when i.due_date < public.ist_today() and coalesce(p.paid,0) > 0 then 'partially_paid_overdue'
    when i.due_date < public.ist_today()                     then 'overdue'
    when coalesce(p.paid,0) > 0                              then 'partially_paid'
    else 'sent' end                                          as payment_status,
  greatest(public.ist_today() - i.due_date, 0)               as days_overdue
from public.invoices i
left join items it on it.invoice_id = i.id
left join paid  p  on p.invoice_id = i.id
left join org on true
where not i.is_archived;

-- ─────────────────────────────────────────────────────────────
-- Creator payouts: gross, TDS, net
-- ─────────────────────────────────────────────────────────────
create or replace view public.creator_payout_totals with (security_invoker = true) as
select
  p.id as payout_id, p.creator_id, p.campaign_id, p.status, p.due_date, p.paid_on, p.account_id,
  coalesce(sum(it.amount), 0)                                          as gross,
  round(coalesce(sum(it.amount), 0) * p.gst_rate / 100, 2)             as gst,
  round(coalesce(sum(it.amount), 0) * p.tds_rate / 100, 2)             as tds,
  coalesce(sum(it.amount), 0) + round(coalesce(sum(it.amount), 0) * p.gst_rate / 100, 2)
    - round(coalesce(sum(it.amount), 0) * p.tds_rate / 100, 2)         as net_payable
from public.creator_payouts p
left join public.creator_payout_items it on it.payout_id = p.id and not it.is_archived
where not p.is_archived and p.status <> 'cancelled'
group by p.id;

-- ─────────────────────────────────────────────────────────────
-- One ledger of every money movement. Reports filter this by date.
-- direction: +1 money in to the account, -1 money out.
-- ─────────────────────────────────────────────────────────────
create or replace view public.money_ledger with (security_invoker = true) as
  select 'receipt'::text as source_table, r.id as source_id, r.received_on as entry_date,
         r.account_id, r.amount_received as amount, 1 as direction,
         r.category as category, r.brand_id, null::uuid as campaign_id
  from public.receipts r where not r.is_archived
union all
  select 'expense', e.id, coalesce(e.paid_on, e.expense_date), e.account_id,
         e.total - e.tds_deducted, -1, 'expense', e.brand_id, e.campaign_id
  from public.expenses e
  where not e.is_archived and e.status = 'paid' and e.account_id is not null
union all
  select 'creator_payout', t.payout_id, t.paid_on, t.account_id, t.net_payable, -1,
         'creator_payout', null, t.campaign_id
  from public.creator_payout_totals t where t.status = 'paid' and t.account_id is not null
union all
  select 'capital', c.id, c.entry_date, c.account_id, c.amount,
         case when c.kind in ('opening_balance','founder_contribution','loan_in') then 1 else -1 end,
         c.kind, null, null
  from public.capital_entries c where not c.is_archived
union all
  select 'transfer_out', x.id, x.transfer_date, x.from_account_id, x.amount, -1, 'transfer', null, null
  from public.account_transfers x where not x.is_archived
union all
  select 'transfer_in', x.id, x.transfer_date, x.to_account_id, x.amount, 1, 'transfer', null, null
  from public.account_transfers x where not x.is_archived;

create or replace view public.account_balances with (security_invoker = true) as
select a.id as account_id, a.name, a.kind,
       coalesce(sum(l.amount * l.direction), 0) as balance
from public.money_accounts a
left join public.money_ledger l on l.account_id = a.id
where not a.is_archived
group by a.id;

-- ─────────────────────────────────────────────────────────────
-- Campaign P&L — revenue is what was invoiced (pre-GST).
-- ─────────────────────────────────────────────────────────────
create or replace view public.campaign_financials with (security_invoker = true) as
select
  c.id as campaign_id, c.brand_id, c.name, c.status, c.contract_value,
  coalesce(inv.billed, 0)        as billed,
  coalesce(inv.outstanding, 0)   as outstanding,
  coalesce(inv.received, 0)      as received,
  coalesce(po.creator_cost, 0)   as creator_cost,
  coalesce(po.creator_paid, 0)   as creator_paid,
  coalesce(ex.direct_cost, 0)    as direct_expenses,
  coalesce(inv.billed, 0) - coalesce(po.creator_cost, 0) - coalesce(ex.direct_cost, 0) as profit,
  case when coalesce(inv.billed, 0) > 0
       then round((coalesce(inv.billed,0) - coalesce(po.creator_cost,0) - coalesce(ex.direct_cost,0))
                  / inv.billed * 100, 1) end as margin_pct
from public.campaigns c
left join (select campaign_id, sum(subtotal) billed, sum(outstanding) outstanding, sum(paid) received
           from public.invoice_totals where document_status = 'sent' group by campaign_id) inv
       on inv.campaign_id = c.id
left join (select campaign_id, sum(gross) creator_cost,
                  sum(gross) filter (where status = 'paid') creator_paid
           from public.creator_payout_totals group by campaign_id) po
       on po.campaign_id = c.id
left join (select campaign_id, sum(amount) direct_cost from public.expenses
           where not is_archived group by campaign_id) ex
       on ex.campaign_id = c.id
where not c.is_archived;

-- ─────────────────────────────────────────────────────────────
-- Brand lifetime totals (period-filtered versions come from the functions below)
-- ─────────────────────────────────────────────────────────────
create or replace view public.brand_financials with (security_invoker = true) as
select b.id as brand_id, b.name,
  coalesce(sum(t.subtotal) filter (where t.document_status = 'sent'), 0)    as billed,
  coalesce(sum(t.paid), 0)                                                  as received,
  coalesce(sum(t.outstanding) filter (where t.document_status = 'sent'), 0) as outstanding,
  coalesce(sum(t.outstanding) filter (where t.payment_status like '%overdue'), 0) as overdue,
  (select count(*) from public.campaigns c where c.brand_id = b.id and not c.is_archived) as campaigns,
  (select count(*) from public.campaigns c where c.brand_id = b.id and not c.is_archived
     and c.status in ('confirmed','in_production','live')) as active_campaigns
from public.brands b
left join public.invoice_totals t on t.brand_id = b.id
where not b.is_archived
group by b.id;

-- ─────────────────────────────────────────────────────────────
-- Agency summary for any period (dashboard & reports).
-- Revenue = invoices issued in period (pre-GST). Collections = cash received.
-- Spend = expenses dated in period + creator payouts due/paid in period.
-- ─────────────────────────────────────────────────────────────
create or replace function public.period_summary(
  period text default 'this_month', custom_from date default null, custom_to date default null)
returns table (
  start_date date, end_date date,
  revenue numeric, gst_billed numeric, collections numeric,
  creator_cost numeric, expenses numeric, profit numeric,
  outstanding_now numeric, overdue_now numeric, creator_payable_now numeric,
  deliverables_live bigint, deliverables_due bigint)
language sql stable security invoker as $$
  with p as (select * from public.period_bounds(period, custom_from, custom_to))
  select p.start_date, p.end_date,
    (select coalesce(sum(subtotal),0) from invoice_totals, p p2
       where document_status = 'sent' and issue_date between p2.start_date and p2.end_date),
    (select coalesce(sum(gst_total),0) from invoice_totals, p p2
       where document_status = 'sent' and issue_date between p2.start_date and p2.end_date),
    (select coalesce(sum(amount_received + tds_deducted),0) from receipts r, p p2
       where not r.is_archived and r.category in ('client_payment','advance')
         and r.received_on between p2.start_date and p2.end_date),
    (select coalesce(sum(gross),0) from creator_payout_totals t, p p2
       where coalesce(t.paid_on, t.due_date) between p2.start_date and p2.end_date),
    (select coalesce(sum(amount),0) from expenses e, p p2
       where not e.is_archived and e.expense_date between p2.start_date and p2.end_date),
    (select coalesce(sum(subtotal),0) from invoice_totals, p p2
       where document_status = 'sent' and issue_date between p2.start_date and p2.end_date)
    - (select coalesce(sum(gross),0) from creator_payout_totals t, p p2
       where coalesce(t.paid_on, t.due_date) between p2.start_date and p2.end_date)
    - (select coalesce(sum(amount),0) from expenses e, p p2
       where not e.is_archived and e.expense_date between p2.start_date and p2.end_date),
    (select coalesce(sum(outstanding),0) from invoice_totals where document_status = 'sent'),
    (select coalesce(sum(outstanding),0) from invoice_totals where payment_status like '%overdue'),
    (select coalesce(sum(net_payable),0) from creator_payout_totals where status in ('pending','approved')),
    (select count(*) from deliverables d, p p2 where not d.is_archived
       and (d.went_live_at at time zone 'Asia/Kolkata')::date between p2.start_date and p2.end_date),
    (select count(*) from deliverables d, p p2 where not d.is_archived
       and d.stage not in ('live','cancelled') and d.due_date between p2.start_date and p2.end_date)
  from p
$$;

-- ─────────────────────────────────────────────────────────────
-- Seed data every install needs
-- ─────────────────────────────────────────────────────────────
insert into public.org_settings (company_name) values ('Social Mog');

insert into public.expense_categories (name, is_direct) values
  ('Production crew', true), ('Equipment rental', true), ('Studio & location', true),
  ('Props & wardrobe', true), ('Travel & food (shoot)', true), ('Freelance editing', true),
  ('Paid ads (client)', true), ('Software & subscriptions', false), ('Office & utilities', false),
  ('Salaries', false), ('Professional fees (CA, legal)', false), ('Bank charges', false),
  ('TDS deposited', false), ('GST paid', false), ('Marketing (our own)', false), ('Other', false);

insert into public.automation_rules (name, trigger_kind, offset_days, recipient_mode, is_enabled) values
  ('Invoice due in 3 days',        'invoice_due',     -3, 'owner',    false),
  ('Invoice overdue',              'invoice_overdue',  1, 'founders', false),
  ('Creator payout due tomorrow',  'payout_due',      -1, 'founders', false),
  ('Deliverable due tomorrow',     'deliverable_due', -1, 'assignee', false),
  ('Task blocked',                 'task_blocked',     0, 'founders', false);
