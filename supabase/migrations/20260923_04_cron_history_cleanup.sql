-- STATUS: APPLIED 2026-09-23 (cron_history_cleanup).
--
-- Keep only the last 7 days of pg_cron run history.
--
-- pg_cron writes a row to cron.job_run_details for every run of every job and
-- never removes them. By 23 September that table held ~50,000 rows back to
-- March and was 26 MB — more than half of the whole 49 MB database — and the
-- every-minute event-jobs check adds ~1,440 rows a day on top.
--
-- That day the project ran out of its Disk IO budget and both sites hung until
-- the compute was upgraded. This table was not proven to be the cause (the
-- query statistics were lost in the restart), but it is pure overhead that
-- every job run adds to, so it is trimmed nightly.
--
-- Runs at 03:30 UTC, the quietest time for a UK studio. The first run removes
-- the backlog (~48,000 rows); the space is reused by later inserts rather than
-- returned to the operating system.

select cron.unschedule('cron-history-cleanup')
where exists (select 1 from cron.job where jobname = 'cron-history-cleanup');

select cron.schedule(
  'cron-history-cleanup',
  '30 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);
