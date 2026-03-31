import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { formatPence, dateToDateStr } from "@/lib/utils"
import { PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { WeeklyRevenueChart } from "@/components/dashboard/analytics/weekly-revenue-chart"
import { BookingsComparison } from "@/components/dashboard/analytics/bookings-comparison"
import { RevenueByClass } from "@/components/dashboard/analytics/revenue-by-class"

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const studioId = await getStudioId()

  // Calculate date ranges
  const now = new Date()
  const jsDow = now.getDay()
  const mondayOffset = jsDow === 0 ? -6 : 1 - jsDow
  const thisMonday = new Date(now)
  thisMonday.setDate(now.getDate() + mondayOffset)

  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(thisMonday.getDate() - 7)

  const eightWeeksAgo = new Date(thisMonday)
  eightWeeksAgo.setDate(thisMonday.getDate() - 8 * 7)

  const thisSunday = new Date(thisMonday)
  thisSunday.setDate(thisMonday.getDate() + 6)

  const lastSunday = new Date(lastMonday)
  lastSunday.setDate(lastMonday.getDate() + 6)

  const toDateStr = (d: Date) => dateToDateStr(d)

  // Fetch all bookings from last 8 weeks with class info
  const { data: bookings } = await supabase
    .from("bookings")
    .select("date, payment_method, schedule:schedule_id(class_id, classes:class_id(name, price_pence))")
    .eq("studio_id", studioId)
    .eq("status", "confirmed")
    .gte("date", toDateStr(eightWeeksAgo))
    .lte("date", toDateStr(thisSunday))

  const allBookings = bookings ?? []

  // --- Weekly revenue (last 8 weeks) ---
  const weeklyMap: Record<string, number> = {}
  for (const b of allBookings) {
    const schedule = b.schedule as unknown as { class_id: string; classes: { name: string; price_pence: number } } | null
    if (!schedule?.classes) continue

    // Only count paid bookings as revenue
    if (b.payment_method !== "stripe" && b.payment_method !== "pack_credit") continue

    const bookingDate = new Date(b.date + "T00:00:00")
    // Get the Monday of that booking's week
    const bDow = bookingDate.getDay()
    const bMondayOffset = bDow === 0 ? -6 : 1 - bDow
    const bMonday = new Date(bookingDate)
    bMonday.setDate(bookingDate.getDate() + bMondayOffset)
    const weekKey = toDateStr(bMonday)

    weeklyMap[weekKey] = (weeklyMap[weekKey] ?? 0) + schedule.classes.price_pence
  }

  // Build sorted weekly data
  const weeklyData: { week: string; revenue: number }[] = []
  for (let i = 7; i >= 0; i--) {
    const weekMonday = new Date(thisMonday)
    weekMonday.setDate(thisMonday.getDate() - i * 7)
    const key = toDateStr(weekMonday)
    const label = weekMonday.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    weeklyData.push({ week: label, revenue: weeklyMap[key] ?? 0 })
  }

  // --- This week vs last week bookings ---
  const thisWeekBookings = allBookings.filter(
    (b) => b.date >= toDateStr(thisMonday) && b.date <= toDateStr(thisSunday)
  ).length

  const lastWeekBookings = allBookings.filter(
    (b) => b.date >= toDateStr(lastMonday) && b.date <= toDateStr(lastSunday)
  ).length

  // --- Revenue by class ---
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

  // --- Total revenue for the period ---
  const totalRevenue = weeklyData.reduce((sum, w) => sum + w.revenue, 0)

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Revenue and booking trends for the last 8 weeks."
      />

      <div className="mb-7 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          label="Total revenue (8 weeks)"
          value={`\u00A3${formatPence(totalRevenue)}`}
          subtitle="Paid bookings only"
        />
        <StatCard
          label="Total bookings (8 weeks)"
          value={allBookings.length}
          subtitle="All payment methods"
        />
        <StatCard
          label="Avg. per week"
          value={`\u00A3${formatPence(Math.round(totalRevenue / 8))}`}
          subtitle="Revenue average"
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
              Last 8 weeks, paid bookings only
            </p>
          </div>
          <div className="p-4">
            <WeeklyRevenueChart data={weeklyData} />
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
