-- STATUS: APPLIED 2026-09-23 (check_in).
--
-- Check-in at the door, by QR code or by name.
--
-- Classes: every member gets one personal check-in code per studio. It works
-- for any class they have booked there; the instructor scans it on the class
-- register and the booking is marked attended. It lives on the membership, not
-- the profile, so a member of two studios has a separate code at each.
--
-- The QR carries "forma-member:<checkin_token>", never a profile id: the token
-- is random, and can be replaced if a code is ever shared.
--
-- Events: a ticket can be for several people, so check-in counts people in
-- (checked_in_count, up to quantity) rather than flipping a flag. The ticket's
-- QR ("forma-ticket:<id>") is already on its wallet pass.

alter table public.studio_memberships
  add column if not exists checkin_token uuid not null default gen_random_uuid();

create unique index if not exists studio_memberships_checkin_token_idx
  on public.studio_memberships (checkin_token);

alter table public.event_tickets
  add column if not exists checked_in_count integer not null default 0,
  add column if not exists checked_in_at timestamptz;

alter table public.event_tickets drop constraint if exists event_tickets_checked_in_count_check;
alter table public.event_tickets add constraint event_tickets_checked_in_count_check
  check (checked_in_count between 0 and quantity);
