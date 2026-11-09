-- Social Mog OS — feature 6: Money.
--   Accounts (opening balance + every movement), invoices (SM/26-27/001 per FY,
--   GST as CGST+SGST or IGST, TDS expected), payments against one or more
--   invoices, other income, expenses (+ recurring), creator & freelancer payouts
--   (paying one creates its expense), capital per founder, and the company
--   balance check. Every total below is calculated from the records.
--
-- Who sees what (RLS, unchanged rule from 0006):
--   founders  everything
--   managers  invoices, payments, expenses, payouts, accounts — never
--             capital_entries (opening capital, capital added, withdrawals)
--   others    no money tables at all
--
-- Editing or archiving any money record needs a reason: send it in the
-- `change_reason` column with the update. The guard below moves it into the
-- activity log (activity_log.reason) and never stores it on the record.

-- ─────────────────────────────────────────────────────────────
-- 1. Settings: our bank details, UPI and invoice terms (for the PDF)
-- ─────────────────────────────────────────────────────────────
alter table public.org_settings
  add column state               text,      -- e.g. 'Maharashtra' (state_code decides the GST split)
  add column bank_account_name   text,
  add column bank_name           text,
  add column bank_account_number text,
  add column bank_ifsc           text,
  add column bank_branch         text,
  add column upi_id              text,
  add column invoice_terms       text default 'Payment due by the date above. Please quote the invoice number with your payment.';

-- Profit share per founder (50:50 by default). Company-level capital entries
-- and "profit transferred to capital" are split by these percentages.
alter table public.team_members
  add column profit_share_pct numeric(5,2) check (profit_share_pct between 0 and 100);
update public.team_members set profit_share_pct = 50 where role = 'founder' and profit_share_pct is null;

-- ─────────────────────────────────────────────────────────────
-- 2. Accounts: type, opening balance, opening date
-- ─────────────────────────────────────────────────────────────
alter table public.money_accounts drop constraint money_accounts_kind_check;
update public.money_accounts set kind = case kind when 'upi_wallet' then 'upi' when 'card' then 'wallet' when 'other' then 'wallet' else kind end;
alter table public.money_accounts
  add constraint money_accounts_kind_check check (kind in ('bank','upi','cash','wallet')),
  add column opening_balance numeric(14,2) not null default 0,
  add column opening_date    date not null default ((now() at time zone 'Asia/Kolkata')::date),
  add column notes           text,
  add column change_reason   text;

-- ─────────────────────────────────────────────────────────────
-- 3. Capital: Opening capital, Capital added, Founder withdrawal,
--    Profit transferred to capital. founder_id null = "Company"
--    (split between founders by profit share).
--    Opening capital and profit transfers move no money between accounts
--    (opening money is the accounts' opening balance); capital added and
--    withdrawals go into / out of an account.
-- ─────────────────────────────────────────────────────────────
alter table public.capital_entries drop constraint capital_entries_kind_check;
-- old "opening balance" entries become the account's opening balance + opening capital
update public.money_accounts a set opening_balance = a.opening_balance + x.total,
       opening_date = least(a.opening_date, x.first_date)
from (select account_id, sum(amount) total, min(entry_date) first_date from public.capital_entries
      where kind = 'opening_balance' and not is_archived group by account_id) x
where x.account_id = a.id;
update public.capital_entries set kind = case kind
  when 'opening_balance' then 'opening_capital'
  when 'founder_contribution' then 'capital_added' when 'loan_in' then 'capital_added'
  when 'loan_repayment' then 'founder_withdrawal' when 'reimbursement' then 'founder_withdrawal'
  else kind end;
alter table public.capital_entries alter column account_id drop not null;
update public.capital_entries set account_id = null where kind = 'opening_capital';
alter table public.capital_entries drop column expense_id;
alter table public.capital_entries
  add constraint capital_entries_kind_check
    check (kind in ('opening_capital','capital_added','founder_withdrawal','profit_transferred')),
  add constraint capital_entries_account_rule
    check ((kind in ('capital_added','founder_withdrawal')) = (account_id is not null)),
  add column change_reason text;

create or replace function public.capital_entry_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.founder_id is not null and not exists (select 1 from team_members where id = new.founder_id and role = 'founder') then
    raise exception 'Capital belongs to a founder or to the company — % is not a founder', (select name from team_members where id = new.founder_id);
  end if;
  return new;
end $$;
create trigger capital_entries_check before insert or update on public.capital_entries
  for each row execute function public.capital_entry_check();

-- ─────────────────────────────────────────────────────────────
-- 4. Invoices: GST toggle + rate, TDS expected, statuses
--    Stored status: draft | sent | cancelled.
--    Shown status (calculated): Draft, Sent, Partly paid, Paid, Overdue, Cancelled.
-- ─────────────────────────────────────────────────────────────
alter table public.invoices drop constraint invoices_status_check;
update public.invoices set status = 'cancelled' where status = 'void';
alter table public.invoices rename column voided_reason to cancel_reason;
alter table public.invoices
  add constraint invoices_status_check check (status in ('draft','sent','cancelled')),
  add column gst_enabled   boolean not null default true,
  add column gst_rate      numeric(5,2) not null default 18 check (gst_rate between 0 and 28),
  add column tds_rate      numeric(5,2) not null default 0 check (tds_rate between 0 and 30),
  add column cancelled_at  timestamptz,
  add column change_reason text;
-- one retainer invoice per brand-month
create unique index invoices_one_per_retainer_month on public.invoices (retainer_id, service_period_start)
  where retainer_id is not null and status <> 'cancelled' and not is_archived;

alter table public.invoice_items add column change_reason text;

-- Numbers: SM/26-27/001, one sequence per financial year (of the issue date),
-- given when the invoice is sent — drafts have no number, so there are no gaps.
create or replace function public.invoice_prepare()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fy text; v_n int; v_prefix text; v_terms int; v_num text;
begin
  if tg_op = 'INSERT' then
    new.place_of_supply_code := coalesce(new.place_of_supply_code, (select state_code from brands where id = new.brand_id));
  else
    if old.invoice_number is not null and new.invoice_number is distinct from old.invoice_number then
      raise exception 'Invoice numbers never change once given';
    end if;
    if old.status <> 'draft' and new.status = 'draft' then
      raise exception 'A sent invoice can’t go back to draft — cancel it and make a new one';
    end if;
    if old.status = 'cancelled' and new.status <> 'cancelled' then
      raise exception 'A cancelled invoice stays cancelled';
    end if;
    if old.status = 'draft' and new.status = 'sent'
       and not exists (select 1 from invoice_items where invoice_id = new.id and not is_archived) then
      raise exception 'Add at least one line before sending the invoice';
    end if;
  end if;

  if new.status = 'cancelled' and (tg_op = 'INSERT' or old.status <> 'cancelled') then
    if nullif(btrim(coalesce(new.cancel_reason, '')), '') is null then
      raise exception 'Say why the invoice is cancelled';
    end if;
    if exists (select 1 from receipt_allocations a join receipts r on r.id = a.receipt_id
               where a.invoice_id = new.id and not a.is_archived and not r.is_archived) then
      raise exception 'This invoice has payments against it — move or archive those payments first';
    end if;
    new.cancelled_at := now();
  end if;

  if new.status = 'sent' and new.invoice_number is null then
    select coalesce(invoice_prefix, 'SM'), default_payment_terms_days into v_prefix, v_terms from org_settings limit 1;
    new.issue_date := coalesce(new.issue_date, ist_today());
    new.due_date := coalesce(new.due_date, new.issue_date +
      coalesce((select payment_terms_days from brands where id = new.brand_id), v_terms, 30));
    v_fy := fy_label(new.issue_date);              -- '2026-27'
    loop
      insert into document_sequences (doc_type, fy_label, next_value) values ('invoice', v_fy, 2)
      on conflict (doc_type, fy_label) do update set next_value = document_sequences.next_value + 1
      returning next_value - 1 into v_n;
      v_num := coalesce(v_prefix, 'SM') || '/' || substr(v_fy, 3) || '/' ||
               case when v_n < 1000 then lpad(v_n::text, 3, '0') else v_n::text end;
      exit when not exists (select 1 from invoices where invoice_number = v_num);  -- skip numbers taken by imports
    end loop;
    new.invoice_number := v_num;
    new.sent_at := coalesce(new.sent_at, now());
  end if;
  return new;
end $$;
create trigger invoices_prepare before insert or update on public.invoices
  for each row execute function public.invoice_prepare();

create or replace function public.invoice_item_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select status from invoices where id = new.invoice_id) = 'cancelled' then
    raise exception 'This invoice is cancelled — its lines can’t change';
  end if;
  return new;
end $$;
create trigger invoice_items_check before insert or update on public.invoice_items
  for each row execute function public.invoice_item_check();

-- ─────────────────────────────────────────────────────────────
-- 5. Payments received (receipts) and other income
-- ─────────────────────────────────────────────────────────────
alter table public.receipts drop constraint receipts_category_check;
update public.receipts set category = case when category in ('client_payment','advance') then 'client_payment' else 'other_income' end;
alter table public.receipts
  add constraint receipts_category_check check (category in ('client_payment','other_income')),
  add constraint receipts_brand_rule check (category = 'other_income' or brand_id is not null),
  add column change_reason text;
alter table public.receipt_allocations add column change_reason text;

create or replace function public.receipt_allocation_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare r receipts; inv invoices; v_used numeric; v_inv_total numeric; v_inv_paid numeric;
begin
  if new.is_archived then return new; end if;
  select * into r from receipts where id = new.receipt_id;
  select * into inv from invoices where id = new.invoice_id;
  if r.category <> 'client_payment' then raise exception 'Other income isn’t applied to invoices'; end if;
  if inv.status <> 'sent' then raise exception 'Payments can only be applied to sent invoices'; end if;
  if inv.brand_id is distinct from r.brand_id then raise exception 'That invoice belongs to another brand'; end if;
  select coalesce(sum(amount), 0) into v_used from receipt_allocations
   where receipt_id = new.receipt_id and id <> new.id and not is_archived;
  if v_used + new.amount > r.amount_received + r.tds_deducted then
    raise exception 'Applied ₹% but this payment is only ₹% (received + TDS)', v_used + new.amount, r.amount_received + r.tds_deducted;
  end if;
  select t.total into v_inv_total from invoice_totals t where t.invoice_id = new.invoice_id;
  select coalesce(sum(a.amount), 0) into v_inv_paid from receipt_allocations a join receipts x on x.id = a.receipt_id
   where a.invoice_id = new.invoice_id and a.id <> new.id and not a.is_archived and not x.is_archived;
  if v_inv_paid + new.amount > v_inv_total then
    raise exception 'Invoice % has only ₹% left to pay', inv.invoice_number, v_inv_total - v_inv_paid;
  end if;
  return new;
end $$;
create trigger receipt_allocations_check before insert or update on public.receipt_allocations
  for each row execute function public.receipt_allocation_check();

create or replace function public.receipt_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and not new.is_archived and (select coalesce(sum(amount), 0) from receipt_allocations
       where receipt_id = new.id and not is_archived) > new.amount_received + new.tds_deducted then
    raise exception 'More than this is already applied to invoices — change those first';
  end if;
  if tg_op = 'UPDATE' and new.category = 'other_income' and old.category = 'client_payment'
     and exists (select 1 from receipt_allocations where receipt_id = new.id and not is_archived) then
    raise exception 'This payment is applied to invoices — it can’t become other income';
  end if;
  return new;
end $$;
create trigger receipts_check before insert or update on public.receipts
  for each row execute function public.receipt_check();

-- One call records a payment and applies it to one or more invoices.
-- p_allocations: [{"invoice_id": "...", "amount": 59000}, ...]
create or replace function public.record_payment(
  p_brand uuid, p_account uuid, p_received_on date, p_amount numeric, p_tds numeric default 0,
  p_mode text default null, p_reference text default null, p_notes text default null,
  p_allocations jsonb default '[]'::jsonb, p_category text default 'client_payment')
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; a jsonb;
begin
  insert into receipts (brand_id, account_id, received_on, amount_received, tds_deducted, category, mode, reference, notes)
  values (p_brand, p_account, p_received_on, p_amount, coalesce(p_tds, 0), p_category, p_mode, nullif(btrim(p_reference), ''), p_notes)
  returning id into v_id;
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    continue when coalesce((a->>'amount')::numeric, 0) <= 0;
    insert into receipt_allocations (receipt_id, invoice_id, amount) values (v_id, (a->>'invoice_id')::uuid, (a->>'amount')::numeric);
  end loop;
  return v_id;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 6. Expense categories — your list, editable. `treatment` decides where a
--    category lands: direct (gross profit), overhead (net profit), or a tax
--    payment (reduces GST / TDS owed, not profit).
-- ─────────────────────────────────────────────────────────────
alter table public.expense_categories
  add column treatment text not null default 'overhead' check (treatment in ('direct','overhead','gst_payment','tds_payment')),
  add column system_key text unique,     -- categories the app relies on (payouts, tax payments)
  add column position int not null default 100;

insert into public.expense_categories (name, treatment, system_key, position) values
  ('Creator payout', 'direct', 'creator_payout', 1), ('Freelancer', 'direct', 'freelancer', 2),
  ('Equipment', 'direct', null, 3), ('Travel', 'direct', null, 4), ('Location', 'direct', null, 5),
  ('Props', 'direct', null, 6), ('Software/subscriptions', 'overhead', null, 7), ('Ads spend', 'direct', null, 8),
  ('Food', 'direct', null, 9), ('Office', 'overhead', null, 10), ('Salary', 'overhead', null, 11),
  ('GST paid to government', 'gst_payment', 'gst_payment', 12), ('TDS deposited', 'tds_payment', 'tds_payment', 13)
on conflict (name) do update set treatment = excluded.treatment, system_key = excluded.system_key, position = excluded.position;
update public.expense_categories set treatment = 'overhead', position = 14 where name = 'Other';
-- move expenses off the old starter categories, then archive those
with m(old_name, new_name) as (values
  ('Production crew','Freelancer'), ('Equipment rental','Equipment'), ('Studio & location','Location'),
  ('Props & wardrobe','Props'), ('Travel & food (shoot)','Travel'), ('Freelance editing','Freelancer'),
  ('Paid ads (client)','Ads spend'), ('Software & subscriptions','Software/subscriptions'),
  ('Office & utilities','Office'), ('Salaries','Salary'), ('Professional fees (CA, legal)','Other'),
  ('Bank charges','Other'), ('TDS deposited','TDS deposited'), ('GST paid','GST paid to government'),
  ('Marketing (our own)','Other'))
update public.expenses e set category_id = n.id
from m join public.expense_categories o on o.name = m.old_name join public.expense_categories n on n.name = m.new_name
where e.category_id = o.id and o.id <> n.id;
update public.expense_categories set is_archived = true
where name in ('Production crew','Equipment rental','Studio & location','Props & wardrobe','Travel & food (shoot)',
               'Freelance editing','Paid ads (client)','Software & subscriptions','Office & utilities','Salaries',
               'Professional fees (CA, legal)','Bank charges','GST paid','Marketing (our own)');
alter table public.expense_categories drop column is_direct;

-- ─────────────────────────────────────────────────────────────
-- 7. Creator & freelancer payouts. One payout = one agreed amount for a
--    creator (via campaign_creators) or a freelancer/vendor (often for a
--    production item). Pending → Approved → Paid.
-- ─────────────────────────────────────────────────────────────
alter table public.creator_payouts drop constraint creator_payouts_status_check;
update public.creator_payouts set status = 'pending' where status = 'on_hold';
alter table public.creator_payouts
  add constraint creator_payouts_status_check check (status in ('pending','approved','paid','cancelled')),
  add column amount         numeric(14,2) check (amount >= 0),        -- agreed, before TDS / GST
  add column vendor_id      uuid references public.vendors(id),
  add column deliverable_id uuid references public.deliverables(id),
  add column brand_id       uuid references public.brands(id),
  add column description    text,
  add column approved_at    timestamptz,
  add column approved_by    uuid references public.team_members(id),
  add column change_reason  text;
update public.creator_payouts p set amount = coalesce((select sum(i.amount) from public.creator_payout_items i
  where i.payout_id = p.id and not i.is_archived), 0);
alter table public.creator_payouts alter column amount set not null;
alter table public.creator_payouts alter column creator_id drop not null;
alter table public.creator_payouts
  add constraint creator_payouts_one_payee check (num_nonnulls(creator_id, vendor_id) = 1),
  add constraint creator_payouts_paid_rule check (status <> 'paid' or (paid_on is not null and account_id is not null));
create index creator_payouts_deliverable_idx on public.creator_payouts (deliverable_id);
create index creator_payouts_vendor_idx on public.creator_payouts (vendor_id);

create or replace function public.payout_prepare()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cc record; v_d record;
begin
  if new.campaign_creator_id is not null then
    select cc.creator_id, cc.campaign_id, f.agreed_fee into v_cc
    from campaign_creators cc left join campaign_creator_fees f on f.campaign_creator_id = cc.id where cc.id = new.campaign_creator_id;
    new.creator_id := coalesce(new.creator_id, v_cc.creator_id);
    new.campaign_id := coalesce(new.campaign_id, v_cc.campaign_id);
  end if;
  if new.deliverable_id is not null then
    select campaign_id, brand_id into v_d from deliverables where id = new.deliverable_id;
    new.campaign_id := coalesce(new.campaign_id, v_d.campaign_id);
    new.brand_id := coalesce(new.brand_id, v_d.brand_id);
  end if;
  if new.campaign_id is not null then
    new.brand_id := coalesce(new.brand_id, (select brand_id from campaigns where id = new.campaign_id));
  end if;
  if new.status = 'paid' then
    new.paid_on := coalesce(new.paid_on, ist_today());
    if new.account_id is null then raise exception 'Pick the account the payout was paid from'; end if;
  elsif tg_op = 'UPDATE' and old.status = 'paid' then
    new.paid_on := null;
  end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    new.approved_at := now(); new.approved_by := current_member_id();
  end if;
  return new;
end $$;
create trigger creator_payouts_prepare before insert or update on public.creator_payouts
  for each row execute function public.payout_prepare();

-- payout totals: gross = agreed amount; TDS and GST on it; net = what is transferred
create or replace view public.creator_payout_totals with (security_invoker = true) as
select
  p.id as payout_id, p.creator_id, p.campaign_id, p.status, p.due_date, p.paid_on, p.account_id,
  p.amount::numeric                                                as gross,
  round(p.amount * p.gst_rate / 100, 2)                            as gst,
  round(p.amount * p.tds_rate / 100, 2)                            as tds,
  p.amount + round(p.amount * p.gst_rate / 100, 2) - round(p.amount * p.tds_rate / 100, 2) as net_payable
from public.creator_payouts p
where not p.is_archived and p.status <> 'cancelled';
drop table public.creator_payout_items;

-- ─────────────────────────────────────────────────────────────
-- 8. Expenses: paid from an account, links, payout & recurring source
-- ─────────────────────────────────────────────────────────────
alter table public.expenses drop constraint expenses_status_check;
update public.expenses set status = 'paid' where status = 'reimbursed';
alter table public.expenses drop column paid_by_member_id;
alter table public.expenses
  add constraint expenses_status_check check (status in ('unpaid','paid')),
  add constraint expenses_paid_needs_account check (status <> 'paid' or account_id is not null) not valid,
  add column payout_id uuid unique references public.creator_payouts(id),
  add column recurring_id uuid,
  add column recurring_period date,              -- first day of the month it was made for
  add column change_reason text;
create index expenses_payout_idx on public.expenses (payout_id);

create table public.recurring_expenses (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.team_members(id),
  is_archived    boolean not null default false,
  archived_at    timestamptz,
  description    text not null,                  -- "Adobe Creative Cloud"
  category_id    uuid not null references public.expense_categories(id),
  vendor_id      uuid references public.vendors(id),
  amount         numeric(14,2) not null check (amount >= 0),
  gst_amount     numeric(14,2) not null default 0 check (gst_amount >= 0),
  account_id     uuid references public.money_accounts(id),
  mark_paid      boolean not null default true,  -- auto-debit: the expense is created as paid
  day_of_month   smallint not null default 1 check (day_of_month between 1 and 28),
  start_date     date not null,
  end_date       date,
  is_paused      boolean not null default false,
  notes          text,
  check (end_date is null or end_date >= start_date),
  check (not mark_paid or account_id is not null)
);
select public.enable_standard_table('public.recurring_expenses');
create policy staff_select on public.recurring_expenses for select to authenticated using (public.is_staff());
create policy staff_insert on public.recurring_expenses for insert to authenticated with check (public.is_staff());
create policy staff_update on public.recurring_expenses for update to authenticated using (public.is_staff()) with check (public.is_staff());
alter table public.expenses add constraint expenses_recurring_fk foreign key (recurring_id) references public.recurring_expenses(id);
create unique index expenses_one_per_recurring_month on public.expenses (recurring_id, recurring_period) where recurring_id is not null;

create or replace function public.expense_prepare()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_d record;
begin
  if new.deliverable_id is not null then
    select campaign_id, brand_id into v_d from deliverables where id = new.deliverable_id;
    new.campaign_id := coalesce(new.campaign_id, v_d.campaign_id);
    new.brand_id := coalesce(new.brand_id, v_d.brand_id);
  end if;
  if new.campaign_id is not null then
    new.brand_id := coalesce(new.brand_id, (select brand_id from campaigns where id = new.campaign_id));
  end if;
  if new.status = 'paid' then
    if new.account_id is null then raise exception 'Pick the account the expense was paid from'; end if;
    new.paid_on := coalesce(new.paid_on, new.expense_date);
  else
    new.paid_on := null;
  end if;
  return new;
end $$;
create trigger expenses_prepare before insert or update on public.expenses
  for each row execute function public.expense_prepare();

-- Paying a payout creates (or updates) its matching expense; un-paying or
-- cancelling it archives that expense. The expense can't be edited by hand.
create or replace function public.payout_expense_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cat uuid; v_payee text; v_for text;
begin
  perform set_config('app.money_workflow', 'on', true);
  if new.status = 'paid' and not new.is_archived then
    select id into v_cat from expense_categories
     where system_key = case when new.creator_id is not null then 'creator_payout' else 'freelancer' end;
    v_payee := coalesce((select name from creators where id = new.creator_id), (select name from vendors where id = new.vendor_id));
    v_for := coalesce((select title from deliverables where id = new.deliverable_id), (select name from campaigns where id = new.campaign_id));
    insert into expenses (category_id, vendor_id, brand_id, campaign_id, deliverable_id, description, expense_date,
                          amount, gst_amount, tds_deducted, bill_number, status, paid_on, account_id, payout_id, notes)
    values (v_cat, new.vendor_id, new.brand_id, new.campaign_id, new.deliverable_id,
            'Payout — ' || v_payee || coalesce(' — ' || v_for, ''), new.paid_on,
            new.amount, round(new.amount * new.gst_rate / 100, 2), round(new.amount * new.tds_rate / 100, 2),
            new.creator_invoice_no, 'paid', new.paid_on, new.account_id, new.id, new.reference)
    on conflict (payout_id) do update set
      category_id = excluded.category_id, vendor_id = excluded.vendor_id, brand_id = excluded.brand_id,
      campaign_id = excluded.campaign_id, deliverable_id = excluded.deliverable_id, description = excluded.description,
      expense_date = excluded.expense_date, amount = excluded.amount, gst_amount = excluded.gst_amount,
      tds_deducted = excluded.tds_deducted, bill_number = excluded.bill_number, status = 'paid',
      paid_on = excluded.paid_on, account_id = excluded.account_id, notes = excluded.notes, is_archived = false;
  else
    update expenses set is_archived = true where payout_id = new.id and not is_archived;
  end if;
  perform set_config('app.money_workflow', 'off', true);
  return null;
end $$;
create trigger creator_payouts_expense after insert or update on public.creator_payouts
  for each row execute function public.payout_expense_sync();

-- Creates every recurring expense that has come due (idempotent: one per
-- template per month). Runs daily via pg_cron where available, and the
-- Expenses page also calls it when it opens.
create or replace function public.create_recurring_expenses(p_today date default null)
returns int language plpgsql security definer set search_path = public as $$
declare t recurring_expenses; m date; v_on date; v_n int := 0; v_today date := coalesce(p_today, ist_today()); v_rows int;
begin
  if auth.uid() is not null and not is_staff() then raise exception 'Only founders and managers can do this'; end if;
  perform set_config('app.activity_source', 'automation', true);
  for t in select * from recurring_expenses where not is_archived and not is_paused and start_date <= v_today loop
    m := date_trunc('month', t.start_date)::date;
    while m <= v_today loop
      v_on := m + (t.day_of_month - 1);
      if v_on >= t.start_date and v_on <= v_today and (t.end_date is null or v_on <= t.end_date) then
        insert into expenses (category_id, vendor_id, description, expense_date, amount, gst_amount, status, account_id,
                              recurring_id, recurring_period, notes)
        values (t.category_id, t.vendor_id, t.description || ' — ' || to_char(m, 'Mon YYYY'), v_on, t.amount, t.gst_amount,
                case when t.mark_paid then 'paid' else 'unpaid' end, t.account_id, t.id, m, 'Created from a recurring expense')
        on conflict (recurring_id, recurring_period) where recurring_id is not null do nothing;
        get diagnostics v_rows = row_count; v_n := v_n + v_rows;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
  return v_n;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('social-mog-recurring-expenses', '30 0 * * *', 'select public.create_recurring_expenses()');  -- 06:00 IST
  end if;
exception when others then
  raise notice 'pg_cron not available: recurring expenses are created when the Expenses page opens.';
end $$;

alter table public.account_transfers add column change_reason text;

-- ─────────────────────────────────────────────────────────────
-- 9. The guard: editing or archiving a money record needs a reason;
--    money records are never hard-deleted. Normal workflow steps (sending
--    a draft, approving/paying a payout, marking an expense paid) don't.
-- ─────────────────────────────────────────────────────────────
alter table public.activity_log add column reason text;

create or replace function public.money_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb; v_old jsonb; v_changed text[];
  v_reason text;
  v_free boolean := coalesce(current_setting('app.money_workflow', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if current_setting('app.allow_money_delete', true) = 'on' then return old; end if;
    raise exception 'Money records are never deleted — archive it with a reason instead';
  end if;
  v_new := to_jsonb(new);
  v_reason := nullif(btrim(coalesce(v_new->>'change_reason', '')), '');
  new := jsonb_populate_record(new, jsonb_build_object('change_reason', null));

  if tg_table_name = 'money_accounts' and not is_founder() and auth.uid() is not null
     and (tg_op = 'INSERT' and coalesce((v_new->>'opening_balance')::numeric, 0) <> 0
          or tg_op = 'UPDATE' and ((to_jsonb(old)->'opening_balance') is distinct from (v_new->'opening_balance')
                                   or (to_jsonb(old)->'opening_date') is distinct from (v_new->'opening_date'))) then
    raise exception 'Only founders set opening balances';
  end if;
  if tg_op = 'INSERT' then
    if tg_table_name = 'expenses' and v_new->>'payout_id' is not null and not v_free then
      raise exception 'Payout expenses are created by paying the payout';
    end if;
    return new;
  end if;

  v_old := to_jsonb(old);
  select coalesce(array_agg(e.key), '{}') into v_changed from jsonb_each(v_new) e
   where e.key not in ('updated_at','archived_at','change_reason') and (v_old -> e.key) is distinct from e.value
     and e.key not in (select attname from pg_attribute where attrelid = tg_relid and attgenerated <> '');  -- not filled yet in BEFORE triggers
  if cardinality(v_changed) = 0 then return new; end if;

  if not v_free then
    case tg_table_name
      when 'invoices' then
        v_free := v_old->>'status' = 'draft';                       -- drafts aren't issued yet
        if v_new->>'status' = 'cancelled' and v_old->>'status' = 'sent' then
          v_reason := coalesce(v_reason, nullif(btrim(coalesce(v_new->>'cancel_reason', '')), ''));
        end if;
      when 'invoice_items' then
        v_free := (select status from invoices where id = (v_old->>'invoice_id')::uuid) = 'draft';
      when 'creator_payouts' then
        v_free := v_changed <@ array['status','approved_at','approved_by','paid_on','account_id','reference']
          and (v_old->>'status', v_new->>'status') in (('pending','approved'), ('approved','paid'), ('pending','paid'));
      when 'expenses' then
        if v_old->>'payout_id' is not null then
          raise exception 'This expense comes from a payout — edit the payout instead';
        end if;
        v_free := v_changed <@ array['status','paid_on','account_id']
          and v_old->>'status' = 'unpaid' and v_new->>'status' = 'paid';
      when 'money_accounts' then
        v_free := not (v_changed && array['opening_balance','opening_date','is_archived','kind']);
      else v_free := false;
    end case;
  end if;

  if not v_free and v_reason is null then
    raise exception 'Give a reason for this change — money edits are logged with why';
  end if;
  perform set_config('app.change_reason', coalesce(v_reason, ''), true);
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['invoices','invoice_items','receipts','receipt_allocations','expenses',
                           'creator_payouts','capital_entries','account_transfers','money_accounts'] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.money_guard()',
                   t || '_money_guard', t);
  end loop;
end $$;

-- the activity log now records the reason given
create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_action text;
  v_fields text[] := '{}'; v_o jsonb := '{}'; v_n jsonb := '{}';
  k text;
  v_source text := coalesce(nullif(current_setting('app.activity_source', true), ''), 'app');
  v_reason text := nullif(current_setting('app.change_reason', true), '');
  v_actor uuid := public.current_member_id();
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new) - 'change_reason';
    insert into activity_log (created_by, action, table_name, record_id, new_values, source)
    values (v_actor, 'create', tg_table_name, (v_new->>'id')::uuid, mask_sensitive(tg_table_name, v_new), v_source);
    return new;
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old) - 'change_reason';
    insert into activity_log (created_by, action, table_name, record_id, old_values, source)
    values (v_actor, 'delete', tg_table_name, (v_old->>'id')::uuid, mask_sensitive(tg_table_name, v_old), v_source);
    return old;
  end if;

  v_old := to_jsonb(old); v_new := to_jsonb(new);
  for k in select jsonb_object_keys(v_new) loop
    continue when k in ('updated_at','archived_at','phone_key','change_reason');
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

  insert into activity_log (created_by, action, table_name, record_id, changed_fields, old_values, new_values, source, reason)
  values (v_actor, v_action, tg_table_name, (v_new->>'id')::uuid, v_fields,
          mask_sensitive(tg_table_name, v_o), mask_sensitive(tg_table_name, v_n), v_source, v_reason);
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 10. Invoice totals (same columns as before, then the new ones)
--   subtotal = Σ qty × rate;  GST = subtotal × rate (if on), split
--   CGST/SGST (same state as ours) or IGST (other state);  total = subtotal + GST;
--   paid = Σ payments applied (cash + client's TDS);  outstanding = total − paid.
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
from base b;

-- GST is now set per invoice (toggle + rate), not per line
alter table public.invoice_items drop column gst_amount;
alter table public.invoice_items drop column gst_rate;

-- Payments with what they settled
create or replace view public.payment_list with (security_invoker = true) as
select r.id, r.created_at, r.updated_at, r.is_archived, r.brand_id, b.name as brand_name, r.account_id, a.name as account_name,
  r.received_on, r.amount_received, r.tds_deducted, r.amount_received + r.tds_deducted as credited,
  r.category, r.mode, r.reference, r.notes,
  coalesce(al.applied, 0) as applied,
  case when r.category = 'client_payment' then r.amount_received + r.tds_deducted - coalesce(al.applied, 0) else 0 end as unapplied,
  coalesce(al.invoice_numbers, '{}') as invoice_numbers, coalesce(al.invoice_ids, '{}') as invoice_ids
from public.receipts r
left join public.brands b on b.id = r.brand_id
left join public.money_accounts a on a.id = r.account_id
left join lateral (
  select sum(x.amount) applied, array_agg(i.invoice_number order by i.invoice_number) invoice_numbers, array_agg(i.id order by i.invoice_number) invoice_ids
  from public.receipt_allocations x join public.invoices i on i.id = x.invoice_id
  where x.receipt_id = r.id and not x.is_archived
) al on true;

create or replace view public.expense_list with (security_invoker = true) as
select e.id, e.created_at, e.updated_at, e.is_archived, e.expense_date, e.description, e.amount, e.gst_amount, e.tds_deducted, e.total,
  e.total - e.tds_deducted as paid_out, e.status, e.paid_on, e.account_id, a.name as account_name,
  e.category_id, c.name as category_name, c.treatment, e.vendor_id, v.name as vendor_name,
  e.brand_id, b.name as brand_name, e.campaign_id, cm.name as campaign_name, e.deliverable_id, d.title as deliverable_title,
  e.bill_number, e.notes, e.payout_id, e.recurring_id, e.recurring_period,
  (select count(*) from public.files f where f.expense_id = e.id and not f.is_archived) as bills
from public.expenses e
join public.expense_categories c on c.id = e.category_id
left join public.money_accounts a on a.id = e.account_id
left join public.vendors v on v.id = e.vendor_id
left join public.brands b on b.id = e.brand_id
left join public.campaigns cm on cm.id = e.campaign_id
left join public.deliverables d on d.id = e.deliverable_id;

create or replace view public.payout_list with (security_invoker = true) as
select p.id, p.created_at, p.updated_at, p.is_archived, p.status, p.description,
  p.creator_id, p.vendor_id, case when p.creator_id is not null then 'creator' else 'freelancer' end as payee_kind,
  coalesce(cr.name, v.name) as payee_name, cr.photo_path as payee_photo_path,
  p.campaign_creator_id, p.campaign_id, cm.name as campaign_name, p.deliverable_id, d.title as deliverable_title,
  p.brand_id, b.name as brand_name,
  p.amount as gross, p.tds_rate, round(p.amount * p.tds_rate / 100, 2) as tds,
  p.gst_rate, round(p.amount * p.gst_rate / 100, 2) as gst,
  p.amount + round(p.amount * p.gst_rate / 100, 2) - round(p.amount * p.tds_rate / 100, 2) as net_payable,
  p.due_date, p.status in ('pending','approved') and p.due_date < public.ist_today() as is_overdue,
  p.approved_at, ap.name as approved_by_name, p.paid_on, p.account_id, a.name as account_name, p.reference,
  p.creator_invoice_no, p.notes, ex.id as expense_id
from public.creator_payouts p
left join public.creators cr on cr.id = p.creator_id
left join public.vendors v on v.id = p.vendor_id
left join public.campaigns cm on cm.id = p.campaign_id
left join public.deliverables d on d.id = p.deliverable_id
left join public.brands b on b.id = p.brand_id
left join public.money_accounts a on a.id = p.account_id
left join public.team_members ap on ap.id = p.approved_by
left join public.expenses ex on ex.payout_id = p.id and not ex.is_archived;

create or replace view public.capital_list with (security_invoker = true) as
select c.id, c.created_at, c.updated_at, c.is_archived, c.entry_date, c.kind, c.founder_id,
  coalesce(f.name, 'Company') as founder_name, c.account_id, a.name as account_name, c.amount,
  case when c.kind = 'founder_withdrawal' then -c.amount else c.amount end as signed_amount, c.notes
from public.capital_entries c
left join public.team_members f on f.id = c.founder_id
left join public.money_accounts a on a.id = c.account_id;

-- ─────────────────────────────────────────────────────────────
-- 11. Money movements by account (payout money moves through its expense)
-- ─────────────────────────────────────────────────────────────
create or replace view public.money_ledger with (security_invoker = true) as
  select 'receipt'::text as source_table, r.id as source_id, r.received_on as entry_date,
         r.account_id, r.amount_received as amount, 1 as direction,
         r.category as category, r.brand_id, null::uuid as campaign_id
  from public.receipts r where not r.is_archived
union all
  select 'expense', e.id, e.paid_on, e.account_id, e.total - e.tds_deducted, -1,
         case when e.payout_id is not null then 'payout' else 'expense' end, e.brand_id, e.campaign_id
  from public.expenses e
  where not e.is_archived and e.status = 'paid' and e.account_id is not null
union all
  select 'capital', c.id, c.entry_date, c.account_id, c.amount,
         case when c.kind = 'capital_added' then 1 else -1 end, c.kind, null, null
  from public.capital_entries c where not c.is_archived and c.account_id is not null
union all
  select 'transfer_out', x.id, x.transfer_date, x.from_account_id, x.amount, -1, 'transfer', null, null
  from public.account_transfers x where not x.is_archived
union all
  select 'transfer_in', x.id, x.transfer_date, x.to_account_id, x.amount, 1, 'transfer', null, null
  from public.account_transfers x where not x.is_archived
union all
  select 'opening', a.id, a.opening_date, a.id, a.opening_balance, 1, 'opening_balance', null, null
  from public.money_accounts a where not a.is_archived and a.opening_balance <> 0;

-- Current balance = opening balance + money in − money out.
-- Runs as the owner (capital movements are founder-only line by line) and
-- returns totals to founders and managers.
drop function public.account_balances();
create function public.account_balances()
returns table (account_id uuid, name text, kind text, opening_balance numeric, opening_date date,
               money_in numeric, money_out numeric, balance numeric, is_default boolean, last_movement date)
language sql stable security definer set search_path = public as $$
  select a.id, a.name, a.kind, a.opening_balance, a.opening_date,
    coalesce(sum(l.amount) filter (where l.direction = 1 and l.source_table <> 'opening'), 0),
    coalesce(sum(l.amount) filter (where l.direction = -1), 0),
    a.opening_balance + coalesce(sum(l.amount * l.direction) filter (where l.source_table <> 'opening'), 0),
    a.is_default, max(l.entry_date) filter (where l.source_table <> 'opening')
  from public.money_accounts a
  left join (
    select r.account_id, r.received_on entry_date, r.amount_received amount, 1 direction, 'receipt' source_table from public.receipts r where not r.is_archived
    union all
    select e.account_id, e.paid_on, e.total - e.tds_deducted, -1, 'expense' from public.expenses e
      where not e.is_archived and e.status = 'paid' and e.account_id is not null
    union all
    select c.account_id, c.entry_date, c.amount, case when c.kind = 'capital_added' then 1 else -1 end, 'capital'
      from public.capital_entries c where not c.is_archived and c.account_id is not null
    union all
    select x.from_account_id, x.transfer_date, x.amount, -1, 'transfer' from public.account_transfers x where not x.is_archived
    union all
    select x.to_account_id, x.transfer_date, x.amount, 1, 'transfer' from public.account_transfers x where not x.is_archived
  ) l on l.account_id = a.id
  where not a.is_archived and public.is_staff()
  group by a.id
  order by a.is_default desc, a.name
$$;

-- One account's movements. Capital lines are shown to founders; managers
-- see them as one "capital movements" total so the running balance still adds up.
create or replace function public.account_statement(p_account uuid)
returns table (entry_date date, source_table text, source_id uuid, description text, money_in numeric, money_out numeric)
language sql stable security definer set search_path = public as $$
  select * from (
    select a.opening_date, 'opening'::text, a.id, 'Opening balance'::text,
           case when a.opening_balance >= 0 then a.opening_balance else 0 end, case when a.opening_balance < 0 then -a.opening_balance else 0 end
    from money_accounts a where a.id = p_account and a.opening_balance <> 0
    union all
    select r.received_on, 'receipts', r.id,
           case when r.category = 'other_income' then 'Other income' else 'Payment from ' || coalesce(b.name, 'a brand') end
             || coalesce(' · ' || r.reference, ''), r.amount_received, 0
    from receipts r left join brands b on b.id = r.brand_id where r.account_id = p_account and not r.is_archived
    union all
    select e.paid_on, 'expenses', e.id, e.description, 0, e.total - e.tds_deducted
    from expenses e where e.account_id = p_account and not e.is_archived and e.status = 'paid'
    union all
    select x.transfer_date, 'account_transfers', x.id, 'Transfer from ' || f.name, x.amount, 0
    from account_transfers x join money_accounts f on f.id = x.from_account_id where x.to_account_id = p_account and not x.is_archived
    union all
    select x.transfer_date, 'account_transfers', x.id, 'Transfer to ' || t.name, 0, x.amount
    from account_transfers x join money_accounts t on t.id = x.to_account_id where x.from_account_id = p_account and not x.is_archived
    union all
    select c.entry_date, 'capital_entries', c.id,
           case c.kind when 'capital_added' then 'Capital added' else 'Founder withdrawal' end || ' — ' || coalesce(f.name, 'Company'),
           case when c.kind = 'capital_added' then c.amount else 0 end, case when c.kind = 'founder_withdrawal' then c.amount else 0 end
    from capital_entries c left join team_members f on f.id = c.founder_id
    where c.account_id = p_account and not c.is_archived and is_founder()
    union all
    select max(c.entry_date), 'capital_entries', null, 'Capital movements (founders see the detail)',
           coalesce(sum(c.amount) filter (where c.kind = 'capital_added'), 0), coalesce(sum(c.amount) filter (where c.kind = 'founder_withdrawal'), 0)
    from capital_entries c where c.account_id = p_account and not c.is_archived and not is_founder()
    having count(*) > 0
  ) s
  where is_staff()
  order by 1, 2
$$;

-- ─────────────────────────────────────────────────────────────
-- 12. Profit lines. Every P&L figure is a sum over this view, on either basis:
--   invoice basis   revenue when invoiced (issue date), costs when incurred
--                   (expense date; payouts when agreed: paid date, else due date,
--                   else the day it was recorded)
--   payments basis  revenue when paid (the pre-GST share of each payment),
--                   costs when paid
--   Both: amounts before GST. Payout expenses aren't counted twice; tax
--   payments (GST / TDS deposited) are not costs.
-- ─────────────────────────────────────────────────────────────
create or replace view public.pnl_lines with (security_invoker = true) as
  select 'invoice'::text as basis, 'revenue'::text as line, t.issue_date as entry_date, t.subtotal as amount,
         t.brand_id, t.campaign_id, 'invoices'::text as source_table, t.invoice_id as source_id
  from public.invoice_totals t where t.document_status = 'sent'
union all
  select 'cash', 'revenue', r.received_on, round(a.amount * t.subtotal / nullif(t.total, 0), 2),
         t.brand_id, t.campaign_id, 'receipts', r.id
  from public.receipt_allocations a join public.receipts r on r.id = a.receipt_id join public.invoice_totals t on t.invoice_id = a.invoice_id
  where not a.is_archived and not r.is_archived and t.document_status = 'sent'
union all
  select b.basis, 'other_income', r.received_on, r.amount_received, r.brand_id, null, 'receipts', r.id
  from public.receipts r cross join (values ('invoice'), ('cash')) b(basis)
  where not r.is_archived and r.category = 'other_income'
union all
  select 'invoice', 'creator_payout', coalesce(p.paid_on, p.due_date, (p.created_at at time zone 'Asia/Kolkata')::date), p.amount,
         p.brand_id, p.campaign_id, 'creator_payouts', p.id
  from public.creator_payouts p where not p.is_archived and p.status <> 'cancelled'
union all
  select 'cash', 'creator_payout', p.paid_on, p.amount, p.brand_id, p.campaign_id, 'creator_payouts', p.id
  from public.creator_payouts p where not p.is_archived and p.status = 'paid'
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

-- ─────────────────────────────────────────────────────────────
-- 13. Money overview for a date range
--   gross profit = revenue − creator payouts − direct expenses
--   net profit   = gross profit − overhead expenses + other income
-- Outstanding, ageing and pending payouts are as of today.
-- ─────────────────────────────────────────────────────────────
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
    (select coalesce(sum(subtotal), 0) from invoice_totals where document_status = 'sent' and issue_date between p_from and p_to),
    v.rev,
    (select coalesce(sum(amount_received), 0) from receipts where not is_archived and received_on between p_from and p_to),
    v.oth, v.po, v.dir, v.ovh, v.dir + v.ovh,
    v.rev - v.po - v.dir,
    v.rev - v.po - v.dir - v.ovh + v.oth,
    case when v.rev > 0 then round((v.rev - v.po - v.dir) / v.rev * 100, 1) end,
    case when v.rev > 0 then round((v.rev - v.po - v.dir - v.ovh + v.oth) / v.rev * 100, 1) end,
    (select coalesce(sum(gst_total), 0) from invoice_totals where document_status = 'sent' and issue_date between p_from and p_to),
    (select coalesce(sum(e.gst_amount), 0) from expenses e where not e.is_archived and e.expense_date between p_from and p_to),
    o.outs, o.ovd, o.n, o.a1, o.a2, o.a3,
    (select coalesce(sum(net_payable), 0) from creator_payout_totals where status in ('pending','approved')),
    (select count(*) from creator_payout_totals where status in ('pending','approved')),
    (select count(*) from creator_payout_totals where status in ('pending','approved') and due_date < ist_today()),
    (select coalesce(sum(total), 0) from expenses where not is_archived and status = 'unpaid')
  from v, o
$$;

-- Profit by brand / by campaign for a range (direct costs only; overheads
-- aren't spread across clients).
create or replace function public.profit_by(p_group text, p_from date, p_to date, p_basis text default 'invoice')
returns table (id uuid, name text, brand_name text, revenue numeric, creator_payouts numeric,
               direct_expenses numeric, profit numeric, margin_pct numeric)
language sql stable security invoker set search_path = public as $$
  with l as (
    select case when p_group = 'campaign' then campaign_id else brand_id end as gid, line, amount
    from pnl_lines
    where basis = case when p_basis = 'cash' then 'cash' else 'invoice' end and entry_date between p_from and p_to
      and line in ('revenue','creator_payout','direct_expense')
  ), g as (
    select gid, coalesce(sum(amount) filter (where line = 'revenue'), 0) rev,
                coalesce(sum(amount) filter (where line = 'creator_payout'), 0) po,
                coalesce(sum(amount) filter (where line = 'direct_expense'), 0) dir
    from l group by gid
  )
  select g.gid,
    case when p_group = 'campaign' then coalesce(c.name, 'Not linked to a campaign') else coalesce(b.name, 'Not linked to a brand') end,
    case when p_group = 'campaign' then cb.name end,
    g.rev, g.po, g.dir, g.rev - g.po - g.dir,
    case when g.rev > 0 then round((g.rev - g.po - g.dir) / g.rev * 100, 1) end
  from g
  left join brands b on p_group <> 'campaign' and b.id = g.gid
  left join campaigns c on p_group = 'campaign' and c.id = g.gid
  left join brands cb on cb.id = c.brand_id
  order by g.rev - g.po - g.dir desc
$$;

-- ─────────────────────────────────────────────────────────────
-- 14. GST and TDS for the CA
-- ─────────────────────────────────────────────────────────────
create or replace view public.gst_register with (security_invoker = true) as
select t.invoice_id, t.invoice_number, t.issue_date, t.brand_id, b.billing_name, b.name as brand_name, b.gstin as brand_gstin,
  t.place_of_supply_code, b.state as brand_state, t.is_interstate, t.gst_rate,
  t.subtotal as taxable_value, t.cgst, t.sgst, t.igst, t.gst_total, t.total
from public.invoice_totals t join public.brands b on b.id = t.brand_id
where t.document_status = 'sent';

create or replace function public.gst_monthly(p_from date, p_to date)
returns table (month date, invoices bigint, taxable_value numeric, cgst numeric, sgst numeric, igst numeric,
               output_gst numeric, input_gst numeric, gst_paid numeric, net_gst numeric)
language sql stable security invoker set search_path = public as $$
  with m as (select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month)
  select m.month,
    (select count(*) from gst_register g where date_trunc('month', g.issue_date) = m.month),
    (select coalesce(sum(taxable_value), 0) from gst_register g where date_trunc('month', g.issue_date) = m.month),
    (select coalesce(sum(cgst), 0) from gst_register g where date_trunc('month', g.issue_date) = m.month),
    (select coalesce(sum(sgst), 0) from gst_register g where date_trunc('month', g.issue_date) = m.month),
    (select coalesce(sum(igst), 0) from gst_register g where date_trunc('month', g.issue_date) = m.month),
    (select coalesce(sum(gst_total), 0) from gst_register g where date_trunc('month', g.issue_date) = m.month),
    (select coalesce(sum(e.gst_amount), 0) from expenses e where not e.is_archived and date_trunc('month', e.expense_date) = m.month),
    (select coalesce(sum(e.total), 0) from expenses e join expense_categories c on c.id = e.category_id
      where not e.is_archived and c.treatment = 'gst_payment' and date_trunc('month', e.expense_date) = m.month),
    (select coalesce(sum(gst_total), 0) from gst_register g where date_trunc('month', g.issue_date) = m.month)
    - (select coalesce(sum(e.gst_amount), 0) from expenses e where not e.is_archived and date_trunc('month', e.expense_date) = m.month)
  from m order by m.month
$$;

create or replace function public.tds_monthly(p_from date, p_to date)
returns table (month date, tds_by_clients numeric, tds_we_deducted numeric, tds_deposited numeric)
language sql stable security invoker set search_path = public as $$
  with m as (select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month)
  select m.month,
    (select coalesce(sum(r.tds_deducted), 0) from receipts r where not r.is_archived and date_trunc('month', r.received_on) = m.month),
    (select coalesce(sum(e.tds_deducted), 0) from expenses e where not e.is_archived and e.status = 'paid' and date_trunc('month', e.paid_on) = m.month),
    (select coalesce(sum(e.total), 0) from expenses e join expense_categories c on c.id = e.category_id
      where not e.is_archived and c.treatment = 'tds_payment' and date_trunc('month', e.expense_date) = m.month)
  from m order by m.month
$$;

-- TDS line by line (who deducted / whom we deducted from), for the CA
create or replace view public.tds_register with (security_invoker = true) as
  select 'deducted_by_client'::text as direction, r.received_on as entry_date, b.name as party, b.pan as party_pan,
         r.reference, r.tds_deducted as tds, r.amount_received + r.tds_deducted as gross, 'receipts'::text as source_table, r.id as source_id
  from public.receipts r left join public.brands b on b.id = r.brand_id where not r.is_archived and r.tds_deducted > 0
union all
  select 'deducted_by_us', e.paid_on, coalesce(cr.name, v.name, e.description), coalesce(v.pan, null),
         e.bill_number, e.tds_deducted, e.amount + e.gst_amount, 'expenses', e.id
  from public.expenses e
  left join public.creator_payouts p on p.id = e.payout_id
  left join public.creators cr on cr.id = p.creator_id
  left join public.vendors v on v.id = coalesce(p.vendor_id, e.vendor_id)
  where not e.is_archived and e.status = 'paid' and e.tds_deducted > 0;

-- ─────────────────────────────────────────────────────────────
-- 15. Capital per founder and the company balance check (founders only)
--   founder capital = opening + added − withdrawals + profit transferred,
--   with company-level entries split by profit share.
-- ─────────────────────────────────────────────────────────────
create or replace function public.capital_accounts()
returns table (founder_id uuid, name text, profit_share_pct numeric, opening_capital numeric, capital_added numeric,
               withdrawals numeric, profit_transferred numeric, balance numeric)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not is_founder() then raise exception 'Only founders see capital'; end if;
  return query
  with f as (select t.id, t.name, coalesce(t.profit_share_pct, 0) pct from team_members t where t.role = 'founder' and not t.is_archived),
  e as (
    select c.kind, c.amount, c.founder_id from capital_entries c where not c.is_archived
  ), s as (
    select f.id, f.name, f.pct, e.kind,
           case when e.founder_id = f.id then e.amount when e.founder_id is null then round(e.amount * f.pct / 100, 2) else 0 end as share
    from f cross join e
  )
  select f.id, f.name, f.pct,
    coalesce(sum(s.share) filter (where s.kind = 'opening_capital'), 0),
    coalesce(sum(s.share) filter (where s.kind = 'capital_added'), 0),
    coalesce(sum(s.share) filter (where s.kind = 'founder_withdrawal'), 0),
    coalesce(sum(s.share) filter (where s.kind = 'profit_transferred'), 0),
    coalesce(sum(case when s.kind = 'founder_withdrawal' then -s.share else s.share end), 0)
  from f left join s on s.id = f.id
  group by f.id, f.name, f.pct order by f.name;
end $$;

-- Capital + retained profit  =  money in accounts + owed to us − we owe.
--   owed to us = unpaid invoices + TDS clients deducted (claimable)
--   we owe     = unpaid payouts + unpaid expenses + client advances not yet
--                applied + GST payable (output − input − paid) + TDS to deposit
--   retained profit = all-time net profit (invoice basis) − profit transferred
-- A difference means an entry is missing (e.g. opening capital not recorded).
create or replace function public.balance_check()
returns table (capital numeric, retained_profit numeric, left_side numeric,
               accounts numeric, receivables numeric, tds_credit numeric, owed_to_us numeric,
               payouts_owed numeric, expenses_owed numeric, advances numeric, gst_payable numeric, tds_payable numeric, we_owe numeric,
               right_side numeric, difference numeric, is_balanced boolean)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_cap numeric; v_profit numeric; v_transferred numeric; v_acc numeric; v_rec numeric; v_tdsc numeric;
  v_po numeric; v_ex numeric; v_adv numeric; v_gst numeric; v_tds numeric;
begin
  if not is_founder() then raise exception 'Only founders see the balance check'; end if;
  select coalesce(sum(case when kind = 'founder_withdrawal' then -amount else amount end), 0),
         coalesce(sum(amount) filter (where kind = 'profit_transferred'), 0)
    into v_cap, v_transferred from capital_entries where not is_archived;
  select coalesce(sum(case when line in ('revenue','other_income') then amount else -amount end), 0)
    into v_profit from pnl_lines where basis = 'invoice';
  select coalesce(sum(b.balance), 0) into v_acc from account_balances() b;
  select coalesce(sum(outstanding), 0) into v_rec from invoice_totals where document_status = 'sent';
  select coalesce(sum(tds_deducted), 0) into v_tdsc from receipts where not is_archived and category = 'client_payment';
  select coalesce(sum(amount), 0) into v_po from creator_payouts where not is_archived and status in ('pending','approved');
  select coalesce(sum(total), 0) into v_ex from expenses where not is_archived and status = 'unpaid';
  select coalesce(sum(unapplied), 0) into v_adv from payment_list where not is_archived;
  v_gst := (select coalesce(sum(gst_total), 0) from invoice_totals where document_status = 'sent')
         - (select coalesce(sum(gst_amount), 0) from expenses where not is_archived)
         - (select coalesce(sum(e.total), 0) from expenses e join expense_categories c on c.id = e.category_id
             where not e.is_archived and c.treatment = 'gst_payment');
  v_tds := (select coalesce(sum(tds_deducted), 0) from expenses where not is_archived and status = 'paid')
         - (select coalesce(sum(e.total), 0) from expenses e join expense_categories c on c.id = e.category_id
             where not e.is_archived and c.treatment = 'tds_payment');
  return query select v_cap, v_profit - v_transferred, v_cap + v_profit - v_transferred,
    v_acc, v_rec, v_tdsc, v_rec + v_tdsc,
    v_po, v_ex, v_adv, v_gst, v_tds, v_po + v_ex + v_adv + v_gst + v_tds,
    v_acc + v_rec + v_tdsc - (v_po + v_ex + v_adv + v_gst + v_tds),
    (v_cap + v_profit - v_transferred) - (v_acc + v_rec + v_tdsc - (v_po + v_ex + v_adv + v_gst + v_tds)),
    abs((v_cap + v_profit - v_transferred) - (v_acc + v_rec + v_tdsc - (v_po + v_ex + v_adv + v_gst + v_tds))) < 1;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 16. Retainer: this month's invoice in one click (a draft to check & send)
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_retainer_invoice(p_retainer uuid, p_month date default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare r retainers; m date := date_trunc('month', coalesce(p_month, ist_today()))::date; v_id uuid; v_scope text; v_existing text;
begin
  select * into r from retainers where id = p_retainer and not is_archived;
  if r.id is null then raise exception 'Retainer not found'; end if;
  if r.status <> 'active' then raise exception 'This retainer isn’t active'; end if;
  select coalesce(invoice_number, 'a draft') into v_existing from invoices
   where retainer_id = r.id and service_period_start = m and status <> 'cancelled' and not is_archived;
  if found then raise exception '%’s invoice already exists (%)', to_char(m, 'FMMonth YYYY'), v_existing; end if;
  select string_agg(s.quantity_per_month || ' ' || replace(s.deliverable_type, '_', ' ') ||
                    case when s.quantity_per_month > 1 then 's' else '' end, ', ' order by s.created_at)
    into v_scope from retainer_scope_items s where s.retainer_id = r.id and not s.is_archived;
  insert into invoices (brand_id, retainer_id, service_period_start, service_period_end, gst_rate, notes)
  values (r.brand_id, r.id, m, (m + interval '1 month')::date - 1,
          coalesce((select default_gst_rate from org_settings limit 1), 18), null)
  returning id into v_id;
  insert into invoice_items (invoice_id, position, description, quantity, rate)
  values (v_id, 1, r.title || ' — ' || to_char(m, 'FMMonth YYYY') || coalesce(' (' || v_scope || ')', ''), 1, r.monthly_fee);
  return v_id;
end $$;

-- Which active retainers have no invoice for a month yet
create or replace function public.retainers_to_invoice(p_month date default null)
returns table (retainer_id uuid, brand_id uuid, brand_name text, title text, monthly_fee numeric, invoice_id uuid, invoice_number text)
language sql stable security invoker set search_path = public as $$
  select r.id, r.brand_id, b.name, r.title, r.monthly_fee, i.id, i.invoice_number
  from retainers r join brands b on b.id = r.brand_id
  left join invoices i on i.retainer_id = r.id and i.service_period_start = date_trunc('month', coalesce(p_month, ist_today()))::date
                       and i.status <> 'cancelled' and not i.is_archived
  where not r.is_archived and r.status = 'active' and not b.is_archived
  order by b.name
$$;

-- ─────────────────────────────────────────────────────────────
-- 17. Campaign profit views: payout expenses aren't counted twice
-- ─────────────────────────────────────────────────────────────
create or replace view public.campaign_financials with (security_invoker = true) as
select
  c.id as campaign_id, c.brand_id, c.name, c.status, cf.contract_value, cf.creator_budget,
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
left join public.campaign_finances cf on cf.campaign_id = c.id
left join (select campaign_id, sum(subtotal) billed, sum(outstanding) outstanding, sum(paid) received
           from public.invoice_totals where document_status = 'sent' group by campaign_id) inv
       on inv.campaign_id = c.id
left join (select campaign_id, sum(gross) creator_cost,
                  sum(gross) filter (where status = 'paid') creator_paid
           from public.creator_payout_totals group by campaign_id) po
       on po.campaign_id = c.id
left join (select e.campaign_id, sum(e.amount) direct_cost from public.expenses e join public.expense_categories k on k.id = e.category_id
           where not e.is_archived and e.payout_id is null and k.treatment in ('direct','overhead') group by e.campaign_id) ex
       on ex.campaign_id = c.id
where not c.is_archived;

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
  case when coalesce(pf.views,0) > 0 and fin.contract_value is not null then round(fin.contract_value / pf.views, 4) end as client_cost_per_view
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

-- Dashboard period summary, same numbers as the Money overview (invoice basis)
create or replace function public.period_summary(
  period text default 'this_month', custom_from date default null, custom_to date default null)
returns table (
  start_date date, end_date date,
  revenue numeric, gst_billed numeric, collections numeric,
  creator_cost numeric, expenses numeric, profit numeric,
  outstanding_now numeric, overdue_now numeric, creator_payable_now numeric,
  deliverables_live bigint, deliverables_due bigint)
language sql stable security invoker as $$
  with p as (select * from public.period_bounds(period, custom_from, custom_to)),
  o as (select m.* from p, public.money_overview(p.start_date, p.end_date, 'invoice') m)
  select p.start_date, p.end_date, o.revenue, o.gst_output, o.cash_received, o.creator_payouts, o.expenses, o.net_profit,
    o.outstanding, o.overdue, o.payouts_pending,
    (select count(*) from public.deliverables d where not d.is_archived
       and (d.went_live_at at time zone 'Asia/Kolkata')::date between p.start_date and p.end_date),
    (select count(*) from public.deliverables d where not d.is_archived
       and d.stage not in ('live','cancelled') and d.due_date between p.start_date and p.end_date)
  from p, o
$$;

-- ─────────────────────────────────────────────────────────────
-- 18. Activity for a money record and its lines / allocations
-- ─────────────────────────────────────────────────────────────
create or replace function public.money_activity(p_table text, p_id uuid)
returns table (id uuid, created_at timestamptz, action text, table_name text, record_id uuid,
               changed_fields text[], old_values jsonb, new_values jsonb, source text,
               actor_id uuid, actor_name text, reason text)
language sql stable security invoker set search_path = public as $$
  with recs as (
    select p_table as t, p_id as rid
    union all select 'invoice_items', i.id from invoice_items i where p_table = 'invoices' and i.invoice_id = p_id
    union all select 'receipt_allocations', a.id from receipt_allocations a where p_table = 'invoices' and a.invoice_id = p_id
    union all select 'receipt_allocations', a.id from receipt_allocations a where p_table = 'receipts' and a.receipt_id = p_id
    union all select 'expenses', e.id from expenses e where p_table = 'creator_payouts' and e.payout_id = p_id
    union all select 'files', f.id from files f where p_table = 'expenses' and f.expense_id = p_id
  )
  select l.id, l.created_at, l.action, l.table_name, l.record_id, l.changed_fields, l.old_values, l.new_values, l.source,
         l.created_by, m.name, l.reason
  from activity_log l join recs r on r.t = l.table_name and r.rid = l.record_id
  left join team_members m on m.id = l.created_by
  order by l.created_at desc limit 300
$$;
