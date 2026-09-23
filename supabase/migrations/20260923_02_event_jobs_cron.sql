-- STATUS: NOT YET APPLIED — needs two Vault secrets first (see below).
--
-- Runs forma-admin's /api/internal/event-jobs every minute. That endpoint:
--   * emails members who asked to hear when an event's tickets go on sale
--   * expires lapsed event waitlist offers and offers the freed places onward
--
-- Nothing about who can buy depends on this job; sale times, holds and offers
-- are all checked live at purchase. It exists so the emails go out on time. The
-- daily Vercel cron (Hobby plan) would send a "tickets are on sale" email up to
-- a day late, by which point a small event would be gone.
--
-- Same pattern as the existing `waitlist-expiry` job, but calling forma-admin
-- rather than an edge function so the email templates live in one place.
--
-- The endpoint processes events for every studio in the database, like
-- /api/cron does, so one job is enough for the whole platform.
--
-- Prerequisites, in Vault:
--   forma_admin_url  e.g. https://admin.burnmatstudio.co.uk  (no trailing slash)
--   CRON_SECRET      already present for waitlist-expiry. It must equal the
--                    CRON_SECRET env var on the forma-admin Vercel project.

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
  ) as request_id;
  $$
);
