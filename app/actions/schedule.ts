"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { notifyInstructorScheduleChange } from "@/lib/email/schedule-notifications"

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

export async function deleteScheduleSlot(slotId: string) {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Fetch slot data before soft-delete for notification
  const { data: slot } = await supabase
    .from("schedule")
    .select("instructor_id, day_of_week, start_time, classes:class_id(name)")
    .eq("id", slotId)
    .eq("studio_id", studioId)
    .single()

  const { error } = await supabase
    .from("schedule")
    .update({ is_active: false })
    .eq("id", slotId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)

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
}
