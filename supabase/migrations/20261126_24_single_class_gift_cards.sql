-- Single-class gift cards: the buyer picks the class, pays that class's
-- drop-in price, and the recipient's credit only books that class.
--
-- gift_card_tiers.priced_by_class   the one-class card takes its price from
--                                   the class chosen at checkout
-- gift_cards.class_id               the class a single-class card is for
-- class_packs.only_class_id         set when such a card is claimed; the pack
--                                   can pay for that class and nothing else
--
-- Each app skips such a pack for any other class when it picks which pack to
-- charge; trg_enforce_pack_only_class refuses the booking in the database as
-- well, whichever app (or SQL) writes it, like the valid_from and weekly-cap
-- triggers beside it.

alter table public.gift_card_tiers
  add column if not exists priced_by_class boolean not null default false;

alter table public.gift_cards
  add column if not exists class_id uuid references public.classes(id);
create index if not exists gift_cards_class_idx on public.gift_cards (class_id);

alter table public.class_packs
  add column if not exists only_class_id uuid references public.classes(id);
create index if not exists class_packs_only_class_idx on public.class_packs (only_class_id);

comment on column public.class_packs.only_class_id is
  'Set for packs from a single-class gift card: the pack can only pay for this class.';

-- The one-class card is priced by the class picked, not by the tier.
update public.gift_card_tiers
   set priced_by_class = true, price_pence = null
 where credits = 1;

create or replace function public.enforce_pack_only_class()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_only uuid;
  v_class uuid;
  v_name text;
begin
  if new.class_pack_id is null or new.status <> 'confirmed' then
    return new;
  end if;

  select cp.only_class_id into v_only
    from public.class_packs cp
   where cp.id = new.class_pack_id;
  if v_only is null then
    return new;
  end if;

  select s.class_id into v_class from public.schedule s where s.id = new.schedule_id;
  if v_class is distinct from v_only then
    select c.name into v_name from public.classes c where c.id = v_only;
    raise exception using
      errcode = 'check_violation',
      message = format('This gift card can only be used for %s.', coalesce(v_name, 'one class'));
  end if;

  return new;
end
$$;

drop trigger if exists trg_enforce_pack_only_class on public.bookings;
create trigger trg_enforce_pack_only_class
  before insert or update of class_pack_id, schedule_id, status on public.bookings
  for each row execute function public.enforce_pack_only_class();

-- Claiming a single-class card makes a pack locked to its class.
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
    credits_total, credits_remaining, purchased_at, expires_at, stripe_session_id, only_class_id
  ) values (
    g.studio_id, p_profile_id, null, g.credits::text,
    g.credits, g.credits, now(), v_expires, coalesce(g.stripe_payment_intent_id, 'gift:' || g.code), g.class_id
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
