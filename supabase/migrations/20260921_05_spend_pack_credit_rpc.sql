-- STATUS: NOT YET APPLIED — awaiting review.
--
-- Spending a credit is currently a read-then-write from application code, which
-- races two concurrent bookings against each other and leaves the ledger unable
-- to say which booking a debit belonged to. Doing it in one function locks the
-- row and attaches the booking to the ledger entry.

create or replace function public.spend_pack_credit(p_pack_id uuid, p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_pack public.class_packs%rowtype;
  v_new  integer;
begin
  select * into v_pack from public.class_packs where id = p_pack_id for update;

  if v_pack.id is null then
    raise exception 'Pack % not found', p_pack_id;
  end if;

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
$$;

grant execute on function public.spend_pack_credit(uuid, uuid) to authenticated, service_role;
