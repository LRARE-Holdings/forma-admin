# CLAUDE.md — forma-admin

## What this project is

The admin and staff dashboard for studios on the **Forma** platform. This is where studio owners manage their business and where instructors view their schedules. For Burn Mat Studio (tenant #1), this deploys at **admin.burnmatstudio.co.uk**. For Studio #2, it would deploy at admin.studio2.co.uk — same codebase, different `STUDIO_ID`.

## Tech stack

- **Framework:** Next.js 15, App Router, TypeScript
- **Database & Auth:** Supabase (shared multi-tenant DB with Row-Level Security)
- **Hosting:** Vercel (linked to GitHub)
- **Email:** Resend (for admin notifications if needed)

- **Payments:** Stripe (via Stripe Connect — each studio connects their own Standard account, paying their own Stripe fees)

This app is the **single source of truth for all products** (class packs, drop-in classes, memberships). When an admin creates or edits a product, it is synced to the studio's connected Stripe account. The public site (`burn-public`) reads `stripe_price_id` from the database to power Stripe Elements checkout.

## What this app handles

### Studio admin view (role: `admin` at this studio)

Lucy logs in and sees the full dashboard:

- **Classes CRUD** — create, edit, archive class types (Hot Pilates, Hot Yoga, etc.)
- **Schedule management** — set and update the weekly timetable, assign instructors to slots
- **Bookings view** — see all upcoming and past bookings, filter by class/date/member
- **Client list** — view all registered members, their booking history, pack balances
- **Team management** — add/remove staff, assign roles
- **Class packs** — manage pack tiers (pricing, credits, validity periods), synced to Stripe as one-time products
- **Memberships** — manage recurring membership tiers (monthly/weekly/yearly), synced to Stripe as subscription products
- **Revenue overview** — charts and summaries of income (read-only, data from Stripe via bookings)
- **Stripe Connect** — onboard studio's own Stripe Standard account, manage payment settings
- **Settings** — studio profile, branding, contact details, Stripe Connect status

### Staff view (role: `staff`)

Amelia and Takkiya log in and see a restricted view:

- **Filtered timetable** — only their assigned classes
- **Attendee lists** — who's booked into each of their classes
- **Read-only** — staff cannot edit classes, schedule, pricing, or anything else

### Role-based routing

Middleware reads the user's role from `studio_memberships` filtered by the current `STUDIO_ID` and redirects:
- `admin` at this studio → `/dashboard`
- `staff` at this studio → `/staff`
- `member` or no membership → redirect to public site (they shouldn't be here)

## What this app does NOT handle

- Public browsing, booking, payments, member accounts → that's `burn-public`
- Forma marketing, pricing, onboarding → that's `forma-landing`

## Why staff and admin are in the same app

The staff view is a subset of the admin dashboard — same timetable component, same booking data, just filtered and read-only. Building it as routes within one app (`/staff` vs `/dashboard`) with role-based middleware is far less work than maintaining a separate deployment. It also keeps all management functions behind one auth wall, which is cleaner than putting admin-level data (client names, emails, booking details) on the public site.

## Database

Same shared Supabase instance as `burn-public`. Every query scoped by `studio_id`. RLS enforces tenant isolation.

### Key tables (same schema as burn-public, different access patterns)

- `profiles` — studio-agnostic identity table. Admin reads member profiles via joins through studio_memberships. Staff reads attendee profiles for their classes.
- `studio_memberships` — the multi-tenancy junction table. Links users to studios with a role (member | staff | admin). This is where role resolution happens. Admin manages memberships for their studio. Staff can read their own.
- `studios` — platform-level table. One row per tenant. Stores name, domain, email config (`email_from`, `email_domain`), and branding JSON. Admin can update their own studio's settings.
- `classes` — admin has full CRUD; staff reads only
- `instructors` — admin manages; staff reads own profile
- `schedule` — admin has full CRUD; staff reads own assignments
- `bookings` — admin reads all; staff reads only bookings for their assigned classes
- `class_packs` — admin manages tiers and views balances; staff has no access
- `pack_tiers` — admin manages; has `stripe_product_id` and `stripe_price_id` for Stripe sync
- `membership_tiers` — admin manages recurring subscription products; synced to Stripe
- `memberships` — tracks active member subscriptions with Stripe subscription IDs

### Auth roles (via studio_memberships)

Roles are per-studio, not per-user. A user's role is resolved by querying `studio_memberships` filtered by the current `STUDIO_ID`.

- **admin** — full read/write access to all studio data at this studio
- **staff** — read-only access to own schedule and attendee lists at this studio
- **member** — redirected away, this app is not for them

## Business context (Burn Mat Studio — tenant #1)

- 3 staff total: Lucy (admin), Amelia Bennett (staff), Takkiya Mastoor (staff)
- 6 class types, all capped at 10 attendees
- Class packs: 10-pack £75 (6 weeks), 5-pack £37.50 (4 weeks)
- Timetable is static weekly, Lucy tweaks it monthly

## Key architectural decisions

1. **One app, two experiences** — role-based middleware splits the UI. No separate staff app.
2. **Product source of truth** — this app creates and manages all Stripe Products and Prices on the studio's connected account. The public site reads `stripe_price_id` values from the DB. Revenue data is derived from bookings/payments. A webhook at `/api/stripe/webhook` handles post-payment events (pack purchases, subscription lifecycle).
3. **Clone-ready** — same as burn-public: all studio-specific data from the DB, keyed by `STUDIO_ID`. One codebase serves every Forma studio's admin panel.
4. **RLS is the security boundary** — even if middleware fails, RLS prevents cross-tenant data access. Defence in depth.
5. **No member-facing features** — if you're thinking about adding something a member would see, it probably belongs in burn-public instead.

## Email strategy

Same Resend account as all Forma apps. When this app sends emails (e.g. admin notifications, staff invites), it looks up the studio's `email_from` and `email_domain` from the `studios` table and sends from the studio's own domain. Auth emails (password resets etc.) come from auth@useforma.co.uk via Supabase's project-wide SMTP config.

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
NEXT_PUBLIC_STUDIO_ID=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

## Conventions

- App Router file structure: `app/(admin)/dashboard/`, `app/(staff)/staff/`, `app/api/`
- Route groups `(admin)` and `(staff)` with separate layouts and middleware guards
- Server Components by default; `"use client"` only for interactive dashboard widgets (charts, filters, modals)
- Tailwind CSS for styling
- Components in `components/` with subdirectories: `components/dashboard/`, `components/staff/`, `components/shared/`
- Shared timetable/booking components live in `components/shared/` and accept a `readOnly` prop for the staff view
- `lib/` for shared utilities: `lib/supabase.ts`, `lib/auth.ts`
- `lib/stripe/` for Stripe helpers: `index.ts` (client), `connect.ts` (Standard accounts), `products.ts` (product/price sync), `account.ts` (get studio's connected account)

## When working on this project

- Always resolve the user's role via `studio_memberships` filtered by `STUDIO_ID` — never assume a flat role on profiles
- Always check the user's role before rendering anything — middleware redirect is the first line, RLS is the second
- Staff should never see data outside their assigned classes — filter at the query level, not just the UI level
- When adding new admin features, ask: does the staff view need a read-only version of this?
- Revenue figures are derived — make sure they stay consistent with what Stripe actually processed (match on booking records with `payment_status = 'paid'`)
- All mutations (class CRUD, schedule updates, team changes) are admin-only — enforce in both middleware and API routes
- When creating a new staff member, create both the Supabase Auth account AND the `studio_memberships` row (role = staff, studio_id = current studio). Don't forget the `instructors` row too.
- The Forma platform theme system (studios.branding JSON column) will eventually drive per-studio visual identity in this app too — keep styles tokenised and ready for theming