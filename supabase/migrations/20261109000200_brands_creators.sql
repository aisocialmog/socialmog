-- Social Mog OS — 0002 brands, clients, creators, vendors

-- ─────────────────────────────────────────────────────────────
-- Brands & clients (feature 2)
-- ─────────────────────────────────────────────────────────────
create table public.brands (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id),
  is_archived        boolean not null default false,
  archived_at        timestamptz,
  import_batch_id    uuid references public.import_batches(id),
  name               text not null,
  legal_name         text,                    -- name on invoices
  industry           text,                    -- Beauty, D2C food, Fintech…
  website            text,
  instagram_handle   text,
  relationship       text not null default 'project'
                     check (relationship in ('project','retainer','both')),
  status             text not null default 'lead'
                     check (status in ('lead','pitching','active','paused','churned')),
  owner_id           uuid references public.profiles(id),  -- which founder owns the account
  source             text,                    -- referral, inbound, outreach…
  gstin              text,
  pan                text,
  billing_address    text,
  city               text,
  state              text,
  state_code         text,                    -- GST place of supply
  payment_terms_days int,                     -- overrides org default
  notes              text
);
create index brands_status_idx on public.brands (status) where not is_archived;
create index brands_name_idx   on public.brands (lower(name));

create table public.brand_contacts (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  brand_id     uuid not null references public.brands(id),
  name         text not null,
  designation  text,
  email        text,
  phone        text,
  is_primary   boolean not null default false,
  is_billing   boolean not null default false,   -- receives invoices
  notes        text
);
create index brand_contacts_brand_idx on public.brand_contacts (brand_id);

-- Retainer = full-marketing contract with a monthly fee.
create table public.retainers (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  is_archived   boolean not null default false,
  archived_at   timestamptz,
  brand_id      uuid not null references public.brands(id),
  title         text not null,               -- "Social media retainer 2026"
  monthly_fee   numeric(14,2) not null check (monthly_fee >= 0),
  start_date    date not null,
  end_date      date,
  billing_day   smallint check (billing_day between 1 and 28),
  status        text not null default 'active'
                check (status in ('draft','active','paused','ended')),
  scope         text,
  check (end_date is null or end_date >= start_date)
);
create index retainers_brand_idx on public.retainers (brand_id);

-- What the monthly fee buys: e.g. 12 reels + 20 stories on Instagram.
create table public.retainer_scope_items (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id),
  is_archived        boolean not null default false,
  archived_at        timestamptz,
  retainer_id        uuid not null references public.retainers(id),
  deliverable_type   text not null,
  platform           text,
  quantity_per_month int not null check (quantity_per_month > 0)
);

-- ─────────────────────────────────────────────────────────────
-- Tags (niches, industries, custom labels) shared by brands and creators
-- ─────────────────────────────────────────────────────────────
create table public.tags (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  name         text not null,
  kind         text not null default 'label' check (kind in ('niche','industry','label')),
  unique (kind, name)
);

create table public.brand_tags (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  brand_id    uuid not null references public.brands(id),
  tag_id      uuid not null references public.tags(id),
  unique (brand_id, tag_id)
);

-- ─────────────────────────────────────────────────────────────
-- Creators (feature 3)
-- ─────────────────────────────────────────────────────────────
create table public.creators (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  is_archived       boolean not null default false,
  archived_at       timestamptz,
  import_batch_id   uuid references public.import_batches(id),
  name              text not null,
  gender            text check (gender in ('female','male','non_binary','other','undisclosed')),
  city              text,
  state             text,
  languages         text[] not null default '{}',     -- Hindi, English, Tamil…
  email             text,
  phone             text,
  whatsapp          text,
  manager_name      text,                    -- talent manager / agency, if any
  manager_phone     text,
  manager_email     text,
  status            text not null default 'prospect'
                    check (status in ('prospect','active','inactive','do_not_work')),
  rating            smallint check (rating between 1 and 5),
  owner_id          uuid references public.profiles(id),
  shipping_address  text,                    -- for product seeding / barter
  notes             text
);
create index creators_status_idx on public.creators (status) where not is_archived;
create index creators_name_idx   on public.creators (lower(name));

create table public.creator_tags (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  creator_id  uuid not null references public.creators(id),
  tag_id      uuid not null references public.tags(id),
  unique (creator_id, tag_id)
);

-- One row per social account. Latest numbers live here; history in snapshots.
create table public.creator_platforms (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  is_archived      boolean not null default false,
  archived_at      timestamptz,
  creator_id       uuid not null references public.creators(id),
  platform         text not null
                   check (platform in ('instagram','youtube','x','linkedin','snapchat','moj','josh','sharechat','facebook','threads','other')),
  handle           text not null,
  url              text,
  is_primary       boolean not null default false,
  followers        bigint check (followers >= 0),
  avg_views        bigint check (avg_views >= 0),
  engagement_rate  numeric(6,3),             -- percent
  metrics_updated_on date,
  unique (platform, handle)
);
create index creator_platforms_creator_idx on public.creator_platforms (creator_id);

create table public.creator_metric_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  creator_platform_id uuid not null references public.creator_platforms(id),
  captured_on         date not null,
  followers           bigint,
  avg_views           bigint,
  engagement_rate     numeric(6,3),
  unique (creator_platform_id, captured_on)
);

-- What the creator charges, per deliverable type. Keep old rates (valid_to).
create table public.creator_rate_cards (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  is_archived       boolean not null default false,
  archived_at       timestamptz,
  creator_id        uuid not null references public.creators(id),
  platform          text not null,
  deliverable_type  text not null,           -- reel, story, post, youtube_video, short…
  rate              numeric(14,2) not null check (rate >= 0),
  valid_from        date not null default current_date,
  valid_to          date,
  notes             text
);
create index creator_rate_cards_creator_idx on public.creator_rate_cards (creator_id);

-- Bank / tax details: founders & admins only (separate RLS, see 0005).
create table public.creator_payment_details (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references public.profiles(id),
  is_archived          boolean not null default false,
  archived_at          timestamptz,
  creator_id           uuid not null unique references public.creators(id),
  legal_name           text,
  pan                  text,
  gstin                text,
  bank_account_name    text,
  bank_account_number  text,
  ifsc                 text,
  upi_id               text,
  tds_section          text,                 -- 194J / 194C / 194R…
  tds_rate             numeric(5,2)
);

-- ─────────────────────────────────────────────────────────────
-- Vendors & freelancers who are paid but may never log in
-- (editors, DOPs, studios, software subscriptions…)
-- ─────────────────────────────────────────────────────────────
create table public.vendors (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  is_archived    boolean not null default false,
  archived_at    timestamptz,
  name           text not null,
  kind           text not null default 'freelancer'
                 check (kind in ('freelancer','studio','agency','software','equipment','travel','other')),
  skill          text,                       -- editor, DOP, scriptwriter…
  profile_id     uuid references public.profiles(id),  -- if this freelancer also logs in
  email          text,
  phone          text,
  pan            text,
  gstin          text,
  upi_id         text,
  notes          text
);
