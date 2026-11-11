-- Removes the sample campaign and everything attached to it (creators on it,
-- fees, promo codes, deliverables, performance numbers, the sample expense,
-- history). Run BEFORE remove_sample_brands.sql / remove_sample_creators.sql.
begin;
-- sample removal is the one place money rows are hard-deleted
select set_config('app.allow_money_delete', 'on', true);
create temp table sc_ids on commit drop as
  select '5a3b1e00-0000-4000-8000-0000000ca001'::uuid as id
  union select id from public.campaign_creators where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select f.id from public.campaign_creator_fees f join public.campaign_creators x on x.id = f.campaign_creator_id where x.campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select id from public.campaign_finances where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select id from public.campaign_promo_codes where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select id from public.deliverables where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select m.id from public.deliverable_metrics m join public.deliverables d on d.id = m.deliverable_id where d.campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select id from public.expenses where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select id from public.files where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select id from public.shoots where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select p.id from public.production_people p join public.deliverables d on d.id = p.deliverable_id where d.campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select e.id from public.edit_versions e join public.deliverables d on d.id = e.deliverable_id where d.campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select s.id from public.scripts s join public.deliverables d on d.id = s.deliverable_id where d.campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
  union select c.id from public.script_comments c join public.scripts s on s.id = c.script_id join public.deliverables d on d.id = s.deliverable_id where d.campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
-- what the automations made for the sample: template tasks, untouched auto-payouts, andon alerts
delete from public.andons where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001'
   or deliverable_id in (select id from public.deliverables where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001')
   or task_id in (select id from public.tasks where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001');
delete from public.task_assignees where task_id in (select id from public.tasks where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001' and source = 'automation');
delete from public.tasks where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001' and source = 'automation';
delete from public.creator_payouts where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001' and status = 'pending' and description like 'Auto:%';
do $$
begin
  if exists (select 1 from public.invoices where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001')
     or exists (select 1 from public.creator_payouts where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001') then
    raise exception 'The sample campaign now has invoices or payouts. Archive it in the app instead.';
  end if;
end $$;
update public.shortlists set campaign_id = null where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
delete from public.production_people where deliverable_id in (select id from public.deliverables where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001');
delete from public.edit_versions where deliverable_id in (select id from public.deliverables where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001');
delete from public.script_comments where script_id in (select s.id from public.scripts s join public.deliverables d on d.id = s.deliverable_id where d.campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001');
delete from public.scripts where deliverable_id in (select id from public.deliverables where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001');
delete from public.shoot_crew where shoot_id in (select id from public.shoots where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001');
delete from public.shoot_deliverables where deliverable_id in (select id from public.deliverables where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001')
   or shoot_id in (select id from public.shoots where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001');
delete from public.shoots where campaign_id = '5a3b1e00-0000-4000-8000-0000000ca001';
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
