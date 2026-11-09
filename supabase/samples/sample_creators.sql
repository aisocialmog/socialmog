-- Five SAMPLE creators for trying out the Creators module (tiers nano → mega,
-- one blacklisted, two in Ranchi so the "Ranchi food micro creators" view works).
-- Run in Supabase → SQL Editor. Safe to run again. Remove with remove_sample_creators.sql.
-- Every sample row has a fixed id starting with 5a3b1e00-0000-4000-8000-000000000c.
begin;
select set_config('app.activity_source', 'system', true);

insert into public.creators (id, name, gender, city, state, languages, phone, whatsapp, email,
  manager_name, manager_agency, manager_phone, manager_email, status, rating, would_work_again, is_blacklisted, blacklist_reason, notes)
values
  ('5a3b1e00-0000-4000-8000-000000000c01', 'Aarohi Sinha (sample)', 'female', 'Ranchi', 'Jharkhand', '{Hindi,English}',
   '+91 98350 10001', '+91 98350 10001', 'aarohi@creator.example', null, null, null, null,
   'active', 5, true, false, null, 'Street-food reels, very quick turnaround. Shoots in Hindi; great with festive food.'),
  ('5a3b1e00-0000-4000-8000-000000000c02', 'Kabir Menon (sample)', 'male', 'Bengaluru', 'Karnataka', '{English,Malayalam}',
   '+91 99000 10002', null, 'kabir@creator.example', 'Ira Das', 'Pixel Talent (sample agency)', '+91 99000 20002', 'ira@pixeltalent.example',
   'active', 4, true, false, null, 'Long-form tech reviews. Book 3 weeks ahead; agency handles contracts.'),
  ('5a3b1e00-0000-4000-8000-000000000c03', 'Sana Qureshi (sample)', 'female', 'Mumbai', 'Maharashtra', '{Hindi,English}',
   '+91 98200 10003', '+91 98200 10003', 'sana@creator.example', null, null, null, null,
   'active', 4, true, false, null, 'Fashion + skincare. Strong saves on carousels.'),
  ('5a3b1e00-0000-4000-8000-000000000c04', 'Rohit Verma "Desi Dad" (sample)', 'male', 'Delhi', 'Delhi', '{Hindi}',
   '+91 98100 10004', null, 'rohit@creator.example', 'Neha Arora', null, '+91 98100 20004', null,
   'active', 3, false, false, null, 'Huge reach, but delivered 6 days late on the last two campaigns.'),
  ('5a3b1e00-0000-4000-8000-000000000c05', 'Meenal Jha (sample)', 'female', 'Ranchi', 'Jharkhand', '{Hindi}',
   '+91 98350 10005', '+91 98350 10005', null, null, null, null, null,
   'inactive', 1, false, true, 'Posted brand content before approval (Mar 2026).', null)
on conflict (id) do nothing;

insert into public.creator_platforms (id, creator_id, platform, handle, url, followers, avg_views, engagement_rate, is_primary) values
  ('5a3b1e00-0000-4000-8000-000000000c11', '5a3b1e00-0000-4000-8000-000000000c01', 'instagram', 'aarohi.eats.sample', 'https://instagram.com/aarohi.eats.sample', 48200, 31000, 6.2, true),
  ('5a3b1e00-0000-4000-8000-000000000c12', '5a3b1e00-0000-4000-8000-000000000c01', 'youtube', 'AarohiEatsSample', null, 8900, 4200, 3.1, false),
  ('5a3b1e00-0000-4000-8000-000000000c21', '5a3b1e00-0000-4000-8000-000000000c02', 'youtube', 'KabirTechSample', null, 640000, 210000, 4.4, true),
  ('5a3b1e00-0000-4000-8000-000000000c22', '5a3b1e00-0000-4000-8000-000000000c02', 'instagram', 'kabir.tech.sample', null, 210000, 95000, 3.8, false),
  ('5a3b1e00-0000-4000-8000-000000000c23', '5a3b1e00-0000-4000-8000-000000000c02', 'x', 'kabirtech_sample', null, 38000, null, null, false),
  ('5a3b1e00-0000-4000-8000-000000000c31', '5a3b1e00-0000-4000-8000-000000000c03', 'instagram', 'sana.styles.sample', null, 156000, 64000, 5.1, true),
  ('5a3b1e00-0000-4000-8000-000000000c41', '5a3b1e00-0000-4000-8000-000000000c04', 'instagram', 'desidad.sample', null, 1240000, 820000, 7.9, true),
  ('5a3b1e00-0000-4000-8000-000000000c42', '5a3b1e00-0000-4000-8000-000000000c04', 'moj', 'desidad_sample', null, 210000, 90000, null, false),
  ('5a3b1e00-0000-4000-8000-000000000c51', '5a3b1e00-0000-4000-8000-000000000c05', 'instagram', 'meenal.khana.sample', null, 7400, 3900, 8.4, true),
  ('5a3b1e00-0000-4000-8000-000000000c52', '5a3b1e00-0000-4000-8000-000000000c05', 'josh', 'meenal_jha_sample', null, 5100, 2600, null, false)
on conflict (id) do nothing;

insert into public.creator_tags (creator_id, tag_id)
select x.creator_id::uuid, t.id from (values
  ('5a3b1e00-0000-4000-8000-000000000c01', 'Food'), ('5a3b1e00-0000-4000-8000-000000000c01', 'Regional'),
  ('5a3b1e00-0000-4000-8000-000000000c02', 'Tech'), ('5a3b1e00-0000-4000-8000-000000000c02', 'Education'),
  ('5a3b1e00-0000-4000-8000-000000000c03', 'Fashion'), ('5a3b1e00-0000-4000-8000-000000000c03', 'Beauty'),
  ('5a3b1e00-0000-4000-8000-000000000c04', 'Parenting'), ('5a3b1e00-0000-4000-8000-000000000c04', 'Comedy'),
  ('5a3b1e00-0000-4000-8000-000000000c05', 'Food'), ('5a3b1e00-0000-4000-8000-000000000c05', 'Lifestyle')
) as x(creator_id, tag) join public.tags t on t.kind = 'niche' and t.name = x.tag and not t.is_archived
on conflict do nothing;

insert into public.creator_rate_cards (creator_id, deliverable_type, rate)
select x.creator_id::uuid, x.kind, x.rate from (values
  ('5a3b1e00-0000-4000-8000-000000000c01', 'reel', 9000), ('5a3b1e00-0000-4000-8000-000000000c01', 'story', 2500), ('5a3b1e00-0000-4000-8000-000000000c01', 'post', 4000),
  ('5a3b1e00-0000-4000-8000-000000000c02', 'youtube_video', 120000), ('5a3b1e00-0000-4000-8000-000000000c02', 'short', 35000), ('5a3b1e00-0000-4000-8000-000000000c02', 'reel', 45000),
  ('5a3b1e00-0000-4000-8000-000000000c03', 'reel', 28000), ('5a3b1e00-0000-4000-8000-000000000c03', 'story', 8000), ('5a3b1e00-0000-4000-8000-000000000c03', 'post', 15000), ('5a3b1e00-0000-4000-8000-000000000c03', 'ugc_video', 18000),
  ('5a3b1e00-0000-4000-8000-000000000c04', 'reel', 150000), ('5a3b1e00-0000-4000-8000-000000000c04', 'live', 60000),
  ('5a3b1e00-0000-4000-8000-000000000c05', 'reel', 3000)
) as x(creator_id, kind, rate)
where not exists (select 1 from public.creator_rate_cards r where r.creator_id = x.creator_id::uuid and r.deliverable_type = x.kind and r.valid_to is null and not r.is_archived);

-- Founders-only payment details for one sample (fake numbers)
insert into public.creator_payment_details (creator_id, legal_name, pan, upi_id, bank_name, bank_account_name, bank_account_number, ifsc, tds_section, tds_rate)
values ('5a3b1e00-0000-4000-8000-000000000c01', 'Aarohi Sinha', 'ABCPS1234K', 'aarohi.sample@okaxis', 'HDFC Bank', 'Aarohi Sinha', '50100012345678', 'HDFC0001234', '194J', 10)
on conflict (creator_id) do nothing;
commit;
