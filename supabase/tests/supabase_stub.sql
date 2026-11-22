-- Local stand-in for the bits of Supabase the migrations rely on (roles, auth.users, auth.uid(), extensions, realtime).
-- Only used by run_local.sh on a throwaway Postgres; never apply this to a real Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema extensions;
create extension pgcrypto with schema extensions;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated;

create publication supabase_realtime;
