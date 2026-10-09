import { createClient } from "@/lib/supabase/server"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { getRangeData } from "@/lib/schedule-utils"

export interface SessionFill {
  scheduleId: string
  date: string
  booked: number
  capacity: number
  className: string
  instructorName: string
  /** 0 = Monday, matching schedule.day_of_week */
  dayOfWeek: number
  /** "HH:MM" */
  startTime: string
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
  { instructorId }: { instructorId?: string } = {},
): Promise<SessionFill[]> {
  const supabase = await createClient()

  const [{ slots }, bookings] = await Promise.all([
    getRangeData(studioId, from, to),
    fetchAllRows((rangeFrom, rangeTo) => {
      // !inner so the instructor filter drops other instructors' bookings
      // in the query, not afterwards.
      let q = supabase
        .from("bookings")
        .select("schedule_id, date, schedule:schedule_id!inner(instructor_id, day_of_week, start_time, classes:class_id(name, capacity), instructors:instructor_id(name))")
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .gte("date", from)
        .lte("date", to)
      if (instructorId) q = q.eq("schedule.instructor_id", instructorId)
      return q.order("id").range(rangeFrom, rangeTo)
    }),
  ])

  const sessions = new Map<string, SessionFill>()
  for (const s of slots) {
    if (s.isSkipped || s.isHoliday) continue
    if (instructorId && s.instructorId !== instructorId) continue
    sessions.set(`${s.scheduleId}:${s.date}`, {
      scheduleId: s.scheduleId,
      date: s.date,
      booked: 0,
      capacity: s.capacity,
      className: s.className,
      instructorName: s.instructorName,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime.slice(0, 5),
    })
  }

  for (const b of bookings) {
    const key = `${b.schedule_id}:${b.date}`
    let session = sessions.get(key)
    if (!session) {
      const schedule = b.schedule as unknown as {
        day_of_week: number
        start_time: string
        classes: { name: string; capacity: number | null } | null
        instructors: { name: string } | null
      } | null
      session = {
        scheduleId: b.schedule_id,
        date: b.date,
        booked: 0,
        capacity: schedule?.classes?.capacity ?? 10,
        className: schedule?.classes?.name ?? "Unknown class",
        instructorName: schedule?.instructors?.name ?? "Unknown",
        dayOfWeek: schedule?.day_of_week ?? 0,
        startTime: (schedule?.start_time ?? "00:00").slice(0, 5),
      }
      sessions.set(key, session)
    }
    session.booked++
  }

  return [...sessions.values()]
}

export interface FillTotals {
  booked: number
  capacity: number
  sessions: number
  rate: number | null
}

/** Places booked over places offered for sessions dated in [from, to]. */
export function summariseFill(sessions: SessionFill[], from: string, to: string): FillTotals {
  return totalFill(sessions.filter((s) => s.date >= from && s.date <= to))
}

/** Fill totals for a set of sessions, grouped by `key`, largest group first. */
export function fillBy<K extends string>(
  sessions: SessionFill[],
  key: (s: SessionFill) => K,
): Array<{ key: K } & FillTotals> {
  const groups = new Map<K, SessionFill[]>()
  for (const s of sessions) {
    const k = key(s)
    const list = groups.get(k) ?? []
    list.push(s)
    groups.set(k, list)
  }
  return [...groups.entries()]
    .map(([k, list]) => ({ key: k, ...totalFill(list) }))
    .sort((a, b) => b.sessions - a.sessions)
}

function totalFill(sessions: SessionFill[]): FillTotals {
  let booked = 0
  let capacity = 0
  let count = 0
  for (const s of sessions) {
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
