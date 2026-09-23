-- STATUS: APPLIED 2026-09-23 (remove_crm).
--
-- Remove the Forma sales CRM (the `forma` repo's portal app).
--
-- The CRM is being retired. Its crm_activity view was readable by anyone with
-- the public anon key (SECURITY DEFINER, granted to anon), exposing enquiries,
-- notes and referrers. Rather than secure it, it goes.
--
-- The data was test data (two "Test Studio" enquiries; no notes, referrers or
-- rewards). It was exported first, to forma-crm-export-2026-09-23.json, kept
-- outside the repos.
--
-- email_signups stays: the marketing site's waitlist form writes to it with
-- the service role, and RLS (no policies) already keeps everyone else out.
--
-- No CASCADE, so anything unexpected still depending on these fails loudly.

drop view if exists public.crm_activity;

-- Only Test Studio was linked to an enquiry; nothing in any app reads this.
alter table public.studios drop constraint if exists studios_onboarding_submission_id_fkey;
alter table public.studios drop column if exists onboarding_submission_id;

drop table if exists public.referral_rewards;
drop table if exists public.crm_notes;
drop table if exists public.referrers;
drop table if exists public.onboarding_submissions;
