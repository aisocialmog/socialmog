-- Removes the sample campaign and everything attached to it (creators on it,
-- fees, promo codes, deliverables, performance numbers, the sample expense,
-- history). Run BEFORE remove_sample_brands.sql / remove_sample_creators.sql.
begin;
create temp table sc_ids on commit drop as
  select '5a3b1e00-0000-4000-8000-0000000ca001'::uuid as id
  union select id from public.campaign_creators where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select f.id from public.campaign_creator_fees f join public.campaign_creators x on x.id = f.campaign_creator_id where x.campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select id from public.campaign_finances where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select id from public.campaign_promo_codes where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select id from public.deliverables where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select m.id from public.deliverable_metrics m join public.deliverables d on d.id = m.deliverable_id where d.campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select id from public.expenses where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select id from public.files where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
do $$
begin
  if exists (select 1 from public.invoices where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001')
     or exists (select 1 from public.creator_payouts where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001') then
    raise exception 'The sample campaign now has invoices or payouts. Archive it in the app instead.';
  end if;
end $$;
update public.shortlists set campaign_id = null where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
delete from public.deliverable_metrics where deliverable_id in (select id from public.deliverables where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001');
delete from public.deliverable_reviews where deliverable_id in (select id from public.deliverables where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001');
delete from public.deliverable_fees where deliverable_id in (select id from public.deliverables where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001');
delete from public.files where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
delete from public.expenses where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
delete from public.deliverables where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
delete from public.campaign_promo_codes where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
delete from public.campaign_creator_fees where campaign_creator_id in (select id from public.campaign_creators where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001');
delete from public.campaign_creators where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
delete from public.campaign_members where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
delete from public.campaign_finances where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
delete from public.campaigns where id = '5a3b1e00-0000-4000-8000-0000000ca001';
delete from public.activity_log where record_id in (select id from sc_ids)
   or coalesce(new_values->>'campaign_id', old_values->>'campaign_id') = '5a3b1e00-0000-4000-8000-0000000ca001';
commit;
