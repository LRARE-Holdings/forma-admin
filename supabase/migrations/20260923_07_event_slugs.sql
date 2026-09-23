-- STATUS: APPLIED 2026-09-23 (event_slugs).
--
-- A readable, shareable address for every event:
--   https://burnmatstudio.co.uk/events/sunset-yoga-sound-bath
--
-- Lucy posts these on social media and sends them to collaborators, so a slug
-- is set once, from the title, and never changes — renaming an event must not
-- break the links already out there. Two events with the same title in one
-- studio get -2, -3, … on the later ones.
--
-- Set by a trigger rather than by the dashboard, so every way an event is
-- created gets one.

alter table public.events add column if not exists slug text;

create or replace function public.events_set_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base      text;
  v_candidate text;
  v_n         integer := 1;
begin
  if new.slug is not null and new.slug <> '' then
    return new;
  end if;

  v_base := left(trim(both '-' from regexp_replace(lower(new.title), '[^a-z0-9]+', '-', 'g')), 60);
  v_base := trim(both '-' from v_base);
  if v_base = '' then
    v_base := 'event';
  end if;

  v_candidate := v_base;
  while exists (
    select 1 from public.events
     where studio_id = new.studio_id and slug = v_candidate and id <> new.id
  ) loop
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n;
  end loop;

  new.slug := v_candidate;
  return new;
end;
$$;

drop trigger if exists events_set_slug on public.events;
create trigger events_set_slug
  before insert or update of slug on public.events
  for each row execute function public.events_set_slug();

-- Backfill any events created before this migration.
update public.events set slug = null where slug is null;

alter table public.events alter column slug set not null;
alter table public.events drop constraint if exists events_slug_format_check;
alter table public.events add constraint events_slug_format_check
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

create unique index if not exists events_studio_slug_idx
  on public.events (studio_id, slug);
