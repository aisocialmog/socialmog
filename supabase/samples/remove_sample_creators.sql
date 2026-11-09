-- Removes the five sample creators and everything attached to them (platforms,
-- stats history, niches, rates, payment details, shortlist entries, history).
-- Only sample ids (5a3b1e00-0000-4000-8000-000000000c…) are touched.
-- Run in Supabase → SQL Editor. If you uploaded a photo for a sample creator,
-- also delete avatars/creators/<id> in Storage.
begin;
create temp table sample_creator_ids (id uuid) on commit drop;
insert into sample_creator_ids select ('5a3b1e00-0000-4000-8000-000000000c0' || n)::uuid from generate_series(1, 5) n;

do $$
begin
  if exists (select 1 from public.campaign_creators where creator_id in (select id from sample_creator_ids))
     or exists (select 1 from public.deliverables where creator_id in (select id from sample_creator_ids))
     or exists (select 1 from public.creator_payouts where creator_id in (select id from sample_creator_ids)) then
    raise exception 'A sample creator is now on a campaign, deliverable or payout. Archive them in the app instead.';
  end if;
end $$;

create temp table sample_creator_records on commit drop as
  select id from sample_creator_ids
  union select id from public.creator_platforms where creator_id in (select id from sample_creator_ids)
  union select id from public.creator_rate_cards where creator_id in (select id from sample_creator_ids)
  union select id from public.creator_payment_details where creator_id in (select id from sample_creator_ids)
  union select id from public.creator_tags where creator_id in (select id from sample_creator_ids)
  union select id from public.shortlist_creators where creator_id in (select id from sample_creator_ids)
  union select id from public.comments where creator_id in (select id from sample_creator_ids)
  union select id from public.files where creator_id in (select id from sample_creator_ids);

delete from public.creator_metric_snapshots where creator_platform_id in (select id from public.creator_platforms where creator_id in (select id from sample_creator_ids));
delete from public.shortlist_creators     where creator_id in (select id from sample_creator_ids);
delete from public.comments               where creator_id in (select id from sample_creator_ids);
delete from public.files                  where creator_id in (select id from sample_creator_ids);
delete from public.creator_payment_details where creator_id in (select id from sample_creator_ids);
delete from public.creator_rate_cards     where creator_id in (select id from sample_creator_ids);
delete from public.creator_tags           where creator_id in (select id from sample_creator_ids);
delete from public.creator_platforms      where creator_id in (select id from sample_creator_ids);
delete from public.creators               where id in (select id from sample_creator_ids);
delete from public.activity_log
 where record_id in (select id from sample_creator_records)
    or coalesce(new_values->>'creator_id', old_values->>'creator_id') in (select id::text from sample_creator_ids);
commit;
