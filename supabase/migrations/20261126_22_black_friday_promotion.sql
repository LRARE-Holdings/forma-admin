-- Black Friday 2026: £10 off every class pack, from 26 November (when it was
-- switched on, 12:09 UTC) to the end of Saturday 5 December (UK time, which is
-- UTC in winter). The public site shows the bar and the reduced prices only
-- inside this window, and checkout charges the reduced price only inside it.
--
-- Needs migration 23 (fixed-amount promotions) and the public-site code that
-- reads pack_discount_pence. Applied 2026-11-26 after that deploy.

insert into public.promotions (studio_id, name, starts_at, ends_at, pack_discount_pence)
select 'f47b1352-b1bb-4a36-a601-ebf08030e26a', 'Black Friday', now(), '2026-12-06 00:00:00+00', 1000
 where not exists (
   select 1 from public.promotions
    where studio_id = 'f47b1352-b1bb-4a36-a601-ebf08030e26a' and name = 'Black Friday'
 );
