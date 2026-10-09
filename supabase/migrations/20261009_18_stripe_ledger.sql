-- A local copy of every Stripe balance transaction and payout on each studio's
-- connected account, so money figures come from one place, in UK time, without
-- calling Stripe on every page load.
--
-- Written by the service role only (nightly sync in /api/cron, plus a backfill).
-- Readable by owners and admins of the studio; nobody else sees money.

create table public.stripe_balance_transactions (
  id                 text primary key,              -- txn_…
  studio_id          uuid not null references public.studios(id) on delete cascade,
  type               text not null,                 -- charge, payment, refund, payment_refund, payout, advance, …
  reporting_category text not null,
  amount             integer not null,              -- pence, signed as Stripe reports it
  fee                integer not null,
  net                integer not null,
  currency           text not null,
  status             text not null,                 -- pending | available
  created_at         timestamptz not null,
  available_on       timestamptz not null,
  description        text,
  source_id          text,                          -- ch_/py_, re_/pyr_, po_, …
  charge_id          text,                          -- for a sale its charge; for a refund the charge it refunds
  payment_intent_id  text,                          -- joins to bookings/class_packs.stripe_session_id, event_tickets.stripe_payment_intent_id
  payout_id          text,                          -- for payout and advance lines
  sale_type          text,                          -- charge metadata.type: drop_in_class, pack_tier, waitlist_claim, event_ticket; membership for invoices
  metadata           jsonb not null default '{}'::jsonb,
  synced_at          timestamptz not null default now()
);

create index stripe_balance_transactions_studio_created_idx
  on public.stripe_balance_transactions (studio_id, created_at);
create index stripe_balance_transactions_payment_intent_idx
  on public.stripe_balance_transactions (payment_intent_id)
  where payment_intent_id is not null;
create index stripe_balance_transactions_charge_idx
  on public.stripe_balance_transactions (charge_id)
  where charge_id is not null;

create table public.stripe_payouts (
  id                     text primary key,          -- po_…
  studio_id              uuid not null references public.studios(id) on delete cascade,
  amount                 integer not null,          -- pence reaching the bank
  currency               text not null,
  status                 text not null,             -- paid, pending, in_transit, failed, canceled
  method                 text not null,             -- standard | instant
  automatic              boolean not null,
  created_at             timestamptz not null,
  arrival_date           timestamptz not null,
  balance_transaction_id text,
  statement_descriptor   text,
  synced_at              timestamptz not null default now()
);

create index stripe_payouts_studio_arrival_idx
  on public.stripe_payouts (studio_id, arrival_date);

alter table public.stripe_balance_transactions enable row level security;
alter table public.stripe_payouts enable row level security;

create policy "Owners and admins can view studio Stripe transactions"
  on public.stripe_balance_transactions for select to authenticated
  using (public.get_user_role(studio_id) = any (array['owner', 'admin']));

create policy "Owners and admins can view studio payouts"
  on public.stripe_payouts for select to authenticated
  using (public.get_user_role(studio_id) = any (array['owner', 'admin']));

-- One statement for any period, with UK-time boundaries: p_from and p_to are
-- inclusive calendar dates in Europe/London.
--
-- Everything that moved the Stripe balance lands in exactly one bucket, so
--   opening_balance + net_sales - payouts - payout_fees + other = closing_balance
-- holds to the penny. advance / advance_funding (Instant Payouts pulling
-- pending money forward) net to zero and are left out of every bucket but
-- still count toward the balances.
--
-- Security invoker: RLS above decides who can see the figures.
create or replace function public.stripe_ledger_summary(
  p_studio_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select (p_from::timestamp at time zone 'Europe/London') as t0,
           ((p_to + 1)::timestamp at time zone 'Europe/London') as t1
  ),
  txn as (
    select t.*,
      case
        when t.type in ('charge', 'payment') then 'sale'
        when t.type in ('refund', 'payment_refund') then 'refund'
        when t.type in ('payout', 'payout_cancel', 'payout_failure') then 'payout'
        when t.type in ('advance', 'advance_funding') then 'advance'
        else 'other'
      end as bucket
    from public.stripe_balance_transactions t
    where t.studio_id = p_studio_id
  ),
  period as (
    select txn.* from txn, bounds
    where txn.created_at >= bounds.t0 and txn.created_at < bounds.t1
  ),
  by_type as (
    select coalesce(sale_type, 'other') as sale_type,
           sum(amount) filter (where bucket = 'sale')   as gross,
           count(*)    filter (where bucket = 'sale')   as sales,
           -sum(amount) filter (where bucket = 'refund') as refunded,
           count(*)    filter (where bucket = 'refund') as refunds
    from period
    where bucket in ('sale', 'refund')
    group by 1
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'currency', coalesce((select min(currency) from txn), 'gbp'),
    'gross_sales',   coalesce((select sum(amount) from period where bucket = 'sale'), 0),
    'refunds',       coalesce((select -sum(amount) from period where bucket = 'refund'), 0),
    'card_fees',     coalesce((select sum(fee) from period where bucket in ('sale', 'refund')), 0),
    'net_sales',     coalesce((select sum(net) from period where bucket in ('sale', 'refund')), 0),
    'payouts',       coalesce((select -sum(amount) from period where bucket = 'payout'), 0),
    'payout_fees',   coalesce((select sum(fee) from period where bucket = 'payout'), 0),
    'other',         coalesce((select sum(net) from period where bucket = 'other'), 0),
    'other_types',   coalesce((select jsonb_object_agg(type, n) from (
                       select type, sum(net) as n from period where bucket = 'other' group by type) o), '{}'::jsonb),
    'opening_balance', coalesce((select sum(net) from txn, bounds where txn.created_at < bounds.t0), 0),
    'closing_balance', coalesce((select sum(net) from txn, bounds where txn.created_at < bounds.t1), 0),
    'by_type', coalesce((select jsonb_agg(jsonb_build_object(
                 'sale_type', sale_type,
                 'gross', coalesce(gross, 0), 'sales', sales,
                 'refunded', coalesce(refunded, 0), 'refunds', refunds
               ) order by gross desc nulls last) from by_type), '[]'::jsonb),
    'last_synced_at', (select max(synced_at) from txn)
  );
$$;

revoke all on function public.stripe_ledger_summary(uuid, date, date) from public, anon;
grant execute on function public.stripe_ledger_summary(uuid, date, date) to authenticated, service_role;
