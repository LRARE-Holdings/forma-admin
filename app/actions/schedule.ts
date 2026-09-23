"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { notifyInstructorScheduleChange } from "@/lib/email/schedule-notifications"
import { getSlotRemovalImpact } from "@/lib/schedule-integrity"
import { cancelClassInstance } from "./class-cancellation"

export async function createScheduleSlot(formData: FormData) {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const class_id = formData.get("class_id") as string
  const instructor_id = formData.get("instructor_id") as string
  const day_of_week = parseInt(formData.get("day_of_week") as string)
  const start_time = formData.get("start_time") as string
  const end_time = formData.get("end_time") as string

  const { error } = await supabase.from("schedule").insert({
    studio_id: studioId,
    class_id,
    instructor_id,
    day_of_week,
    start_time,
    end_time,
  })

  if (error) throw new Error(error.message)

  // Notify instructor (fire-and-forget)
  const { data: cls } = await supabase
    .from("classes")
    .select("name")
    .eq("id", class_id)
    .single()

  notifyInstructorScheduleChange(studioId, instructor_id, "assigned", {
    className: cls?.name ?? "a class",
    dayOfWeek: day_of_week,
    startTime: start_time,
  }).catch((err) => console.error("[schedule] Notification failed:", err))

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}

export async function updateScheduleSlot(slotId: string, formData: FormData) {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Fetch old slot for comparison
  const { data: oldSlot } = await supabase
    .from("schedule")
    .select("instructor_id, day_of_week, start_time, class_id, classes:class_id(name)")
    .eq("id", slotId)
    .eq("studio_id", studioId)
    .single()

  const class_id = formData.get("class_id") as string
  const instructor_id = formData.get("instructor_id") as string
  const day_of_week = parseInt(formData.get("day_of_week") as string)
  const start_time = formData.get("start_time") as string
  const end_time = formData.get("end_time") as string

  const { error } = await supabase
    .from("schedule")
    .update({ class_id, instructor_id, day_of_week, start_time, end_time })
    .eq("id", slotId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)

  // Get new class name for notification
  const { data: cls } = await supabase
    .from("classes")
    .select("name")
    .eq("id", class_id)
    .single()

  const className = cls?.name ?? "a class"

  if (oldSlot) {
    if (oldSlot.instructor_id !== instructor_id) {
      // Instructor changed — notify old (removed) and new (assigned)
      const oldClassName = (oldSlot.classes as unknown as { name: string })?.name ?? className
      notifyInstructorScheduleChange(studioId, oldSlot.instructor_id, "removed", {
        className: oldClassName,
        dayOfWeek: oldSlot.day_of_week,
        startTime: oldSlot.start_time,
      }).catch((err) => console.error("[schedule] Notification failed:", err))

      notifyInstructorScheduleChange(studioId, instructor_id, "assigned", {
        className,
        dayOfWeek: day_of_week,
        startTime: start_time,
      }).catch((err) => console.error("[schedule] Notification failed:", err))
    } else if (
      oldSlot.day_of_week !== day_of_week ||
      oldSlot.start_time !== start_time
    ) {
      // Same instructor, but time/day changed
      notifyInstructorScheduleChange(studioId, instructor_id, "changed", {
        className,
        dayOfWeek: day_of_week,
        startTime: start_time,
      }).catch((err) => console.error("[schedule] Notification failed:", err))
    }
  }

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}

/**
 * What removing this slot would cancel: upcoming dates that still hold
 * confirmed bookings, and how many on each. The removal dialog asks for this
 * first, so nobody deletes a class out from under eleven paying members
 * without being told that is what the button does.
 */
export async function getSlotRemovalSummary(
  slotId: string
): Promise<{ date: string; bookingCount: number }[]> {
  await requireManager()
  const studioId = await getStudioId()
  return getSlotRemovalImpact(studioId, slotId)
}

/**
 * Take a slot off the timetable.
 *
 * Switching `is_active` off hides the class from every surface at once — the
 * admin timetable, the staff schedule, the register and the public booking
 * page all filter on it. Any confirmed booking left pointing at the slot
 * therefore becomes invisible while staying perfectly valid: the member keeps
 * their confirmation email and their spent credit, and turns up to a class
 * that is on nobody's timetable and has nobody rostered to teach it.
 *
 * So the bookings are cancelled *before* the slot goes, through the normal
 * cancellation path — credits restored, drop-ins refunded, members emailed.
 * Cancelling first means a failure part-way leaves the class still visible,
 * which is the recoverable direction to fail in.
 *
 * (23 Sep 2026: four members arrived for a 10:00 Infrared Pilates whose slot
 * had been switched off a week earlier. Nobody was told, on either side.)
 *
 * Returns what it cancelled so the caller can report it rather than saying
 * "removed" over the top of six refunds.
 */
export async function deleteScheduleSlot(slotId: string): Promise<{
  cancelledCount: number
  refundedCount: number
  refundFailedCount: number
}> {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Fetch slot data before soft-delete for notification
  const { data: slot } = await supabase
    .from("schedule")
    .select("instructor_id, day_of_week, start_time, rule_id, classes:class_id(name)")
    .eq("id", slotId)
    .eq("studio_id", studioId)
    .single()

  // Cancel every future date that still holds bookings, one instance at a time.
  const impact = await getSlotRemovalImpact(studioId, slotId)

  let cancelledCount = 0
  let refundedCount = 0
  let refundFailedCount = 0

  for (const { date } of impact) {
    const result = await cancelClassInstance(
      slotId,
      date,
      "This class has been taken off the timetable"
    )
    cancelledCount += result.cancelledCount
    refundedCount += result.refundedCount
    refundFailedCount += result.refundFailedCount
  }

  const { error } = await supabase
    .from("schedule")
    .update({ is_active: false })
    .eq("id", slotId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)

  // Retire the backing rule too. There is exactly one schedule row per rule, so
  // removing the slot means removing the whole recurring class — and a rule left
  // active with no live slot renders nothing while still occupying the
  // schedule_rules_no_overlap exclusion, silently blocking that class/day/time
  // from ever being scheduled again.
  if (slot?.rule_id) {
    const { error: ruleError } = await supabase
      .from("schedule_rules")
      .update({ is_active: false })
      .eq("id", slot.rule_id)
      .eq("studio_id", studioId)

    if (ruleError) throw new Error(ruleError.message)
  }

  // Notify instructor (fire-and-forget)
  if (slot) {
    const cls = slot.classes as unknown as { name: string } | null
    notifyInstructorScheduleChange(studioId, slot.instructor_id, "removed", {
      className: cls?.name ?? "a class",
      dayOfWeek: slot.day_of_week,
      startTime: slot.start_time,
    }).catch((err) => console.error("[schedule] Notification failed:", err))
  }

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
  revalidatePath("/staff")

  return { cancelledCount, refundedCount, refundFailedCount }
}
