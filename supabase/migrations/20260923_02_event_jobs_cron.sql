-- STATUS: NOT YET APPLIED — needs two Vault secrets first (see below).
--
-- Calls forma-admin's /api/internal/event-jobs when, and only when, there is
-- event work due:
--   * members to email because an event's tickets have just gone on sale
--   * a waitlist offer that has run out, to be passed to the next person
--   * a waitlist with someone whose request now fits the free places (e.g.
--     after an unpaid checkout hold lapsed)
--
-- The check runs in the database every minute and costs one small query. The
-- HTTP call — and the Vercel function behind it — happens only on the minutes
-- where event_jobs_due() says there is something to do, which for most of the
-- year is none of them.
--
-- Nothing about who can buy depends on this job; sale times, holds and offers
-- are all checked live at purchase. It exists so the emails go out on time.
-- Places freed by a cancellation are offered immediately by the code that
-- cancels; this job is the backstop for the ones only time can free.
--
-- Same pattern as the existing `waitlist-expiry` job, but calling forma-admin
-- rather than an edge function so the email templates live in one place. The
-- endpoint processes every studio, so one job covers the platform.
--
-- Prerequisites, in Vault:
--   forma_admin_url  e.g. https://admin.burnmatstudio.co.uk  (no trailing slash)
--   CRON_SECRET      already present for waitlist-expiry. It must equal the
--                    CRON_SECRET env var on the forma-admin Vercel project.

create or replace function public.event_jobs_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- Sale alerts that are due (same conditions as claim_due_sale_alerts).
    exists (
      select 1
      from public.event_sale_alerts a
      join public.events e on e.id = a.event_id
      where a.notified_at is null
        and e.is_published
        and e.tickets_enabled
        and e.cancelled_at is null
        and e.sales_open_at <= now()
        and e.event_date >= public.uk_today()
    )
    -- An offer that has lapsed and needs moving on.
    or exists (
      select 1 from public.event_waitlist w
      where w.status = 'offered' and w.expires_at <= now()
    )
    -- Someone waiting whose request fits the places now free.
    or exists (
      select 1
      from public.event_waitlist w
      join public.events e on e.id = w.event_id
      where w.status = 'waiting'
        and e.is_published
        and e.tickets_enabled
        and e.cancelled_at is null
        and e.event_date >= public.uk_today()
        and w.quantity <= e.capacity - public.event_places_taken(e.id)
    )
$$;

revoke execute on function public.event_jobs_due() from public, anon, authenticated;

select cron.unschedule('event-jobs')
where exists (select 1 from cron.job where jobname = 'event-jobs');

select cron.schedule(
  'event-jobs',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'forma_admin_url' limit 1)
           || '/api/internal/event-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) as request_id
  where public.event_jobs_due();
  $$
);
