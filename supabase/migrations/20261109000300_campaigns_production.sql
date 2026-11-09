-- Social Mog OS — 0003 campaigns, deliverables, production, calendar

-- ─────────────────────────────────────────────────────────────
-- Campaigns (feature 4)
-- ─────────────────────────────────────────────────────────────
create table public.campaigns (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.team_members(id),
  is_archived      boolean not null default false,
  archived_at      timestamptz,
  import_batch_id  uuid references public.import_batches(id),
  brand_id         uuid not null references public.brands(id),
  retainer_id      uuid references public.retainers(id),   -- set if run under a retainer
  name             text not null,
  code             text unique,               -- short ref, e.g. "MAMA-DIWALI-26"
  kind             text not null default 'influencer'
                   check (kind in ('influencer','production','ugc','retainer_month','other')),
  objective        text,
  brief            text,
  platforms        text[] not null default '{}',
  start_date       date,
  end_date         date,
  status           text not null default 'draft'
                   check (status in ('draft','pitched','confirmed','in_production','live','completed','on_hold','cancelled')),
  owner_id         uuid references public.team_members(id),
  completed_at     timestamptz,
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index campaigns_brand_idx  on public.campaigns (brand_id);
create index campaigns_status_idx on public.campaigns (status) where not is_archived;
create index campaigns_dates_idx  on public.campaigns (start_date, end_date);

-- Which creators are on a campaign, and on what terms.
create table public.campaign_creators (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.team_members(id),
  is_archived        boolean not null default false,
  archived_at        timestamptz,
  campaign_id        uuid not null references public.campaigns(id),
  creator_id         uuid not null references public.creators(id),
  status             text not null default 'shortlisted'
                     check (status in ('shortlisted','proposed','client_approved','confirmed','contracted','live','completed','dropped')),
  usage_rights_days  int,
  exclusivity_days   int,
  notes              text,
  unique (campaign_id, creator_id)
);
create index campaign_creators_creator_idx on public.campaign_creators (creator_id);

-- Which team members work on a campaign. Team members see only campaigns they are on.
create table public.campaign_members (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.team_members(id),
  campaign_id     uuid not null references public.campaigns(id),
  team_member_id  uuid not null references public.team_members(id),
  role_on_campaign text,                     -- lead, scriptwriter, editor…
  unique (campaign_id, team_member_id)
);
create index campaign_members_member_idx on public.campaign_members (team_member_id);

-- ─────────────────────────────────────────────────────────────
-- Deliverables — the single unit of work. A reel, a story, a YouTube video.
-- The production tracker (feature 5) is a board of these by stage.
-- Works for campaign work AND retainer work (campaign optional, brand required).
-- ─────────────────────────────────────────────────────────────
create table public.deliverables (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references public.team_members(id),
  is_archived          boolean not null default false,
  archived_at          timestamptz,
  import_batch_id      uuid references public.import_batches(id),
  brand_id             uuid not null references public.brands(id),
  campaign_id          uuid references public.campaigns(id),
  retainer_id          uuid references public.retainers(id),
  campaign_creator_id  uuid references public.campaign_creators(id),
  creator_id           uuid references public.creators(id),
  title                text not null,
  deliverable_type     text not null default 'reel'
                       check (deliverable_type in ('reel','story','post','carousel','youtube_video','short','live','ugc_video','photo','blog','other')),
  platform             text,
  stage                text not null default 'brief'
                       check (stage in ('brief','scripting','script_review','shoot','editing','internal_review','client_review','changes','approved','scheduled','live','cancelled')),
  priority             text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_id          uuid references public.team_members(id),   -- internal owner
  editor_vendor_id     uuid references public.vendors(id),    -- freelance editor, if any
  brief                text,
  script_due           date,
  shoot_date           date,
  edit_due             date,
  due_date             date,                  -- final delivery to client
  go_live_date         date,                  -- planned publish date (content calendar)
  went_live_at         timestamptz,
  live_url             text,
  approved_at          timestamptz
);
create index deliverables_brand_idx    on public.deliverables (brand_id);
create index deliverables_campaign_idx on public.deliverables (campaign_id);
create index deliverables_creator_idx  on public.deliverables (creator_id);
create index deliverables_stage_idx    on public.deliverables (stage) where not is_archived;
create index deliverables_golive_idx   on public.deliverables (go_live_date);
create index deliverables_due_idx      on public.deliverables (due_date);

-- Script versions (AI drafts are linked to the AI request that wrote them — see 0005).
create table public.scripts (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.team_members(id),
  is_archived     boolean not null default false,
  archived_at     timestamptz,
  deliverable_id  uuid not null references public.deliverables(id),
  version         int not null default 1,
  title           text,
  hook            text,
  body            text not null default '',
  status          text not null default 'draft'
                  check (status in ('draft','in_review','approved','rejected')),
  ai_request_id   uuid,                      -- FK added in 0005
  unique (deliverable_id, version)
);

-- Every review round, internal or client, with feedback.
create table public.deliverable_reviews (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.team_members(id),
  is_archived        boolean not null default false,
  archived_at        timestamptz,
  deliverable_id     uuid not null references public.deliverables(id),
  round              int not null default 1,
  reviewer_type      text not null check (reviewer_type in ('internal','client')),
  reviewer_id        uuid references public.team_members(id),
  brand_contact_id   uuid references public.brand_contacts(id),
  status             text not null default 'pending'
                     check (status in ('pending','approved','changes_requested','rejected')),
  feedback           text,
  reviewed_at        timestamptz
);
create index deliverable_reviews_deliverable_idx on public.deliverable_reviews (deliverable_id);

-- Post performance over time.
create table public.deliverable_metrics (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.team_members(id),
  deliverable_id  uuid not null references public.deliverables(id),
  captured_on     date not null,
  views           bigint,
  reach           bigint,
  likes           bigint,
  comments        bigint,
  shares          bigint,
  saves           bigint,
  link_clicks     bigint,
  unique (deliverable_id, captured_on)
);

-- ─────────────────────────────────────────────────────────────
-- Shoots
-- ─────────────────────────────────────────────────────────────
create table public.shoots (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.team_members(id),
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  title        text not null,
  brand_id     uuid references public.brands(id),
  campaign_id  uuid references public.campaigns(id),
  shoot_date   date not null,
  call_time    time,
  wrap_time    time,
  location     text,
  status       text not null default 'planned'
               check (status in ('planned','confirmed','done','rescheduled','cancelled')),
  notes        text
);
create index shoots_date_idx on public.shoots (shoot_date);

create table public.shoot_deliverables (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.team_members(id),
  shoot_id        uuid not null references public.shoots(id),
  deliverable_id  uuid not null references public.deliverables(id),
  unique (shoot_id, deliverable_id)
);

-- Who is on set: a team member, a freelancer/vendor or a creator.
create table public.shoot_crew (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.team_members(id),
  shoot_id     uuid not null references public.shoots(id),
  team_member_id uuid references public.team_members(id),
  vendor_id    uuid references public.vendors(id),
  creator_id   uuid references public.creators(id),
  role         text,                         -- DOP, talent, stylist…
  check (num_nonnulls(team_member_id, vendor_id, creator_id) = 1)
);

-- ─────────────────────────────────────────────────────────────
-- Calendar events that are not deliverables or shoots
-- (meetings, festival dates, brand launches). The content calendar
-- = deliverables.go_live_date + shoots + these.
-- ─────────────────────────────────────────────────────────────
create table public.calendar_events (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.team_members(id),
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  title        text not null,
  kind         text not null default 'meeting'
               check (kind in ('meeting','festival','holiday','launch','deadline','other')),
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  all_day      boolean not null default false,
  brand_id     uuid references public.brands(id),
  campaign_id  uuid references public.campaigns(id),
  description  text,
  check (ends_at is null or ends_at >= starts_at)
);
create index calendar_events_time_idx on public.calendar_events (starts_at);
