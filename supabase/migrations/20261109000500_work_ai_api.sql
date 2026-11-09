-- Social Mog OS — 0005 tasks, comments, files, notifications, automations,
-- AI, external API (Ops Board), backups.

-- ─────────────────────────────────────────────────────────────
-- Tasks (feature 8). Optional links to whatever the task is about.
-- ─────────────────────────────────────────────────────────────
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  is_archived      boolean not null default false,
  archived_at      timestamptz,
  title            text not null,
  description      text,
  status           text not null default 'todo'
                   check (status in ('todo','in_progress','blocked','done','cancelled')),
  priority         text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_id      uuid references public.profiles(id),
  due_date         date,
  completed_at     timestamptz,
  blocked_reason   text,                      -- the andon "I'm blocked" button fills this
  blocked_at       timestamptz,
  parent_task_id   uuid references public.tasks(id),
  brand_id         uuid references public.brands(id),
  creator_id       uuid references public.creators(id),
  campaign_id      uuid references public.campaigns(id),
  deliverable_id   uuid references public.deliverables(id),
  shoot_id         uuid references public.shoots(id),
  invoice_id       uuid references public.invoices(id),
  source           text not null default 'manual' check (source in ('manual','automation','ai','api')),
  check (status <> 'blocked' or blocked_reason is not null)
);
create index tasks_assignee_idx on public.tasks (assignee_id, status) where not is_archived;
create index tasks_due_idx      on public.tasks (due_date) where not is_archived;

-- Comments / notes on any record (one nullable FK per linkable table keeps real FKs).
create table public.comments (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  is_archived     boolean not null default false,
  archived_at     timestamptz,
  body            text not null,
  task_id         uuid references public.tasks(id),
  brand_id        uuid references public.brands(id),
  creator_id      uuid references public.creators(id),
  campaign_id     uuid references public.campaigns(id),
  deliverable_id  uuid references public.deliverables(id),
  invoice_id      uuid references public.invoices(id),
  check (num_nonnulls(task_id, brand_id, creator_id, campaign_id, deliverable_id, invoice_id) = 1)
);

-- File attachments (Supabase Storage). The bytes live in storage; this row
-- records what the file is and what it belongs to.
create table public.files (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  is_archived      boolean not null default false,
  archived_at      timestamptz,
  bucket           text not null default 'records',
  storage_path     text not null,
  file_name        text not null,
  mime_type        text,
  size_bytes       bigint,
  kind             text not null default 'other'
                   check (kind in ('contract','brief','script','raw_footage','edit','invoice_pdf','bill','creator_invoice','screenshot','media_kit','other')),
  brand_id         uuid references public.brands(id),
  creator_id       uuid references public.creators(id),
  campaign_id      uuid references public.campaigns(id),
  deliverable_id   uuid references public.deliverables(id),
  invoice_id       uuid references public.invoices(id),
  expense_id       uuid references public.expenses(id),
  payout_id        uuid references public.creator_payouts(id),
  task_id          uuid references public.tasks(id),
  unique (bucket, storage_path)
);

-- ─────────────────────────────────────────────────────────────
-- Notifications & automations (feature 11)
-- ─────────────────────────────────────────────────────────────
create table public.automation_rules (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  is_archived     boolean not null default false,
  archived_at     timestamptz,
  name            text not null,
  trigger_kind    text not null
                  check (trigger_kind in ('invoice_due','invoice_overdue','payout_due','deliverable_due','go_live_due',
                                          'task_due','task_blocked','campaign_ending','retainer_billing_day',
                                          'creator_metrics_stale','weekly_digest')),
  offset_days     int not null default 0,     -- negative = before the date
  channel         text not null default 'in_app' check (channel in ('in_app','email','whatsapp')),
  recipient_mode  text not null default 'owner' check (recipient_mode in ('owner','assignee','founders','everyone')),
  action          text not null default 'notify' check (action in ('notify','create_task')),
  is_enabled      boolean not null default true,
  last_run_at     timestamptz
);

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  recipient_id  uuid not null references public.profiles(id),
  kind          text not null,               -- matches automation trigger_kind or 'mention', 'system'
  title         text not null,
  body          text,
  table_name    text,                        -- which record to open
  record_id     uuid,
  rule_id       uuid references public.automation_rules(id),
  read_at       timestamptz
);
create index notifications_recipient_idx on public.notifications (recipient_id, read_at);

create table public.reminders (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  rule_id       uuid references public.automation_rules(id),
  recipient_id  uuid references public.profiles(id),
  remind_at     timestamptz not null,
  table_name    text not null,
  record_id     uuid not null,
  status        text not null default 'scheduled' check (status in ('scheduled','sent','failed','cancelled')),
  sent_at       timestamptz,
  error         text,
  unique (rule_id, table_name, record_id, remind_at)   -- never send the same reminder twice
);
create index reminders_due_idx on public.reminders (remind_at) where status = 'scheduled';

-- ─────────────────────────────────────────────────────────────
-- AI (feature 10). Calls happen in Edge Functions; keys never reach the browser.
-- ─────────────────────────────────────────────────────────────
create table public.ai_prompt_templates (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  feature      text not null,               -- script_draft, brief_summary, creator_match, caption…
  name         text not null,
  template     text not null,
  is_default   boolean not null default false
);

create table public.ai_requests (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  feature        text not null,
  provider       text not null,
  model          text not null,
  template_id    uuid references public.ai_prompt_templates(id),
  table_name     text,
  record_id      uuid,
  input_summary  text,
  output         text,
  status         text not null default 'pending' check (status in ('pending','succeeded','failed')),
  error          text,
  tokens_in      int,
  tokens_out     int,
  latency_ms     int
);
alter table public.scripts
  add constraint scripts_ai_request_fk foreign key (ai_request_id) references public.ai_requests(id);

-- ─────────────────────────────────────────────────────────────
-- External API for the Ops Board (feature 12)
-- ─────────────────────────────────────────────────────────────
create table public.api_clients (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  name          text not null,              -- "Ops Board"
  key_prefix    text not null unique,       -- first characters, shown in Settings
  key_hash      text not null,              -- sha-256 of the key; the key itself is never stored
  scopes        text[] not null default '{}',   -- e.g. {deliverables:read, tasks:write}
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz
);

create table public.api_request_log (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  api_client_id  uuid references public.api_clients(id),
  method         text not null,
  path           text not null,
  status_code    int not null,
  ip             inet,
  duration_ms    int
);
create index api_request_log_time_idx on public.api_request_log (created_at desc);

create table public.webhook_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  is_archived    boolean not null default false,
  archived_at    timestamptz,
  api_client_id  uuid not null references public.api_clients(id),
  event          text not null,             -- deliverable.stage_changed, task.created…
  url            text not null,
  secret_hash    text not null,
  is_enabled     boolean not null default true,
  last_status    int,
  last_sent_at   timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- Backups (feature 13)
-- ─────────────────────────────────────────────────────────────
create table public.backups (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  kind          text not null default 'full' check (kind in ('full','database','files','export_csv')),
  trigger       text not null default 'manual' check (trigger in ('manual','scheduled')),
  status        text not null default 'running' check (status in ('running','succeeded','failed')),
  storage_path  text,
  size_bytes    bigint,
  finished_at   timestamptz,
  error         text
);

-- Saved filters on list pages ("Overdue invoices", "Beauty creators > 100k").
create table public.saved_views (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  page         text not null,               -- 'brands', 'creators', 'invoices'…
  name         text not null,
  query        jsonb not null,              -- UI filter state (not business data)
  is_shared    boolean not null default false
);
