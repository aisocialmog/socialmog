-- Social Mog OS — 0004 money: accounts, invoices, receipts, expenses,
-- creator payouts, capital, transfers, targets.
-- Rule: amounts typed in are facts from a document (a bill, a bank credit,
-- an invoice line). Every total, balance, profit and outstanding figure is
-- calculated in the views of 0006 — never stored, never typed.

-- ─────────────────────────────────────────────────────────────
-- Money that belongs to campaigns / creators / deliverables lives in these
-- side tables (one row each) instead of on the work tables, so team members
-- and freelancers can see the work without ever seeing an amount.
-- ─────────────────────────────────────────────────────────────
create table public.campaign_finances (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.team_members(id),
  campaign_id     uuid not null unique references public.campaigns(id),
  contract_value  numeric(14,2) check (contract_value >= 0),  -- agreed fee, before GST (what was signed)
  creator_budget  numeric(14,2) check (creator_budget >= 0),  -- planned spend on creators
  po_number       text
);

create table public.campaign_creator_fees (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references public.team_members(id),
  campaign_creator_id  uuid not null unique references public.campaign_creators(id),
  agreed_fee           numeric(14,2) check (agreed_fee >= 0),    -- total agreed with the creator
  client_price         numeric(14,2) check (client_price >= 0)   -- what the brand is billed for this creator
);

create table public.deliverable_fees (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.team_members(id),
  deliverable_id   uuid not null unique references public.deliverables(id),
  creator_fee      numeric(14,2) check (creator_fee >= 0),       -- agreed cost for this piece
  billable_amount  numeric(14,2) check (billable_amount >= 0)    -- agreed price for this piece
);

-- Where money sits: bank accounts, cash, UPI/wallets.
create table public.money_accounts (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.team_members(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  name          text not null,               -- "HDFC Current", "Petty cash"
  kind          text not null default 'bank' check (kind in ('bank','cash','upi_wallet','card','other')),
  bank_name     text,
  last4         text,                        -- only the last 4 digits are kept
  is_default    boolean not null default false
);

-- ─────────────────────────────────────────────────────────────
-- Invoices (to brands)
-- ─────────────────────────────────────────────────────────────
create table public.invoices (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.team_members(id),
  is_archived           boolean not null default false,
  archived_at           timestamptz,
  import_batch_id       uuid references public.import_batches(id),
  brand_id              uuid not null references public.brands(id),
  campaign_id           uuid references public.campaigns(id),
  retainer_id           uuid references public.retainers(id),
  billing_contact_id    uuid references public.brand_contacts(id),
  kind                  text not null default 'tax_invoice'
                        check (kind in ('tax_invoice','proforma','credit_note')),
  invoice_number        text unique,          -- assigned when issued (draft has none)
  issue_date            date,
  due_date              date,
  service_period_start  date,                 -- e.g. retainer month
  service_period_end    date,
  place_of_supply_code  text,                 -- GST state code; vs org state → CGST+SGST or IGST
  status                text not null default 'draft'
                        check (status in ('draft','sent','void')),   -- paid/overdue are CALCULATED
  sent_at               timestamptz,
  voided_reason         text,
  notes                 text,
  credit_note_for_id    uuid references public.invoices(id),
  check (due_date is null or issue_date is null or due_date >= issue_date)
);
create index invoices_brand_idx    on public.invoices (brand_id);
create index invoices_campaign_idx on public.invoices (campaign_id);
create index invoices_issue_idx    on public.invoices (issue_date);

create table public.invoice_items (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.team_members(id),
  is_archived     boolean not null default false,
  archived_at     timestamptz,
  invoice_id      uuid not null references public.invoices(id),
  deliverable_id  uuid references public.deliverables(id),
  position        int not null default 1,
  description     text not null,
  hsn_sac         text default '998361',      -- advertising services SAC
  quantity        numeric(12,2) not null default 1 check (quantity > 0),
  rate            numeric(14,2) not null check (rate >= 0),
  gst_rate        numeric(5,2) not null default 18 check (gst_rate >= 0),
  amount          numeric(14,2) generated always as (round(quantity * rate, 2)) stored,
  gst_amount      numeric(14,2) generated always as (round(round(quantity * rate, 2) * gst_rate / 100, 2)) stored
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- ─────────────────────────────────────────────────────────────
-- Income: money received. One receipt can settle several invoices.
-- ─────────────────────────────────────────────────────────────
create table public.receipts (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.team_members(id),
  is_archived       boolean not null default false,
  archived_at       timestamptz,
  import_batch_id   uuid references public.import_batches(id),
  brand_id          uuid references public.brands(id),   -- null = other income (interest, refund…)
  account_id        uuid not null references public.money_accounts(id),
  received_on       date not null,
  amount_received   numeric(14,2) not null check (amount_received > 0),  -- what hit the bank
  tds_deducted      numeric(14,2) not null default 0 check (tds_deducted >= 0), -- client's TDS (claimable)
  category          text not null default 'client_payment'
                    check (category in ('client_payment','advance','other_income','refund','interest')),
  mode              text check (mode in ('neft','rtgs','imps','upi','cheque','cash','card','other')),
  reference         text,                    -- UTR / cheque number
  notes             text
);
create index receipts_date_idx  on public.receipts (received_on);
create index receipts_brand_idx on public.receipts (brand_id);

create table public.receipt_allocations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.team_members(id),
  is_archived boolean not null default false,
  archived_at timestamptz,
  receipt_id  uuid not null references public.receipts(id),
  invoice_id  uuid not null references public.invoices(id),
  amount      numeric(14,2) not null check (amount > 0),   -- portion of (received + TDS) applied
  unique (receipt_id, invoice_id)
);
create index receipt_allocations_invoice_idx on public.receipt_allocations (invoice_id);

-- ─────────────────────────────────────────────────────────────
-- Expenses
-- ─────────────────────────────────────────────────────────────
create table public.expense_categories (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.team_members(id),
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  name         text not null unique,
  parent_id    uuid references public.expense_categories(id),
  is_direct    boolean not null default false   -- direct project cost (counts in campaign profit)
);

create table public.expenses (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.team_members(id),
  is_archived        boolean not null default false,
  archived_at        timestamptz,
  import_batch_id    uuid references public.import_batches(id),
  category_id        uuid not null references public.expense_categories(id),
  vendor_id          uuid references public.vendors(id),
  brand_id           uuid references public.brands(id),
  campaign_id        uuid references public.campaigns(id),
  deliverable_id     uuid references public.deliverables(id),
  shoot_id           uuid references public.shoots(id),
  description        text not null,
  expense_date       date not null,
  amount             numeric(14,2) not null check (amount >= 0),       -- before GST, from the bill
  gst_amount         numeric(14,2) not null default 0 check (gst_amount >= 0),
  tds_deducted       numeric(14,2) not null default 0 check (tds_deducted >= 0),
  total              numeric(14,2) generated always as (amount + gst_amount) stored,
  bill_number        text,
  -- paid from a company account, OR personally by a founder (→ reimbursement owed)
  status             text not null default 'paid' check (status in ('unpaid','paid','reimbursed')),
  paid_on            date,
  account_id         uuid references public.money_accounts(id),
  paid_by_member_id  uuid references public.team_members(id),
  is_recurring       boolean not null default false,
  notes              text
);
create index expenses_date_idx     on public.expenses (expense_date);
create index expenses_campaign_idx on public.expenses (campaign_id);

-- ─────────────────────────────────────────────────────────────
-- Creator payouts. A payout bundles one or more deliverables / fees.
-- ─────────────────────────────────────────────────────────────
create table public.creator_payouts (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references public.team_members(id),
  is_archived          boolean not null default false,
  archived_at          timestamptz,
  import_batch_id      uuid references public.import_batches(id),
  creator_id           uuid not null references public.creators(id),
  campaign_id          uuid references public.campaigns(id),
  campaign_creator_id  uuid references public.campaign_creators(id),
  tds_rate             numeric(5,2) not null default 0 check (tds_rate between 0 and 100),
  tds_section          text,
  gst_rate             numeric(5,2) not null default 0,   -- if the creator is GST-registered
  due_date             date,
  status               text not null default 'pending'
                       check (status in ('pending','approved','paid','on_hold','cancelled')),
  paid_on              date,
  account_id           uuid references public.money_accounts(id),
  reference            text,                  -- UTR
  creator_invoice_no   text,
  notes                text
);
create index creator_payouts_creator_idx  on public.creator_payouts (creator_id);
create index creator_payouts_campaign_idx on public.creator_payouts (campaign_id);

create table public.creator_payout_items (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.team_members(id),
  is_archived     boolean not null default false,
  archived_at     timestamptz,
  payout_id       uuid not null references public.creator_payouts(id),
  deliverable_id  uuid references public.deliverables(id),
  description     text not null,
  amount          numeric(14,2) not null check (amount >= 0)   -- gross, before TDS
);
create index creator_payout_items_payout_idx on public.creator_payout_items (payout_id);

-- ─────────────────────────────────────────────────────────────
-- Capital (feature 7): founder money in / out, opening balances, loans.
-- ─────────────────────────────────────────────────────────────
create table public.capital_entries (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.team_members(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  import_batch_id uuid references public.import_batches(id),
  kind          text not null
                check (kind in ('opening_balance','founder_contribution','founder_withdrawal','loan_in','loan_repayment','reimbursement')),
  founder_id    uuid references public.team_members(id),   -- whose money (null for opening balance)
  account_id    uuid not null references public.money_accounts(id),
  entry_date    date not null,
  amount        numeric(14,2) not null check (amount > 0),  -- sign comes from kind
  expense_id    uuid references public.expenses(id),        -- for reimbursements
  notes         text
);
create index capital_entries_date_idx on public.capital_entries (entry_date);

create table public.account_transfers (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.team_members(id),
  is_archived      boolean not null default false,
  archived_at      timestamptz,
  from_account_id  uuid not null references public.money_accounts(id),
  to_account_id    uuid not null references public.money_accounts(id),
  transfer_date    date not null,
  amount           numeric(14,2) not null check (amount > 0),
  notes            text,
  check (from_account_id <> to_account_id)
);

-- Targets for the ensō progress rings (e.g. monthly revenue goal).
create table public.targets (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.team_members(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  metric        text not null check (metric in ('revenue','collections','profit','deliverables_live','new_brands')),
  period_start  date not null,
  period_end    date not null,
  target_value  numeric(14,2) not null check (target_value > 0),
  team_member_id uuid references public.team_members(id),  -- null = whole agency
  check (period_end >= period_start)
);
