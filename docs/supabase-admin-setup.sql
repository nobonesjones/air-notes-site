-- ============================================================
-- Air Note — Admin Dashboard: Supabase setup
-- Run this ONCE in the Supabase SQL editor for project pukxgbtwamgifdjhyckb.
--
-- This is written defensively so it is safe to re-run. Before running,
-- confirm your real table/column names — this assumes a `profiles` table
-- keyed to auth.users(id). Adjust the names in section 0 if yours differ.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Admin flag on profiles
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- ------------------------------------------------------------
-- 1. analytics_events table
--    Both the app (writing events) and this dashboard (reading them)
--    point at this one table.
-- ------------------------------------------------------------
create table if not exists public.analytics_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete cascade,
  event_name  text not null,
  properties  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists analytics_events_user_id_idx    on public.analytics_events (user_id);
create index if not exists analytics_events_created_at_idx  on public.analytics_events (created_at desc);
create index if not exists analytics_events_event_name_idx  on public.analytics_events (event_name);

-- ------------------------------------------------------------
-- 2. A helper so RLS policies don't recurse on profiles.
--    SECURITY DEFINER lets it read is_admin without re-triggering
--    the profiles SELECT policy for the calling user.
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- ------------------------------------------------------------
-- 3. Row Level Security
--    The site is static and only ever holds the public anon key,
--    so every admin read MUST be gated here, keyed off auth.uid()
--    and is_admin. There is no service-role key anywhere in the site.
-- ------------------------------------------------------------

-- profiles: users see their own row; admins see everything.
alter table public.profiles enable row level security;

drop policy if exists "own profile readable" on public.profiles;
create policy "own profile readable" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "admins read all profiles" on public.profiles;
create policy "admins read all profiles" on public.profiles
  for select using (public.is_admin());

-- analytics_events: users write/read their own; admins read all.
alter table public.analytics_events enable row level security;

drop policy if exists "insert own events" on public.analytics_events;
create policy "insert own events" on public.analytics_events
  for insert with check (user_id = auth.uid());

drop policy if exists "read own events" on public.analytics_events;
create policy "read own events" on public.analytics_events
  for select using (user_id = auth.uid());

drop policy if exists "admins read all events" on public.analytics_events;
create policy "admins read all events" on public.analytics_events
  for select using (public.is_admin());

-- ------------------------------------------------------------
-- 4. Captures / meetings table (adjust the name to match yours)
--    Apply the same admin-read pattern to whatever table holds
--    the app's captures so the dashboard can count and list them.
--    Example (uncomment + rename `captures`):
--
-- alter table public.captures enable row level security;
-- drop policy if exists "admins read all captures" on public.captures;
-- create policy "admins read all captures" on public.captures
--   for select using (public.is_admin());
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 5. Make yourself an admin (run AFTER your account exists).
--    Sign up on the site once with Harry's email, then:
--
-- update public.profiles set is_admin = true
-- where id = (select id from auth.users where email = 'harry@example.com');
-- ------------------------------------------------------------
