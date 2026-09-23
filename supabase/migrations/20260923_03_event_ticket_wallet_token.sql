-- STATUS: APPLIED 2026-09-23 (event_ticket_wallet_token).
--
-- A per-ticket secret for the "Add to Apple Wallet" / "Add to Google Wallet"
-- links in the ticket confirmation email.
--
-- People open emails on their phone without being logged in to the site, so
-- the links cannot rely on a session. Each ticket gets its own unguessable
-- token instead; the link is only as powerful as "show me this ticket as a
-- wallet pass", and only while the ticket is confirmed.
--
-- A column rather than a signed link, so neither app has to share a signing
-- secret: forma-admin writes the link into the email, burn-public serves it.

alter table public.event_tickets
  add column if not exists wallet_token uuid not null default gen_random_uuid();

create unique index if not exists event_tickets_wallet_token_idx
  on public.event_tickets (wallet_token);
