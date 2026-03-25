import { createClient } from "@/lib/supabase/server"
import { getUser, getUserRole } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { getGreeting, formatTime, formatPence } from "@/lib/utils"
import { getMonthlyRevenue } from "@/lib/stripe/revenue"
import { ADMIN_ROLES } from "@/lib/types"
import { StatCard } from "@/components/shared/stat-card"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist"
import { TodayCancelButton } from "@/components/dashboard/today-cancel-button"
import { RealtimeBookingListener } from "@/components/dashboard/realtime-booking-listener"

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

  // Get current day of week (0 = Monday in our schema)
  const now = new Date()
  const jsDow = now.getDay() // 0 = Sunday
  const dow = jsDow === 0 ? 6 : jsDow - 1 // Convert to 0 = Monday

  const today = now.toISOString().split("T")[0]

  const role = await getUserRole(studioId)

  // Fetch data in parallel
  const [scheduleRes, bookingsTodayRes, membersRes, revenue, recentBookingsRes, studioRes, classesCountRes, scheduleCountRes, teamCountRes, allBookingsRes] =
    await Promise.all([
      // Today's schedule
      supabase
        .from("schedule")
        .select("*, classes(*), instructors(*)")
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
      // Active members (with profile details for at-risk section)
      supabase
        .from("studio_memberships")
        .select("profile_id, created_at, profiles:profile_id(id, full_name, email)")
        .eq("studio_id", studioId)
        .eq("role", "member"),
      // Revenue this month from Stripe
      getMonthlyRevenue(),
      // Recent bookings for activity feed
      supabase
        .from("bookings")
        .select("*, profiles:profile_id(full_name), schedule:schedule_id(start_time, classes:class_id(name))")
        .eq("studio_id", studioId)
        .order("created_at", { ascending: false })
        .limit(7),
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
      // All confirmed bookings for at-risk calculation
      supabase
        .from("bookings")
        .select("profile_id, date")
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .order("date", { ascending: false }),
    ])

  const todaySchedule = scheduleRes.data ?? []
  const bookingsTodayCount = bookingsTodayRes.data?.length ?? 0
  const membersCount = membersRes.data?.length ?? 0
  const recentBookings = recentBookingsRes.data ?? []
  const { revenuePence, stripeConnected } = revenue

  // At-risk members: no confirmed booking in 30+ days
  const memberIdSet = new Set(
    (membersRes.data ?? []).map((m: Record<string, unknown>) => m.profile_id as string)
  )

  const lastBookingByProfile: Record<string, string> = {}
  for (const b of allBookingsRes.data ?? []) {
    if (memberIdSet.has(b.profile_id) && !lastBookingByProfile[b.profile_id]) {
      lastBookingByProfile[b.profile_id] = b.date
    }
  }

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0]

  const nowMs = Date.now()
  const atRiskMembers: Array<{
    id: string
    name: string
    email: string
    lastBookingDate: string | null
    daysSinceLastBooking: number | null
  }> = []

  for (const m of membersRes.data ?? []) {
    const profile = (m as Record<string, unknown>).profiles as {
      id: string
      full_name: string | null
      email: string | null
    } | null
    if (!profile) continue
    // Skip members who joined less than 30 days ago — they're still new
    const joinedAt = (m as Record<string, unknown>).created_at as string | null
    if (joinedAt && new Date(joinedAt).getTime() > thirtyDaysAgo.getTime()) continue
    const lastDate = lastBookingByProfile[profile.id]
    if (!lastDate || lastDate < thirtyDaysAgoStr) {
      const daysSince = lastDate
        ? Math.floor(
            (nowMs - new Date(lastDate + "T00:00:00").getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : null
      atRiskMembers.push({
        id: profile.id,
        name: profile.full_name ?? "Unknown",
        email: profile.email ?? "",
        lastBookingDate: lastDate ?? null,
        daysSinceLastBooking: daysSince,
      })
    }
  }

  // Sort: longest-absent first, never-booked last
  atRiskMembers.sort((a, b) => {
    if (a.daysSinceLastBooking === null && b.daysSinceLastBooking === null) return 0
    if (a.daysSinceLastBooking === null) return 1
    if (b.daysSinceLastBooking === null) return -1
    return b.daysSinceLastBooking - a.daysSinceLastBooking
  })

  const atRiskCount = atRiskMembers.length

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
            weekday: "short",
            day: "numeric",
            month: "long",
          })}
        />
        <StatCard
          label="Bookings today"
          value={bookingsTodayCount}
          subtitle={bookingsTodayCount === 0 ? "No bookings yet" : undefined}
        />
        <StatCard
          label="Active members"
          value={membersCount}
          subtitle={membersCount === 0 ? "No members yet" : undefined}
        />
        <StatCard
          label="Revenue this month"
          value={revenuePence > 0 ? `\u00A3${formatPence(revenuePence)}` : "\u00A30"}
          subtitle={
            !stripeConnected
              ? "Connect Stripe to track revenue"
              : revenuePence === 0
                ? "No revenue yet"
                : "Net after Stripe fees"
          }
        />
        <StatCard
          label="At risk"
          value={atRiskCount}
          subtitle={
            atRiskCount === 0
              ? "All members active"
              : "No booking in 30+ days"
          }
          subtitleClassName={atRiskCount > 0 ? "text-ember" : "text-warm-grey"}
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
                description="Bookings and cancellations will appear here."
              />
            ) : (
              recentBookings.map((booking: Record<string, unknown>) => {
                const bookingProfile = booking.profiles as unknown as { full_name: string } | null
                const schedule = booking.schedule as unknown as {
                  start_time: string
                  classes: { name: string }
                } | null
                const isCancelled = booking.status === "cancelled"
                return (
                  <div
                    key={booking.id as string}
                    className="flex gap-3 border-b border-sand/40 px-5 py-2.5 last:border-b-0"
                  >
                    <div
                      className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                        isCancelled ? "bg-ember" : "bg-gold"
                      }`}
                    />
                    <div>
                      <div className="text-[0.8rem] text-slate">
                        <strong className="text-cocoa">
                          {bookingProfile?.full_name ?? "Someone"}
                        </strong>{" "}
                        {isCancelled ? "cancelled" : "booked"}{" "}
                        {schedule?.classes?.name ?? "a class"}
                        {schedule?.start_time
                          ? ` (${formatTime(schedule.start_time)})`
                          : ""}
                      </div>
                      <div className="mt-0.5 text-[0.68rem] text-warm-grey">
                        {new Date(booking.created_at as string).toLocaleDateString(
                          "en-GB",
                          {
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
      {/* At risk members */}
      {atRiskMembers.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-2xl border border-sand bg-white">
          <div className="flex items-center justify-between border-b border-sand px-5 py-4">
            <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
              At risk members
            </h3>
            <a
              href="/dashboard/members"
              className="text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-gold hover:text-ember"
            >
              View all members
            </a>
          </div>
          <div>
            {atRiskMembers.slice(0, 8).map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 border-b border-sand/40 px-5 py-2.5 last:border-b-0"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-ember/10 font-heading text-[0.7rem] font-semibold text-ember">
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.82rem] font-semibold text-cocoa">
                    {m.name}
                  </div>
                  <div className="truncate text-[0.7rem] text-warm-grey">
                    {m.email}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[0.75rem] font-semibold text-ember">
                    {m.daysSinceLastBooking !== null
                      ? `${m.daysSinceLastBooking}d ago`
                      : "Never booked"}
                  </div>
                  {m.lastBookingDate && (
                    <div className="text-[0.65rem] text-warm-grey">
                      {new Date(m.lastBookingDate + "T00:00:00").toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {atRiskMembers.length > 8 && (
            <div className="border-t border-sand px-5 py-3 text-center">
              <a
                href="/dashboard/members"
                className="text-[0.75rem] font-semibold text-gold hover:text-ember"
              >
                +{atRiskMembers.length - 8} more at risk members
              </a>
            </div>
          )}
        </div>
      )}

      <RealtimeBookingListener studioId={studioId} />
    </>
  )
}
