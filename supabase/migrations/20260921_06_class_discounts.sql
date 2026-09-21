-- STATUS: NOT YET APPLIED — awaiting review.
--
-- A time-boxed percentage discount on individual (drop-in) classes only.
-- Deliberately NOT added to pack_tiers: the October promotion is drop-in classes
-- only, and keeping the column off pack_tiers means a pack can never
-- accidentally inherit it.
--
-- price_pence stays the list price. The discount is a separate, dated overlay,
-- so the promotion expires on its own and the original price is never lost —
-- which overwriting price_pence would have done.

alter table public.classes
  add column if not exists discount_percent   integer,
  add column if not exists discount_starts_on date,
  add column if not exists discount_ends_on   date,
  -- Stripe Prices are immutable, so a discount needs its own Price object.
  -- Kept beside the list price rather than overwriting stripe_price_id, so the
  -- full-price Price is still there to go back to on 1 November.
  add column if not exists discount_stripe_price_id text;

alter table public.classes
  drop constraint if exists classes_discount_percent_check;
alter table public.classes
  add constraint classes_discount_percent_check
  check (discount_percent is null or (discount_percent > 0 and discount_percent < 100));

alter table public.classes
  drop constraint if exists classes_discount_dates_check;
alter table public.classes
  add constraint classes_discount_dates_check
  check (discount_ends_on is null or discount_starts_on is null
         or discount_ends_on >= discount_starts_on);

-- One definition of "what does this class cost today", shared by this dashboard
-- and the public site, so the two can never drift into showing different prices.
-- security_invoker keeps the caller's RLS on classes in force.
create or replace view public.classes_with_pricing
with (security_invoker = true) as
select
  c.*,
  (c.discount_percent is not null
   and (c.discount_starts_on is null or c.discount_starts_on <= current_date)
   and (c.discount_ends_on   is null or c.discount_ends_on   >= current_date)
  ) as discount_active,
  case
    when c.discount_percent is not null
     and (c.discount_starts_on is null or c.discount_starts_on <= current_date)
     and (c.discount_ends_on   is null or c.discount_ends_on   >= current_date)
    then round(c.price_pence * (100 - c.discount_percent) / 100.0)::integer
    else c.price_pence
  end as effective_price_pence
from public.classes c;

grant select on public.classes_with_pricing to anon, authenticated, service_role;
