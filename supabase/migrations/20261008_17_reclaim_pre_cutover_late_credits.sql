-- STATUS: APPLIED 2026-10-08 (reclaim_pre_cutover_late_credits).
--
-- Migration 16 went live at 22:34 UK on 2026-10-07, but its rule covers member
-- cancellations from midnight that day. Four late cancels in between got their
-- credit back under the old code. Lucy asked for those four back.
--
-- Each pack still has at least one credit, so nobody goes below zero. The
-- reclaim is a manual_adjustment of -1 against the booking, so it shows in the
-- credit history next to the refund it undoes.
--
-- credit_shortfalls() counted a late cancel as used only when no refund row
-- existed. A reclaimed credit has one, so it now nets the booking's refunds and
-- adjustments instead: if the credit is not back on the balance, it was spent.
-- Otherwise each of these four would show as a credit the studio owes.

do $$
declare
  r record;
begin
  for r in
    select b.id as booking_id, ct.class_pack_id, b.date
      from public.bookings b
      join public.credit_transactions ct on ct.booking_id = b.id and ct.kind = 'refund'
     where b.id in ('502cb513-33c1-471a-9371-4d6dbfdbe3fa',   -- Millie Pay, 7 Oct 18:35
                    '95fd5f98-0efd-40cd-8f9e-82a3bf973061',   -- Stella Jones, 8 Oct 07:00
                    '9a4e2498-23fd-46e2-be15-add2c6f421da',   -- Jessie Kirk, 7 Oct 18:35
                    '983dcd90-4fb6-4ef0-afd8-20f92313d870')   -- Martha Cunningham, 8 Oct 07:00
       and public.is_late_member_cancel(b)
       and not exists (select 1 from public.credit_transactions x
                        where x.booking_id = b.id and x.kind = 'manual_adjustment')
  loop
    perform set_config('app.credit_context',
      jsonb_build_object(
        'kind', 'manual_adjustment',
        'booking_id', r.booking_id::text,
        'actor_role', 'studio',
        'reason', 'Credit reclaimed: cancelled within 24 hours of the '
                  || to_char(r.date, 'DD Mon YYYY') || ' class')::text, true);

    update public.class_packs
       set credits_remaining = credits_remaining - 1
     where id = r.class_pack_id and credits_remaining >= 1;

    if not found then
      raise exception 'Pack % has no credit to reclaim for booking %', r.class_pack_id, r.booking_id;
    end if;
  end loop;

  perform set_config('app.credit_context', '', true);
end
$$;


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
                    and coalesce((select sum(ct.delta) from public.credit_transactions ct
                                   where ct.booking_id = b.id
                                     and ct.kind in ('refund', 'manual_adjustment')), 0) <= 0)
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
