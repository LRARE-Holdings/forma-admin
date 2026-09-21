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
