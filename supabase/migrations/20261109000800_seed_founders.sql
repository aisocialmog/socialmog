-- Social Mog OS — 0008 the two founders.
--
-- ┌────────────────────────────────────────────────────────────────┐
-- │  PUT THE REAL NAMES AND EMAILS HERE BEFORE `supabase db push`. │
-- │  The migration stops with an error while placeholders remain.  │
-- └────────────────────────────────────────────────────────────────┘
--
-- After pushing, invite both emails once from the Supabase dashboard
-- (Authentication → Users → Invite user). Their logins link to these rows
-- automatically. From then on, founders invite everyone else from
-- Settings → Team inside the app.

do $$
declare
  founders constant text[][] := array[
    ['[Founder 1 name]', '[Founder 1 email]'],
    ['[Founder 2 name]', '[Founder 2 email]']
  ];
  i int;
begin
  for i in 1 .. array_length(founders, 1) loop
    if founders[i][2] !~ '^[^@\s\[\]]+@[^@\s\[\]]+\.[^@\s\[\]]+$' or founders[i][1] like '[%' then
      raise exception 'Founder % still has a placeholder name or email. Edit supabase/migrations/20261109000800_seed_founders.sql first.', i;
    end if;
    insert into public.team_members (name, email, role, status, title, invited_at)
    values (founders[i][1], lower(founders[i][2]), 'founder', 'active', 'Co-founder', now())
    on conflict (lower(email)) do update set role = 'founder', status = 'active';
  end loop;
  -- if a founder already has a login (invited before this ran), link it now
  update public.team_members tm set user_id = u.id
    from auth.users u
   where lower(u.email) = lower(tm.email) and tm.user_id is null;
end $$;
