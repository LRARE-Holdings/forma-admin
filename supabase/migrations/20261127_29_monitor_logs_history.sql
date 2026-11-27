-- Monitor, part 2: logs, error groups and history behind the website, admin
-- and combined status dashboards.
--
-- app_events       structured log from both apps: payments the webhook
--                  handled, checkouts started, requests the site refused,
--                  actions that showed Lucy an error, job runs. request_id ties
--                  one request together; correlation (a Stripe payment id)
--                  ties the website, Stripe and the webhook together.
-- app_errors       + request_id / correlation / profile / release / data
-- error_groups     one row per fingerprint: first/last seen, count, people,
--                  and open / resolved / muted. A resolved group reopens when
--                  the error comes back (trigger below).
-- monitor_results  every check result, kept 3 days (speed charts)
-- monitor_daily    per check per day counts, kept 120 days (uptime bars)
--
-- All service-role only, like the rest of the monitor tables.

create table if not exists public.app_events (
  id bigserial primary key,
  app text not null check (app in ('admin', 'public', 'monitor')),
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  category text not null,
  event text not null,
  message text,
  request_id text,
  correlation text,
  profile_id uuid,
  path text,
  status_code integer,
  duration_ms integer,
  data jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists app_events_occurred_idx on public.app_events (occurred_at desc);
create index if not exists app_events_category_idx on public.app_events (category, occurred_at desc);
create index if not exists app_events_request_idx on public.app_events (request_id) where request_id is not null;
create index if not exists app_events_correlation_idx on public.app_events (correlation) where correlation is not null;

alter table public.app_errors
  add column if not exists request_id text,
  add column if not exists correlation text,
  add column if not exists profile_id uuid,
  add column if not exists release text,
  add column if not exists data jsonb;
create index if not exists app_errors_request_idx on public.app_errors (request_id) where request_id is not null;

create table if not exists public.error_groups (
  fingerprint text primary key,
  app text not null,
  kind text not null,
  title text not null,
  path text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  occurrences integer not null default 0,
  status text not null default 'open' check (status in ('open', 'resolved', 'muted')),
  muted_until timestamptz,
  resolved_at timestamptz,
  reopened boolean not null default false
);
create index if not exists error_groups_last_seen_idx on public.error_groups (last_seen desc);

create or replace function public.track_error_group()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.error_groups (fingerprint, app, kind, title, path, first_seen, last_seen, occurrences)
  values (new.fingerprint, new.app, new.kind, left(new.message, 300), new.path, new.occurred_at, new.occurred_at, 1)
  on conflict (fingerprint) do update set
    last_seen = greatest(public.error_groups.last_seen, excluded.last_seen),
    occurrences = public.error_groups.occurrences + 1,
    -- Back after being marked fixed: open again and say so. A mute that has
    -- run out lets it alert again.
    reopened = public.error_groups.reopened or public.error_groups.status = 'resolved',
    status = case
      when public.error_groups.status = 'resolved' then 'open'
      when public.error_groups.status = 'muted' and coalesce(public.error_groups.muted_until, 'infinity') < now() then 'open'
      else public.error_groups.status
    end,
    resolved_at = case when public.error_groups.status = 'resolved' then null else public.error_groups.resolved_at end;
  return new;
end
$$;

drop trigger if exists trg_track_error_group on public.app_errors;
create trigger trg_track_error_group
  after insert on public.app_errors
  for each row execute function public.track_error_group();

-- Groups for the errors already logged.
insert into public.error_groups (fingerprint, app, kind, title, path, first_seen, last_seen, occurrences)
select distinct on (fingerprint) fingerprint, app, kind, left(message, 300), path,
       min(occurred_at) over (partition by fingerprint), max(occurred_at) over (partition by fingerprint),
       count(*) over (partition by fingerprint)
  from public.app_errors
 order by fingerprint, occurred_at desc
on conflict do nothing;

create table if not exists public.monitor_results (
  id bigserial primary key,
  check_key text not null,
  status text not null,
  ms integer,
  checked_at timestamptz not null default now()
);
create index if not exists monitor_results_key_idx on public.monitor_results (check_key, checked_at desc);

create table if not exists public.monitor_daily (
  check_key text not null,
  day date not null,
  runs integer not null default 0,
  ok integer not null default 0,
  warn integer not null default 0,
  down integer not null default 0,
  ms_sum bigint not null default 0,
  ms_count integer not null default 0,
  primary key (check_key, day)
);

-- One call per monitor run: raw results plus the day's counters (UK day).
create or replace function public.monitor_record_results(p_results jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  r jsonb;
  v_day date := (now() at time zone 'Europe/London')::date;
begin
  for r in select * from jsonb_array_elements(p_results) loop
    insert into public.monitor_results (check_key, status, ms)
    values (r->>'key', r->>'status', nullif(r->>'ms', '')::int);

    insert into public.monitor_daily (check_key, day, runs, ok, warn, down, ms_sum, ms_count)
    values (
      r->>'key', v_day, 1,
      (r->>'status' = 'ok')::int, (r->>'status' = 'warn')::int, (r->>'status' = 'down')::int,
      coalesce(nullif(r->>'ms', '')::int, 0), (nullif(r->>'ms', '') is not null)::int
    )
    on conflict (check_key, day) do update set
      runs = public.monitor_daily.runs + 1,
      ok = public.monitor_daily.ok + excluded.ok,
      warn = public.monitor_daily.warn + excluded.warn,
      down = public.monitor_daily.down + excluded.down,
      ms_sum = public.monitor_daily.ms_sum + excluded.ms_sum,
      ms_count = public.monitor_daily.ms_count + excluded.ms_count;
  end loop;
end
$$;

-- The database's own scheduled jobs: last 14 runs each.
create or replace function public.monitor_jobs()
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'job', j.jobname, 'schedule', j.schedule, 'active', j.active,
           'runs', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'status', d.status, 'start', d.start_time,
                      'ms', (extract(epoch from (d.end_time - d.start_time)) * 1000)::int,
                      'message', left(d.return_message, 200))
                    order by d.start_time desc)
               from (select * from cron.job_run_details x where x.jobid = j.jobid
                      order by x.start_time desc limit 14) d
           ), '[]'::jsonb)
         ) order by j.jobname), '[]'::jsonb)
    from cron.job j
$$;

create or replace function public.monitor_prune()
returns void
language sql
security definer
set search_path to ''
as $$
  delete from public.monitor_runs where created_at < now() - interval '7 days';
  delete from public.monitor_events where created_at < now() - interval '30 days';
  delete from public.app_errors where occurred_at < now() - interval '30 days';
  delete from public.app_events where occurred_at < now() - interval '30 days';
  delete from public.monitor_results where checked_at < now() - interval '3 days';
  delete from public.monitor_daily where day < (now() - interval '120 days')::date;
  delete from public.error_groups where last_seen < now() - interval '60 days';
$$;

alter table public.app_events enable row level security;
alter table public.error_groups enable row level security;
alter table public.monitor_results enable row level security;
alter table public.monitor_daily enable row level security;
revoke all on public.app_events, public.error_groups, public.monitor_results, public.monitor_daily from anon, authenticated;

revoke all on function public.track_error_group() from public, anon, authenticated;
revoke all on function public.monitor_record_results(jsonb) from public, anon, authenticated;
revoke all on function public.monitor_jobs() from public, anon, authenticated;
revoke all on function public.monitor_prune() from public, anon, authenticated;
grant execute on function public.monitor_record_results(jsonb) to service_role;
grant execute on function public.monitor_jobs() to service_role;
grant execute on function public.monitor_prune() to service_role;

-- Applied separately as "error_group_alerting" (same day): each group alerts
-- once when it first appears, again only after it comes back from resolved,
-- never while muted. The monitor sets alerted_at when it sends.
alter table public.error_groups add column if not exists alerted_at timestamptz;
update public.error_groups set alerted_at = coalesce(alerted_at, now());
-- track_error_group() also clears alerted_at when a resolved group reopens:
--   alerted_at = case when status = 'resolved' then null else alerted_at end
