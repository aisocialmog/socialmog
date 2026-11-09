-- Removes the two sample brands and everything attached to them, including
-- their activity history. Only rows whose id starts with 5a3b1e00- (the samples)
-- and rows linked to the two sample brands are touched.
-- Run in Supabase → SQL Editor. (This is the one place a hard delete is used:
-- sample data isn't business data. Real brands are archived, never deleted.)
-- If you uploaded files or a logo to a sample brand, also delete the folders
-- records/brands/5a3b1e00-0000-4000-8000-0000000000b1 and …b2 in Storage.
begin;
create temp table sample_brand_ids (id uuid) on commit drop;
insert into sample_brand_ids values ('5a3b1e00-0000-4000-8000-0000000000b1'), ('5a3b1e00-0000-4000-8000-0000000000b2');

create temp table sample_record_ids on commit drop as
  select id from sample_brand_ids
  union select id from public.brand_contacts where brand_id in (select id from sample_brand_ids)
  union select id from public.retainers where brand_id in (select id from sample_brand_ids)
  union select s.id from public.retainer_scope_items s join public.retainers r on r.id = s.retainer_id
        where r.brand_id in (select id from sample_brand_ids)
  union select id from public.files where brand_id in (select id from sample_brand_ids)
  union select id from public.brand_tags where brand_id in (select id from sample_brand_ids)
  union select id from public.comments where brand_id in (select id from sample_brand_ids);

-- Anything real linked to a sample brand (campaigns, invoices…) stops the removal.
do $$
begin
  if exists (select 1 from public.campaigns where brand_id in (select id from sample_brand_ids))
     or exists (select 1 from public.invoices where brand_id in (select id from sample_brand_ids))
     or exists (select 1 from public.deliverables where brand_id in (select id from sample_brand_ids))
     or exists (select 1 from public.tasks where brand_id in (select id from sample_brand_ids)) then
    raise exception 'A sample brand now has campaigns, deliverables, tasks or invoices. Archive it in the app instead.';
  end if;
end $$;

delete from public.comments       where brand_id in (select id from sample_brand_ids);
delete from public.files          where brand_id in (select id from sample_brand_ids);
delete from public.brand_tags     where brand_id in (select id from sample_brand_ids);
delete from public.retainer_scope_items where retainer_id in (select id from public.retainers where brand_id in (select id from sample_brand_ids));
delete from public.retainers      where brand_id in (select id from sample_brand_ids);
delete from public.brand_contacts where brand_id in (select id from sample_brand_ids);
delete from public.brands         where id in (select id from sample_brand_ids);
-- last, so the "delete" entries the steps above just logged go too
delete from public.activity_log
 where record_id in (select id from sample_record_ids)
    or coalesce(new_values->>'brand_id', old_values->>'brand_id') in (select id::text from sample_brand_ids);
commit;
