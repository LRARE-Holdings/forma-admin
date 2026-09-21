-- STATUS: NOT YET APPLIED — awaiting review.
--
-- The Beginner's Course is a 12-credit pack that may only be spent on up to two
-- classes in any one week. The existing pack model can express "12 credits in 42
-- days" but has no notion of a rate limit, so it would let someone take all 12
-- in a fortnight.
--
-- The cap lives in the database rather than in booking code because both this
-- dashboard and the public site create bookings; a check in either one alone
-- would be enforced on one path and not the other.

alter table public.pack_tiers
  add column if not exists max_per_week integer;

alter table public.pack_tiers
  drop constraint if exists pack_tiers_max_per_week_check;
alter table public.pack_tiers
  add constraint pack_tiers_max_per_week_check
  check (max_per_week is null or max_per_week > 0);

comment on column public.pack_tiers.max_per_week is
  'Most classes this pack may fund in one Mon-Sun week. NULL = no limit.';

create or replace function public.enforce_pack_weekly_cap()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cap   integer;
  v_used  integer;
begin
  if new.class_pack_id is null or new.status <> 'confirmed' then
    return new;
  end if;

  select pt.max_per_week
    into v_cap
    from public.class_packs cp
    join public.pack_tiers  pt on pt.id = cp.pack_tier_id
   where cp.id = new.class_pack_id;

  if v_cap is null then
    return new;
  end if;

  -- Monday-based week, matching how the studio reads its own timetable.
  select count(*)
    into v_used
    from public.bookings b
   where b.class_pack_id = new.class_pack_id
     and b.status = 'confirmed'
     and b.id <> new.id
     and date_trunc('week', b.date::timestamp)
       = date_trunc('week', new.date::timestamp);

  if v_used >= v_cap then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'This pack covers %s class%s per week and that week is already full.',
        v_cap, case when v_cap = 1 then '' else 'es' end);
  end if;

  return new;
end
$$;

drop trigger if exists trg_enforce_pack_weekly_cap on public.bookings;
create trigger trg_enforce_pack_weekly_cap
  before insert or update on public.bookings
  for each row execute function public.enforce_pack_weekly_cap();
