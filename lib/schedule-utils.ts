import { createClient } from "@/lib/supabase/server"
import type { WeekData, WeekSlot, StudioHoliday, MonthData } from "@/lib/types"

/** Format a Date as YYYY-MM-DD in local time (avoids toISOString UTC shift). */
function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

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
 * Compute which schedule slots appear within [rangeStart, rangeEnd] inclusive,
 * including skip exceptions, holidays, and booking counts. Shared by the
 * weekly and monthly views.
 */
async function getRangeData(
  studioId: string,
  rangeStartStr: string,
  rangeEndStr: string
): Promise<{ slots: WeekSlot[]; holidays: StudioHoliday[] }> {
  const supabase = await createClient()

  const rangeStart = new Date(rangeStartStr + "T00:00:00")
  const rangeEnd = new Date(rangeEndStr + "T00:00:00")

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
        .gte("date", rangeStartStr)
        .lte("date", rangeEndStr),
      supabase
        .from("studio_holidays")
        .select("*")
        .eq("studio_id", studioId)
        .lte("start_date", rangeEndStr)
        .gte("end_date", rangeStartStr),
      supabase
        .from("bookings")
        .select("schedule_id, date")
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .gte("date", rangeStartStr)
        .lte("date", rangeEndStr),
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

  /**
   * Does the holiday cover this slot? For full-day holidays (start_time/end_time
   * NULL) — yes if the date is in range. For partial-day holidays — yes only
   * if the slot's start time falls inside the window [start_time, end_time).
   */
  function isSlotInHoliday(dateStr: string, slotStart: string): boolean {
    return holidays.some((h) => {
      if (dateStr < h.start_date || dateStr > h.end_date) return false
      if (!h.start_time || !h.end_time) return true
      return slotStart >= h.start_time && slotStart < h.end_time
    })
  }

  const bookingCounts = new Map<string, number>()
  for (const b of bookingsRes.data ?? []) {
    const key = `${b.schedule_id}:${b.date}`
    bookingCounts.set(key, (bookingCounts.get(key) ?? 0) + 1)
  }

  // Vercel runs in UTC — convert to UK local time for isPast checks
  const ukParts = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).split(", ")
  // ukParts = ["01/04/2026", "18:15"]
  const [dd, mm, yyyy] = ukParts[0].split("/")
  const today = `${yyyy}-${mm}-${dd}`
  const nowTime = ukParts[1]

  // Build slots — for every (schedule, date-in-range) pair where the schedule's
  // day_of_week matches and the rule (if any) applies
  const slots: WeekSlot[] = []

  for (const entry of scheduleRes.data ?? []) {
    const dayOfWeek = entry.day_of_week as number

    // Walk through each date in range that lands on this day_of_week
    const cursor = new Date(rangeStart)
    const cursorDow = (cursor.getDay() + 6) % 7 // Convert to 0=Mon
    let daysToAdd = dayOfWeek - cursorDow
    if (daysToAdd < 0) daysToAdd += 7
    cursor.setDate(cursor.getDate() + daysToAdd)

    while (cursor <= rangeEnd) {
      const dateStr = toDateStr(cursor)

      // Check rule applicability for recurring slots
      let include = true
      if (entry.rule_id) {
        const rule = rulesById.get(entry.rule_id as string)
        if (!rule) {
          include = false
        } else if (
          !ruleAppliesToDate(
            {
              recurrence: rule.recurrence as string,
              starts_on: rule.starts_on as string,
              ends_on: (rule.ends_on as string) ?? null,
              day_of_week: rule.day_of_week as number,
            },
            dateStr
          )
        ) {
          include = false
        }
      }

      if (include) {
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
          isHoliday: isSlotInHoliday(dateStr, entry.start_time as string),
          isPast:
            dateStr < today ||
            (dateStr === today &&
              (entry.start_time as string).slice(0, 5) <= nowTime),
        })
      }

      cursor.setDate(cursor.getDate() + 7)
    }
  }

  return { slots, holidays }
}

/**
 * Compute which schedule slots appear for a given week, including
 * skip exceptions, holidays, and booking counts.
 */
export async function getWeekData(
  studioId: string,
  weekStartStr: string // YYYY-MM-DD, must be a Monday
): Promise<WeekData> {
  const weekStart = new Date(weekStartStr + "T00:00:00")
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  const weekEndStr = toDateStr(weekEnd)

  const { slots, holidays } = await getRangeData(studioId, weekStartStr, weekEndStr)

  return {
    slots,
    holidays,
    weekStart: weekStartStr,
    weekEnd: weekEndStr,
  }
}

/**
 * Compute slots for a calendar-month grid. The grid runs Monday before the 1st
 * through Sunday after the last day, so the result spans 5–6 weeks.
 */
export async function getMonthData(
  studioId: string,
  monthStr: string // YYYY-MM
): Promise<MonthData> {
  const [y, m] = monthStr.split("-").map(Number)
  const monthStart = new Date(y, m - 1, 1)
  const monthEnd = new Date(y, m, 0)

  // Grid starts on Monday before the 1st (0=Sun → -6 offset, 1=Mon → 0)
  const gridStart = new Date(monthStart)
  const dow = monthStart.getDay()
  const startOffset = dow === 0 ? -6 : 1 - dow
  gridStart.setDate(monthStart.getDate() + startOffset)

  // Grid ends on Sunday after the last day
  const gridEnd = new Date(monthEnd)
  const endDow = monthEnd.getDay()
  const endOffset = endDow === 0 ? 0 : 7 - endDow
  gridEnd.setDate(monthEnd.getDate() + endOffset)

  const gridStartStr = toDateStr(gridStart)
  const gridEndStr = toDateStr(gridEnd)

  const { slots, holidays } = await getRangeData(studioId, gridStartStr, gridEndStr)

  return {
    slots,
    holidays,
    monthStart: toDateStr(monthStart),
    monthEnd: toDateStr(monthEnd),
    gridStart: gridStartStr,
    gridEnd: gridEndStr,
  }
}
