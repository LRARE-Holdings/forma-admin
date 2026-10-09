import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { sendStudioEmail } from "./send"
import { weeklySummaryEmail, type WeeklySummaryParams } from "./templates"
import { formatUkDate } from "@/lib/money-periods"
import { formatUKPhoneDisplay } from "@/lib/phone-utils"
import { dayShort } from "@/lib/utils"
import { ACTIVE_WINDOW_DAYS, activityByProfile, addDays, isActive, isLapsed } from "@/lib/member-activity"
import { getSessionFill, summariseFill, fillBy } from "@/lib/fill-rate"
import { getAttendanceStats } from "@/lib/insights"
import { getLedgerSummary, getPayouts, salesByCategory } from "@/lib/money"
import type { StudioBranding } from "@/lib/types"

/**
 * Monday email to a studio's owners and admins: last week (Mon–Sun) in money,
 * classes and members, against the week before, plus the week ahead and the
 * regulars who went quiet. Figures come from the same functions as the Money
 * and Insights pages, so the email never disagrees with them.
 *
 * Quiet regulars use the Members page's definition (lib/member-activity.ts);
 * only people whose last booking crossed the 30-day line in the past 7 days
 * are named, so each appears once.
 */
export async function buildWeeklySummary(
  db: SupabaseClient,
  studioId: string,
  today: string,
): Promise<{ params: Omit<WeeklySummaryParams, "recipientName">; recipients: Map<string, string>; empty: boolean } | null> {
  const weekFrom = addDays(today, -7)
  const weekTo = addDays(today, -1)
  const prevFrom = addDays(today, -14)
  const prevTo = addDays(today, -8)

  const { data: studio } = await db
    .from("studios")
    .select("name, domain, branding, stripe_account_id, stripe_onboarding_complete")
    .eq("id", studioId)
    .single()
  if (!studio) return null
  const stripeConnected = !!studio.stripe_account_id && !!studio.stripe_onboarding_complete

  const [members, bookings, admins, sessions, ahead, attendance, ledger, prevLedger, payouts] = await Promise.all([
    fetchAllRows((rf, rt) =>
      db.from("studio_memberships")
        .select("profile_id, profiles:profile_id(full_name, email, phone)")
        .eq("studio_id", studioId).eq("role", "member")
        .order("id").range(rf, rt),
    ),
    fetchAllRows((rf, rt) =>
      db.from("bookings").select("profile_id, date")
        .eq("studio_id", studioId).eq("status", "confirmed")
        .order("id").range(rf, rt),
    ),
    db.from("studio_memberships").select("profiles:profile_id(full_name, email)")
      .eq("studio_id", studioId).in("role", ["owner", "admin"]),
    getSessionFill(studioId, prevFrom, weekTo, { db }),
    getSessionFill(studioId, today, addDays(today, 6), { db }),
    getAttendanceStats(studioId, weekFrom, weekTo, { db }),
    stripeConnected ? getLedgerSummary(studioId, weekFrom, weekTo, db) : Promise.resolve(null),
    stripeConnected ? getLedgerSummary(studioId, prevFrom, prevTo, db) : Promise.resolve(null),
    stripeConnected ? getPayouts(studioId, weekFrom, weekTo, db) : Promise.resolve([]),
  ])

  // Classes
  const week = summariseFill(sessions, weekFrom, weekTo)
  const prev = summariseFill(sessions, prevFrom, prevTo)
  const slots = fillBy(
    sessions.filter((s) => s.date >= weekFrom),
    (s) => `${s.className}, ${dayShort(s.dayOfWeek)} ${s.startTime}`,
  ).filter((s) => s.rate !== null)
  const byRate = [...slots].sort((a, b) => b.rate! - a.rate!)
  const asPct = (r: number | null) => (r === null ? null : Math.round(r * 100))

  // Members
  const memberIds = new Set(members.map((m) => m.profile_id as string))
  const memberBookings = bookings.filter((b) => memberIds.has(b.profile_id))
  const activity = activityByProfile(memberBookings, today)
  const firstClass = new Map<string, string>()
  for (const b of memberBookings) {
    const f = firstClass.get(b.profile_id)
    if (!f || b.date < f) firstClass.set(b.profile_id, b.date)
  }
  const firstIn = (from: string, to: string) =>
    [...firstClass.values()].filter((d) => d >= from && d <= to).length

  const crossedFrom = addDays(today, -ACTIVE_WINDOW_DAYS - 7)
  let totalLapsed = 0
  let active30 = 0
  const lapsed: Array<{ entry: WeeklySummaryParams["lapsed"][number]; sortKey: string }> = []
  for (const m of members) {
    const a = activity.get(m.profile_id as string)
    if (!a) continue
    if (isActive(a, today)) active30++
    if (!isLapsed(a, today)) continue
    totalLapsed++
    if (a.lastBookingDate! < crossedFrom) continue
    const p = m.profiles as unknown as { full_name: string | null; email: string | null; phone: string | null } | null
    lapsed.push({
      entry: {
        name: p?.full_name ?? "Unknown",
        email: p?.email ?? "",
        phone: p?.phone ? formatUKPhoneDisplay(p.phone) : "",
        lastClass: a.lastClassDate ? formatUkDate(a.lastClassDate) : "",
        classes: a.pastClasses,
      },
      sortKey: a.lastClassDate ?? "",
    })
  }
  lapsed.sort((x, y) => (x.sortKey < y.sortKey ? 1 : -1))

  const recipients = new Map<string, string>()
  for (const r of admins.data ?? []) {
    const p = r.profiles as unknown as { full_name: string | null; email: string | null } | null
    if (p?.email) recipients.set(p.email.toLowerCase(), p.full_name?.split(" ")[0] ?? "there")
  }

  const base = studio.domain ? `https://admin.${studio.domain}` : ""
  const aheadFill = summariseFill(ahead, today, addDays(today, 6))
  // "Mon 28 Sep": built by hand, as Node's en-GB short month is "Sept"
  const fmtDay = (d: string) => {
    const dow = (new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7
    return `${dayShort(dow)} ${formatUkDate(d).replace(/ \d{4}$/, "")}`
  }

  const params: Omit<WeeklySummaryParams, "recipientName"> = {
    studioName: studio.name as string,
    branding: studio.branding as StudioBranding | null,
    weekLabel: `${fmtDay(weekFrom)} to ${fmtDay(weekTo)}`,
    money: ledger
      ? {
          sales: ledger.gross_sales,
          prevSales: prevLedger?.gross_sales ?? 0,
          byType: salesByCategory(ledger)
            .filter((c) => c.sales > 0)
            .map((c) => ({ label: c.label, amount: c.gross, count: c.sales })),
          refunds: ledger.refunds,
          refundCount: ledger.by_type.reduce((s, t) => s + t.refunds, 0),
          cardFees: ledger.card_fees,
          net: ledger.net_sales,
          paidOut: ledger.payouts,
          payoutCount: payouts.length,
          payoutFees: ledger.payout_fees,
        }
      : null,
    classes: {
      held: week.sessions,
      booked: week.booked,
      capacity: week.capacity,
      fillPct: asPct(week.rate),
      prevFillPct: asPct(prev.rate),
      busiest: byRate.length ? { label: byRate[0].key, pct: asPct(byRate[0].rate)! } : null,
      quietest: byRate.length > 1 ? { label: byRate[byRate.length - 1].key, pct: asPct(byRate[byRate.length - 1].rate)! } : null,
      noShows: attendance.noShows,
      marked: attendance.marked,
      lateCancels: attendance.lateCancels,
    },
    members: {
      firstTimers: firstIn(weekFrom, weekTo),
      prevFirstTimers: firstIn(prevFrom, prevTo),
      active30,
      totalLapsed,
    },
    lapsed: lapsed.map((l) => l.entry),
    ahead: { classes: aheadFill.sessions, booked: aheadFill.booked, capacity: aheadFill.capacity },
    links: {
      money: `${base}/dashboard/money`,
      insights: `${base}/dashboard/analytics?weeks=4`,
      lapsed: `${base}/dashboard/members?filter=lapsed`,
    },
  }

  const empty = week.sessions === 0 && (ledger?.gross_sales ?? 0) === 0 && aheadFill.sessions === 0
  return { params, recipients, empty }
}

/** Build and send. Skips a studio with nothing at all to report. */
export async function sendWeeklySummary(
  studioId: string,
  today: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ sent: number; recipients: number; skipped?: string }> {
  const built = await buildWeeklySummary(createAdminClient(), studioId, today)
  if (!built) return { sent: 0, recipients: 0, skipped: "studio not found" }
  if (built.empty) return { sent: 0, recipients: 0, skipped: "nothing to report" }
  if (dryRun) return { sent: 0, recipients: built.recipients.size }

  let sent = 0
  for (const [email, firstName] of built.recipients) {
    const { subject, html } = weeklySummaryEmail({ ...built.params, recipientName: firstName })
    const res = await sendStudioEmail(studioId, { to: email, subject, html })
    if (res.success) sent++
  }
  return { sent, recipients: built.recipients.size }
}
