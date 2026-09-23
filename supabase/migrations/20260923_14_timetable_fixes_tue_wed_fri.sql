-- STATUS: APPLIED 2026-09-23 (timetable_fixes_tue_wed_fri).
--
-- Three timetable corrections, confirmed by Alex on 2026-09-23:
--
-- 1. Infrared Pilates, Wed 10:00 (Lucy) — added as a one-off for 30 Sep, but
--    saved without a rule, so it showed every week. Now 30 Sep only. No bookings.
--
-- 2. Pilates Sculpt, Fri 08:00 (Dominika) — its rule (from 25 Sep, planned in
--    August) never got a slot, so this Friday's class was missing from the
--    timetable and the website. It runs on 25 Sep only (the October timetable
--    has Infrared Sculpt SWT at 08:00 from 2 Oct).
--
-- 3. Pilates Sculpt, Tue 06:30 (Amelia) — two identical rules overlapped from
--    6 Oct, so the class showed twice every Tuesday in October. The October
--    rule holds the October bookings; the open-ended one had none in October.
--    The open-ended rule now ends after 29 Sep (its 6 bookings are all on the
--    29th), and an identical rule continues it from 3 Nov, so November onwards
--    is unchanged.

do $$
declare
  v_studio uuid := 'f47b1352-b1bb-4a36-a601-ebf08030e26a';
  v_rule uuid;
  v_old public.schedule_rules;
begin
  -- 1. Wed 10:00 → 30 Sep only
  insert into public.schedule_rules (studio_id, class_id, instructor_id, recurrence, day_of_week, start_time, end_time, starts_on, ends_on)
  select s.studio_id, s.class_id, s.instructor_id, 'weekly', s.day_of_week, s.start_time, s.end_time, date '2026-09-30', date '2026-09-30'
    from public.schedule s
   where s.id = '359e726e-127b-41ab-81e1-d01a6b80ae5b' and s.rule_id is null and s.is_active
  returning id into v_rule;
  if v_rule is null then raise exception 'Wed 10:00 slot not found'; end if;
  update public.schedule set rule_id = v_rule where id = '359e726e-127b-41ab-81e1-d01a6b80ae5b';

  -- 2. Fri 08:00 Pilates Sculpt → 25 Sep only, with its slot
  update public.schedule_rules set ends_on = date '2026-09-25'
   where id = '6342d6a3-ba52-4bad-804f-4e1eff218d53' and studio_id = v_studio and starts_on = date '2026-09-25'
  returning * into v_old;
  if v_old.id is null then raise exception 'Fri 08:00 rule not found'; end if;
  if exists (select 1 from public.schedule where rule_id = v_old.id and is_active) then
    raise exception 'Fri 08:00 rule already has a slot';
  end if;
  insert into public.schedule (studio_id, class_id, instructor_id, day_of_week, start_time, end_time, rule_id, is_active)
  values (v_old.studio_id, v_old.class_id, v_old.instructor_id, v_old.day_of_week, v_old.start_time, v_old.end_time, v_old.id, true);

  -- 3. Tue 06:30: end the open-ended rule after 29 Sep, continue it from 3 Nov
  update public.schedule_rules set ends_on = date '2026-09-29'
   where id = (select rule_id from public.schedule where id::text like 'b7922165%' and studio_id = v_studio)
     and ends_on is null and starts_on = date '2026-09-29'
  returning * into v_old;
  if v_old.id is null then raise exception 'Tue 06:30 open-ended rule not found'; end if;
  if exists (select 1 from public.bookings b join public.schedule s on s.id = b.schedule_id
              where s.rule_id = v_old.id and b.status = 'confirmed' and b.date > date '2026-09-29') then
    raise exception 'Tue 06:30 rule has bookings after 29 Sep';
  end if;
  insert into public.schedule_rules (studio_id, class_id, instructor_id, recurrence, day_of_week, start_time, end_time, starts_on, ends_on)
  values (v_old.studio_id, v_old.class_id, v_old.instructor_id, v_old.recurrence, v_old.day_of_week, v_old.start_time, v_old.end_time, date '2026-11-03', null)
  returning id into v_rule;
  insert into public.schedule (studio_id, class_id, instructor_id, day_of_week, start_time, end_time, rule_id, is_active)
  values (v_old.studio_id, v_old.class_id, v_old.instructor_id, v_old.day_of_week, v_old.start_time, v_old.end_time, v_rule, true);
end
$$;
