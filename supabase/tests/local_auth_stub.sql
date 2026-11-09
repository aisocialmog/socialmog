-- LOCAL TESTING ONLY. Mimics the parts of Supabase the migrations rely on
-- (auth.users, auth.uid(), the authenticated/anon roles, default grants) so the
-- schema can be checked on plain Postgres. Never run against a real project.
-- Migrations run as `app_owner`: NOT a superuser and WITHOUT bypassrls,
-- so RLS behaves as it does for Supabase's own tables.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role app_owner login nosuperuser nobypassrls;
grant anon, authenticated to app_owner;
create schema auth authorization app_owner;
create table auth.users (
  id uuid primary key, email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz
);
alter table auth.users owner to app_owner;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
alter schema public owner to app_owner;
-- Supabase grants table access to the API roles by default; RLS does the filtering.
alter default privileges for role app_owner in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges for role app_owner in schema public grant execute on functions to authenticated;
grant usage on schema public to authenticated;
