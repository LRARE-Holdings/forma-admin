-- STATUS: APPLIED 2026-09-23 (lock_down_credit_functions).
--
-- Close public access to the credit functions.
--
-- These are SECURITY DEFINER, so they bypass RLS, and every one of them was
-- executable by `anon` through /rest/v1/rpc/ with no check of its own. The anon
-- key ships in both sites' JavaScript, so in practice anyone could:
--   grant_correction_credit        — give any member free class credits
--   credit_shortfalls              — list members' names and emails
--   spend_pack_credit              — drain credits from a pack by id
--   credit_shortfall_legacy_count  — (a count only)
--
-- Callers that must keep working:
--   forma-admin, as a signed-in studio admin (credit reconciliation, manual
--     bookings) — allowed by get_user_role() = 'admin'
--   burn-public and webhooks, with the service role key — allowed
--   pg_cron, migrations, the SQL editor — direct sessions with no JWT, allowed
--
-- restore_pack_credit_for_booking is only revoked from anon: it can only ever
-- return a credit a cancelled pack booking is owed, once, and it also runs
-- from the booking-cancel trigger, which must not be blocked.

-- ─── The one check ──────────────────────────────────────────────────────────

create or replace function public.require_studio_admin_or_server(p_studio_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  -- No JWT: not an API request at all (pg_cron, migrations, SQL editor).
  if v_claims is null then
    return true;
  end if;

  if (v_claims::jsonb ->> 'role') = 'service_role' then
    return true;
  end if;

  if public.get_user_role(p_studio_id) = 'admin' then
    return true;
  end if;

  raise exception 'Not allowed' using errcode = '42501';
end;
$$;

revoke execute on function public.require_studio_admin_or_server(uuid) from public, anon;

-- ─── grant_correction_credit ────────────────────────────────────────────────

create or replace function public.grant_correction_credit(
  p_profile_id uuid, p_studio_id uuid, p_credits integer, p_reason text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_validity constant integer := 42;
  v_pack     public.class_packs%rowtype;
  v_headroom integer;
  v_reason   text;
  v_new_pack uuid;
  v_applied  integer := 0;
begin
  perform public.require_studio_admin_or_server(p_studio_id);

  if p_credits is null or p_credits < 1 then
    raise exception 'Credits to restore must be 1 or more';
  end if;

  v_reason := coalesce(nullif(p_reason, ''),
    'Correction: credits from cancelled bookings that were never returned');

  select * into v_pack
    from public.class_packs cp
   where cp.studio_id  = p_studio_id
     and cp.profile_id = p_profile_id
     and cp.expires_at > now()
     and cp.credits_remaining < cp.credits_total
   order by cp.expires_at asc
   limit 1
     for update;

  if v_pack.id is not null then
    v_headroom := v_pack.credits_total - v_pack.credits_remaining;
    v_applied  := least(p_credits, v_headroom);

    perform set_config('app.credit_context',
      jsonb_build_object('kind','manual_adjustment','reason',v_reason)::text, true);

    update public.class_packs
       set credits_remaining = credits_remaining + v_applied
     where id = v_pack.id;

    perform set_config('app.credit_context', '', true);
  end if;

  if v_applied < p_credits then
    perform set_config('app.credit_context',
      jsonb_build_object('kind','manual_adjustment','reason',v_reason)::text, true);

    -- pack_type 'correction' keeps these out of the "bought" side of the
    -- reconciliation, so issuing one actually settles the shortfall.
    insert into public.class_packs (
      studio_id, profile_id, pack_type, credits_total, credits_remaining,
      purchased_at, expires_at, stripe_session_id)
    values (
      p_studio_id, p_profile_id, 'correction',
      p_credits - v_applied, p_credits - v_applied,
      now(), now() + make_interval(days => v_validity), null)
    returning id into v_new_pack;

    perform set_config('app.credit_context', '', true);
  end if;

  return jsonb_build_object(
    'topped_up_pack', v_pack.id,
    'topped_up',      v_applied,
    'new_pack',       v_new_pack,
    'new_pack_credits', greatest(p_credits - v_applied, 0));
end
$function$;

-- ─── spend_pack_credit ──────────────────────────────────────────────────────

create or replace function public.spend_pack_credit(p_pack_id uuid, p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_pack public.class_packs%rowtype;
  v_new  integer;
begin
  select * into v_pack from public.class_packs where id = p_pack_id for update;

  if v_pack.id is null then
    raise exception 'Pack % not found', p_pack_id;
  end if;

  perform public.require_studio_admin_or_server(v_pack.studio_id);

  if v_pack.credits_remaining < 1 then
    raise exception 'Pack % has no credits remaining', p_pack_id;
  end if;

  v_new := v_pack.credits_remaining - 1;

  perform set_config('app.credit_context',
    jsonb_build_object(
      'kind',       'debit',
      'booking_id', p_booking_id::text,
      'reason',     'Credit spent on a booking'
    )::text, true);

  update public.class_packs set credits_remaining = v_new where id = p_pack_id;

  perform set_config('app.credit_context', '', true);

  return v_new;
end
$function$;

-- ─── Reconciliation reads (member names and emails) ─────────────────────────

create or replace function public.credit_shortfalls(p_studio_id uuid)
returns table(profile_id uuid, full_name text, email text, bought integer, used integer,
              cancelled integer, remaining integer, missing integer)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform public.require_studio_admin_or_server(p_studio_id);

  return query
  with packs as (
    select cp.profile_id,
           -- Credits the member paid for. A correction pack is credits being
           -- given back, so it counts towards the balance but not the purchase,
           -- which is what lets a correction actually settle the shortfall.
           sum(cp.credits_total) filter (where cp.pack_type <> 'correction') as bought,
           sum(cp.credits_remaining)                                          as remaining,
           bool_or(cp.purchased_at < date '2026-04-01'
                   and cp.pack_type <> 'correction')                          as legacy
      from public.class_packs cp
     where cp.studio_id = p_studio_id
     group by cp.profile_id
  ),
  bk as (
    select b.profile_id,
           count(*) filter (where b.status = 'confirmed') as used,
           count(*) filter (where b.status = 'cancelled') as cancelled
      from public.bookings b
     where b.studio_id = p_studio_id
       and b.payment_method = 'pack_credit'
     group by b.profile_id
  )
  select p.profile_id,
         pr.full_name,
         pr.email,
         coalesce(p.bought, 0)::integer,
         coalesce(bk.used, 0)::integer,
         coalesce(bk.cancelled, 0)::integer,
         p.remaining::integer,
         (coalesce(p.bought, 0) - coalesce(bk.used, 0) - p.remaining)::integer
    from packs p
    join public.profiles pr on pr.id = p.profile_id
    left join bk on bk.profile_id = p.profile_id
   where not p.legacy
     and (coalesce(p.bought, 0) - coalesce(bk.used, 0) - p.remaining) > 0
   order by 8 desc, pr.full_name;
end
$function$;

create or replace function public.credit_shortfall_legacy_count(p_studio_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  perform public.require_studio_admin_or_server(p_studio_id);

  select count(*)::integer into v_count from (
    select cp.profile_id
      from public.class_packs cp
     where cp.studio_id = p_studio_id
     group by cp.profile_id
    having bool_or(cp.purchased_at < date '2026-04-01')
  ) s;

  return v_count;
end
$function$;

-- ─── No anonymous access to any of them ─────────────────────────────────────

revoke execute on function public.grant_correction_credit(uuid, uuid, integer, text) from public, anon;
revoke execute on function public.spend_pack_credit(uuid, uuid) from public, anon;
revoke execute on function public.credit_shortfalls(uuid) from public, anon;
revoke execute on function public.credit_shortfall_legacy_count(uuid) from public, anon;
revoke execute on function public.restore_pack_credit_for_booking(uuid) from public, anon;

-- Signed-in admins and the server still need them; the check inside decides.
grant execute on function public.grant_correction_credit(uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function public.spend_pack_credit(uuid, uuid) to authenticated, service_role;
grant execute on function public.credit_shortfalls(uuid) to authenticated, service_role;
grant execute on function public.credit_shortfall_legacy_count(uuid) to authenticated, service_role;
grant execute on function public.restore_pack_credit_for_booking(uuid) to authenticated, service_role;
grant execute on function public.require_studio_admin_or_server(uuid) to authenticated, service_role;
