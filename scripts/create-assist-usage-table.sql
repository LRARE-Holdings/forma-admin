-- Migration: create assist_usage table for Forma Assist rate limiting
-- Run this in the Supabase SQL editor

create table if not exists public.assist_usage (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  date date not null default current_date,
  request_count int not null default 0,
  created_at timestamptz not null default now(),
  unique(studio_id, profile_id, date)
);

-- Enable RLS
alter table public.assist_usage enable row level security;

-- Users can read their own usage
create policy "Users can read own assist usage"
  on public.assist_usage for select
  using (profile_id = auth.uid());

-- Users can insert their own usage (upsert pattern)
create policy "Users can insert own assist usage"
  on public.assist_usage for insert
  with check (profile_id = auth.uid());

-- Users can update their own usage
create policy "Users can update own assist usage"
  on public.assist_usage for update
  using (profile_id = auth.uid());

-- Index for fast lookups
create index if not exists idx_assist_usage_lookup
  on public.assist_usage(studio_id, profile_id, date);

-- Add assist_enabled column to studios if not present (plan gating)
-- Studios on pro/partner plans get Assist; launch/studio do not
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'studios' and column_name = 'assist_enabled'
  ) then
    alter table public.studios add column assist_enabled boolean not null default false;
  end if;
end $$;
