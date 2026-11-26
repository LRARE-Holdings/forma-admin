-- 1. Promotions can take a fixed amount off each pack (Black Friday 2026 is
--    £10 off every pack), as well as a percentage. Exactly one of the two.
--
--    Apply before deploying the code that reads pack_discount_pence, and
--    insert the Black Friday row only after that deploy: the older code reads
--    pack_discount_percent alone and would show "null% off".
--
-- 2. Instructors get an optional title for the website ("Founder of Burn",
--    "Our Barre Queen"). Without one the site falls back to Founder /
--    Instructor as before.

alter table public.promotions
  add column if not exists pack_discount_pence integer check (pack_discount_pence > 0);

alter table public.promotions
  alter column pack_discount_percent drop not null;

alter table public.promotions
  drop constraint if exists promotions_one_discount;
alter table public.promotions
  add constraint promotions_one_discount
  check (num_nonnulls(pack_discount_percent, pack_discount_pence) = 1);

alter table public.instructors
  add column if not exists title text check (title is null or char_length(title) between 1 and 60);

comment on column public.instructors.title is
  'Shown on the website above the name, e.g. "Founder of Burn". NULL: Founder for a studio admin, else Instructor.';
