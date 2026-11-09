-- Two SAMPLE brands for trying out the Brands module.
-- Run once in Supabase → SQL Editor (paste and Run). Safe to run again: it skips
-- what already exists. Remove them with remove_sample_brands.sql.
-- Every sample row uses a fixed id starting with 5a3b1e00- so it can be found
-- and removed exactly, without touching your real data.
begin;
select set_config('app.activity_source', 'system', true);

insert into public.brands (id, name, billing_name, industry, website, instagram_handle, youtube_handle,
                           engagement_type, status, source, owner_id, city, state, state_code, gstin,
                           billing_address, payment_terms_days, notes)
values
  ('5a3b1e00-0000-4000-8000-0000000000b1', 'Chai Sutra (sample)', 'Chai Sutra Beverages Pvt. Ltd.', 'Beverages',
   'https://chaisutra.example', 'chaisutra.example', 'ChaiSutraTV',
   'mixed', 'active', 'Referral',
   (select id from public.team_members where role = 'founder' and not is_archived order by created_at limit 1),
   'Mumbai', 'Maharashtra', '27', '27AAACC1234D1ZC',
   '4th floor, Kamala Mills, Lower Parel, Mumbai 400013', 30,
   'Monthly reels + festive campaigns. Approvals go through the brand manager; finance needs POs before invoicing.'),
  ('5a3b1e00-0000-4000-8000-0000000000b2', 'Neelam Naturals (sample)', null, 'Beauty & skincare',
   'https://neelamnaturals.example', 'neelam.naturals.example', null,
   'campaign_management', 'pitching', 'Instagram',
   (select id from public.team_members where role = 'founder' and not is_archived order by created_at offset 1 limit 1),
   'Jaipur', 'Rajasthan', '08', null, null, null,
   'Inbound DM after our skincare reel. Wants 5 micro creators for a winter launch. Send proposal by Friday.')
on conflict (id) do nothing;

insert into public.brand_contacts (id, brand_id, name, designation, phone, whatsapp, email, is_primary, is_billing)
values
  ('5a3b1e00-0000-4000-8000-0000000000c1', '5a3b1e00-0000-4000-8000-0000000000b1', 'Priya Nair', 'Brand manager',
   '+91 98200 11111', '+91 98200 11111', 'priya@chaisutra.example', true, false),
  ('5a3b1e00-0000-4000-8000-0000000000c2', '5a3b1e00-0000-4000-8000-0000000000b1', 'Rohan Shah', 'Finance',
   '+91 98200 22222', null, 'accounts@chaisutra.example', false, true),
  ('5a3b1e00-0000-4000-8000-0000000000c3', '5a3b1e00-0000-4000-8000-0000000000b2', 'Ananya Rathore', 'Founder',
   '+91 99280 33333', '+91 99280 33333', 'ananya@neelamnaturals.example', true, true)
on conflict (id) do nothing;

-- Retainer renews 10 days from today, so you can see the 15-day warning.
insert into public.retainers (id, brand_id, title, monthly_fee, start_date, billing_day, renewal_date, status, scope)
values ('5a3b1e00-0000-4000-8000-0000000000a1', '5a3b1e00-0000-4000-8000-0000000000b1', 'Always-on social', 85000,
        public.fy_start(public.ist_today()), 5, public.ist_today() + 10, 'active',
        '8 reels + 12 stories a month on Instagram, 2 YouTube Shorts, monthly content calendar and community replies.')
on conflict (id) do nothing;
commit;
