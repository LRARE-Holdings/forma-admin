-- Gift cards the studio sets up for a customer (e.g. someone who rings or
-- walks in): the admin fills in the card, the customer gets an email with a
-- link to pay, and once they pay it goes through exactly the same path as a
-- website purchase (webhook → paid → buyer receipt + voucher → recipient email).
--
-- requested_at / requested_by   set when the studio created the card; tells a
--                               payment request apart from an abandoned
--                               website checkout (both are 'pending')
-- request_emailed_at            last time the payment link was emailed
--
-- A cancelled request becomes 'abandoned', like an unfinished checkout.

alter table public.gift_cards
  add column if not exists requested_at timestamptz,
  add column if not exists requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists request_emailed_at timestamptz;

create index if not exists gift_cards_requested_idx
  on public.gift_cards (studio_id, requested_at)
  where requested_at is not null;
