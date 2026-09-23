-- STATUS: APPLIED 2026-09-23 as 20260923145006 (events_and_event_tickets).
--
-- Studio events, and tickets for them.
--
-- An event is something one-off at the studio (a workshop, a social, a charity
-- class). The admin posts it from the dashboard; the public site shows it on the
-- home page while it is upcoming. An event can simply be an announcement, or it
-- can sell tickets: its own price, its own capacity, a per-member limit, and an
-- optional future time when tickets go on sale.
--
-- Dates are UK wall-clock, stored the same way as schedule (date + time without
-- time zone), so "upcoming" is a plain date comparison against today in
-- Europe/London. The one real instant is sales_open_at, which the dashboard
-- converts from UK time when Lucy sets it.
--
-- Selling a limited number of places without overselling them
-- -----------------------------------------------------------
-- The class flow checks capacity before payment and again in the webhook, and
-- refunds whoever loses a race. That is fine for a class with ten spots and a
-- trickle of bookings. It is not fine for a six-place event that thirty people
-- were emailed about at the same moment: most of them would pay and then be
-- refunded, and the studio pays Stripe's fee on every one of those.
--
-- So places are *held* before payment. Starting checkout calls
-- reserve_event_tickets(), which locks the event row, counts what is taken, and
-- writes a `pending` ticket that holds the places for ten minutes. The webhook
-- then calls confirm_event_ticket(). A payment that lands after its hold lapsed
-- is still confirmed if there is room, and refunded if not.
--
-- "Taken" is always computed live — confirmed tickets, unexpired holds, and
-- unexpired waitlist offers — so nothing about who can buy depends on a
-- background job having run. The job (see 20260923_02_event_jobs_cron.sql)
-- only sends emails: tickets-on-sale alerts and waitlist offers.

-- ─── events ─────────────────────────────────────────────────────────────────

create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  studio_id    uuid not null references public.studios(id) on delete cascade,
  title        text not null,
  description  text not null default '',
  event_date   date not null,
  -- Both optional: an all-day event has neither, an open-ended one only a start.
  start_time   time,
  end_time     time,
  location     text,
  image_url    text,
  -- An optional call to action for events sold elsewhere (e.g. Eventbrite).
  link_url     text,
  link_label   text,
  -- Drafts are visible to admins only.
  is_published boolean not null default true,

  -- Ticketing. Off by default: an event with tickets_enabled = false is an
  -- announcement and none of the columns below apply.
  tickets_enabled        boolean not null default false,
  price_pence            integer not null default 0,
  capacity               integer,
  max_tickets_per_member integer not null default 1,
  -- Null means on sale as soon as it is published.
  sales_open_at          timestamptz,
  stripe_product_id      text,
  stripe_price_id        text,
  -- Set when the studio calls the event off. Every ticket is refunded and the
  -- event disappears from the site; the row stays for the record.
  cancelled_at           timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint events_title_check
    check (length(btrim(title)) between 1 and 120),
  constraint events_times_check
    check (end_time is null or start_time is null or end_time > start_time),
  constraint events_end_needs_start_check
    check (end_time is null or start_time is not null),
  constraint events_link_url_check
    check (link_url is null or link_url ~* '^https?://'),
  constraint events_max_per_member_check
    check (max_tickets_per_member between 1 and 20),
  -- Stripe will not take a card payment under 30p.
  constraint events_ticketing_check
    check (not tickets_enabled
           or (price_pence >= 30 and capacity >= 1 and max_tickets_per_member <= capacity))
);

-- The public home page asks "published events for this studio from today on".
create index if not exists events_studio_date_idx
  on public.events (studio_id, event_date)
  where is_published;

alter table public.events enable row level security;

drop policy if exists "Anyone can view published events" on public.events;
create policy "Anyone can view published events"
  on public.events for select
  using (is_published);

-- Same check as classes: admin at the event's own studio.
drop policy if exists "Admins can manage events" on public.events;
create policy "Admins can manage events"
  on public.events for all
  using (public.get_user_role(studio_id) = 'admin')
  with check (public.get_user_role(studio_id) = 'admin');

grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;

-- ─── event_waitlist ─────────────────────────────────────────────────────────
-- Created before event_tickets, which points at it.

create table if not exists public.event_waitlist (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studios(id) on delete cascade,
  event_id    uuid not null references public.events(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  -- How many places they want. An offer is only made when that many are free.
  quantity    integer not null default 1 check (quantity between 1 and 20),
  status      text not null default 'waiting'
    check (status in ('waiting', 'offered', 'claimed', 'expired', 'removed')),
  offered_at  timestamptz,
  expires_at  timestamptz,
  claim_token uuid not null default gen_random_uuid() unique,
  created_at  timestamptz not null default now()
);

-- One live place in the queue per member per event.
create unique index if not exists event_waitlist_one_active_idx
  on public.event_waitlist (event_id, profile_id)
  where status in ('waiting', 'offered');

create index if not exists event_waitlist_queue_idx
  on public.event_waitlist (event_id, created_at)
  where status in ('waiting', 'offered');

alter table public.event_waitlist enable row level security;

drop policy if exists "Members can view own event waitlist entries" on public.event_waitlist;
create policy "Members can view own event waitlist entries"
  on public.event_waitlist for select
  using (profile_id = auth.uid());

drop policy if exists "Admins can manage event waitlist" on public.event_waitlist;
create policy "Admins can manage event waitlist"
  on public.event_waitlist for all
  using (public.get_user_role(studio_id) = 'admin')
  with check (public.get_user_role(studio_id) = 'admin');

grant select on public.event_waitlist to authenticated;
grant update, delete on public.event_waitlist to authenticated;

-- ─── event_tickets ──────────────────────────────────────────────────────────
-- One row per purchase. `quantity` places for one member.

create table if not exists public.event_tickets (
  id                       uuid primary key default gen_random_uuid(),
  studio_id                uuid not null references public.studios(id) on delete cascade,
  event_id                 uuid not null references public.events(id) on delete restrict,
  profile_id               uuid not null references public.profiles(id) on delete restrict,
  quantity                 integer not null check (quantity between 1 and 20),
  amount_pence             integer not null check (amount_pence >= 0),
  status                   text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  -- How long a pending ticket holds its places while the member pays.
  hold_expires_at          timestamptz,
  stripe_payment_intent_id text unique,
  -- Set when the purchase was a waitlist offer being claimed.
  waitlist_entry_id        uuid references public.event_waitlist(id) on delete set null,
  confirmed_at             timestamptz,
  cancelled_at             timestamptz,
  cancelled_by             text check (cancelled_by in ('member', 'studio', 'stripe')),
  refunded_at              timestamptz,
  refund_amount_pence      integer,
  created_at               timestamptz not null default now()
);

create index if not exists event_tickets_event_idx
  on public.event_tickets (event_id, status);
create index if not exists event_tickets_profile_idx
  on public.event_tickets (profile_id, event_id);

alter table public.event_tickets enable row level security;

drop policy if exists "Members can view own event tickets" on public.event_tickets;
create policy "Members can view own event tickets"
  on public.event_tickets for select
  using (profile_id = auth.uid());

drop policy if exists "Admins can manage event tickets" on public.event_tickets;
create policy "Admins can manage event tickets"
  on public.event_tickets for all
  using (public.get_user_role(studio_id) = 'admin')
  with check (public.get_user_role(studio_id) = 'admin');

grant select on public.event_tickets to authenticated;
grant update on public.event_tickets to authenticated;

-- ─── event_sale_alerts ──────────────────────────────────────────────────────
-- "Email me when tickets go on sale."

create table if not exists public.event_sale_alerts (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studios(id) on delete cascade,
  event_id    uuid not null references public.events(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  notified_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (event_id, profile_id)
);

create index if not exists event_sale_alerts_pending_idx
  on public.event_sale_alerts (event_id)
  where notified_at is null;

alter table public.event_sale_alerts enable row level security;

drop policy if exists "Members can view own sale alerts" on public.event_sale_alerts;
create policy "Members can view own sale alerts"
  on public.event_sale_alerts for select
  using (profile_id = auth.uid());

drop policy if exists "Admins can view sale alerts" on public.event_sale_alerts;
create policy "Admins can view sale alerts"
  on public.event_sale_alerts for select
  using (public.get_user_role(studio_id) = 'admin');

grant select on public.event_sale_alerts to authenticated;

-- ─── Functions ──────────────────────────────────────────────────────────────
-- All of these are called with the service role from server code. None is
-- exposed to members directly except event_availability(), which only returns
-- counts.

create or replace function public.uk_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/London')::date
$$;

-- Places currently spoken for. The two exclusions let a caller ask "how many
-- are taken by everyone else", e.g. when confirming a ticket whose own hold has
-- lapsed, or reserving against a waitlist offer that is already counted.
create or replace function public.event_places_taken(
  p_event_id       uuid,
  p_exclude_ticket uuid default null,
  p_exclude_entry  uuid default null
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(t.quantity)
      from public.event_tickets t
      where t.event_id = p_event_id
        and t.id is distinct from p_exclude_ticket
        and (t.status = 'confirmed'
             or (t.status = 'pending' and t.hold_expires_at > now()))
    ), 0)
    +
    coalesce((
      select sum(w.quantity)
      from public.event_waitlist w
      where w.event_id = p_event_id
        and w.id is distinct from p_exclude_entry
        and w.status = 'offered'
        and w.expires_at > now()
        -- Once the claimant is at checkout, their held ticket is what counts.
        and not exists (
          select 1 from public.event_tickets t
          where t.waitlist_entry_id = w.id
            and t.id is distinct from p_exclude_ticket
            and (t.status = 'confirmed'
                 or (t.status = 'pending' and t.hold_expires_at > now()))
        )
    ), 0)
  ::integer
$$;

-- Hold places for a member while they pay. Returns
--   { ok: true, ticket_id, quantity, amount_pence }  or  { ok: false, error }.
-- p_claim_token turns this into a waitlist claim: the quantity comes from the
-- offer, and the queue check is skipped because this member *is* the queue.
create or replace function public.reserve_event_tickets(
  p_event_id    uuid,
  p_profile_id  uuid,
  p_quantity    integer,
  p_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event  public.events%rowtype;
  v_entry  public.event_waitlist%rowtype;
  v_qty    integer := p_quantity;
  v_held   integer;
  v_left   integer;
  v_ticket uuid;
begin
  -- Serialises every reservation for this event.
  select * into v_event from public.events where id = p_event_id for update;

  if not found or not v_event.is_published or not v_event.tickets_enabled
     or v_event.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'error', 'not_on_sale');
  end if;
  if v_event.event_date < public.uk_today() then
    return jsonb_build_object('ok', false, 'error', 'event_passed');
  end if;
  if v_event.sales_open_at is not null and v_event.sales_open_at > now() then
    return jsonb_build_object('ok', false, 'error', 'not_open_yet');
  end if;

  if p_claim_token is not null then
    select * into v_entry
    from public.event_waitlist
    where claim_token = p_claim_token
      and event_id = p_event_id
      and profile_id = p_profile_id
    for update;

    if not found or v_entry.status <> 'offered' or v_entry.expires_at <= now() then
      return jsonb_build_object('ok', false, 'error', 'offer_invalid');
    end if;
    v_qty := v_entry.quantity;
  else
    if v_qty is null or v_qty < 1 or v_qty > v_event.max_tickets_per_member then
      return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
    end if;
    -- Freed places belong to the people already queueing for them.
    if exists (
      select 1 from public.event_waitlist
      where event_id = p_event_id and status = 'waiting'
    ) then
      return jsonb_build_object('ok', false, 'error', 'sold_out');
    end if;
  end if;

  -- A member reopening checkout replaces their earlier hold rather than
  -- stacking a second one against their own limit. If the earlier payment
  -- still goes through, confirm_event_ticket() takes it if there is room.
  update public.event_tickets
     set status = 'expired'
   where event_id = p_event_id
     and profile_id = p_profile_id
     and status = 'pending';

  select coalesce(sum(quantity), 0) into v_held
  from public.event_tickets
  where event_id = p_event_id
    and profile_id = p_profile_id
    and status = 'confirmed';

  if v_held + v_qty > v_event.max_tickets_per_member then
    return jsonb_build_object(
      'ok', false, 'error', 'limit_reached',
      'remaining_allowance', greatest(v_event.max_tickets_per_member - v_held, 0)
    );
  end if;

  v_left := v_event.capacity - public.event_places_taken(p_event_id, null, v_entry.id);
  if v_left < v_qty then
    return jsonb_build_object('ok', false, 'error', 'sold_out', 'places_left', greatest(v_left, 0));
  end if;

  insert into public.event_tickets (
    studio_id, event_id, profile_id, quantity, amount_pence,
    status, hold_expires_at, waitlist_entry_id
  ) values (
    v_event.studio_id, p_event_id, p_profile_id, v_qty, v_event.price_pence * v_qty,
    'pending', now() + interval '10 minutes', v_entry.id
  )
  returning id into v_ticket;

  return jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket,
    'quantity', v_qty,
    'amount_pence', v_event.price_pence * v_qty
  );
end;
$$;

-- Called by the webhook once the payment has succeeded. Returns one of
--   confirmed | already_confirmed | not_found | cancelled | event_unavailable | no_room
-- Anything other than the first two means the member paid and has no ticket,
-- and the caller must refund them.
create or replace function public.confirm_event_ticket(
  p_ticket_id         uuid,
  p_payment_intent_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.event_tickets%rowtype;
  v_event  public.events%rowtype;
begin
  select * into v_ticket from public.event_tickets where id = p_ticket_id;
  if not found then
    return 'not_found';
  end if;

  -- Event first, then ticket: the same lock order as reserve_event_tickets().
  select * into v_event from public.events where id = v_ticket.event_id for update;
  select * into v_ticket from public.event_tickets where id = p_ticket_id for update;

  if v_ticket.status = 'confirmed' then
    return 'already_confirmed';
  end if;
  if v_ticket.status = 'cancelled' then
    return 'cancelled';
  end if;
  if v_event.cancelled_at is not null or v_event.event_date < public.uk_today() then
    return 'event_unavailable';
  end if;

  -- Hold lapsed (or was replaced): take it only if the places are still free.
  if not (v_ticket.status = 'pending' and v_ticket.hold_expires_at > now()) then
    if v_event.capacity
       - public.event_places_taken(v_event.id, v_ticket.id, v_ticket.waitlist_entry_id)
       < v_ticket.quantity then
      update public.event_tickets
         set status = 'expired', stripe_payment_intent_id = p_payment_intent_id
       where id = p_ticket_id;
      return 'no_room';
    end if;
  end if;

  update public.event_tickets
     set status = 'confirmed',
         confirmed_at = now(),
         hold_expires_at = null,
         stripe_payment_intent_id = p_payment_intent_id
   where id = p_ticket_id;

  if v_ticket.waitlist_entry_id is not null then
    update public.event_waitlist
       set status = 'claimed'
     where id = v_ticket.waitlist_entry_id;
  end if;

  return 'confirmed';
end;
$$;

-- Join the queue for a sold-out event. Returns { ok, entry_id } or { ok: false, error }.
create or replace function public.join_event_waitlist(
  p_event_id   uuid,
  p_profile_id uuid,
  p_quantity   integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_held  integer;
  v_left  integer;
  v_entry uuid;
begin
  select * into v_event from public.events where id = p_event_id for update;

  if not found or not v_event.is_published or not v_event.tickets_enabled
     or v_event.cancelled_at is not null
     or v_event.event_date < public.uk_today() then
    return jsonb_build_object('ok', false, 'error', 'not_on_sale');
  end if;
  if v_event.sales_open_at is not null and v_event.sales_open_at > now() then
    return jsonb_build_object('ok', false, 'error', 'not_open_yet');
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > v_event.max_tickets_per_member then
    return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  end if;

  select coalesce(sum(quantity), 0) into v_held
  from public.event_tickets
  where event_id = p_event_id and profile_id = p_profile_id and status = 'confirmed';

  if v_held + p_quantity > v_event.max_tickets_per_member then
    return jsonb_build_object('ok', false, 'error', 'limit_reached');
  end if;

  -- Only queue for something that is actually unavailable.
  v_left := v_event.capacity - public.event_places_taken(p_event_id);
  if v_left >= p_quantity and not exists (
    select 1 from public.event_waitlist where event_id = p_event_id and status = 'waiting'
  ) then
    return jsonb_build_object('ok', false, 'error', 'available');
  end if;

  insert into public.event_waitlist (studio_id, event_id, profile_id, quantity)
  values (v_event.studio_id, p_event_id, p_profile_id, p_quantity)
  on conflict do nothing
  returning id into v_entry;

  if v_entry is null then
    return jsonb_build_object('ok', false, 'error', 'already_waiting');
  end if;

  return jsonb_build_object('ok', true, 'entry_id', v_entry);
end;
$$;

-- Expire lapsed offers, then offer free places to the queue in order. The first
-- person whose request fits is offered, so someone wanting two places does not
-- block someone behind them who wants one. Returns the entries just offered;
-- the caller emails them.
create or replace function public.offer_event_waitlist(p_event_id uuid)
returns setof public.event_waitlist
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event  public.events%rowtype;
  v_left   integer;
  v_window interval;
  v_entry  public.event_waitlist%rowtype;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    return;
  end if;

  update public.event_waitlist
     set status = 'expired'
   where event_id = p_event_id
     and status = 'offered'
     and expires_at <= now();

  if not v_event.is_published or not v_event.tickets_enabled
     or v_event.cancelled_at is not null
     or v_event.event_date < public.uk_today() then
    return;
  end if;

  -- Long enough to see an email; short once the event is almost here.
  v_window := case
    when v_event.event_date <= public.uk_today() + 1 then interval '1 hour'
    else interval '12 hours'
  end;

  v_left := v_event.capacity - public.event_places_taken(p_event_id);

  loop
    exit when v_left <= 0;

    select * into v_entry
    from public.event_waitlist
    where event_id = p_event_id
      and status = 'waiting'
      and quantity <= v_left
    order by created_at
    limit 1
    for update skip locked;

    exit when not found;

    update public.event_waitlist
       set status = 'offered', offered_at = now(), expires_at = now() + v_window
     where id = v_entry.id
    returning * into v_entry;

    v_left := v_left - v_entry.quantity;
    return next v_entry;
  end loop;
end;
$$;

-- Mark due "tickets on sale" alerts as sent and hand them back for emailing.
-- Marking first means two overlapping runs can never email someone twice; the
-- cost is that a failed send is not retried, which the caller logs.
create or replace function public.claim_due_sale_alerts()
returns table (alert_id uuid, studio_id uuid, event_id uuid, profile_id uuid)
language sql
security definer
set search_path = ''
as $$
  update public.event_sale_alerts a
     set notified_at = now()
    from public.events e
   where e.id = a.event_id
     and a.notified_at is null
     and e.is_published
     and e.tickets_enabled
     and e.cancelled_at is null
     and e.sales_open_at <= now()
     and e.event_date >= public.uk_today()
  returning a.id, a.studio_id, a.event_id, a.profile_id
$$;

-- Counts for the public site. Only published ticketed events; no names.
create or replace function public.event_availability(p_event_ids uuid[])
returns table (event_id uuid, places_left integer, queue_open boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    greatest(e.capacity - public.event_places_taken(e.id), 0),
    exists (select 1 from public.event_waitlist w
            where w.event_id = e.id and w.status = 'waiting')
  from public.events e
  where e.id = any(p_event_ids)
    and e.is_published
    and e.tickets_enabled
$$;

revoke execute on function public.event_places_taken(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reserve_event_tickets(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke execute on function public.confirm_event_ticket(uuid, text) from public, anon, authenticated;
revoke execute on function public.join_event_waitlist(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.offer_event_waitlist(uuid) from public, anon, authenticated;
revoke execute on function public.claim_due_sale_alerts() from public, anon, authenticated;

grant execute on function public.event_places_taken(uuid, uuid, uuid) to service_role;
grant execute on function public.reserve_event_tickets(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.confirm_event_ticket(uuid, text) to service_role;
grant execute on function public.join_event_waitlist(uuid, uuid, integer) to service_role;
grant execute on function public.offer_event_waitlist(uuid) to service_role;
grant execute on function public.claim_due_sale_alerts() to service_role;
grant execute on function public.event_availability(uuid[]) to anon, authenticated, service_role;
