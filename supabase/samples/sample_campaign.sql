-- One SAMPLE campaign (Chai Sutra × three sample creators) so the tracker,
-- performance tab and report have something to show. Needs sample_brands.sql
-- and sample_creators.sql to have been run first. Safe to run again.
-- Remove with remove_sample_campaign.sql (run that BEFORE removing the sample
-- brands or creators). All ids start with 5a3b1e00-0000-4000-8000-0000000ca.
begin;
select set_config('app.activity_source', 'system', true);
do $$
begin
  if not exists (select 1 from public.brands where id = '5a3b1e00-0000-4000-8000-0000000000b1')
     or not exists (select 1 from public.creators where id = '5a3b1e00-0000-4000-8000-000000000c01') then
    raise exception 'Run sample_brands.sql and sample_creators.sql first.';
  end if;
end $$;

insert into public.campaigns (id, brand_id, name, code, kind, objective, platforms, start_date, end_date, status, owner_id,
  brief, key_messages, dos, donts, hashtags, links)
values ('5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-0000000000b1', 'Diwali Chai Reels (sample)', 'CHAI-DIWALI-SAMPLE',
  'influencer', 'sales', '{instagram}', public.ist_today() - 20, public.ist_today() + 10, 'live',
  (select id from public.team_members where role = 'founder' and not is_archived order by created_at limit 1),
  'Festive reels showing Chai Sutra masala chai as the centre of Diwali gatherings. Each creator hosts a small chai moment with family or friends.',
  E'Made with real spices, no premix\nPerfect for festive guests\n15% off with your code',
  E'Show the pack in the first 3 seconds\nPour shot in slow motion\nMention the code out loud and in the caption',
  E'No comparisons with other brands\nNo sugar-free claims\nAvoid alcohol in frame',
  '{#ChaiSutraDiwali,#ChaiMoments,#ad}', '{https://chaisutra.example/diwali}')
on conflict (id) do nothing;

insert into public.campaign_finances (campaign_id, contract_value, creator_budget, production_budget, po_number)
values ('5a3b1e00-0000-4000-8000-0000000ca001', 300000, 120000, 30000, 'PO-SAMPLE-4471')
on conflict (campaign_id) do nothing;

insert into public.campaign_creators (id, campaign_id, creator_id, status, notes) values
  ('5a3b1e00-0000-4000-8000-0000000ca101', '5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-000000000c01', 'posted', null),
  ('5a3b1e00-0000-4000-8000-0000000ca102', '5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-000000000c03', 'approved', null),
  ('5a3b1e00-0000-4000-8000-0000000ca103', '5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-000000000c04', 'dropped', 'Dates clashed with another brand.'),
  ('5a3b1e00-0000-4000-8000-0000000ca104', '5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-000000000c02', 'shortlisted', null)
on conflict (id) do nothing;
insert into public.campaign_creator_fees (campaign_creator_id, agreed_fee, client_price) values
  ('5a3b1e00-0000-4000-8000-0000000ca101', 30000, 60000), ('5a3b1e00-0000-4000-8000-0000000ca102', 56000, 110000),
  ('5a3b1e00-0000-4000-8000-0000000ca103', 150000, null)
on conflict (campaign_creator_id) do nothing;
insert into public.campaign_promo_codes (campaign_id, campaign_creator_id, code, offer) values
  ('5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-0000000ca101', 'AAROHI15', '15% off'),
  ('5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-0000000ca102', 'SANA15', '15% off')
on conflict (campaign_id, code) do nothing;

insert into public.deliverables (id, brand_id, campaign_id, campaign_creator_id, creator_id, title, deliverable_type, platform, stage,
  approval_status, draft_url, live_url, go_live_date)
values
  ('5a3b1e00-0000-4000-8000-0000000ca201', '5a3b1e00-0000-4000-8000-0000000000b1', '5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-0000000ca101', '5a3b1e00-0000-4000-8000-000000000c01',
   'Aarohi — Diwali chai reel', 'reel', 'instagram', 'live', 'approved', 'https://drive.example/aarohi-reel-1', 'https://instagram.com/p/sample-aarohi-1', public.ist_today() - 8),
  ('5a3b1e00-0000-4000-8000-0000000ca202', '5a3b1e00-0000-4000-8000-0000000000b1', '5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-0000000ca101', '5a3b1e00-0000-4000-8000-000000000c01',
   'Aarohi — guests arrive reel', 'reel', 'instagram', 'live', 'approved', 'https://drive.example/aarohi-reel-2', 'https://instagram.com/p/sample-aarohi-2', public.ist_today() - 3),
  ('5a3b1e00-0000-4000-8000-0000000ca203', '5a3b1e00-0000-4000-8000-0000000000b1', '5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-0000000ca101', '5a3b1e00-0000-4000-8000-000000000c01',
   'Aarohi — code story', 'story', 'instagram', 'live', 'approved', null, 'https://instagram.com/stories/sample-aarohi', public.ist_today() - 3),
  ('5a3b1e00-0000-4000-8000-0000000ca204', '5a3b1e00-0000-4000-8000-0000000000b1', '5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-0000000ca102', '5a3b1e00-0000-4000-8000-000000000c03',
   'Sana — festive look reel', 'reel', 'instagram', 'approved', 'approved', 'https://drive.example/sana-reel', null, public.ist_today() - 2),
  ('5a3b1e00-0000-4000-8000-0000000ca205', '5a3b1e00-0000-4000-8000-0000000000b1', '5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-0000000ca102', '5a3b1e00-0000-4000-8000-000000000c03',
   'Sana — carousel post', 'post', 'instagram', 'client_review', 'pending', 'https://drive.example/sana-carousel', null, public.ist_today() + 5)
on conflict (id) do nothing;

insert into public.deliverable_metrics (deliverable_id, captured_on, views, reach, likes, comments, shares, saves, link_clicks, conversions) values
  ('5a3b1e00-0000-4000-8000-0000000ca201', public.ist_today() - 1, 184000, 152000, 9800, 412, 1350, 2240, 960, 210),
  ('5a3b1e00-0000-4000-8000-0000000ca202', public.ist_today() - 1, 96500, 81000, 5100, 230, 640, 1180, 420, 95),
  ('5a3b1e00-0000-4000-8000-0000000ca203', public.ist_today() - 1, 21000, 21000, 0, 0, 120, 0, 610, 140)
on conflict (deliverable_id, captured_on) do nothing;

-- one production expense linked to the campaign (props for the shoot)
insert into public.expenses (id, category_id, campaign_id, brand_id, description, expense_date, amount, gst_amount, status)
select '5a3b1e00-0000-4000-8000-0000000ca301', id, '5a3b1e00-0000-4000-8000-0000000ca001', '5a3b1e00-0000-4000-8000-0000000000b1',
       'Diya, brass kettle and rangoli props (sample)', public.ist_today() - 15, 8000, 1440, 'unpaid'
from public.expense_categories where name = 'Props'
on conflict (id) do nothing;
commit;
