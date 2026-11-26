-- Gift cards give the recipient a year to claim, not six months (26 Nov 2026,
-- before any card was sold). Applied as data; the website and emails read
-- claim_months, so nothing else changes.
alter table public.gift_card_tiers alter column claim_months set default 12;
update public.gift_card_tiers set claim_months = 12;
