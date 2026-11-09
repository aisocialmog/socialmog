-- Social Mog OS — feature 4: Campaigns
-- Campaign record, brief, budget, creators in a campaign, deliverables tracker,
-- per-post performance, calculated money/performance views, campaign activity.

-- ─────────────────────────────────────────────────────────────
-- campaigns: type, objective, status set from the brief + brief fields
-- ─────────────────────────────────────────────────────────────
alter table public.campaigns drop constraint campaigns_kind_check;
update public.campaigns set kind = case kind when 'retainer_month' then 'full_marketing_month' when 'other' then 'influencer' else kind end;
alter table public.campaigns add constraint campaigns_kind_check
  check (kind in ('influencer','production','full_marketing_month','ugc'));

update public.campaigns set objective = null where objective not in ('awareness','sales','app_installs','footfall');
alter table public.campaigns add constraint campaigns_objective_check
  check (objective is null or objective in ('awareness','sales','app_installs','footfall'));

alter table public.campaigns drop constraint campaigns_status_check;
update public.campaigns set status = case status
  when 'draft' then 'planning' when 'pitched' then 'planning' when 'on_hold' then 'planning'
  when 'confirmed' then 'creator_outreach' when 'in_production' then 'production' else status end;
alter table public.campaigns alter column status set default 'planning';
alter table public.campaigns add constraint campaigns_status_check check (status in
  ('planning','creator_outreach','production','content_review','live','reporting','completed','cancelled'));

alter table public.campaigns
  add column key_messages text,
  add column dos          text,
  add column donts        text,
  add column hashtags     text[] not null default '{}',
  add column links        text[] not null default '{}';

-- completed_at follows the status
create or replace function public.campaign_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then new.completed_at := now();
  elsif new.status <> 'completed' then new.completed_at := null; end if;
  return new;
end $$;
create trigger campaigns_completed_at before insert or update of status on public.campaigns
  for each row execute function public.campaign_completed_at();

-- Planned production spend (client budget = contract_value, planned creator spend = creator_budget)
alter table public.campaign_finances add column production_budget numeric(14,2) check (production_budget >= 0);

-- Promo codes: campaign-wide or per creator
create table public.campaign_promo_codes (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references public.team_members(id),
  is_archived          boolean not null default false,
  archived_at          timestamptz,
  campaign_id          uuid not null references public.campaigns(id),
  campaign_creator_id  uuid references public.campaign_creators(id),
  code                 text not null,
  offer                text,                     -- "15% off first order"
  unique (campaign_id, code)
);
select public.enable_standard_table('public.campaign_promo_codes');
create policy role_select on public.campaign_promo_codes for select to authenticated using (public.can_access_campaign(campaign_id));
create policy staff_insert on public.campaign_promo_codes for insert to authenticated with check (public.is_staff());
create policy staff_update on public.campaign_promo_codes for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- ─────────────────────────────────────────────────────────────
-- Creators in a campaign: the status set from the brief
-- ─────────────────────────────────────────────────────────────
alter table public.campaign_creators drop constraint campaign_creators_status_check;
update public.campaign_creators set status = case status
  when 'proposed' then 'contacted' when 'client_approved' then 'negotiating' when 'contracted' then 'confirmed'
  when 'live' then 'posted' when 'completed' then 'paid' else status end;
alter table public.campaign_creators add constraint campaign_creators_status_check check (status in
  ('shortlisted','contacted','negotiating','confirmed','content_submitted','approved','posted','paid','dropped'));

-- Statuses that count as "confirmed" for actual creator spend.
create or replace function public.creator_status_confirmed(s text)
returns boolean language sql immutable as $$
  select s in ('confirmed','content_submitted','approved','posted','paid')
$$;

-- ─────────────────────────────────────────────────────────────
-- Deliverables: draft link + brand approval; posted = stage 'live'
-- ─────────────────────────────────────────────────────────────
alter table public.deliverables
  add column draft_url        text,
  add column approval_status  text not null default 'not_submitted'
    check (approval_status in ('not_submitted','pending','approved','changes_requested','rejected'));

-- Keep stage, approved_at and went_live_at in step with what the tracker sets.
create or replace function public.deliverable_tracker_sync()
returns trigger language plpgsql as $$
begin
  if new.approval_status = 'approved' and (tg_op = 'INSERT' or old.approval_status is distinct from 'approved') then
    new.approved_at := coalesce(new.approved_at, now());
    if new.stage not in ('approved','scheduled','live','cancelled') then new.stage := 'approved'; end if;
  elsif new.approval_status = 'pending' and new.stage in ('brief','scripting','script_review','shoot','editing','internal_review') then
    new.stage := 'client_review';
  elsif new.approval_status = 'changes_requested' and new.stage not in ('live','cancelled') then
    new.stage := 'changes';
  end if;
  if new.stage = 'live' and new.went_live_at is null then new.went_live_at := now(); end if;
  if new.stage <> 'live' then new.went_live_at := null; end if;
  return new;
end $$;
create trigger deliverables_tracker_sync before insert or update on public.deliverables
  for each row execute function public.deliverable_tracker_sync();

-- Posting needs the live link.
alter table public.deliverables add constraint deliverables_live_needs_url
  check (stage <> 'live' or nullif(trim(live_url), '') is not null) not valid;

-- Sales / promo-code uses per post
alter table public.deliverable_metrics add column conversions bigint check (conversions >= 0);
alter table public.deliverable_metrics add constraint deliverable_metrics_non_negative check (
  coalesce(views,0) >= 0 and coalesce(reach,0) >= 0 and coalesce(likes,0) >= 0 and coalesce(comments,0) >= 0
  and coalesce(shares,0) >= 0 and coalesce(saves,0) >= 0 and coalesce(link_clicks,0) >= 0);

-- ─────────────────────────────────────────────────────────────
-- deliverable_performance — one row per deliverable: latest numbers,
-- engagement rate, cost and cost per view, overdue flag.
--   engagement rate = (likes + comments + shares + saves) / views   (reach if no views)
--   cost            = deliverable_fees.creator_fee if set, else the creator's
--                     agreed fee split evenly over their deliverables in the campaign
--   cost per view   = cost / views
--   overdue         = go-live date passed and not posted
-- ─────────────────────────────────────────────────────────────
create or replace view public.deliverable_performance with (security_invoker = true) as
select
  d.id as deliverable_id, d.campaign_id, d.campaign_creator_id, d.creator_id, d.brand_id,
  d.title, d.deliverable_type, d.platform, d.stage, d.approval_status, d.draft_url, d.live_url,
  d.go_live_date, d.due_date, d.went_live_at, d.assignee_id,
  cr.name as creator_name, cr.photo_path as creator_photo_path,
  (d.stage = 'live') as is_posted,
  (d.go_live_date < public.ist_today() and d.stage not in ('live','cancelled')) as is_overdue,
  greatest(public.ist_today() - d.go_live_date, 0) as days_overdue,
  m.captured_on as metrics_on, m.views, m.reach, m.likes, m.comments, m.shares, m.saves, m.link_clicks, m.conversions,
  coalesce(m.likes,0) + coalesce(m.comments,0) + coalesce(m.shares,0) + coalesce(m.saves,0) as engagements,
  case when coalesce(m.views, m.reach, 0) > 0 then round(
    (coalesce(m.likes,0) + coalesce(m.comments,0) + coalesce(m.shares,0) + coalesce(m.saves,0))::numeric
    / coalesce(nullif(m.views,0), m.reach) * 100, 2) end as engagement_rate,
  cost.cost,
  case when coalesce(m.views,0) > 0 and cost.cost is not null then round(cost.cost / m.views, 4) end as cost_per_view
from public.deliverables d
left join public.creators cr on cr.id = d.creator_id
left join lateral (
  select * from public.deliverable_metrics dm where dm.deliverable_id = d.id order by dm.captured_on desc limit 1
) m on true
left join lateral (
  select coalesce(
    (select df.creator_fee from public.deliverable_fees df where df.deliverable_id = d.id),
    (select f.agreed_fee / nullif((select count(*) from public.deliverables x
                                    where x.campaign_creator_id = d.campaign_creator_id and not x.is_archived and x.stage <> 'cancelled'), 0)
       from public.campaign_creator_fees f where f.campaign_creator_id = d.campaign_creator_id)) as cost
) cost on true
where not d.is_archived;

-- ─────────────────────────────────────────────────────────────
-- campaign_summary — the numbers on the list, detail, money tab and report.
--   expected margin       = client budget − planned creator spend − planned production spend
--   actual creator spend  = Σ agreed fee of creators in a confirmed-or-later status
--   client billing        = invoiced (before GST) on issued invoices for this campaign
--   profit                = client billing − creator payouts − production expenses
-- Runs as the caller: money columns are null for anyone who can't see money.
-- ─────────────────────────────────────────────────────────────
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
left join lateral (select sum(e.amount) as expenses from public.expenses e where e.campaign_id = c.id and not e.is_archived) ex on true
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

-- Brand pages count "active campaigns" with the new statuses.
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
) r on true;

create or replace view public.brand_financials with (security_invoker = true) as
select b.id as brand_id, b.name,
  coalesce(sum(t.subtotal) filter (where t.document_status = 'sent'), 0)    as billed,
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

-- ─────────────────────────────────────────────────────────────
-- Changing a creator's planned deliverables ("2 Reels + 3 Stories")
-- adds rows or cancels the extra ones (never deletes).
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_creator_deliverables(p_campaign_creator uuid, p_type text, p_quantity int)
returns int language plpgsql security invoker set search_path = public as $$
declare cc record; v_have int; v_platform text; i int;
begin
  if p_quantity < 0 or p_quantity > 50 then raise exception 'Quantity must be between 0 and 50'; end if;
  select x.*, c.brand_id, c.platforms, cr.name as creator_name into cc
    from campaign_creators x join campaigns c on c.id = x.campaign_id join creators cr on cr.id = x.creator_id
   where x.id = p_campaign_creator;
  if not found then raise exception 'Creator is not on this campaign'; end if;
  select count(*) into v_have from deliverables
   where campaign_creator_id = p_campaign_creator and deliverable_type = p_type and not is_archived and stage <> 'cancelled';
  v_platform := case when p_type in ('youtube_video','short') then 'youtube' when p_type = 'ugc_video' then null
                     else coalesce(cc.platforms[1], 'instagram') end;
  for i in 1 .. greatest(p_quantity - v_have, 0) loop
    insert into deliverables (brand_id, campaign_id, campaign_creator_id, creator_id, title, deliverable_type, platform, stage)
    values (cc.brand_id, cc.campaign_id, p_campaign_creator, cc.creator_id,
            cc.creator_name || ' — ' || initcap(replace(p_type, '_', ' ')) || ' ' || (v_have + i), p_type, v_platform, 'brief');
  end loop;
  -- too many: cancel the newest ones that haven't been posted
  update deliverables set stage = 'cancelled'
   where id in (select id from deliverables
                 where campaign_creator_id = p_campaign_creator and deliverable_type = p_type and not is_archived
                   and stage not in ('cancelled','live')
                 order by created_at desc limit greatest(v_have - p_quantity, 0));
  return p_quantity;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Activity for a campaign and everything hanging off it.
-- ─────────────────────────────────────────────────────────────
create index activity_log_campaign_ref_idx on public.activity_log
  ((coalesce(new_values->>'campaign_id', old_values->>'campaign_id')));

create or replace function public.campaign_activity(p_campaign uuid, p_limit int default 300)
returns table (id uuid, created_at timestamptz, action text, table_name text, record_id uuid,
               changed_fields text[], old_values jsonb, new_values jsonb, source text,
               actor_id uuid, actor_name text)
language sql stable security invoker set search_path = public as $$
  with children as (
    select 'campaign_creators'::text t, id from campaign_creators where campaign_id = p_campaign
    union all select 'campaign_creator_fees', f.id from campaign_creator_fees f join campaign_creators x on x.id = f.campaign_creator_id where x.campaign_id = p_campaign
    union all select 'campaign_finances', id from campaign_finances where campaign_id = p_campaign
    union all select 'campaign_promo_codes', id from campaign_promo_codes where campaign_id = p_campaign
    union all select 'deliverables', id from deliverables where campaign_id = p_campaign
    union all select 'deliverable_metrics', m.id from deliverable_metrics m join deliverables d on d.id = m.deliverable_id where d.campaign_id = p_campaign
    union all select 'files', id from files where campaign_id = p_campaign
    union all select 'shortlists', id from shortlists where campaign_id = p_campaign
  )
  select a.id, a.created_at, a.action, a.table_name, a.record_id, a.changed_fields, a.old_values, a.new_values,
         a.source, a.created_by, coalesce(tm.name, case when a.created_by is null then 'System' else 'Former member' end)
  from activity_log a
  left join team_members tm on tm.id = a.created_by
  where (a.table_name = 'campaigns' and a.record_id = p_campaign)
     or (a.table_name, a.record_id) in (select t, id from children)
  order by a.created_at desc, a.id desc
  limit greatest(1, least(p_limit, 1000))
$$;

-- Shortlist → campaign: add every creator on a shortlist as "Shortlisted".
create or replace function public.add_shortlist_to_campaign(p_shortlist uuid, p_campaign uuid)
returns int language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  update shortlists set campaign_id = p_campaign,
         brand_id = coalesce(brand_id, (select brand_id from campaigns where id = p_campaign))
   where id = p_shortlist;
  insert into campaign_creators (campaign_id, creator_id, status)
  select p_campaign, s.creator_id, 'shortlisted' from shortlist_creators s
   where s.shortlist_id = p_shortlist and not s.is_archived and s.status <> 'rejected'
  on conflict (campaign_id, creator_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Storage: campaign files live under records/campaigns/<id>/ (founders & managers, like other non-"work" paths).
