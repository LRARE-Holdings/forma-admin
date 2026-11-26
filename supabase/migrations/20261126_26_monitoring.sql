-- Monitoring: the health checks behind /dashboard/status and the alerts that
-- go to the platform owner (Telegram, phone push via ntfy, email).
--
-- monitor_checks    current state of each check, one row per check key
-- monitor_events    every change of state, newest first on the status page
-- monitor_runs      heartbeat: each monitor run and each scheduled job writes
--                   one, so a job that stops running shows up as missing
-- app_errors        unhandled server errors from both apps, plus error pages
--                   members actually saw in their browser
-- platform_owners   who can open the status page (Forma, not the studio)
--
-- Alert settings (Telegram bot token and chat, ntfy topic, alert email) live in
-- Vault, never in a table: monitor_config() reads them and monitor_set_config()
-- writes them, both service role only.
--
-- Nothing here is readable by anon or signed-in users. The apps reach it with
-- the service role key only.

create table if not exists public.monitor_checks (
  key text primary key,
  label text not null,
  area text not null,
  status text not null default 'unknown' check (status in ('ok', 'warn', 'down', 'unknown')),
  summary text,
  detail jsonb,
  checked_at timestamptz,
  changed_at timestamptz not null default now(),
  last_ok_at timestamptz,
  streak integer not null default 0,
  alerted_status text,
  alerted_at timestamptz
);

create table if not exists public.monitor_events (
  id bigserial primary key,
  check_key text not null,
  label text not null,
  status text not null,
  previous_status text,
  summary text,
  alerted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists monitor_events_created_idx on public.monitor_events (created_at desc);

create table if not exists public.monitor_runs (
  id bigserial primary key,
  job text not null,
  ok boolean not null default true,
  note text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists monitor_runs_job_idx on public.monitor_runs (job, created_at desc);

create table if not exists public.app_errors (
  id bigserial primary key,
  app text not null check (app in ('admin', 'public')),
  kind text not null,
  fingerprint text not null,
  message text not null,
  path text,
  method text,
  route text,
  digest text,
  stack text,
  user_agent text,
  occurred_at timestamptz not null default now()
);
create index if not exists app_errors_occurred_idx on public.app_errors (occurred_at desc);
create index if not exists app_errors_fingerprint_idx on public.app_errors (fingerprint, occurred_at desc);

create table if not exists public.platform_owners (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.monitor_checks enable row level security;
alter table public.monitor_events enable row level security;
alter table public.monitor_runs enable row level security;
alter table public.app_errors enable row level security;
alter table public.platform_owners enable row level security;

revoke all on public.monitor_checks, public.monitor_events, public.monitor_runs,
  public.app_errors, public.platform_owners from anon, authenticated;

-- The Forma accounts (lrare.co.uk) that already hold admin at a studio.
insert into public.platform_owners (profile_id)
select sm.profile_id
  from public.studio_memberships sm
  join auth.users u on u.id = sm.profile_id
 where sm.role = 'admin'
   and lower(u.email) like '%@lrare.co.uk'
on conflict do nothing;

-- Database-side figures the monitor can't reach through PostgREST: size,
-- connections, failed pg_cron runs and failed outbound HTTP calls (pg_net).
create or replace function public.monitor_db_stats()
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'connections', (select count(*) from pg_stat_activity),
    'max_connections', current_setting('max_connections')::int,
    'cron_failures', coalesce((
      select jsonb_agg(jsonb_build_object(
               'job', j.jobname,
               'message', left(d.return_message, 300),
               'at', d.end_time))
        from cron.job_run_details d
        join cron.job j on j.jobid = d.jobid
       where d.status = 'failed'
         and d.end_time > now() - interval '15 minutes'
    ), '[]'::jsonb),
    'cron_last_success', coalesce((
      select jsonb_object_agg(jobname, last_ok)
        from (
          select j.jobname, max(d.end_time) as last_ok
            from cron.job j
            left join cron.job_run_details d on d.jobid = j.jobid and d.status = 'succeeded'
           where j.active
           group by j.jobname
        ) s
    ), '{}'::jsonb),
    'http_failures', (
      select count(*)
        from net._http_response r
       where r.created > now() - interval '15 minutes'
         and (r.error_msg is not null or r.status_code >= 500)
    ),
    'http_failure_sample', (
      select left(coalesce(r.error_msg, r.status_code::text || ' ' || coalesce(r.content, '')), 200)
        from net._http_response r
       where r.created > now() - interval '15 minutes'
         and (r.error_msg is not null or r.status_code >= 500)
       order by r.created desc
       limit 1
    )
  )
$$;

create or replace function public.monitor_config()
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select coalesce(jsonb_object_agg(replace(name, 'monitor_', ''), decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets
   where name in ('monitor_telegram_token', 'monitor_telegram_chat_id',
                  'monitor_ntfy_topic', 'monitor_alert_email')
$$;

create or replace function public.monitor_set_config(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_name text := 'monitor_' || p_key;
  v_id uuid;
begin
  if p_key not in ('telegram_token', 'telegram_chat_id', 'ntfy_topic', 'alert_email') then
    raise exception 'Unknown monitor setting %', p_key;
  end if;

  select id into v_id from vault.secrets where name = v_name;

  if p_value is null or btrim(p_value) = '' then
    if v_id is not null then
      delete from vault.secrets where id = v_id;
    end if;
  elsif v_id is null then
    perform vault.create_secret(btrim(p_value), v_name);
  else
    perform vault.update_secret(v_id, btrim(p_value));
  end if;
end
$$;

-- Old history goes after 30 days, heartbeats after 7.
create or replace function public.monitor_prune()
returns void
language sql
security definer
set search_path to ''
as $$
  delete from public.monitor_runs where created_at < now() - interval '7 days';
  delete from public.monitor_events where created_at < now() - interval '30 days';
  delete from public.app_errors where occurred_at < now() - interval '30 days';
$$;

revoke all on function public.monitor_db_stats() from public, anon, authenticated;
revoke all on function public.monitor_config() from public, anon, authenticated;
revoke all on function public.monitor_set_config(text, text) from public, anon, authenticated;
revoke all on function public.monitor_prune() from public, anon, authenticated;
grant execute on function public.monitor_db_stats() to service_role;
grant execute on function public.monitor_config() to service_role;
grant execute on function public.monitor_set_config(text, text) to service_role;
grant execute on function public.monitor_prune() to service_role;

-- The pg_cron job that runs the monitor every five minutes is added
-- separately, once the endpoint is deployed (see README).
