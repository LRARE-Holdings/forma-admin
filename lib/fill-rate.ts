import { createClient } from "@/lib/supabase/server"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { getRangeData } from "@/lib/schedule-utils"

export interface SessionFill {
  scheduleId: string
  date: string
  booked: number
  capacity: number
}

/**
 * Every class session that ran in [from, to] with its confirmed bookings and
 * capacity. Empty sessions count — leaving them out flatters the rate (it
 * read 59.7% that way on 8 Oct 2026).
 *
 * Sessions come from the timetable (skipped and holiday sessions excluded),
 * plus any session that has confirmed bookings but no longer appears there
 * because its slot was retired since. Those classes still ran.
 */
export async function getSessionFill(
  studioId: string,
  from: string,
  to: string,
): Promise<SessionFill[]> {
  const supabase = await createClient()

  const [{ slots }, bookings] = await Promise.all([
    getRangeData(studioId, from, to),
    fetchAllRows((rangeFrom, rangeTo) =>
      supabase
        .from("bookings")
        .select("schedule_id, date, schedule:schedule_id(classes:class_id(capacity))")
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .gte("date", from)
        .lte("date", to)
        .order("id")
        .range(rangeFrom, rangeTo),
    ),
  ])

  const sessions = new Map<string, SessionFill>()
  for (const s of slots) {
    if (s.isSkipped || s.isHoliday) continue
    sessions.set(`${s.scheduleId}:${s.date}`, {
      scheduleId: s.scheduleId,
      date: s.date,
      booked: 0,
      capacity: s.capacity,
    })
  }

  for (const b of bookings) {
    const key = `${b.schedule_id}:${b.date}`
    let session = sessions.get(key)
    if (!session) {
      const schedule = b.schedule as unknown as { classes: { capacity: number | null } | null } | null
      session = {
        scheduleId: b.schedule_id,
        date: b.date,
        booked: 0,
        capacity: schedule?.classes?.capacity ?? 10,
      }
      sessions.set(key, session)
    }
    session.booked++
  }

  return [...sessions.values()]
}

/** Places booked over places offered for sessions dated in [from, to]. */
export function summariseFill(sessions: SessionFill[], from: string, to: string) {
  let booked = 0
  let capacity = 0
  let count = 0
  for (const s of sessions) {
    if (s.date < from || s.date > to) continue
    // An overbooked class (manual add) is full, not more than full.
    booked += Math.min(s.booked, s.capacity)
    capacity += s.capacity
    count++
  }
  return {
    booked,
    capacity,
    sessions: count,
    rate: capacity > 0 ? booked / capacity : null,
  }
}
