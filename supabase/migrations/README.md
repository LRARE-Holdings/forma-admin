# Migrations

Schema changes go straight to the shared Supabase project (`Forma DB`,
`yzcerbbiifususbxczns`) — there was no migrations directory before this change
set. Supabase keeps the authoritative history in
`supabase_migrations.schema_migrations`; the `.sql` files here are copies kept
for review.

## Applied on 2026-09-21

| Version | Name | What it does |
|---|---|---|
| `20260921215724` | `schedule_rules_warn_not_block` | Drops the `schedule_rules_no_overlap` EXCLUDE constraint; adds a lookup index |
| `20260921215910` | `credit_transactions_ledger` | `bookings.class_pack_id`, `bookings.cancelled_at`, the `credit_transactions` table and its RLS |
| `20260921220120` | `credit_ledger_and_auto_recredit_triggers` | Ledger trigger on `class_packs`; first cut of the re-credit trigger |
| `20260921220142` | `disable_auto_recredit_pending_review` | Disables that trigger |
| `20260921222225` | `spend_pack_credit_rpc` | `spend_pack_credit()` — locks the pack, decrements, attributes the debit |
| `20260921222259` | `class_discounts` | Dated discount columns on `classes` + the `classes_with_pricing` view |
| `20260921222312` | `pack_tier_weekly_cap` | `pack_tiers.max_per_week` + enforcement trigger |
| `20260921222335` | `restore_credit_callable` | `restore_pack_credit_for_booking()`, idempotent; `cancelled_at` stamping |
| `20260921223227` | `adopt_orphaned_monday_slot` | Gives the ruleless Monday 16:30 slot a rule, keeping its 38 bookings |
| `20260921223343` | `grant_correction_credit_rpc` | `grant_correction_credit()` for the reconciliation screen |

## How credits work now

Returning a credit lives in one function, `restore_pack_credit_for_booking`:

- It goes back to the pack the booking actually charged (`bookings.class_pack_id`).
- If that pack has expired, its expiry is extended 14 days so the credit is spendable.
- It refuses to pay out twice for the same booking.

Both apps call it directly after cancelling a booking — forma-admin in
`cancelBooking` and `cancelClassInstance`, burn-public in its cancel route. The
idempotency guard is what allows that, and it is also why the two can be deployed
independently without double-crediting.

### `trg_restore_pack_credit_on_cancel` is disabled on purpose

It calls the same function from an `AFTER UPDATE` on `bookings`, as a backstop
for anything that cancels a booking without going through either app (a direct
SQL fix, a future service).

It stays off until **burn-public is deployed**. The currently deployed bundle
still calls the old `incrementPackCredit`, which writes to `class_packs`
directly and so slips past the idempotency guard — a member cancellation would
return two credits. Once that deploy is out:

```sql
alter table public.bookings enable trigger trg_restore_pack_credit_on_cancel;
```

Nothing depends on this being enabled; re-crediting already works through the
explicit calls.

## Verified

Run as `DO` blocks ending in a deliberate exception, so they roll themselves back:

- Credit returns to the charged pack, not the oldest or an expired one
- An expired pack is revived so the returned credit can be used
- A second call returns `already_refunded` and does not double-credit
- The refund is written to `credit_transactions` against the right booking and pack
- A Beginner's Course pack allows two classes a week, blocks the third, and resets the next week
- Two instructors can now hold the same class at the same time, and partial time overlaps are accepted

## Events and event tickets (2026-09-23)

All steps applied on 2026-09-23. Step 1 as `20260923145006`
(`events_and_event_tickets`), with the scenario suite re-run against the applied
functions. The `event-jobs` job was checked end to end before scheduling: a
manual `net.http_post` with the Vault URL and secret got a 200 from forma-admin.

1. `20260923_01_events.sql` — `events`, `event_tickets`, `event_waitlist`,
   `event_sale_alerts`, and the functions that decide who can buy
   (`reserve_event_tickets`, `confirm_event_ticket`, `join_event_waitlist`,
   `offer_event_waitlist`, `claim_due_sale_alerts`, `event_availability`).
   Dry-run verified on 2026-09-23 inside a rolled-back transaction: holds,
   per-member limits, queue fairness, waitlist offer and claim, late payments
   refunded when there is no room, sale-time gating, alerts sent once, and
   execute grants.
2. Add Vault secret `forma_admin_url` (e.g. `https://admin.burnmatstudio.co.uk`)
   and check Vault's `CRON_SECRET` equals the forma-admin Vercel `CRON_SECRET`.
3. `20260923_02_event_jobs_cron.sql` — the `event-jobs` pg_cron job. It checks
   `event_jobs_due()` every minute in the database and only calls forma-admin
   when an alert, a lapsed offer or a fillable waitlist place is actually due.

Deploy forma-admin (webhook + `/api/internal/event-jobs`) before or with
burn-public. Until step 3, tickets still sell correctly; only the "on sale"
and waitlist-offer emails wait.

### Wallet passes (2026-09-23)

4. `20260923_03_event_ticket_wallet_token.sql` — `event_tickets.wallet_token`,
   the secret behind the "Add to Apple/Google Wallet" links in the ticket
   confirmation email. Applied 2026-09-23.
5. `20260923_04_cron_history_cleanup.sql` — nightly `cron-history-cleanup`
   job (03:30 UTC) keeping 7 days of `cron.job_run_details`. Applied
   2026-09-23, after the project ran out of Disk IO budget and that table was
   found to be 26 MB of a 49 MB database.

## Security fixes and CRM removal (2026-09-23)

Found during a codebase review. Both applied the same day.

- `20260923_05_lock_down_credit_functions.sql` — `grant_correction_credit`,
  `credit_shortfalls`, `credit_shortfall_legacy_count` and `spend_pack_credit`
  were SECURITY DEFINER and executable with the public anon key, with no check
  of their own: anyone could grant free credits or list members' emails. They
  now call `require_studio_admin_or_server()`. Verified in a rolled-back
  transaction (anon and members refused; studio admin, service role allowed;
  an admin of another studio refused) and then over the live REST API with the
  anon key (401 permission denied on all four).
- `20260923_06_remove_crm.sql` — drops the sales CRM (`crm_activity`, which was
  anon-readable, `crm_notes`, `referrers`, `referral_rewards`,
  `onboarding_submissions`, and `studios.onboarding_submission_id`). The data
  was test data; it was exported to `forma-crm-export-2026-09-23.json` outside
  the repos first. `email_signups` is kept for the marketing waitlist.

## Event pages (2026-09-23)

- `20260923_07_event_slugs.sql` — `events.slug`, set once from the title by a
  trigger and never changed, so links Lucy has shared keep working after a
  rename. Unique per studio (`-2`, `-3`… on repeats). Applied 2026-09-23 after
  a rolled-back test of punctuation, repeats, a title with no letters, another
  studio reusing a slug, and a rename.

## Member write holes (2026-09-23)

- `20260923_08_close_member_write_holes.sql` — from the database audit, each
  hole proven in a rolled-back transaction first: sign-ups could make
  themselves studio admins (role read from user-supplied metadata); members
  could write free bookings, re-confirm cancelled/refunded ones or move them
  past capacity; members could give themselves waitlist offers; class-waitlist
  positions were wrong (59 entries at #1); members could write any profile
  column. Applied after 16 rolled-back checks covering both the holes and the
  legitimate paths (staff invites, admin edits, joining/leaving waitlists,
  profile edits, server-side date-of-birth corrections). Nobody had used the
  admin hole — every admin/staff membership traced to a real invite.

## Check-in (2026-09-23)

- `20260923_09_check_in.sql` — `studio_memberships.checkin_token` (each
  member's personal class check-in code, one per studio; the QR carries
  `forma-member:<token>`, never a profile id) and `event_tickets.checked_in_count`
  / `checked_in_at` (a ticket for several people checks in one at a time).
  Applied 2026-09-23; all 992 memberships got distinct codes. The check-in
  server code was then run against real temporary data (20/20 scenarios,
  including permissions and walk-ins), all of it deleted afterwards.

## Emails, storage and instructor access (2026-09-23)

- `20260923_10_lock_down_emails_storage_staff.sql` — from the completed audit:
  the weekly-email cron jobs now send the Vault `CRON_SECRET` (the function
  requires it; source now in `supabase/functions/send-weekly-emails`), the
  retired launch-email jobs are removed, photo uploads are limited to admins
  and each instructor's own photo (PNG/JPEG/WebP, 10 MB), and instructors only
  see bookings and member profiles for the classes they teach. Applied after
  12 rolled-back checks.
- Edge functions `forma-announcement` and `migration-email` were replaced with
  410 stubs (they exposed member emails to anyone). Delete them in the
  dashboard when convenient.
- The edge-function secret `CRON_SECRET` now matches the Vault's (fixed the
  same evening); `waitlist-expiry` returns 200 again.

## Audit clean-up: data links and performance (2026-09-23)

- `20260923_11_link_unlinked_pack_bookings.sql` — six pack bookings from the
  morning of 2026-09-22 (before the class_pack_id fix) were saved without
  their pack, and their ledger debits without the booking. Credits were taken
  correctly; this only fills in the links so a cancellation re-credits the
  right pack. Applied.
- `20260923_12_rls_initplan_and_fk_indexes.sql` — policies call
  `(select auth.uid())` so it runs once per query instead of per row, and every
  unindexed foreign key gets an index. No access changes: dry run in a
  rolled-back transaction rewrote all 40 policies and a member saw exactly
  their own bookings, packs and profile. Applied.
- Left as they are: 1,496 older pack bookings without `class_pack_id` (from
  before packs were tracked per booking), one 2026-09-02 "stripe" booking with
  no payment reference (a past class, most likely added by hand), and 8
  internal/test accounts with no studio membership.

## One-off classes (2026-09-23)

- `20260923_13_one_off_classes_to_single_date_rules.sql` — "Add one-off class"
  saved a slot with no rule, which everything reads as "every week, forever";
  three added that morning showed (and took bookings) every week. Each now has a
  rule covering only its dates (Tue 17:40 and 18:40 → 29 Sep; Wed 18:30 → 23 and
  30 Sep, since it also ran on the 23rd). Applied after a rolled-back check of
  the dates each would show on. The app now creates one-offs as single-date
  rules, and gives any new rule its slot however far ahead it starts (it used to
  look only 4 weeks ahead, which left six rules planned in August with no slot).
- `20260923_14_timetable_fixes_tue_wed_fri.sql` — Wed 10:00 one-off → 30 Sep
  only; Pilates Sculpt Fri 08:00 (Dominika), a slotless rule, now runs 25 Sep
  only with its slot; the two identical Pilates Sculpt Tue 06:30 rules no
  longer overlap in October (the open-ended one ends 29 Sep and resumes from
  3 Nov). Dry run showed no duplicate class on any day to 30 Nov and no ruleless
  slots left. The remaining slotless rules are inert and were left alone.
