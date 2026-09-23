-- STATUS: APPLIED 2026-09-23 (close_member_write_holes).
--
-- Close the member-write holes found in the 2026-09-23 database audit. Each was
-- proven in a rolled-back transaction before this was written.
--
-- 1. Admin by self-signup. handle_new_user() took studio_memberships.role from
--    raw_user_meta_data — which whoever signs up controls — so a single
--    signUp() call with the public anon key could create a studio admin.
--    Sign-ups are now always 'member'. Staff invites are unaffected: forma-admin
--    (app/actions/team.ts) upserts the invited role itself straight after
--    inviteUserByEmail. No one had exploited it (every admin/staff row came
--    from a real invite).
--
-- 2. Free and re-confirmed bookings. Members could insert confirmed bookings
--    with any payment_method, and update any column of their own — re-confirm
--    a cancelled (and, since today, refunded) booking, or move it to any class
--    and date past capacity. Neither app writes bookings with a member's own
--    client; every booking goes through the server. Both policies go.
--
-- 3. Waitlist jumping. Members could insert or update their waitlist rows to
--    status 'offered' with any expiry, and /api/waitlist/claim books an offer
--    without a capacity check. Members may now only join as 'waiting' and only
--    move an entry to 'cancelled'.
--
-- 4. Waitlist order. The join code computed position from the rows the member
--    can see — only their own — so 59 entries sat at position 1 across 16 class
--    dates and the queue was not first come, first served. The database now
--    assigns the next position, and existing queues are renumbered by join time.
--
-- 5. Profiles. Members could write any column of their own profile, including
--    email and stripe_customer_id, and change date_of_birth whenever they liked
--    (it decides when the birthday treat arrives). They can now edit name,
--    phone and photo; date of birth can be set once, after which only the
--    studio (through the server) can change it.

-- ─── 1. Sign-ups are members ────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );

  -- Link to the studio they signed up at. The role is never read from the
  -- metadata: whoever signs up writes that. Staff invites set their role
  -- through the service role afterwards.
  if new.raw_user_meta_data->>'studio_id' is not null then
    insert into public.studio_memberships (studio_id, profile_id, role)
    values ((new.raw_user_meta_data->>'studio_id')::uuid, new.id, 'member')
    on conflict (studio_id, profile_id) do nothing;
  end if;

  return new;
end;
$function$;

-- ─── 2. Bookings are written by the server only ─────────────────────────────

drop policy if exists "Members can create bookings" on public.bookings;
drop policy if exists "Members can cancel own bookings" on public.bookings;

-- ─── 3 & 4. Class waitlist ──────────────────────────────────────────────────

drop policy if exists "Users can join waitlist" on public.waitlist;
create policy "Members can join a waitlist"
  on public.waitlist for insert
  with check (
    auth.uid() = profile_id
    and status = 'waiting'
    and offered_at is null
    and expires_at is null
  );

drop policy if exists "Users can cancel own waitlist entries" on public.waitlist;
create policy "Members can leave a waitlist"
  on public.waitlist for update
  using (auth.uid() = profile_id and status in ('waiting', 'offered'))
  with check (auth.uid() = profile_id and status = 'cancelled');

-- Next place in the queue, whatever the client sent. The advisory lock stops
-- two people joining the same class at once from getting the same position.
create or replace function public.waitlist_assign_position()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.schedule_id::text || ':' || new.date::text));
  select coalesce(max(position), 0) + 1 into new.position
    from public.waitlist
   where schedule_id = new.schedule_id and date = new.date;
  return new;
end;
$$;

revoke execute on function public.waitlist_assign_position() from public, anon, authenticated;

drop trigger if exists waitlist_assign_position on public.waitlist;
create trigger waitlist_assign_position
  before insert on public.waitlist
  for each row execute function public.waitlist_assign_position();

-- Renumber existing queues by when people joined.
with ordered as (
  select id, row_number() over (partition by schedule_id, date order by created_at, id) as pos
    from public.waitlist
)
update public.waitlist w
   set position = o.pos
  from ordered o
 where o.id = w.id and w.position is distinct from o.pos;

-- ─── 5. Profiles ────────────────────────────────────────────────────────────

-- Members may only write these columns of their own row (RLS still limits
-- the row). The service role, used by both apps' servers, is unaffected.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone, avatar_url, date_of_birth, updated_at) on public.profiles to authenticated;

create or replace function public.profiles_lock_date_of_birth()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  -- Only a member editing their own profile is held to this; the server
  -- (service role, no JWT user) can correct a date of birth for the studio.
  if old.date_of_birth is not null
     and new.date_of_birth is distinct from old.date_of_birth
     and auth.uid() = old.id then
    new.date_of_birth := old.date_of_birth;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_lock_date_of_birth on public.profiles;
create trigger profiles_lock_date_of_birth
  before update of date_of_birth on public.profiles
  for each row execute function public.profiles_lock_date_of_birth();
