import { createClient } from "@/lib/supabase/server"
import type { WeekData, WeekSlot, StudioHoliday } from "@/lib/types"

/**
 * Check if a recurrence rule applies to a specific date.
 */
function ruleAppliesToDate(
  rule: {
    recurrence: string
    starts_on: string
    ends_on: string | null
    day_of_week: number
  },
  dateStr: string
): boolean {
  const d = new Date(dateStr + "T00:00:00")
  const starts = new Date(rule.starts_on + "T00:00:00")
  const ends = rule.ends_on ? new Date(rule.ends_on + "T00:00:00") : null

  if (d < starts) return false
  if (ends && d > ends) return false

  if (rule.recurrence === "weekly") return true

  if (rule.recurrence === "fortnightly") {
    const diffMs = d.getTime() - starts.getTime()
    const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000))
    return diffWeeks % 2 === 0
  }

  if (rule.recurrence === "monthly") {
    // Same nth weekday of the month (e.g. 2nd Tuesday)
    const nthInMonth = Math.ceil(d.getDate() / 7)
    const nthInStart = Math.ceil(starts.getDate() / 7)
    return nthInMonth === nthInStart
  }

  return true
}

/**
 * Compute which schedule slots appear for a given week, including
 * skip exceptions, holidays, and booking counts.
 */
export async function getWeekData(
  studioId: string,
  weekStartStr: string // YYYY-MM-DD, must be a Monday
): Promise<WeekData> {
  const supabase = await createClient()

  const weekStart = new Date(weekStartStr + "T00:00:00")
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  const weekEndStr = weekEnd.toISOString().split("T")[0]

  const [scheduleRes, rulesRes, exceptionsRes, holidaysRes, bookingsRes] =
    await Promise.all([
      supabase
        .from("schedule")
        .select("*, classes(*), instructors(*)")
        .eq("studio_id", studioId)
        .eq("is_active", true)
        .order("day_of_week")
        .order("start_time"),
      supabase
        .from("schedule_rules")
        .select("*")
        .eq("studio_id", studioId)
        .eq("is_active", true),
      supabase
        .from("schedule_exceptions")
        .select("*")
        .eq("studio_id", studioId)
        .gte("date", weekStartStr)
        .lte("date", weekEndStr),
      supabase
        .from("studio_holidays")
        .select("*")
        .eq("studio_id", studioId)
        .lte("start_date", weekEndStr)
        .gte("end_date", weekStartStr),
      supabase
        .from("bookings")
        .select("schedule_id, date")
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .gte("date", weekStartStr)
        .lte("date", weekEndStr),
    ])

  // Build lookup maps
  const rulesById = new Map(
    (rulesRes.data ?? []).map((r) => [r.id as string, r])
  )

  const exceptionSet = new Set(
    (exceptionsRes.data ?? []).map(
      (e) => `${e.schedule_id}:${e.date}`
    )
  )

  const holidays = (holidaysRes.data ?? []) as StudioHoliday[]

  function isHolidayDate(dateStr: string): boolean {
    return holidays.some(
      (h) => dateStr >= h.start_date && dateStr <= h.end_date
    )
  }

  const bookingCounts = new Map<string, number>()
  for (const b of bookingsRes.data ?? []) {
    const key = `${b.schedule_id}:${b.date}`
    bookingCounts.set(key, (bookingCounts.get(key) ?? 0) + 1)
  }

  const today = new Date().toISOString().split("T")[0]

  // Build slots
  const slots: WeekSlot[] = []

  for (const entry of scheduleRes.data ?? []) {
    const dayOfWeek = entry.day_of_week as number
    const dateObj = new Date(weekStart)
    dateObj.setDate(weekStart.getDate() + dayOfWeek)
    const dateStr = dateObj.toISOString().split("T")[0]

    // Check rule applicability for recurring slots
    if (entry.rule_id) {
      const rule = rulesById.get(entry.rule_id as string)
      if (!rule) continue
      if (
        !ruleAppliesToDate(
          {
            recurrence: rule.recurrence as string,
            starts_on: rule.starts_on as string,
            ends_on: (rule.ends_on as string) ?? null,
            day_of_week: rule.day_of_week as number,
          },
          dateStr
        )
      )
        continue
    }

    const cls = entry.classes as Record<string, unknown>
    const inst = entry.instructors as Record<string, unknown>
    const key = `${entry.id}:${dateStr}`

    slots.push({
      scheduleId: entry.id as string,
      classId: cls.id as string,
      className: cls.name as string,
      classSlug: cls.slug as string,
      instructorId: inst.id as string,
      instructorName: inst.name as string,
      dayOfWeek,
      date: dateStr,
      startTime: entry.start_time as string,
      endTime: entry.end_time as string,
      pricePence: cls.price_pence as number,
      capacity: (cls.capacity as number) ?? 10,
      durationMins: (cls.duration_mins as number) ?? 60,
      ruleId: (entry.rule_id as string) ?? null,
      bookingCount: bookingCounts.get(key) ?? 0,
      isSkipped: exceptionSet.has(key),
      isHoliday: isHolidayDate(dateStr),
      isPast: dateStr < today,
    })
  }

  return {
    slots,
    holidays,
    weekStart: weekStartStr,
    weekEnd: weekEndStr,
  }
}
