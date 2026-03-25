"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { cancelClassInstance } from "./class-cancellation"

/**
 * Skip a recurring class for a specific date.
 * Creates a schedule_exception record and cancels any existing bookings.
 */
export async function skipClassInstance(
  scheduleId: string,
  date: string,
  reason?: string
): Promise<{ cancelledCount: number; error?: string }> {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Insert the exception
  const { error } = await supabase.from("schedule_exceptions").insert({
    studio_id: studioId,
    schedule_id: scheduleId,
    date,
    type: "skip",
    reason: reason ?? null,
  })

  if (error) {
    if (error.code === "23505") {
      return { cancelledCount: 0, error: "This class is already skipped for this date" }
    }
    throw new Error(error.message)
  }

  // Cancel any existing bookings (handles credit restoration + member emails)
  const result = await cancelClassInstance(
    scheduleId,
    date,
    reason || "Class skipped this week"
  )

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")

  return result
}

/**
 * Undo a skip — restore a recurring class for a specific date.
 */
export async function unskipClassInstance(
  scheduleId: string,
  date: string
): Promise<void> {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { error } = await supabase
    .from("schedule_exceptions")
    .delete()
    .eq("studio_id", studioId)
    .eq("schedule_id", scheduleId)
    .eq("date", date)

  if (error) throw new Error(error.message)

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}
