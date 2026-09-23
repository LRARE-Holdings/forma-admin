"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import {
  findStrandedBookings,
  type StrandedBooking,
} from "@/lib/schedule-integrity"
import { cancelClassInstance } from "./class-cancellation"

/**
 * Bookings held against a class that no longer renders anywhere. See
 * `lib/schedule-integrity.ts` for why this needs checking rather than trusting.
 */
export async function getStrandedBookings(): Promise<StrandedBooking[]> {
  await requireManager()
  const studioId = await getStudioId()
  return findStrandedBookings(studioId)
}

/**
 * Move a stranded booking onto the live slot that replaced its dead one.
 *
 * The class is still running — only the row backing it changed — so the member
 * keeps their place, their payment and their credit, and simply reappears on
 * the register. Nothing is cancelled and nothing is refunded.
 *
 * The target is re-checked here rather than trusted from the client: it must
 * belong to this studio, be live, and run the same class at the same time on
 * the same weekday as the booking's date.
 */
export async function reattachStrandedBooking(
  bookingId: string,
  targetScheduleId: string
): Promise<{ error?: string }> {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, date, status, schedule_id, schedule:schedule_id(class_id, day_of_week, start_time)")
    .eq("id", bookingId)
    .eq("studio_id", studioId)
    .single()

  if (!booking) return { error: "Booking not found" }
  if (booking.status !== "confirmed") {
    return { error: "That booking is no longer confirmed" }
  }

  const from = booking.schedule as unknown as {
    class_id: string
    day_of_week: number
    start_time: string
  } | null

  const { data: target } = await supabase
    .from("schedule")
    .select("id, is_active, class_id, day_of_week, start_time, schedule_rules:rule_id(starts_on, ends_on, is_active)")
    .eq("id", targetScheduleId)
    .eq("studio_id", studioId)
    .single()

  if (!target) return { error: "That class is not on this studio's timetable" }
  if (!target.is_active) return { error: "That class is not on the timetable" }

  if (
    !from ||
    from.class_id !== target.class_id ||
    from.day_of_week !== target.day_of_week ||
    from.start_time !== target.start_time
  ) {
    return {
      error:
        "That is a different class, day or time. Cancel and rebook rather than moving it.",
    }
  }

  const rule = target.schedule_rules as unknown as
    | { starts_on: string; ends_on: string | null; is_active: boolean }
    | null
  const date = booking.date as string

  if (rule) {
    if (!rule.is_active) return { error: "That class is paused" }
    if (date < rule.starts_on || (rule.ends_on && date > rule.ends_on)) {
      return { error: "That class does not run on this booking's date" }
    }
  }

  const { error } = await supabase
    .from("bookings")
    .update({ schedule_id: targetScheduleId })
    .eq("id", bookingId)
    .eq("studio_id", studioId)

  if (error) return { error: error.message }

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard/bookings")
  revalidatePath("/staff")

  return {}
}

/**
 * Cancel a stranded booking's whole class instance when there is no live slot
 * to move it to — the class genuinely is not running. Goes through the normal
 * cancellation path, so credits come back, drop-ins are refunded and members
 * are emailed.
 */
export async function cancelStrandedInstance(
  scheduleId: string,
  date: string,
  reason?: string
): Promise<{
  cancelledCount: number
  refundedCount: number
  refundFailedCount: number
  error?: string
}> {
  await requireManager()

  const result = await cancelClassInstance(
    scheduleId,
    date,
    reason || "This class is no longer running"
  )

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/timetable")

  return result
}
