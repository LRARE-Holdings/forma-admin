-- STATUS: APPLIED 2026-09-23 (rls_initplan_and_fk_indexes).
--
-- Performance fixes from the 2026-09-23 database audit (item 4). Nothing here
-- changes who can see or write what.
--
-- 1. Policies that call auth.uid() directly make Postgres re-run it for every
--    row a query touches. Wrapped as (select auth.uid()), it runs once per
--    query (Supabase advisor `auth_rls_initplan`). The rewrite is textual and
--    only touches policies not already wrapped. get_user_role(studio_id) takes
--    the row's studio, so it can't be hoisted the same way and is left alone.
--
-- 2. Indexes for every foreign key without one (advisor
--    `unindexed_foreign_keys`), so joins, RLS lookups and cascading deletes
--    don't scan whole tables. The tables are small, so plain CREATE INDEX.

-- ─── 1. auth.uid() once per query ───────────────────────────────────────────

do $$
declare
  p record;
  v_sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname in ('public', 'storage')
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%auth.uid()%'
       and (coalesce(qual, '') || coalesce(with_check, '')) not like '%SELECT auth.uid()%'
  loop
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then
      v_sql := v_sql || ' using (' || replace(p.qual, 'auth.uid()', '(select auth.uid())') || ')';
    end if;
    if p.with_check is not null then
      v_sql := v_sql || ' with check (' || replace(p.with_check, 'auth.uid()', '(select auth.uid())') || ')';
    end if;
    execute v_sql;
  end loop;
end
$$;

-- ─── 2. Foreign-key indexes ─────────────────────────────────────────────────

create index if not exists admin_invites_invited_by_idx          on public.admin_invites (invited_by);
create index if not exists admin_invites_studio_id_idx           on public.admin_invites (studio_id);
create index if not exists assist_usage_profile_id_idx           on public.assist_usage (profile_id);
create index if not exists birthday_tokens_profile_id_idx        on public.birthday_tokens (profile_id);
create index if not exists bookings_attendance_marked_by_idx     on public.bookings (attendance_marked_by);
create index if not exists credit_transactions_actor_idx         on public.credit_transactions (actor_profile_id);
create index if not exists credit_transactions_class_pack_id_idx on public.credit_transactions (class_pack_id);
create index if not exists event_sale_alerts_profile_id_idx      on public.event_sale_alerts (profile_id);
create index if not exists event_sale_alerts_studio_id_idx       on public.event_sale_alerts (studio_id);
create index if not exists event_tickets_studio_id_idx           on public.event_tickets (studio_id);
create index if not exists event_tickets_waitlist_entry_id_idx   on public.event_tickets (waitlist_entry_id);
create index if not exists event_waitlist_profile_id_idx         on public.event_waitlist (profile_id);
create index if not exists event_waitlist_studio_id_idx          on public.event_waitlist (studio_id);
create index if not exists instructors_profile_id_idx            on public.instructors (profile_id);
create index if not exists membership_tiers_studio_id_idx        on public.membership_tiers (studio_id);
create index if not exists memberships_membership_tier_id_idx    on public.memberships (membership_tier_id);
create index if not exists schedule_class_id_idx                 on public.schedule (class_id);
create index if not exists schedule_instructor_id_idx            on public.schedule (instructor_id);
create index if not exists schedule_studio_id_idx                on public.schedule (studio_id);
create index if not exists schedule_rules_class_id_idx           on public.schedule_rules (class_id);
create index if not exists schedule_rules_instructor_id_idx      on public.schedule_rules (instructor_id);
create index if not exists waitlist_profile_id_idx               on public.waitlist (profile_id);
create index if not exists waitlist_schedule_id_idx              on public.waitlist (schedule_id);
