import Link from "next/link"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { formatPence, localDateStr } from "@/lib/utils"
import { addDays } from "@/lib/member-activity"
import { formatUkDate } from "@/lib/money-periods"
import { getSessionFill, summariseFill, fillBy } from "@/lib/fill-rate"
import { getStudioStripeAccount } from "@/lib/stripe/account"
import { getLedgerSummary, getWeeklySales, salesByCategory } from "@/lib/money"
import {
  getAttendanceStats,
  getEventStats,
  getPackStats,
  getRetention,
  LATE_CANCEL_RULE_FROM,
} from "@/lib/insights"
import { PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { FillGrid } from "@/components/dashboard/insights/fill-grid"
import { WeeklyRevenueChart } from "@/components/dashboard/analytics/weekly-revenue-chart"
import { RevenueByClass } from "@/components/dashboard/analytics/revenue-by-class"

export const dynamic = "force-dynamic"

const RANGES = [4, 8, 12, 26] as const
const gbp = (pence: number) => `£${formatPence(pence)}`
const pct = (rate: number | null) => (rate === null ? "--" : `${Math.round(rate * 100)}%`)
const monthLabel = (ym: string) =>
  new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" })

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-sand bg-white">
      <div className="border-b border-sand px-5 py-4">
        <h3 className="font-heading text-[1.05rem] font-semibold text-cocoa">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[0.7rem] text-warm-grey">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                className={`border-b border-sand bg-cream px-5 py-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey ${i === 0 ? "text-left" : "text-right"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-sand/50 last:border-b-0">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={`px-5 py-2.5 text-[0.82rem] ${j === 0 ? "text-cocoa" : "text-right tabular-nums text-slate"}`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Tiles({ tiles }: { tiles: Array<{ label: string; value: string; detail?: string }> }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-sand sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {tiles.map((t) => (
        <div key={t.label} className="px-5 py-4">
          <div className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">{t.label}</div>
          <div className="mt-1 font-heading text-[1.5rem] text-cocoa">{t.value}</div>
          {t.detail && <div className="mt-0.5 text-[0.7rem] text-warm-grey">{t.detail}</div>}
        </div>
      ))}
    </div>
  )
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>
}) {
  await requireAdmin()
  const studioId = await getStudioId()
  const today = localDateStr()

  const requested = Number((await searchParams).weeks)
  const weeks = (RANGES as readonly number[]).includes(requested) ? requested : 8
  // Completed days only, so today's half-run classes don't skew anything
  const to = addDays(today, -1)
  const from = addDays(today, -7 * weeks)
  const prevTo = addDays(from, -1)
  const prevFrom = addDays(from, -7 * weeks)

  // Mon–Sun weeks for the sales chart, ending with the current week
  const jsDow = new Date(today + "T12:00:00Z").getUTCDay()
  const thisMonday = addDays(today, jsDow === 0 ? -6 : 1 - jsDow)
  const mondays = Array.from({ length: weeks }, (_, i) => addDays(thisMonday, -7 * (weeks - 1 - i)))

  const stripeAccount = await getStudioStripeAccount()
  const [sessions, attendance, packs, retention, events, weeklySales, salesSummary] = await Promise.all([
    getSessionFill(studioId, prevFrom, to),
    getAttendanceStats(studioId, from, to),
    getPackStats(studioId, from, to),
    getRetention(studioId, today),
    getEventStats(studioId, addDays(today, -365)),
    stripeAccount ? getWeeklySales(studioId, mondays) : Promise.resolve([]),
    stripeAccount ? getLedgerSummary(studioId, from, to) : Promise.resolve(null),
  ])

  const current = sessions.filter((s) => s.date >= from)
  const fill = summariseFill(sessions, from, to)
  const prevFill = summariseFill(sessions, prevFrom, prevTo)
  const fillChange =
    fill.rate !== null && prevFill.rate !== null
      ? { value: Math.round(fill.rate * 100) - Math.round(prevFill.rate * 100), label: `vs previous ${weeks} weeks`, unit: " pts" }
      : undefined
  const byClass = fillBy(current, (s) => s.className)
  const byInstructor = fillBy(current, (s) => s.instructorName)

  const markedShare = attendance.booked > 0 ? attendance.marked / attendance.booked : null
  const attendedRate = attendance.marked > 0 ? attendance.attended / attendance.marked : null
  const noShowRate = attendance.marked > 0 ? attendance.noShows / attendance.marked : null

  const completeCohorts = retention.cohorts.filter((c) => c.complete && c.newMembers > 0)
  const recentCohort = completeCohorts[completeCohorts.length - 1]

  return (
    <>
      <PageHeader
        title="Insights"
        description={`${formatUkDate(from)} to ${formatUkDate(to)}. For sales, fees and payouts by period, see Money.`}
        action={
          <div className="flex rounded-lg border border-sand p-0.5 text-[0.75rem] font-semibold" role="group" aria-label="Period">
            {RANGES.map((w) => (
              <Link
                key={w}
                href={`/dashboard/analytics?weeks=${w}`}
                aria-current={w === weeks ? "page" : undefined}
                className={`rounded-md px-2.5 py-1 transition-colors ${w === weeks ? "bg-cream text-cocoa" : "text-warm-grey hover:text-cocoa"}`}
              >
                {w} wks
              </Link>
            ))}
          </div>
        }
      />

      <div className="mb-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Class fill rate"
          value={pct(fill.rate)}
          subtitle={`${fill.booked} of ${fill.capacity} places, ${fill.sessions} classes`}
          change={fillChange}
        />
        <StatCard
          label="Attendance"
          value={pct(attendedRate)}
          subtitle={markedShare === null ? "No classes yet" : `Of the ${pct(markedShare)} of bookings marked`}
        />
        <StatCard
          label="No-shows"
          value={attendance.noShows}
          subtitle={noShowRate === null ? "Mark attendance to track" : `${pct(noShowRate)} of marked bookings`}
        />
        <StatCard
          label="Late cancels"
          value={attendance.lateCancels}
          subtitle={
            attendance.lateCancelsKept > 0
              ? `${gbp(attendance.keptPence)} kept from ${attendance.lateCancelsKept} since ${formatUkDate(LATE_CANCEL_RULE_FROM)}`
              : attendance.untimedCancels > 0
                ? `Within 24 hours, of ${attendance.cancels - attendance.untimedCancels} cancels with a time (recorded since 21 Sep)`
                : `Within 24 hours, of ${attendance.cancels} member cancels`
          }
        />
      </div>

      <Section
        title="When classes fill"
        subtitle="Places booked out of places offered, by day and start time. Hover a cell for the detail."
      >
        <FillGrid sessions={current} />
      </Section>

      <div className="grid grid-cols-1 gap-x-5 lg:grid-cols-2">
        <Section title="By class">
          <Table
            head={["Class", "Classes", "Avg booked", "Full"]}
            rows={byClass.map((c) => [c.key, c.sessions, (c.booked / c.sessions).toFixed(1), pct(c.rate)])}
          />
        </Section>
        <Section title="By instructor">
          <Table
            head={["Instructor", "Classes", "Avg booked", "Full"]}
            rows={byInstructor.map((c) => [c.key, c.sessions, (c.booked / c.sessions).toFixed(1), pct(c.rate)])}
          />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-x-5 lg:grid-cols-[2fr_1fr]">
        <Section title="Weekly card sales" subtitle="Monday to Sunday, before fees and refunds">
          <div className="p-4">
            {stripeAccount ? (
              <WeeklyRevenueChart
                data={weeklySales.map((w) => ({
                  week: new Date(w.monday + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
                  revenue: w.gross,
                }))}
              />
            ) : (
              <p className="py-10 text-center text-sm text-warm-grey">Connect Stripe to see sales</p>
            )}
          </div>
        </Section>
        <Section title="Sales by type" subtitle="What members paid, this period">
          <div className="p-4">
            <RevenueByClass
              data={salesSummary ? salesByCategory(salesSummary).map((c) => ({ className: c.label, revenue: c.gross })) : []}
            />
          </div>
        </Section>
      </div>

      <Section
        title="Do new members come back?"
        subtitle={
          recentCohort
            ? `Of people whose first class was in ${monthLabel(recentCohort.month)}, ${pct(recentCohort.cameBack / recentCohort.newMembers)} came to a second within 30 days.`
            : "First-time members by month, and how many came to a second class within 30 days."
        }
      >
        <Table
          head={["First class in", "New members", "Came back", "Rate", "Active that month"]}
          rows={retention.cohorts.map((c, i) => [
            monthLabel(c.month),
            c.newMembers,
            c.complete ? c.cameBack : `${c.cameBack} so far`,
            c.newMembers === 0 ? "--" : c.complete ? pct(c.cameBack / c.newMembers) : "Too early",
            retention.monthlyActive[i].members,
          ])}
        />
      </Section>

      <Section
        title="Class packs"
        subtitle="Packs bought through Stripe, credits spent on classes held, and credits that ran out unused."
      >
        <Tiles
          tiles={[
            {
              label: "Sold",
              value: `${packs.packsSold} pack${packs.packsSold === 1 ? "" : "s"}`,
              detail: `${packs.creditsSold} credits, ${gbp(packs.soldPence)}`,
            },
            { label: "Credits used", value: String(packs.creditsUsed), detail: "On classes in this period" },
            {
              label: "Expired unused",
              value: `${packs.creditsExpired} credit${packs.creditsExpired === 1 ? "" : "s"}`,
              detail: `${packs.packsExpired} pack${packs.packsExpired === 1 ? "" : "s"}, ${gbp(packs.expiredPence)} kept`,
            },
          ]}
        />
      </Section>

      {events.length > 0 && (
        <Section title="Events" subtitle="Ticketed events in the last year and coming up">
          <Table
            head={["Event", "Date", "Tickets", "Revenue"]}
            rows={events.map((e) => [
              e.cancelled ? `${e.title} (cancelled)` : e.title,
              formatUkDate(e.date),
              e.capacity ? `${e.tickets} / ${e.capacity}` : e.tickets,
              gbp(e.revenuePence),
            ])}
          />
        </Section>
      )}
    </>
  )
}
