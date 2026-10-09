import { createClient } from "@/lib/supabase/server"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { ukMidnightISO } from "@/lib/utils"
import { addDays } from "@/lib/member-activity"

// Figures for the Insights page. Each function takes UK calendar dates,
// inclusive, and pages every list past PostgREST's 1,000-row cap.

/** Late member cancels have kept their money or credit since this date (migration 16). */
export const LATE_CANCEL_RULE_FROM = "2026-10-07"

export interface AttendanceStats {
  /** Confirmed bookings for classes already held. */
  booked: number
  /** Of those, how many have attendance marked. */
  marked: number
  attended: number
  noShows: number
  /** Member cancels within 24 hours of the class. */
  lateCancels: number
  /** Late cancels since the rule went live: no refund, no credit back. */
  lateCancelsKept: number
  /** What those kept late cancels had paid, in pence. */
  keptPence: number
  /** All member cancels, any notice. */
  cancels: number
  /** Member cancels with no cancel time (before 21 Sep 2026), so their notice is unknown. */
  untimedCancels: number
}

/** UK instant a class starts, from its date and "HH:MM:SS" start time. */
function classStartMs(date: string, startTime: string | null): number {
  const [h, m] = (startTime ?? "00:00").split(":").map(Number)
  return new Date(ukMidnightISO(date)).getTime() + (h * 60 + m) * 60_000
}

export async function getAttendanceStats(studioId: string, from: string, to: string): Promise<AttendanceStats> {
  const supabase = await createClient()
  const bookings = await fetchAllRows((rf, rt) =>
    supabase
      .from("bookings")
      .select("date, status, attendance_status, payment_method, cancelled_by, cancelled_at, stripe_session_id, class_pack_id, schedule:schedule_id(start_time)")
      .eq("studio_id", studioId)
      .gte("date", from)
      .lte("date", to)
      .order("id")
      .range(rf, rt),
  )

  const stats: AttendanceStats = {
    booked: 0, marked: 0, attended: 0, noShows: 0,
    lateCancels: 0, lateCancelsKept: 0, keptPence: 0, cancels: 0, untimedCancels: 0,
  }
  const keptStripe: string[] = []
  const keptPacks: string[] = []

  for (const b of bookings) {
    if (b.status === "confirmed") {
      stats.booked++
      if (b.attendance_status) stats.marked++
      if (b.attendance_status === "attended") stats.attended++
      if (b.attendance_status === "no_show") stats.noShows++
      // Marked late by staff before the rule existed
      if (b.attendance_status === "late_cancel") stats.lateCancels++
      continue
    }
    if (b.status !== "cancelled" || b.cancelled_by !== "member") continue
    stats.cancels++
    if (!b.cancelled_at) {
      stats.untimedCancels++
      continue
    }
    const start = classStartMs(b.date, (b.schedule as unknown as { start_time: string } | null)?.start_time ?? null)
    const cancelledMs = new Date(b.cancelled_at as string).getTime()
    if (cancelledMs < start - 24 * 3_600_000) continue
    stats.lateCancels++
    if (cancelledMs >= new Date(ukMidnightISO(LATE_CANCEL_RULE_FROM)).getTime()) {
      stats.lateCancelsKept++
      if (b.payment_method === "stripe" && b.stripe_session_id) keptStripe.push(b.stripe_session_id as string)
      if (b.payment_method === "pack_credit" && b.class_pack_id) keptPacks.push(b.class_pack_id as string)
    }
  }

  // Value what was kept: the drop-in's charge, or one credit of its pack.
  if (keptStripe.length > 0) {
    const { data } = await supabase
      .from("stripe_balance_transactions")
      .select("amount")
      .in("payment_intent_id", keptStripe)
      .in("type", ["charge", "payment"])
    stats.keptPence += (data ?? []).reduce((s, r) => s + (r.amount as number), 0)
  }
  if (keptPacks.length > 0) {
    const perCredit = await packCreditValues(studioId, [...new Set(keptPacks)])
    for (const id of keptPacks) stats.keptPence += perCredit.get(id) ?? 0
  }
  return stats
}

/** What one credit of each pack cost, in pence: its Stripe charge, or its tier's price. */
async function packCreditValues(studioId: string, packIds: string[]): Promise<Map<string, number>> {
  const supabase = await createClient()
  const out = new Map<string, number>()
  if (packIds.length === 0) return out
  const packs: Array<Record<string, unknown>> = []
  for (let i = 0; i < packIds.length; i += 200) {
    const { data } = await supabase
      .from("class_packs")
      .select("id, credits_total, stripe_session_id, pack_tier_id")
      .eq("studio_id", studioId)
      .in("id", packIds.slice(i, i + 200))
    packs.push(...(data ?? []))
  }
  const intents = packs.map((p) => p.stripe_session_id as string | null).filter(Boolean) as string[]
  const paid = new Map<string, number>()
  for (let i = 0; i < intents.length; i += 200) {
    const { data } = await supabase
      .from("stripe_balance_transactions")
      .select("payment_intent_id, amount")
      .in("payment_intent_id", intents.slice(i, i + 200))
      .in("type", ["charge", "payment"])
    for (const t of data ?? []) paid.set(t.payment_intent_id as string, t.amount as number)
  }
  const { data: tiers } = await supabase.from("pack_tiers").select("id, price_pence").eq("studio_id", studioId)
  const tierPrice = new Map((tiers ?? []).map((t) => [t.id as string, t.price_pence as number]))
  for (const p of packs) {
    const price = paid.get(p.stripe_session_id as string) ?? tierPrice.get(p.pack_tier_id as string)
    const total = p.credits_total as number
    if (price !== undefined && total > 0) out.set(p.id as string, Math.round(price / total))
  }
  return out
}

export interface PackStats {
  packsSold: number
  creditsSold: number
  soldPence: number
  /** Credits spent on classes held in the period. */
  creditsUsed: number
  /** Packs that expired in the period with credits left on them. */
  packsExpired: number
  creditsExpired: number
  /** What members paid for the expired credits; the studio keeps it. */
  expiredPence: number
}

export async function getPackStats(studioId: string, from: string, to: string): Promise<PackStats> {
  const supabase = await createClient()
  const start = ukMidnightISO(from)
  const end = ukMidnightISO(addDays(to, 1))

  const [sold, used, expired] = await Promise.all([
    fetchAllRows((rf, rt) =>
      supabase
        .from("class_packs")
        .select("id, credits_total, stripe_session_id")
        .eq("studio_id", studioId)
        .not("stripe_session_id", "is", null)
        .gte("purchased_at", start)
        .lt("purchased_at", end)
        .order("id")
        .range(rf, rt),
    ),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studioId)
      .eq("status", "confirmed")
      .eq("payment_method", "pack_credit")
      .gte("date", from)
      .lte("date", to),
    fetchAllRows((rf, rt) =>
      supabase
        .from("class_packs")
        .select("id, credits_remaining")
        .eq("studio_id", studioId)
        .gt("credits_remaining", 0)
        .gte("expires_at", start)
        .lt("expires_at", end)
        .order("id")
        .range(rf, rt),
    ),
  ])

  // Only packs bought through Stripe count as sold; hand-added ones weren't sales.
  const intents = sold.map((p) => p.stripe_session_id as string)
  let soldPence = 0
  for (let i = 0; i < intents.length; i += 200) {
    const { data } = await supabase
      .from("stripe_balance_transactions")
      .select("amount")
      .in("payment_intent_id", intents.slice(i, i + 200))
      .in("type", ["charge", "payment"])
    soldPence += (data ?? []).reduce((s, r) => s + (r.amount as number), 0)
  }

  const perCredit = await packCreditValues(studioId, expired.map((p) => p.id as string))
  return {
    packsSold: sold.length,
    creditsSold: sold.reduce((s, p) => s + (p.credits_total as number), 0),
    soldPence,
    creditsUsed: used.count ?? 0,
    packsExpired: expired.length,
    creditsExpired: expired.reduce((s, p) => s + (p.credits_remaining as number), 0),
    expiredPence: expired.reduce(
      (s, p) => s + (perCredit.get(p.id as string) ?? 0) * (p.credits_remaining as number),
      0,
    ),
  }
}

export interface Cohort {
  /** YYYY-MM of the member's first class */
  month: string
  newMembers: number
  /** Came to a second class within 30 days of their first */
  cameBack: number
  /** False while some of the cohort are still inside their 30 days */
  complete: boolean
}

export interface RetentionStats {
  cohorts: Cohort[]
  /** Members who came to at least one class in each month */
  monthlyActive: Array<{ month: string; members: number }>
}

/** First-class cohorts and monthly active members for the last `months` months. */
export async function getRetention(studioId: string, today: string, months = 6): Promise<RetentionStats> {
  const supabase = await createClient()
  const [bookings, members] = await Promise.all([
    fetchAllRows((rf, rt) =>
      supabase
        .from("bookings")
        .select("profile_id, date")
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .lte("date", today)
        .order("id")
        .range(rf, rt),
    ),
    fetchAllRows((rf, rt) =>
      supabase
        .from("studio_memberships")
        .select("profile_id")
        .eq("studio_id", studioId)
        .eq("role", "member")
        .order("id")
        .range(rf, rt),
    ),
  ])
  const memberIds = new Set(members.map((m) => m.profile_id as string))

  // Each member's class dates, sorted
  const dates = new Map<string, string[]>()
  for (const b of bookings) {
    if (!memberIds.has(b.profile_id)) continue
    const list = dates.get(b.profile_id) ?? []
    list.push(b.date)
    dates.set(b.profile_id, list)
  }

  const monthKeys: string[] = []
  const [y, m] = today.split("-").map(Number)
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    monthKeys.push(d.toISOString().slice(0, 7))
  }

  const cohorts = new Map(monthKeys.map((k) => [k, { month: k, newMembers: 0, cameBack: 0, complete: true }]))
  const active = new Map(monthKeys.map((k) => [k, new Set<string>()]))

  for (const [profileId, list] of dates) {
    list.sort()
    const first = list[0]
    const cohort = cohorts.get(first.slice(0, 7))
    if (cohort) {
      cohort.newMembers++
      const second = list.find((d) => d > first)
      const windowEnd = addDays(first, 30)
      if (second && second <= windowEnd) cohort.cameBack++
      else if (windowEnd > today) cohort.complete = false
    }
    for (const d of list) active.get(d.slice(0, 7))?.add(profileId)
  }

  return {
    cohorts: monthKeys.map((k) => cohorts.get(k)!),
    monthlyActive: monthKeys.map((k) => ({ month: k, members: active.get(k)!.size })),
  }
}

export interface EventStats {
  id: string
  title: string
  date: string
  capacity: number | null
  tickets: number
  revenuePence: number
  cancelled: boolean
}

/** Ticketed events from `from` onwards, including upcoming ones. */
export async function getEventStats(studioId: string, from: string): Promise<EventStats[]> {
  const supabase = await createClient()
  const { data: events } = await supabase
    .from("events")
    .select("id, title, event_date, capacity, cancelled_at")
    .eq("studio_id", studioId)
    .eq("tickets_enabled", true)
    .gte("event_date", from)
    .order("event_date", { ascending: false })
  if (!events || events.length === 0) return []

  const { data: tickets } = await supabase
    .from("event_tickets")
    .select("event_id, quantity, amount_pence, refund_amount_pence")
    .eq("studio_id", studioId)
    .eq("status", "confirmed")
    .in("event_id", events.map((e) => e.id as string))

  return events.map((e) => {
    const mine = (tickets ?? []).filter((t) => t.event_id === e.id)
    return {
      id: e.id as string,
      title: e.title as string,
      date: e.event_date as string,
      capacity: e.capacity as number | null,
      tickets: mine.reduce((s, t) => s + (t.quantity as number), 0),
      revenuePence: mine.reduce(
        (s, t) => s + (t.amount_pence as number) - ((t.refund_amount_pence as number | null) ?? 0),
        0,
      ),
      cancelled: !!e.cancelled_at,
    }
  })
}
