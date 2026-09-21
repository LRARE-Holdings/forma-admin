-- STATUS: APPLIED to production 2026-09-21.
--
-- Lucy could not freely edit the timetable because schedule_rules carried a hard
-- EXCLUDE constraint keyed on (studio_id, class_id, day_of_week, start_time, daterange).
--
-- That key protected the wrong thing. It rejected legitimate schedules (the same
-- class taught at one time by two instructors) while permitting genuine clashes
-- (two *different* classes in the room at once, or 09:00-10:00 overlapping
-- 09:30-10:30, which it never saw because it only compared start_time for equality).
--
-- Conflicts are now advisory: detected in lib/schedule-conflicts.ts and surfaced
-- in the UI, never used to reject a write.
alter table public.schedule_rules
  drop constraint if exists schedule_rules_no_overlap;

-- The gist index went with the constraint. Overlap *detection* still needs to be
-- fast, and it now runs across all classes for a studio/day rather than per class.
create index if not exists idx_schedule_rules_studio_day_time
  on public.schedule_rules (studio_id, day_of_week, start_time)
  where is_active;
