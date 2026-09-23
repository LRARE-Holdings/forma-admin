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

Step 1 applied on 2026-09-23 as `20260923145006` (`events_and_event_tickets`);
the scenario suite was re-run against the applied functions and passed. Steps 2–3
are still to do.

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
