-- Black Friday 2026: a discount on every class pack, from the start of Friday
-- 27 November to the end of Saturday 5 December (UK time, which is UTC in
-- winter). The public site shows the banner and the reduced prices only inside
-- this window, and checkout charges the reduced price only inside it.
--
-- The discount is still being agreed with Lucy. pack_discount_percent is NULL
-- on purpose: the column is NOT NULL, so this insert fails until a real number
-- replaces it. Do not apply with the placeholder.

insert into public.promotions (studio_id, name, starts_at, ends_at, pack_discount_percent)
values (
  'f47b1352-b1bb-4a36-a601-ebf08030e26a',
  'Black Friday',
  '2026-11-27 00:00:00+00',
  '2026-12-06 00:00:00+00',
  null  -- ← Lucy's percentage, e.g. 20
);
