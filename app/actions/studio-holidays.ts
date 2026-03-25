"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { cancelClassInstance } from "./class-cancellation"

/**
 * Create a studio holiday. Cancels all confirmed bookings in the date range,
 * restores pack credits, and notifies affected members by email.
 */
export async function createStudioHoliday(formData: FormData): Promise<{
  holidayId: string
  totalCancelled: number
}> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const name = formData.get("name") as string
  const start_date = formData.get("start_date") as string
  const end_date = formData.get("end_date") as string

  if (!name || !start_date || !end_date) {
    throw new Error("All fields are required")
  }
  if (end_date < start_date) {
    throw new Error("End date must be on or after start date")
  }

  // Insert the holiday
  const { data: holiday, error } = await supabase
    .from("studio_holidays")
    .insert({ studio_id: studioId, name, start_date, end_date })
    .select("id")
    .single()

  if (error) throw new Error(error.message)

  // Find all confirmed bookings in the holiday date range
  const { data: bookings } = await supabase
    .from("bookings")
    .select("schedule_id, date")
    .eq("studio_id", studioId)
    .eq("status", "confirmed")
    .gte("date", start_date)
    .lte("date", end_date)

  // Cancel each unique schedule_id + date combination
  const seen = new Set<string>()
  let totalCancelled = 0

  for (const b of bookings ?? []) {
    const key = `${b.schedule_id}:${b.date}`
    if (seen.has(key)) continue
    seen.add(key)

    const result = await cancelClassInstance(
      b.schedule_id,
      b.date,
      `Studio holiday: ${name}`
    )
    totalCancelled += result.cancelledCount
  }

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")

  return { holidayId: holiday.id, totalCancelled }
}

/**
 * Delete a studio holiday. Does NOT restore already-cancelled bookings.
 */
export async function deleteStudioHoliday(holidayId: string): Promise<void> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { error } = await supabase
    .from("studio_holidays")
    .delete()
    .eq("id", holidayId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}
