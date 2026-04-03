import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { formatPence, dateToDateStr, localDateStr } from "@/lib/utils"
import { PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { WeeklyRevenueChart } from "@/components/dashboard/analytics/weekly-revenue-chart"
import { BookingsComparison } from "@/components/dashboard/analytics/bookings-comparison"
import { RevenueByClass } from "@/components/dashboard/analytics/revenue-by-class"
import { getWeeklyRevenue } from "@/lib/stripe/revenue"

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const studioId = await getStudioId()

  // Calculate date ranges for bookings query (UK time)
  const today = localDateStr()
  const ukToday = new Date(today + "T12:00:00Z")
  const jsDow = ukToday.getDay()
  const mondayOffset = jsDow === 0 ? -6 : 1 - jsDow
  const thisMonday = new Date(ukToday)
  thisMonday.setDate(ukToday.getDate() + mondayOffset)

  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(thisMonday.getDate() - 7)

  const eightWeeksAgo = new Date(thisMonday)
  eightWeeksAgo.setDate(thisMonday.getDate() - 8 * 7)

  const thisSunday = new Date(thisMonday)
  thisSunday.setDate(thisMonday.getDate() + 6)

  const lastSunday = new Date(lastMonday)
  lastSunday.setDate(lastMonday.getDate() + 6)

  const toDateStr = (d: Date) => dateToDateStr(d)

  // Fetch Stripe revenue and Supabase bookings in parallel
  const [stripeRevenue, { data: bookings }] = await Promise.all([
    getWeeklyRevenue(),
    supabase
      .from("bookings")
      .select("date, payment_method, attendance_status, schedule:schedule_id(class_id, classes:class_id(name, price_pence))")
      .eq("studio_id", studioId)
      .eq("status", "confirmed")
      .gte("date", toDateStr(eightWeeksAgo))
      .lte("date", toDateStr(thisSunday)),
  ])

  const { weeklyData, totalRevenue, stripeConnected } = stripeRevenue
  const allBookings = bookings ?? []

  // --- This week vs last week bookings ---
  const thisWeekBookings = allBookings.filter(
    (b) => b.date >= toDateStr(thisMonday) && b.date <= toDateStr(thisSunday)
  ).length

  const lastWeekBookings = allBookings.filter(
    (b) => b.date >= toDateStr(lastMonday) && b.date <= toDateStr(lastSunday)
  ).length

  // --- Attendance rate ---
  const todayForAttendance = today
  const pastBookings = allBookings.filter((b) => b.date < todayForAttendance)
  const markedAttended = pastBookings.filter((b) => b.attendance_status === "attended").length
  const markedTotal = pastBookings.filter((b) => b.attendance_status !== null).length
  const attendanceRate = markedTotal > 0 ? Math.round((markedAttended / markedTotal) * 100) : null
  const noShowCount = pastBookings.filter((b) => b.attendance_status === "no_show").length
  const lateCancelCount = pastBookings.filter((b) => b.attendance_status === "late_cancel").length

  // --- Revenue by class (estimated from list prices) ---
  const classTotals: Record<string, number> = {}
  for (const b of allBookings) {
    const schedule = b.schedule as unknown as { class_id: string; classes: { name: string; price_pence: number } } | null
    if (!schedule?.classes) continue
    if (b.payment_method !== "stripe" && b.payment_method !== "pack_credit") continue

    const name = schedule.classes.name
    classTotals[name] = (classTotals[name] ?? 0) + schedule.classes.price_pence
  }

  const revenueByClass = Object.entries(classTotals)
    .map(([className, revenue]) => ({ className, revenue }))
    .sort((a, b) => b.revenue - a.revenue)

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Revenue and booking trends for the last 8 weeks."
      />

      <div className="mb-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total revenue (8 weeks)"
          value={stripeConnected ? `\u00A3${formatPence(totalRevenue)}` : "--"}
          subtitle={stripeConnected ? "Net after refunds" : "Connect Stripe to track"}
        />
        <StatCard
          label="Total bookings (8 weeks)"
          value={allBookings.length}
          subtitle="All confirmed bookings"
        />
        <StatCard
          label="Avg. per week"
          value={stripeConnected ? `\u00A3${formatPence(Math.round(totalRevenue / 8))}` : "--"}
          subtitle={stripeConnected ? "Average per week" : "Connect Stripe to track"}
        />
        <StatCard
          label="Attendance rate (8 wks)"
          value={attendanceRate !== null ? `${attendanceRate}%` : "--"}
          subtitle={
            attendanceRate !== null
              ? `${noShowCount} no-show${noShowCount !== 1 ? "s" : ""}, ${lateCancelCount} late cancel${lateCancelCount !== 1 ? "s" : ""}`
              : "Start marking attendance to track"
          }
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        {/* Weekly revenue chart */}
        <div className="overflow-hidden rounded-2xl border border-sand bg-white">
          <div className="border-b border-sand px-5 py-4">
            <h3 className="font-heading text-[1.05rem] font-semibold text-cocoa">
              Weekly revenue
            </h3>
            <p className="mt-0.5 text-[0.7rem] text-warm-grey">
              Last 8 weeks, net after Stripe fees
            </p>
          </div>
          <div className="p-4">
            {stripeConnected ? (
              <WeeklyRevenueChart data={weeklyData} />
            ) : (
              <p className="py-10 text-center text-sm text-warm-grey">
                Connect Stripe to see revenue analytics
              </p>
            )}
          </div>
        </div>

        {/* Bookings comparison + revenue by class */}
        <div className="space-y-5">
          <div className="overflow-hidden rounded-2xl border border-sand bg-white">
            <div className="border-b border-sand px-5 py-4">
              <h3 className="font-heading text-[1.05rem] font-semibold text-cocoa">
                Bookings trend
              </h3>
            </div>
            <div className="p-4">
              <BookingsComparison thisWeek={thisWeekBookings} lastWeek={lastWeekBookings} />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-sand bg-white">
            <div className="border-b border-sand px-5 py-4">
              <h3 className="font-heading text-[1.05rem] font-semibold text-cocoa">
                Revenue by class
              </h3>
              <p className="mt-0.5 text-[0.7rem] text-warm-grey">
                Estimated from list prices
              </p>
            </div>
            <div className="p-4">
              <RevenueByClass data={revenueByClass} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
