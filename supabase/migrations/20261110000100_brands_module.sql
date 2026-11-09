-- Social Mog OS — feature 2: Brands & clients
-- New migration (earlier ones may already be applied to Supabase).

-- ─────────────────────────────────────────────────────────────
-- brands: the fields from the brief
-- ─────────────────────────────────────────────────────────────
alter table public.brands rename column legal_name to billing_name;   -- name on invoices
alter table public.brands
  add column logo_path       text,                -- records bucket: brands/<id>/logo-…
  add column youtube_handle  text,
  add column engagement_type text not null default 'campaign_management'
    check (engagement_type in ('production','campaign_management','full_marketing','mixed'));

update public.brands set engagement_type = case relationship
  when 'retainer' then 'full_marketing' when 'both' then 'mixed' else 'campaign_management' end;
alter table public.brands drop column relationship;

alter table public.brands drop constraint brands_status_check;
update public.brands set status = 'ended' where status = 'churned';
alter table public.brands add constraint brands_status_check
  check (status in ('lead','pitching','active','paused','ended'));

-- GSTIN is optional, but when present it must look like one (15 characters,
-- first two digits = state code). The app fills state_code from it.
alter table public.brands add constraint brands_gstin_format
  check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');

create index brands_owner_idx on public.brands (owner_id);

-- ─────────────────────────────────────────────────────────────
-- contacts: WhatsApp, and at most one primary contact per brand
-- ─────────────────────────────────────────────────────────────
alter table public.brand_contacts add column whatsapp text;
create unique index brand_contacts_one_primary on public.brand_contacts (brand_id)
  where is_primary and not is_archived;

-- Make a contact the primary one (and un-primary the others) in one step.
create or replace function public.set_primary_contact(p_contact uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_brand uuid;
begin
  select brand_id into v_brand from brand_contacts where id = p_contact and not is_archived;
  if v_brand is null then raise exception 'Contact not found'; end if;
  update brand_contacts set is_primary = false where brand_id = v_brand and is_primary and id <> p_contact;
  update brand_contacts set is_primary = true where id = p_contact;
end $$;

-- ─────────────────────────────────────────────────────────────
-- retainers: renewal date; one live retainer per brand at a time
-- ─────────────────────────────────────────────────────────────
alter table public.retainers add column renewal_date date;
alter table public.retainers add constraint retainers_renewal_after_start
  check (renewal_date is null or renewal_date >= start_date);
create unique index retainers_one_live_per_brand on public.retainers (brand_id)
  where status in ('draft','active','paused') and not is_archived;

-- ─────────────────────────────────────────────────────────────
-- files: brand guidelines and logos are kinds of file too
-- ─────────────────────────────────────────────────────────────
alter table public.files drop constraint files_kind_check;
alter table public.files add constraint files_kind_check check (kind in (
  'contract','brief','brand_guidelines','logo','script','raw_footage','edit','invoice_pdf',
  'bill','creator_invoice','screenshot','media_kit','other'));
create index files_brand_idx on public.files (brand_id) where not is_archived;

-- ─────────────────────────────────────────────────────────────
-- brand_overview — one row per brand with everything the list,
-- cards and pipeline show. All numbers are calculated:
--   lifetime_revenue = invoiced (before GST) on issued invoices
--   outstanding      = issued invoices not yet paid
--   active_campaigns = campaigns confirmed / in production / live
-- Money comes from invoice_totals, so it reads ₹0 until feature 6.
-- Runs as the caller: retainer & money columns are empty for non-staff.
-- ─────────────────────────────────────────────────────────────
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
  coalesce(r.status = 'active' and r.renewal_date - public.ist_today() <= 15, false) as renewal_warning
from public.brands b
left join public.team_members owner on owner.id = b.owner_id
left join lateral (
  select sum(t.subtotal) filter (where t.document_status = 'sent')    as billed,
         sum(t.paid)                                                    as received,
         sum(t.outstanding) filter (where t.document_status = 'sent') as outstanding,
         sum(t.outstanding) filter (where t.payment_status like '%overdue') as overdue
  from public.invoice_totals t where t.brand_id = b.id
) money on true
left join lateral (
  select count(*) filter (where c.status in ('confirmed','in_production','live')) as active,
         count(*) as total
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
) r on true;

-- Owners shown by name even to people who can't read team_members rows:
-- the join above runs as the caller, so for non-staff owner_name is filled
-- only for themselves. The page is founders/managers only today.

-- ─────────────────────────────────────────────────────────────
-- Activity for a brand and everything hanging off it
-- (contacts, retainer, scope, files, tags, campaigns).
-- Runs as the caller, so activity_log's own RLS still applies.
-- ─────────────────────────────────────────────────────────────
create index activity_log_brand_ref_idx on public.activity_log
  ((coalesce(new_values->>'brand_id', old_values->>'brand_id')));

create or replace function public.brand_activity(p_brand uuid, p_limit int default 200)
returns table (id uuid, created_at timestamptz, action text, table_name text, record_id uuid,
               changed_fields text[], old_values jsonb, new_values jsonb, source text,
               actor_id uuid, actor_name text)
language sql stable security invoker set search_path = public as $$
  with children as (
    select 'brand_contacts'::text t, id from brand_contacts where brand_id = p_brand
    union all select 'retainers', id from retainers where brand_id = p_brand
    union all select 'retainer_scope_items', s.id from retainer_scope_items s join retainers r on r.id = s.retainer_id where r.brand_id = p_brand
    union all select 'files', id from files where brand_id = p_brand
    union all select 'campaigns', id from campaigns where brand_id = p_brand
  )
  select a.id, a.created_at, a.action, a.table_name, a.record_id, a.changed_fields, a.old_values, a.new_values,
         a.source, a.created_by, coalesce(tm.name, case when a.created_by is null then 'System' else 'Former member' end)
  from activity_log a
  left join team_members tm on tm.id = a.created_by
  where (a.table_name = 'brands' and a.record_id = p_brand)
     or (a.table_name, a.record_id) in (select t, id from children)
     or (a.table_name <> 'brands' and coalesce(a.new_values->>'brand_id', a.old_values->>'brand_id') = p_brand::text)
  order by a.created_at desc, a.id desc
  limit greatest(1, least(p_limit, 1000))
$$;
