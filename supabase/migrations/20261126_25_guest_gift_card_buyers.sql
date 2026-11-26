-- Gift cards can be bought without an account (claiming one still needs an
-- account). A guest buyer is a name and an email instead of a profile.
--
-- access_token: a private, unguessable key for the guest's own card, so the
-- checkout screen can check the payment went through and the buyer can
-- download the voucher without logging in. It goes only to the buyer (in the
-- checkout response and the link in their email), never in a listing.

alter table public.gift_cards
  alter column buyer_profile_id drop not null;

alter table public.gift_cards
  add column if not exists buyer_email text,
  add column if not exists buyer_name text,
  add column if not exists access_token uuid not null default gen_random_uuid();

alter table public.gift_cards
  drop constraint if exists gift_cards_buyer_known;
alter table public.gift_cards
  add constraint gift_cards_buyer_known
  check (buyer_profile_id is not null or (buyer_email is not null and char_length(buyer_email) between 3 and 254));

create unique index if not exists gift_cards_access_token_idx on public.gift_cards (access_token);
