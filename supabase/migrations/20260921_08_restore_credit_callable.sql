-- STATUS: NOT YET APPLIED — awaiting review.
--
-- Replaces the inline logic in trg_restore_pack_credit_on_cancel with one
-- callable, idempotent function.
--
-- Why: the trigger alone forced a coupled deploy. Application code that also
-- returns credits had to be removed in the same instant the trigger was enabled,
-- or cancellations would return two credits (both running) or none (neither).
--
-- Because the function refuses to pay out twice for the same booking, it is safe
-- for BOTH to call it. This repo calls it explicitly after cancelling, so admin
-- cancellations work whether or not the trigger is enabled; the trigger covers
-- the member site, which this repo cannot reach.

create or replace function public.restore_pack_credit_for_booking(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_revival_days constant integer := 14;
  v_booking public.bookings%rowtype;
  v_pack    public.class_packs%rowtype;
  v_new_bal integer;
  v_actor   text;
  v_reason  text;
begin
  select * into v_booking from public.bookings where id = p_booking_id;

  if v_booking.id is null then          return 'booking_not_found'; end if;
  if v_booking.status <> 'cancelled' then return 'not_cancelled';   end if;
  if v_booking.payment_method <> 'pack_credit' then return 'not_pack_credit'; end if;

  v_actor := coalesce(v_booking.cancelled_by, 'system');

  -- The idempotency guard. This is what makes it safe for the trigger and the
  -- application to both call this for the same cancellation.
  if exists (select 1 from public.credit_transactions
              where booking_id = p_booking_id and kind = 'refund') then
    return 'already_refunded';
  end if;

  -- The pack that was actually charged.
  if v_booking.class_pack_id is not null then
    select * into v_pack from public.class_packs
     where id = v_booking.class_pack_id for update;
  end if;

  -- Bookings taken before class_pack_id existed have to be matched. Prefer a
  -- live pack with room, soonest expiry first so it gets spent; otherwise the
  -- most recently expired pack with room, which is revived just below.
  if v_pack.id is null then
    select * into v_pack
      from public.class_packs cp
     where cp.studio_id  = v_booking.studio_id
       and cp.profile_id = v_booking.profile_id
       and cp.credits_remaining < cp.credits_total
     order by (cp.expires_at > now()) desc,
              case when cp.expires_at > now() then cp.expires_at end asc,
              cp.expires_at desc
     limit 1
       for update;
  end if;

  if v_pack.id is null then
    insert into public.credit_transactions (
      studio_id, profile_id, booking_id, kind, delta,
      actor_profile_id, actor_role, reason)
    values (v_booking.studio_id, v_booking.profile_id, p_booking_id, 'refund_failed', 0,
            auth.uid(), v_actor,
            'Cancelled a pack-credit booking but the member has no pack that can take the credit back');
    return 'no_pack';
  end if;

  -- An expired pack would swallow the credit. Revive it so the credit is real.
  if v_pack.expires_at <= now() then
    update public.class_packs
       set expires_at = now() + make_interval(days => v_revival_days)
     where id = v_pack.id;

    insert into public.credit_transactions (
      studio_id, profile_id, class_pack_id, booking_id, kind, delta,
      balance_after, actor_profile_id, actor_role, reason)
    values (v_booking.studio_id, v_booking.profile_id, v_pack.id, p_booking_id,
            'expiry_revival', 0, v_pack.credits_remaining, auth.uid(), v_actor,
            'Pack expired ' || to_char(v_pack.expires_at, 'DD Mon YYYY')
            || ' - extended ' || v_revival_days || ' days so the returned credit can be used');
  end if;

  v_new_bal := least(v_pack.credits_remaining + 1, v_pack.credits_total);

  if v_new_bal = v_pack.credits_remaining then
    insert into public.credit_transactions (
      studio_id, profile_id, class_pack_id, booking_id, kind, delta,
      balance_after, actor_profile_id, actor_role, reason)
    values (v_booking.studio_id, v_booking.profile_id, v_pack.id, p_booking_id,
            'refund_failed', 0, v_pack.credits_remaining, auth.uid(), v_actor,
            'Pack is already at its full balance of ' || v_pack.credits_total
            || ' - the original debit appears to be missing');
    return 'pack_full';
  end if;

  v_reason := 'Credit returned after cancelling the '
           || to_char(v_booking.date, 'DD Mon YYYY') || ' class'
           || case when v_booking.class_pack_id is null
                   then ' (original pack not recorded - matched on balance)'
                   else '' end;

  perform set_config('app.credit_context',
    jsonb_build_object('kind','refund', 'reason', v_reason,
                       'booking_id', p_booking_id::text, 'actor_role', v_actor)::text, true);

  update public.class_packs set credits_remaining = v_new_bal where id = v_pack.id;

  perform set_config('app.credit_context', '', true);

  return 'refunded';
end
$$;

grant execute on function public.restore_pack_credit_for_booking(uuid) to authenticated, service_role;


-- Stamping cancelled_at has to happen before the row is written.
create or replace function public.stamp_booking_cancelled_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists trg_stamp_booking_cancelled_at on public.bookings;
create trigger trg_stamp_booking_cancelled_at
  before update on public.bookings
  for each row execute function public.stamp_booking_cancelled_at();


-- Returning the credit happens after, against the committed row.
create or replace function public.restore_pack_credit_on_cancel()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled'
     and new.payment_method = 'pack_credit' then
    perform public.restore_pack_credit_for_booking(new.id);
  end if;
  return null;
end
$$;

drop trigger if exists trg_restore_pack_credit_on_cancel on public.bookings;
create trigger trg_restore_pack_credit_on_cancel
  after update on public.bookings
  for each row execute function public.restore_pack_credit_on_cancel();

-- Still disabled: burn-public's own incrementPackCredit must go first, or a
-- member cancellation returns one credit from the RPC and another from that call.
alter table public.bookings disable trigger trg_restore_pack_credit_on_cancel;
