import Link from "next/link"
import { getInstructorForUser } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { localDateStr } from "@/lib/utils"
import { addDays } from "@/lib/member-activity"
import { formatUkDate } from "@/lib/money-periods"
import { getSessionFill, summariseFill, fillBy } from "@/lib/fill-rate"
import { getAttendanceStats } from "@/lib/insights"
import { StatCard } from "@/components/shared/stat-card"
import { FillGrid } from "@/components/dashboard/insights/fill-grid"

export const dynamic = "force-dynamic"

const RANGES = [4, 8, 12, 26] as const
const pct = (rate: number | null) => (rate === null ? "--" : `${Math.round(rate * 100)}%`)

/**
 * An instructor's own class stats. Everything is scoped to the instructor
 * linked to the signed-in user, never to an ID from the URL, and RLS only
 * lets staff read bookings for classes they teach. No money figures.
 */
export default async function InstructorInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>
}) {
  const studioId = await getStudioId()
  const instructor = await getInstructorForUser()

  if (!instructor) {
    return (
      <p className="py-12 text-center text-warm-grey">
        Your instructor profile hasn&apos;t been linked yet. Please ask your admin to connect your account.
      </p>
    )
  }

  const today = localDateStr()
  const requested = Number((await searchParams).weeks)
  const weeks = (RANGES as readonly number[]).includes(requested) ? requested : 8
  const to = addDays(today, -1)
  const from = addDays(today, -7 * weeks)
  const prevTo = addDays(from, -1)
  const prevFrom = addDays(from, -7 * weeks)

  const [sessions, attendance] = await Promise.all([
    getSessionFill(studioId, prevFrom, to, { instructorId: instructor.id }),
    getAttendanceStats(studioId, from, to, { instructorId: instructor.id }),
  ])

  const current = sessions.filter((s) => s.date >= from)
  const fill = summariseFill(sessions, from, to)
  const prevFill = summariseFill(sessions, prevFrom, prevTo)
  const fillChange =
    fill.rate !== null && prevFill.rate !== null
      ? { value: Math.round(fill.rate * 100) - Math.round(prevFill.rate * 100), label: `vs previous ${weeks} weeks`, unit: " pts" }
      : undefined
  const byClass = fillBy(current, (s) => s.className)
  const attendedRate = attendance.marked > 0 ? attendance.attended / attendance.marked : null

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/staff" className="text-[0.75rem] font-semibold text-gold hover:text-ember">
            &larr; Your week
          </Link>
          <h2 className="mt-1 font-heading text-[1.8rem] font-medium text-cocoa">Your class stats</h2>
          <p className="mt-0.5 text-[0.82rem] text-warm-grey">
            {formatUkDate(from)} to {formatUkDate(to)}. Only you can see these.
          </p>
        </div>
        <div className="flex rounded-lg border border-sand p-0.5 text-[0.75rem] font-semibold" role="group" aria-label="Period">
          {RANGES.map((w) => (
            <Link
              key={w}
              href={`/staff/insights?weeks=${w}`}
              aria-current={w === weeks ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 transition-colors ${w === weeks ? "bg-cream text-cocoa" : "text-warm-grey hover:text-cocoa"}`}
            >
              {w} wks
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-7 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Classes taught"
          value={fill.sessions}
          subtitle={fill.sessions > 0 ? `${(fill.booked / fill.sessions).toFixed(1)} booked on average` : undefined}
        />
        <StatCard
          label="How full"
          value={pct(fill.rate)}
          subtitle={`${fill.booked} of ${fill.capacity} places`}
          change={fillChange}
        />
        <StatCard
          label="Turned up"
          value={pct(attendedRate)}
          subtitle={
            attendance.marked > 0
              ? `${attendance.noShows} no-show${attendance.noShows === 1 ? "" : "s"}, of ${attendance.marked} marked`
              : "Mark the register to track"
          }
        />
        <StatCard
          label="People"
          value={attendance.people}
          subtitle={`${attendance.returning} came to 2 or more`}
        />
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="border-b border-sand px-5 py-4">
          <h3 className="font-heading text-[1.05rem] font-semibold text-cocoa">When your classes fill</h3>
          <p className="mt-0.5 text-[0.7rem] text-warm-grey">How full each of your regular slots has been. Hover a cell for the detail.</p>
        </div>
        <FillGrid sessions={current} />
      </div>

      {byClass.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-2xl border border-sand bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Class", "Taught", "Avg booked", "Full"].map((h, i) => (
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
              {byClass.map((c) => (
                <tr key={c.key} className="border-b border-sand/50 last:border-b-0">
                  <td className="px-5 py-2.5 text-[0.82rem] text-cocoa">{c.key}</td>
                  <td className="px-5 py-2.5 text-right text-[0.82rem] tabular-nums text-slate">{c.sessions}</td>
                  <td className="px-5 py-2.5 text-right text-[0.82rem] tabular-nums text-slate">{(c.booked / c.sessions).toFixed(1)}</td>
                  <td className="px-5 py-2.5 text-right text-[0.82rem] tabular-nums text-slate">{pct(c.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
