import { createClient } from "@/lib/supabase/server"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { getStudioId } from "@/lib/studio-context"
import { formatPence, dateToDateStr, localDateStr } from "@/lib/utils"
import { PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { WeeklyRevenueChart } from "@/components/dashboard/analytics/weekly-revenue-chart"
import { BookingsComparison } from "@/components/dashboard/analytics/bookings-comparison"
import { RevenueByClass } from "@/components/dashboard/analytics/revenue-by-class"
import { getStudioStripeAccount } from "@/lib/stripe/account"
import { getLedgerSummary, salesByCategory } from "@/lib/money"

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

  // The 8 Mon–Sun weeks ending with this one, in UK dates
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const monday = new Date(thisMonday)
    monday.setDate(thisMonday.getDate() - (7 - i) * 7)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { from: toDateStr(monday), to: toDateStr(sunday), monday }
  })
  const rangeFrom = weeks[0].from
  const rangeTo = toDateStr(thisSunday)

  // Card sales from the Stripe ledger; bookings paged past the 1,000-row cap
  const [stripeAccount, allBookings] = await Promise.all([
    getStudioStripeAccount(),
    fetchAllRows((from, to) =>
      supabase
        .from("bookings")
        .select("date, attendance_status")
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .gte("date", rangeFrom)
        .lte("date", rangeTo)
        .order("id")
        .range(from, to),
    ),
  ])
  const stripeConnected = !!stripeAccount
  const [rangeSummary, ...weekSummaries] = stripeConnected
    ? await Promise.all([
        getLedgerSummary(studioId, rangeFrom, rangeTo),
        ...weeks.map((w) => getLedgerSummary(studioId, w.from, w.to)),
      ])
    : []

  const weeklyData = weeks.map((w, i) => ({
    week: w.monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    revenue: weekSummaries[i]?.gross_sales ?? 0,
  }))
  const totalRevenue = rangeSummary?.gross_sales ?? 0

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

  // --- Sales by type: what members actually paid, by what they bought ---
  const revenueByClass = rangeSummary
    ? salesByCategory(rangeSummary).map((c) => ({ className: c.label, revenue: c.gross }))
    : []

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Card sales and booking trends for the last 8 weeks. For accounts, use Money."
      />

      <div className="mb-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Card sales (8 weeks)"
          value={stripeConnected ? `\u00A3${formatPence(totalRevenue)}` : "--"}
          subtitle={stripeConnected ? "Before fees and refunds" : "Connect Stripe to track"}
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
              Weekly card sales
            </h3>
            <p className="mt-0.5 text-[0.7rem] text-warm-grey">
              Last 8 weeks, Monday to Sunday, before fees and refunds
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
                Sales by type
              </h3>
              <p className="mt-0.5 text-[0.7rem] text-warm-grey">
                Last 8 weeks, what members paid
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
