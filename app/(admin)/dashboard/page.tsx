import { createClient } from "@/lib/supabase/server"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { getUser, getUserRole } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { getGreeting, formatTime, formatPence, localDateStr, dateToDateStr, ukDayOfWeek } from "@/lib/utils"
import { getStudioStripeAccount } from "@/lib/stripe/account"
import { getLedgerSummary } from "@/lib/money"
import { ADMIN_ROLES } from "@/lib/types"
import { findStrandedBookings } from "@/lib/schedule-integrity"
import { getSessionFill, summariseFill } from "@/lib/fill-rate"
import { ACTIVE_WINDOW_DAYS, addDays } from "@/lib/member-activity"
import { StatCard } from "@/components/shared/stat-card"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist"
import { StrandedBookingsBanner } from "@/components/dashboard/stranded-bookings-banner"
import { TodayCancelButton } from "@/components/dashboard/today-cancel-button"
import { RealtimeBookingListener } from "@/components/dashboard/realtime-booking-listener"

export const dynamic = "force-dynamic"

export default async function OverviewPage() {
  const supabase = await createClient()
  const studioId = await getStudioId()
  const user = await getUser()

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user!.id)
    .single()

  const firstName = profile?.full_name?.split(" ")[0] ?? "there"

  // Get current day of week in UK time (0 = Monday in our schema)
  const now = new Date()
  const dow = ukDayOfWeek(now)
  const today = localDateStr(now) // YYYY-MM-DD in Europe/London

  // Build a UK-correct Date for relative calculations by parsing today back
  const ukToday = new Date(today + "T12:00:00Z") // noon UTC avoids edge cases

  // Date calculations for week-over-week comparisons
  const lastWeekSameDay = new Date(ukToday)
  lastWeekSameDay.setDate(ukToday.getDate() - 7)
  const lastWeekSameDayStr = dateToDateStr(lastWeekSameDay)

  const role = await getUserRole(studioId)
  const canSeeMoney = !!role && ADMIN_ROLES.includes(role)

  // Bookings pointing at a slot that is no longer live. Checked on every
  // dashboard load because this failure produces no error and no log — the
  // only signal it ever gave was a member standing in the car park.
  const stranded =
    role && ADMIN_ROLES.includes(role)
      ? await findStrandedBookings(studioId)
      : []

  // Fetch data in parallel
  // Fill rate compares the last 4 complete weeks with the 4 before, ending
  // yesterday so today's half-run classes don't drag it down.
  const fillTo = addDays(today, -1)
  const fillFrom = addDays(today, -28)
  const prevFillTo = addDays(today, -29)
  const prevFillFrom = addDays(today, -56)
  // Active members now (last 30 days) and as of 30 days ago, for the change.
  const activeFrom = addDays(today, -ACTIVE_WINDOW_DAYS)
  // Same length as the current window, which includes today: 31 days each
  const prevActiveFrom = addDays(today, -2 * ACTIVE_WINDOW_DAYS - 1)
  // Sales this month so far vs the same days of last month (capped at its end)
  const monthStart = today.slice(0, 8) + "01"
  const prevMonthStart = addDays(monthStart, -1).slice(0, 8) + "01"
  const prevMonthEnd = addDays(monthStart, -1)
  const prevMonthSameDay = `${prevMonthStart.slice(0, 8)}${today.slice(8)}`
  const prevMonthTo = prevMonthSameDay < prevMonthEnd ? prevMonthSameDay : prevMonthEnd

  const [scheduleRes, bookingsTodayRes, members, revenue, recentBookingsRes, studioRes, classesCountRes, scheduleCountRes, teamCountRes, recentClassBookings, bookingsLastWeekRes, sessionFill, prevMonthRevenue] =
    await Promise.all([
      // Today's schedule (rule date window applied below)
      supabase
        .from("schedule")
        .select("*, classes(*), instructors(*), schedule_rules(starts_on, ends_on)")
        .eq("studio_id", studioId)
        .eq("day_of_week", dow)
        .eq("is_active", true)
        .order("start_time"),
      // Bookings today
      supabase
        .from("bookings")
        .select("id")
        .eq("studio_id", studioId)
        .eq("date", today)
        .eq("status", "confirmed"),
      // Members, to tell their bookings apart from staff test bookings
      fetchAllRows((from, to) =>
        supabase
          .from("studio_memberships")
          .select("profile_id")
          .eq("studio_id", studioId)
          .eq("role", "member")
          .order("id")
          .range(from, to),
      ),
      // Card sales this month, from the Stripe ledger. Money is for owners
      // and admins only (RLS hides the ledger from managers and reception),
      // and a ledger error shows £0 rather than breaking the overview.
      canSeeMoney
        ? getStudioStripeAccount().then(async (account) => ({
            stripeConnected: !!account,
            revenuePence: account
              ? await getLedgerSummary(studioId, monthStart, today).then((s) => s.gross_sales, () => 0)
              : 0,
          }))
        : Promise.resolve({ stripeConnected: false, revenuePence: 0 }),
      // Recent bookings for activity feed (confirmed only, last 20)
      supabase
        .from("bookings")
        .select("*, profiles:profile_id(full_name), schedule:schedule_id(start_time, classes:class_id(name))")
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(20),
      // Studio info for onboarding
      supabase
        .from("studios")
        .select("stripe_onboarding_complete, onboarding_dismissed")
        .eq("id", studioId)
        .single(),
      // Onboarding checks
      supabase
        .from("classes")
        .select("id")
        .eq("studio_id", studioId)
        .limit(1),
      supabase
        .from("schedule")
        .select("id")
        .eq("studio_id", studioId)
        .eq("is_active", true)
        .limit(1),
      supabase
        .from("studio_memberships")
        .select("id")
        .eq("studio_id", studioId)
        .neq("role", "member")
        .limit(2),
      // Classes in the last 60 days, for active members now vs 30 days ago
      fetchAllRows((from, to) =>
        supabase
          .from("bookings")
          .select("profile_id, date")
          .eq("studio_id", studioId)
          .eq("status", "confirmed")
          .gte("date", prevActiveFrom)
          .lte("date", today)
          .order("id")
          .range(from, to),
      ),
      // Bookings same day last week (for comparison)
      supabase
        .from("bookings")
        .select("id")
        .eq("studio_id", studioId)
        .eq("date", lastWeekSameDayStr)
        .eq("status", "confirmed"),
      // Every class session in the last 8 weeks, with bookings and capacity
      getSessionFill(studioId, prevFillFrom, fillTo),
      // Same days of last month, for comparison
      canSeeMoney
        ? getLedgerSummary(studioId, prevMonthStart, prevMonthTo).then((s) => s.gross_sales, () => 0)
        : Promise.resolve(0),
    ])

  // Drop today's slots whose parent rule's date window doesn't cover today.
  // Rows with rule_id=NULL (legacy/manual) bypass the filter.
  const todaySchedule = (scheduleRes.data ?? []).filter((slot: Record<string, unknown>) => {
    const ruleRel = slot.schedule_rules
    const rule = Array.isArray(ruleRel) ? ruleRel[0] ?? null : (ruleRel as { starts_on: string; ends_on: string | null } | null) ?? null
    if (!rule) return true
    if (today < rule.starts_on) return false
    if (rule.ends_on && today > rule.ends_on) return false
    return true
  })
  const bookingsTodayCount = bookingsTodayRes.data?.length ?? 0
  const totalMembersCount = members.length
  const recentBookings = recentBookingsRes.data ?? []
  const { revenuePence, stripeConnected } = revenue

  // Week-over-week comparison calculations
  const bookingsLastWeekCount = bookingsLastWeekRes.data?.length ?? 0
  const prevMonthRevenuePence = prevMonthRevenue

  function percentChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0
    return Math.round(((current - previous) / previous) * 100)
  }

  const bookingsChange = bookingsLastWeekCount > 0 || bookingsTodayCount > 0
    ? { value: percentChange(bookingsTodayCount, bookingsLastWeekCount), label: "vs last week" }
    : undefined


  const revenueChange = stripeConnected && (prevMonthRevenuePence > 0 || revenuePence > 0)
    ? { value: percentChange(revenuePence, prevMonthRevenuePence), label: "vs last month" }
    : undefined

  // Active members: booked a class dated in the last 30 days, compared with
  // the same count as it stood 30 days ago
  const memberIdSet = new Set(members.map((m) => m.profile_id as string))
  const activeNow = new Set<string>()
  const activeBefore = new Set<string>()
  for (const b of recentClassBookings) {
    if (!memberIdSet.has(b.profile_id)) continue
    if (b.date >= activeFrom) activeNow.add(b.profile_id)
    else activeBefore.add(b.profile_id)
  }
  const activeMembersCount = activeNow.size
  const membersChange = activeBefore.size > 0
    ? { value: percentChange(activeNow.size, activeBefore.size), label: "vs previous 30 days" }
    : undefined

  // Class fill rate: places booked out of places offered
  const fill = summariseFill(sessionFill, fillFrom, fillTo)
  const prevFill = summariseFill(sessionFill, prevFillFrom, prevFillTo)
  const fillPct = fill.rate !== null ? Math.round(fill.rate * 100) : null
  const fillChange = fill.rate !== null && prevFill.rate !== null
    ? { value: fillPct! - Math.round(prevFill.rate * 100), label: "vs previous 4 weeks", unit: " pts" }
    : undefined

  // Get booking counts per schedule slot for today
  const { data: todayBookings } = await supabase
    .from("bookings")
    .select("schedule_id")
    .eq("studio_id", studioId)
    .eq("date", today)
    .eq("status", "confirmed")

  const bookingsBySlot: Record<string, number> = {}
  for (const b of todayBookings ?? []) {
    bookingsBySlot[b.schedule_id] = (bookingsBySlot[b.schedule_id] ?? 0) + 1
  }

  // Onboarding checklist
  const studioInfo = studioRes.data
  const showOnboarding =
    role &&
    ADMIN_ROLES.includes(role) &&
    !studioInfo?.onboarding_dismissed

  const onboardingItems = showOnboarding
    ? [
        { label: "Add your first class", href: "/dashboard/classes", completed: (classesCountRes.data?.length ?? 0) > 0 },
        { label: "Set up your timetable", href: "/dashboard/timetable", completed: (scheduleCountRes.data?.length ?? 0) > 0 },
        { label: "Connect Stripe", href: "/dashboard/settings", completed: studioInfo?.stripe_onboarding_complete ?? false },
        { label: "Invite your team", href: "/dashboard/team", completed: (teamCountRes.data?.length ?? 0) > 1 },
      ]
    : null

  return (
    <>
      <PageHeader
        title={`${getGreeting()}, ${firstName}`}
        description={`Here\u2019s what\u2019s happening at your studio today.`}
      />

      {/* Bookings held against a class that no longer renders anywhere. Above
          the onboarding checklist and the stats: these members have paid and
          are expecting to turn up. */}
      <StrandedBookingsBanner stranded={stranded} />

      {/* Onboarding checklist */}
      {onboardingItems && onboardingItems.some((i) => !i.completed) && (
        <OnboardingChecklist items={onboardingItems} />
      )}

      {/* Stat cards */}
      <div className="mb-7 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Classes today"
          value={todaySchedule.length}
          subtitle={now.toLocaleDateString("en-GB", {
            timeZone: "Europe/London",
            weekday: "short",
            day: "numeric",
            month: "long",
          })}
        />
        <StatCard
          label="Bookings today"
          value={bookingsTodayCount}
          subtitle={bookingsTodayCount === 0 ? "No bookings yet" : undefined}
          change={bookingsChange}
        />
        <StatCard
          label="Active members"
          value={activeMembersCount}
          subtitle={
            totalMembersCount === 0
              ? "No members yet"
              : `Booked in the last ${ACTIVE_WINDOW_DAYS} days`
          }
          change={membersChange}
        />
        {canSeeMoney && <StatCard
          label="Sales this month"
          value={revenuePence > 0 ? `\u00A3${formatPence(revenuePence)}` : "\u00A30"}
          subtitle={
            !stripeConnected
              ? "Connect Stripe to track revenue"
              : revenuePence === 0
                ? "No revenue yet"
                : "Card sales, before fees and refunds"
          }
          change={revenueChange}
        />}
        <StatCard
          label="Class fill rate"
          value={fillPct !== null ? `${fillPct}%` : "--"}
          subtitle={
            fill.sessions === 0
              ? "No classes in the last 4 weeks"
              : `${fill.booked} of ${fill.capacity} places, last 4 weeks`
          }
          change={fillChange}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        {/* Today's timetable */}
        <div className="overflow-hidden rounded-2xl border border-sand bg-white">
          <div className="flex items-center justify-between border-b border-sand px-5 py-4">
            <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
              Today&apos;s classes
            </h3>
            <a
              href="/dashboard/timetable"
              className="text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-gold hover:text-ember"
            >
              View full timetable
            </a>
          </div>
          <div>
            {todaySchedule.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="No classes today"
                description="There are no classes scheduled for today."
              />
            ) : (
              todaySchedule.map((slot: Record<string, unknown>) => {
                const cls = slot.classes as unknown as { name: string; slug: string; price_pence: number; capacity?: number }
                const instructor = slot.instructors as unknown as { name: string }
                const booked = bookingsBySlot[slot.id as string] ?? 0
                const capacity = cls.capacity ?? 10
                return (
                  <div
                    key={slot.id as string}
                    className="flex items-center gap-3 border-b border-sand/40 px-5 py-2.5 transition-colors last:border-b-0 hover:bg-cream/50"
                  >
                    <div className="min-w-[48px] text-[0.8rem] font-semibold text-cocoa">
                      {formatTime(slot.start_time as string)}
                    </div>
                    <ClassColorBar classSlug={cls.slug} />
                    <div className="flex-1">
                      <div className="text-[0.82rem] font-semibold text-cocoa">
                        {cls.name}
                      </div>
                      <div className="text-[0.7rem] text-warm-grey">
                        {instructor.name} &middot;{" "}
                        {slot.end_time && slot.start_time
                          ? `${Math.round(
                              (new Date(`2000-01-01T${slot.end_time as string}`).getTime() -
                                new Date(`2000-01-01T${slot.start_time as string}`).getTime()) /
                                60000
                            )} min`
                          : ""}{" "}
                        &middot; &pound;{formatPence(cls.price_pence)}
                      </div>
                    </div>
                    <div
                      className={`text-[0.7rem] font-semibold ${
                        booked >= capacity
                          ? "text-warm-grey"
                          : booked >= capacity * 0.7
                            ? "text-ember"
                            : "text-success"
                      }`}
                    >
                      {booked}/{capacity}
                    </div>
                    <TodayCancelButton
                      scheduleId={slot.id as string}
                      date={today}
                      className={cls.name}
                      startTime={formatTime(slot.start_time as string)}
                      bookingCount={booked}
                    />
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Activity feed */}
        <div className="overflow-hidden rounded-2xl border border-sand bg-white">
          <div className="flex items-center justify-between border-b border-sand px-5 py-4">
            <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
              Recent activity
            </h3>
          </div>
          <div>
            {recentBookings.length === 0 ? (
              <EmptyState
                icon="activity"
                title="No activity yet"
                description="Bookings will appear here."
              />
            ) : (
              recentBookings.slice(0, 10).map((booking: Record<string, unknown>) => {
                const bookingProfile = booking.profiles as unknown as { full_name: string } | null
                const schedule = booking.schedule as unknown as {
                  start_time: string
                  classes: { name: string }
                } | null
                return (
                  <div
                    key={booking.id as string}
                    className="flex gap-3 border-b border-sand/40 px-5 py-2.5 last:border-b-0"
                  >
                    <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-gold" />
                    <div>
                      <div className="text-[0.8rem] text-slate">
                        <strong className="text-cocoa">
                          {bookingProfile?.full_name ?? "Someone"}
                        </strong>{" "}
                        booked{" "}
                        {schedule?.classes?.name ?? "a class"}
                        {booking.date
                          ? ` — ${new Date(booking.date as string).toLocaleDateString(
                              "en-GB",
                              { weekday: "short", day: "numeric", month: "short" }
                            )}${schedule?.start_time ? `, ${formatTime(schedule.start_time)}` : ""}`
                          : schedule?.start_time
                            ? ` (${formatTime(schedule.start_time)})`
                            : ""}
                      </div>
                      <div className="mt-0.5 text-[0.68rem] text-warm-grey">
                        {new Date(booking.created_at as string).toLocaleDateString(
                          "en-GB",
                          {
                            timeZone: "Europe/London",
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
      <RealtimeBookingListener studioId={studioId} />
    </>
  )
}
