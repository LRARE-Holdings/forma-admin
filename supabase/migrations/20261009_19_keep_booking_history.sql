-- Deleting a class or a timetable slot must never delete bookings.
--
-- bookings.schedule_id and schedule.class_id were ON DELETE CASCADE, so
-- deleting a class (allowed once its slots were retired) removed its slots and
-- every booking ever made on them. The Stripe ledger (migration 18) found 32
-- paid drop-ins, Apr–Sep 2026, whose bookings no longer exist for that reason.
--
-- RESTRICT makes the delete fail instead. deleteClass checks first and explains;
-- a class or slot with no bookings can still be deleted.

alter table public.bookings
  drop constraint bookings_schedule_id_fkey,
  add constraint bookings_schedule_id_fkey
    foreign key (schedule_id) references public.schedule(id) on delete restrict;

alter table public.schedule
  drop constraint schedule_class_id_fkey,
  add constraint schedule_class_id_fkey
    foreign key (class_id) references public.classes(id) on delete restrict;
