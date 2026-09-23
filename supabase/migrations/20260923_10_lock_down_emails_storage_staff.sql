-- STATUS: APPLIED 2026-09-23 (lock_down_emails_storage_staff).
--
-- Three findings from the 2026-09-23 database audit.
--
-- 1. Weekly emails. send-weekly-emails had no authentication (and its response
--    listed instructors' emails); it now requires the Vault CRON_SECRET, so the
--    two cron jobs that call it send it. The two retired one-off launch jobs
--    (migration-email) are removed. See supabase/functions/send-weekly-emails.
--
-- 2. Photo storage. Any signed-in user — members included — could upload any
--    file of any size to the public `photos` bucket, or overwrite what is
--    there, including the instructor photos on the website. Now:
--      events/<anything>          studio admins only (event images)
--      instructors/<id>.<ext>     that instructor, or an admin of their studio
--    and only PNG/JPEG/WebP up to 10 MB.
--
-- 3. Instructors could read every booking and every member's profile at the
--    studio. They now see bookings for the classes they teach, and profiles of
--    their team and of members booked into their classes — enough for the
--    register and the member card, and nothing more.

-- ─── 1. Cron jobs send the secret ───────────────────────────────────────────

select cron.unschedule(jobname) from cron.job
 where jobname in ('instructor-schedule-reminder', 'owner-weekly-summary',
                   'migration-email-april-1', 'cleanup-migration-email-job');

select cron.schedule('instructor-schedule-reminder', '0 10 * * 0', $$
  select net.http_post(
    url := 'https://yzcerbbiifususbxczns.supabase.co/functions/v1/send-weekly-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)
    ),
    body := '{"type":"instructor-reminder"}'::jsonb
  );
$$);

select cron.schedule('owner-weekly-summary', '0 7 * * 1', $$
  select net.http_post(
    url := 'https://yzcerbbiifususbxczns.supabase.co/functions/v1/send-weekly-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)
    ),
    body := '{"type":"owner-summary"}'::jsonb
  );
$$);

-- ─── 2. Photo storage ───────────────────────────────────────────────────────

create or replace function public.can_write_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_name like 'events/%' then exists (
      select 1 from public.studio_memberships
       where profile_id = auth.uid() and role = 'admin'
    )
    when p_name ~ '^instructors/[0-9a-f-]{36}\.(png|jpe?g|webp)$' then exists (
      select 1 from public.instructors i
       where i.id = substring(p_name from '^instructors/([0-9a-f-]{36})')::uuid
         and (i.profile_id = auth.uid() or public.get_user_role(i.studio_id) = 'admin')
    )
    else false
  end
$$;

revoke execute on function public.can_write_photo(text) from public, anon;
grant execute on function public.can_write_photo(text) to authenticated;

drop policy if exists "Authenticated users can upload photos" on storage.objects;
drop policy if exists "Authenticated users can update photos" on storage.objects;

create policy "Admins and instructors can upload photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.can_write_photo(name));

create policy "Admins and instructors can replace photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.can_write_photo(name))
  with check (bucket_id = 'photos' and public.can_write_photo(name));

update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
 where id = 'photos';

-- ─── 3. What instructors can see ────────────────────────────────────────────

drop policy if exists "Staff can view bookings for their classes" on public.bookings;
create policy "Staff can view bookings for classes they teach"
  on public.bookings for select
  using (
    public.get_user_role(studio_id) = 'staff'
    and exists (
      select 1
        from public.schedule s
        join public.instructors i on i.id = s.instructor_id
       where s.id = bookings.schedule_id
         and i.profile_id = auth.uid()
    )
  );

create or replace function public.can_view_studio_member(p_target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.studio_memberships v
      join public.studio_memberships t
        on t.studio_id = v.studio_id and t.profile_id = p_target_profile_id
     where v.profile_id = auth.uid()
       and (
         -- The studio's dashboard roles see everyone at their studio.
         v.role in ('owner', 'admin', 'manager', 'reception')
         -- Instructors see their team, and members booked into their classes.
         or (v.role = 'staff' and (
               t.role in ('owner', 'admin', 'staff')
               or exists (
                 select 1
                   from public.bookings b
                   join public.schedule s on s.id = b.schedule_id
                   join public.instructors i on i.id = s.instructor_id
                  where b.profile_id = p_target_profile_id
                    and b.studio_id = v.studio_id
                    and b.status = 'confirmed'
                    and i.profile_id = auth.uid()
               )
             ))
       )
  )
$$;
