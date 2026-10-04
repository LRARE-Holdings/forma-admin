-- STATUS: APPLIED 2026-10-04 (pack_valid_from).
--
-- Packs could only say when they end. Lucy wanted six members given 10 credits
-- for November only, and a pack created in October was spendable on October
-- classes the moment it existed.
--
-- `valid_from` is the first class date a pack may pay for. NULL means no start
-- date, which is every pack before this change. It is compared with the class
-- date, not the booking time, so a member can book a November class in October
-- with a November pack. Expiry is unchanged and still checked at booking time.
--
-- Both apps filter on it when choosing a pack; the trigger is the backstop
-- for anything that writes a booking without going through them, the same
-- arrangement as the weekly cap.

alter table public.class_packs
  add column if not exists valid_from date;

comment on column public.class_packs.valid_from is
  'First class date this pack can pay for. NULL = usable straight away.';

create or replace function public.enforce_pack_valid_from()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_valid_from date;
begin
  if new.class_pack_id is null or new.status <> 'confirmed' then
    return new;
  end if;

  select cp.valid_from into v_valid_from
    from public.class_packs cp
   where cp.id = new.class_pack_id;

  if v_valid_from is not null and new.date < v_valid_from then
    raise exception using
      errcode = 'check_violation',
      message = format('This pack can only be used for classes from %s.',
                       to_char(v_valid_from, 'FMDD FMMonth YYYY'));
  end if;

  return new;
end
$function$;

drop trigger if exists trg_enforce_pack_valid_from on public.bookings;
create trigger trg_enforce_pack_valid_from
  before insert or update of class_pack_id, date, status on public.bookings
  for each row execute function public.enforce_pack_valid_from();
