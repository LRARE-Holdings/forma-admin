-- STATUS: NOT YET APPLIED — awaiting review.
--
-- Studio rule (Lucy, 2026-10-07): a member who cancels 24 hours or less before
-- the class gets no refund. For a card payment that is decided in burn-public's
-- cancel route. For a pack credit it has to be decided here, because
-- trg_restore_pack_credit_on_cancel returns the credit on every cancellation
-- whatever the app does.
--
-- Only member cancellations from 2026-10-07 on. Earlier late cancels were
-- refunded or credited under the old rule and are left exactly as they are:
-- nobody is charged back or has a credit taken away.
--
-- A forfeited credit is spent, not missing, so credit_shortfalls() now counts
-- it as used. Without that, every late cancel would show on the reconciliation
-- page as a credit the studio owes.
--
-- burn-public has the same 24-hour rule in lib/date-utils.ts
-- (isPastRefundCutoffUK) — change both together.

create or replace function public.is_late_member_cancel(p_booking public.bookings)
returns boolean
language sql
stable
set search_path to ''
as $$
  select p_booking.status = 'cancelled'
     and p_booking.cancelled_by = 'member'
     and p_booking.cancelled_at >= timestamptz '2026-10-07 00:00 Europe/London'
     and p_booking.cancelled_at >= (
           (p_booking.date + coalesce(s.start_time, time '00:00')) at time zone 'Europe/London'
         ) - interval '24 hours'
    from (select 1) one
    left join public.schedule s on s.id = p_booking.schedule_id
$$;

revoke execute on function public.is_late_member_cancel(public.bookings) from public, anon;
grant execute on function public.is_late_member_cancel(public.bookings) to authenticated, service_role;


-- As live, plus the late-cancel check after the idempotency guard. A credit
-- already returned stays returned.
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

  if v_booking.id is null then           return 'booking_not_found'; end if;
  if v_booking.status <> 'cancelled' then return 'not_cancelled';    end if;
  if v_booking.payment_method <> 'pack_credit' then return 'not_pack_credit'; end if;

  v_actor := coalesce(v_booking.cancelled_by, 'system');

  if exists (select 1 from public.credit_transactions
              where booking_id = p_booking_id and kind = 'refund') then
    return 'already_refunded';
  end if;

  -- Cancelled by the member 24 hours or less before the class: the credit is spent.
  if public.is_late_member_cancel(v_booking) then
    return 'late_cancel';
  end if;

  if v_booking.class_pack_id is not null then
    select * into v_pack from public.class_packs
     where id = v_booking.class_pack_id for update;
  end if;

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


-- As live, except a late cancel that kept its credit counts as used.
create or replace function public.credit_shortfalls(p_studio_id uuid)
returns table(profile_id uuid, full_name text, email text, bought integer, used integer,
              cancelled integer, remaining integer, missing integer)
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  perform public.require_studio_admin_or_server(p_studio_id);
  return query
  with packs as (
    select cp.profile_id,
           -- Credits the member paid for. A correction pack is credits being
           -- given back, so it counts towards the balance but not the purchase.
           sum(cp.credits_total) filter (where cp.pack_type <> 'correction') as bought,
           sum(cp.credits_remaining) as remaining,
           bool_or(cp.purchased_at < date '2026-04-01' and cp.pack_type <> 'correction') as legacy
      from public.class_packs cp where cp.studio_id = p_studio_id group by cp.profile_id
  ),
  bk as (
    select b.profile_id,
           count(*) filter (
             where b.status = 'confirmed'
                or (public.is_late_member_cancel(b)
                    and not exists (select 1 from public.credit_transactions ct
                                     where ct.booking_id = b.id and ct.kind = 'refund'))
           ) as used,
           count(*) filter (where b.status = 'cancelled') as cancelled
      from public.bookings b where b.studio_id = p_studio_id and b.payment_method = 'pack_credit' group by b.profile_id
  )
  select p.profile_id, pr.full_name, pr.email, coalesce(p.bought, 0)::integer, coalesce(bk.used, 0)::integer,
         coalesce(bk.cancelled, 0)::integer, p.remaining::integer,
         (coalesce(p.bought, 0) - coalesce(bk.used, 0) - p.remaining)::integer
    from packs p join public.profiles pr on pr.id = p.profile_id left join bk on bk.profile_id = p.profile_id
   where not p.legacy and (coalesce(p.bought, 0) - coalesce(bk.used, 0) - p.remaining) > 0
   order by 8 desc, pr.full_name;
end
$$;
