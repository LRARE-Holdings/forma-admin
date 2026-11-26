-- Festive 2026: instructor visibility, timed promotions (Black Friday) and gift cards.
--
-- 1. instructors.archived_at / show_on_site
--    Removing a team member used to DELETE their instructor row. That delete
--    cascades to their schedule and schedule_rules rows, and bookings block
--    deleting a schedule row (ON DELETE RESTRICT). So for anyone with booked
--    classes the delete failed and the app discarded the error: the person
--    vanished from the Team page but stayed on the public site (Dominika
--    Hudziak and Rachel Jackson, Nov 2026). For anyone without bookings it
--    would have silently deleted their timetable history. Instructors are now
--    archived instead, which keeps their past classes intact.
--
-- 2. promotions
--    A dated discount on class packs. The public site shows the banner and the
--    reduced prices only between starts_at and ends_at, and checkout charges the
--    reduced price in the same window, so nothing needs switching off by hand.
--
-- 3. gift_card_tiers / gift_cards / redeem_gift_card()
--    A paid gift card holds credits. The recipient claims it with its code
--    within claim_months of purchase; claiming creates an ordinary class pack
--    with no tier (so no class exclusions and no weekly cap) that lasts
--    pack_validity_days from that day.

-- ─── 1. Instructors ──────────────────────────────────────────────────────────

alter table public.instructors
  add column if not exists archived_at timestamptz,
  add column if not exists show_on_site boolean not null default true;

comment on column public.instructors.archived_at is
  'Set when the instructor leaves. Archived instructors are hidden everywhere but keep their past classes.';
comment on column public.instructors.show_on_site is
  'Whether the public site lists this instructor in the team section.';

-- Lucy asked for both to be removed (26 Nov 2026). Their memberships were
-- already gone; only the instructor rows were left behind.
update public.instructors
   set archived_at = now()
 where id in ('11416e1c-7746-4bf8-9051-58139d3ec82c',  -- Dominika Hudziak
              '224fa37d-8ee1-4758-99ed-c61ceff10fe2')  -- Rachel Jackson
   and archived_at is null;

-- ─── 2. Promotions ───────────────────────────────────────────────────────────

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  pack_discount_percent integer not null check (pack_discount_percent between 1 and 90),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists promotions_studio_window_idx
  on public.promotions (studio_id, starts_at, ends_at);

alter table public.promotions enable row level security;

drop policy if exists "Anyone can view promotions" on public.promotions;
create policy "Anyone can view promotions"
  on public.promotions for select
  using (true);

drop policy if exists "Admins can manage promotions" on public.promotions;
create policy "Admins can manage promotions"
  on public.promotions for all
  using (public.get_user_role(studio_id) = any (array['owner', 'admin']))
  with check (public.get_user_role(studio_id) = any (array['owner', 'admin']));

grant select on public.promotions to anon, authenticated;
grant insert, update, delete on public.promotions to authenticated;

-- ─── 3. Gift cards ───────────────────────────────────────────────────────────

create table if not exists public.gift_card_tiers (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  credits integer not null check (credits > 0),
  -- NULL until the studio confirms a price; such tiers are not offered.
  price_pence integer check (price_pence > 0),
  pack_validity_days integer not null default 42 check (pack_validity_days > 0),
  claim_months integer not null default 6 check (claim_months between 1 and 36),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.gift_card_tiers enable row level security;

drop policy if exists "Anyone can view gift card tiers" on public.gift_card_tiers;
create policy "Anyone can view gift card tiers"
  on public.gift_card_tiers for select
  using (true);

drop policy if exists "Admins can manage gift card tiers" on public.gift_card_tiers;
create policy "Admins can manage gift card tiers"
  on public.gift_card_tiers for all
  using (public.get_user_role(studio_id) = any (array['owner', 'admin']))
  with check (public.get_user_role(studio_id) = any (array['owner', 'admin']));

grant select on public.gift_card_tiers to anon, authenticated;
grant insert, update, delete on public.gift_card_tiers to authenticated;

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  tier_id uuid not null references public.gift_card_tiers(id),
  code text not null unique,
  credits integer not null check (credits > 0),
  amount_pence integer not null check (amount_pence > 0),
  pack_validity_days integer not null,
  claim_months integer not null,
  buyer_profile_id uuid not null references public.profiles(id),
  recipient_name text not null check (char_length(recipient_name) between 1 and 40),
  sender_name text not null check (char_length(sender_name) between 1 and 40),
  recipient_email text,
  send_on date,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'redeemed', 'refunded', 'abandoned')),
  stripe_payment_intent_id text unique,
  paid_at timestamptz,
  expires_at timestamptz,
  buyer_emailed_at timestamptz,
  recipient_emailed_at timestamptz,
  redeemed_by uuid references public.profiles(id),
  redeemed_at timestamptz,
  class_pack_id uuid references public.class_packs(id),
  created_at timestamptz not null default now(),
  check (recipient_email is null or send_on is not null)
);

create index if not exists gift_cards_studio_status_idx on public.gift_cards (studio_id, status);
create index if not exists gift_cards_buyer_idx on public.gift_cards (buyer_profile_id);
create index if not exists gift_cards_redeemed_by_idx on public.gift_cards (redeemed_by);
create index if not exists gift_cards_tier_idx on public.gift_cards (tier_id);
create index if not exists gift_cards_class_pack_idx on public.gift_cards (class_pack_id);
create index if not exists gift_cards_due_idx on public.gift_cards (send_on)
  where status = 'paid' and recipient_emailed_at is null;

alter table public.gift_cards enable row level security;

-- Buyers see the cards they bought, recipients the cards they claimed.
-- All writes go through the server (service role) or redeem_gift_card().
drop policy if exists "Buyers and recipients can view their gift cards" on public.gift_cards;
create policy "Buyers and recipients can view their gift cards"
  on public.gift_cards for select
  using (buyer_profile_id = (select auth.uid()) or redeemed_by = (select auth.uid()));

drop policy if exists "Admins can view gift cards" on public.gift_cards;
create policy "Admins can view gift cards"
  on public.gift_cards for select
  using (public.get_user_role(studio_id) = any (array['owner', 'admin']));

grant select on public.gift_cards to authenticated;

-- Claim a gift card: lock it, check it, turn it into a class pack.
-- Returns one of: 'redeemed', 'not_found', 'not_paid', 'already_redeemed',
-- 'expired', 'refunded'. Server-only (the public site calls it with the
-- service role after checking who is signed in).
create or replace function public.redeem_gift_card(
  p_studio_id uuid,
  p_code text,
  p_profile_id uuid
) returns table (outcome text, class_pack_id uuid, credits integer, pack_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  g public.gift_cards%rowtype;
  v_pack_id uuid;
  v_expires timestamptz;
begin
  select * into g
    from public.gift_cards
   where studio_id = p_studio_id
     and code = upper(btrim(p_code))
   for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::integer, null::timestamptz; return;
  end if;
  if g.status = 'redeemed' then
    return query select 'already_redeemed'::text, g.class_pack_id, g.credits, null::timestamptz; return;
  end if;
  if g.status = 'refunded' then
    return query select 'refunded'::text, null::uuid, null::integer, null::timestamptz; return;
  end if;
  if g.status <> 'paid' then
    return query select 'not_paid'::text, null::uuid, null::integer, null::timestamptz; return;
  end if;
  if g.expires_at is not null and g.expires_at < now() then
    return query select 'expired'::text, null::uuid, null::integer, null::timestamptz; return;
  end if;

  v_expires := now() + make_interval(days => g.pack_validity_days);

  insert into public.class_packs (
    studio_id, profile_id, pack_tier_id, pack_type,
    credits_total, credits_remaining, purchased_at, expires_at, stripe_session_id
  ) values (
    g.studio_id, p_profile_id, null, g.credits::text,
    -- The gift's payment intent, so revenue reports value these credits at
    -- what the buyer actually paid.
    g.credits, g.credits, now(), v_expires, coalesce(g.stripe_payment_intent_id, 'gift:' || g.code)
  )
  returning id into v_pack_id;

  update public.gift_cards
     set status = 'redeemed', redeemed_by = p_profile_id, redeemed_at = now(), class_pack_id = v_pack_id
   where id = g.id;

  return query select 'redeemed'::text, v_pack_id, g.credits, v_expires;
end;
$$;

revoke all on function public.redeem_gift_card(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_gift_card(uuid, text, uuid) to service_role;

-- The three cards Lucy asked for. 5 and 10 have no price yet, so they stay
-- hidden on the site until one is set.
insert into public.gift_card_tiers (studio_id, name, credits, price_pence, sort_order)
select s.id, t.name, t.credits, t.price_pence, t.sort_order
  from public.studios s
 cross join (values ('One class', 1, 1350, 1),
                    ('5 classes', 5, null::integer, 2),
                    ('10 classes', 10, null::integer, 3)) as t(name, credits, price_pence, sort_order)
 where s.id = 'f47b1352-b1bb-4a36-a601-ebf08030e26a'
   and not exists (select 1 from public.gift_card_tiers g where g.studio_id = s.id);
