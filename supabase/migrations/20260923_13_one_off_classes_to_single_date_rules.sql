-- STATUS: APPLIED 2026-09-23 (one_off_classes_to_single_date_rules).
--
-- "Add one-off class" used to save a schedule slot with no rule, which every
-- part of the system reads as "every week, forever". Three classes added that
-- way on 2026-09-23 were meant for one date each; this gives each a rule that
-- covers only those dates (the app now does the same for new one-offs).
--
--   Infrared Pilates, Tue 17:40 (Takkiya)            → 29 Sep only
--   Infrared Beginners Pilates, Tue 18:40 (Takkiya)  → 29 Sep only
--   Infrared Pilates, Wed 18:30 (Lucy)               → 23 and 30 Sep
--       Meant for 30 Sep, but because it showed every week it also ran on
--       23 Sep with two attendees; 23 Sep stays in so those bookings remain
--       visible.
--
-- The fourth, Infrared Pilates Wed 10:00 (359e726e), is left as it is until its
-- date is confirmed.

do $$
declare
  v record;
  v_rule uuid;
begin
  for v in
    select * from (values
      ('4626075e-12cb-4594-a99d-1f69d912daa7'::uuid, date '2026-09-29', date '2026-09-29'),
      ('c09e4f36-12e4-4655-9645-6497fd236e21'::uuid, date '2026-09-29', date '2026-09-29'),
      ('08f09666-3557-4592-929d-a90aa284f9f4'::uuid, date '2026-09-23', date '2026-09-30')
    ) as t(slot_id, starts_on, ends_on)
  loop
    insert into public.schedule_rules
      (studio_id, class_id, instructor_id, recurrence, day_of_week, start_time, end_time, starts_on, ends_on)
    select s.studio_id, s.class_id, s.instructor_id, 'weekly', s.day_of_week, s.start_time, s.end_time, v.starts_on, v.ends_on
      from public.schedule s
     where s.id = v.slot_id and s.rule_id is null and s.is_active
    returning id into v_rule;

    if v_rule is null then
      raise exception 'slot % is not an active slot without a rule', v.slot_id;
    end if;

    update public.schedule set rule_id = v_rule where id = v.slot_id;
    v_rule := null;
  end loop;
end
$$;
