import { createClient } from "@/lib/supabase/server"
import { localDateStr } from "@/lib/utils"

/**
 * Detection for bookings that are attached to a class nobody can see.
 *
 * `bookings.schedule_id` is a hard reference, but every surface that renders a
 * class — the admin timetable, the staff schedule, the register, the public
 * booking page — first filters `schedule.is_active = true`. So a booking whose
 * slot has been switched off stays referentially valid and completely invisible:
 * the member keeps their confirmation email and their credit is still spent,
 * while the class shows on nobody's timetable and nobody is rostered to teach it.
 *
 * Nothing errors and nothing logs. That is the whole problem with this bug
 * class, and why it needs an assertion rather than care at each call site.
 *
 * 23 Sep 2026: four members turned up to a 10:00 Infrared Pilates with no
 * instructor. Their slot (`d3784620`) had been switched off on 16 Sep when the
 * Wednesday timetable was rebuilt; the replacement slot was a new row, so the
 * register for the new one read zero and the four bookings sat on the dead one.
 */

export interface StrandedBooking {
  bookingId: string
  date: string
  profileId: string
  name: string | null
  email: string | null
  paymentMethod: string
  scheduleId: string
  className: string
  startTime: string
  endTime: string
  instructorName: string | null
  /**
   * A live slot running the same class at the same time on the same weekday,
   * whose rule window covers this booking's date. When there is one, the class
   * is still running and the booking only needs re-pointing at it — no refund,
   * no cancellation, the member simply appears on the register again.
   */
  reattachTo: { scheduleId: string; instructorName: string | null } | null
}

/**
 * Confirmed bookings from today onwards whose slot is no longer live.
 *
 * Scoped to today onwards on purpose: past strandings cannot be repaired by
 * re-pointing them, and dragging months of history into a dashboard banner
 * would bury the two rows that still matter.
 */
interface SlotRow {
  id: string
  is_active: boolean
  class_id: string
  day_of_week: number
  start_time: string
  end_time: string
  rule_id: string | null
  classes: { name: string } | null
  instructors: { name: string } | null
  schedule_rules: {
    starts_on: string
    ends_on: string | null
    is_active: boolean
  } | null
}

export async function findStrandedBookings(
  studioId: string
): Promise<StrandedBooking[]> {
  const supabase = await createClient()
  const today = localDateStr()

  // The whole slot table, live and retired. It is one row per weekly pattern —
  // tens of rows, not thousands — so pulling it whole and matching in memory is
  // cheaper than a nested filter and far easier to read.
  const [slotsRes, bookingsRes] = await Promise.all([
    supabase
      .from("schedule")
      .select(
        "id, is_active, class_id, day_of_week, start_time, end_time, rule_id, " +
          "classes:class_id(name), instructors:instructor_id(name), " +
          "schedule_rules:rule_id(starts_on, ends_on, is_active)"
      )
      .eq("studio_id", studioId),
    supabase
      .from("bookings")
      .select("id, date, profile_id, payment_method, schedule_id, profiles:profile_id(full_name, email)")
      .eq("studio_id", studioId)
      .eq("status", "confirmed")
      .gte("date", today)
      .order("date"),
  ])

  if (slotsRes.error) throw new Error(slotsRes.error.message)
  if (bookingsRes.error) throw new Error(bookingsRes.error.message)

  const slots = (slotsRes.data ?? []) as unknown as SlotRow[]
  const slotsById = new Map(slots.map((s) => [s.id, s]))
  const liveSlots = slots.filter((s) => s.is_active)

  /**
   * A live slot running the same class at the same time on the same weekday,
   * whose rule window covers this date. A slot whose rule starts next month is
   * not a home for a booking this week.
   */
  function findReplacement(
    dead: SlotRow,
    date: string
  ): { scheduleId: string; instructorName: string | null } | null {
    for (const slot of liveSlots) {
      if (slot.class_id !== dead.class_id) continue
      if (slot.day_of_week !== dead.day_of_week) continue
      if (slot.start_time !== dead.start_time) continue

      const rule = slot.schedule_rules
      if (rule) {
        if (!rule.is_active) continue
        if (date < rule.starts_on) continue
        if (rule.ends_on && date > rule.ends_on) continue
      }

      return { scheduleId: slot.id, instructorName: slot.instructors?.name ?? null }
    }
    return null
  }

  const stranded: StrandedBooking[] = []

  for (const row of bookingsRes.data ?? []) {
    const booking = row as unknown as {
      id: string
      date: string
      profile_id: string
      payment_method: string
      schedule_id: string
      profiles: { full_name: string | null; email: string | null } | null
    }

    const slot = slotsById.get(booking.schedule_id)
    // A slot that is live renders normally; one that is missing entirely is a
    // different problem (a hard delete) and is not repairable by re-pointing.
    if (!slot || slot.is_active) continue

    stranded.push({
      bookingId: booking.id,
      date: booking.date,
      profileId: booking.profile_id,
      name: booking.profiles?.full_name ?? null,
      email: booking.profiles?.email ?? null,
      paymentMethod: booking.payment_method,
      scheduleId: slot.id,
      className: slot.classes?.name ?? "Class",
      startTime: slot.start_time,
      endTime: slot.end_time,
      instructorName: slot.instructors?.name ?? null,
      reattachTo: findReplacement(slot, booking.date),
    })
  }

  return stranded
}

/**
 * Dates from today onwards that still hold confirmed bookings on a slot, with
 * a headcount each. Used before switching a slot off, so removing a class that
 * people have paid for states what it is about to do instead of doing it
 * quietly.
 */
export async function getSlotRemovalImpact(
  studioId: string,
  slotId: string
): Promise<{ date: string; bookingCount: number }[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("bookings")
    .select("date")
    .eq("studio_id", studioId)
    .eq("schedule_id", slotId)
    .eq("status", "confirmed")
    .gte("date", localDateStr())
    .order("date")

  if (error) throw new Error(error.message)

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    const d = row.date as string
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }

  return [...counts.entries()].map(([date, bookingCount]) => ({
    date,
    bookingCount,
  }))
}
