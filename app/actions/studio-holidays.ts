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
  totalRefunded: number
  totalRefundFailed: number
}> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const name = formData.get("name") as string
  const start_date = formData.get("start_date") as string
  const end_date = formData.get("end_date") as string
  const rawStart = (formData.get("start_time") as string | null)?.trim() || null
  const rawEnd = (formData.get("end_time") as string | null)?.trim() || null
  // Treat an only-one-side time as all-day (avoids confusing the user) and
  // normalise HH:MM to HH:MM:SS for Postgres TIME
  const start_time = rawStart && rawEnd ? `${rawStart}:00` : null
  const end_time = rawStart && rawEnd ? `${rawEnd}:00` : null

  if (!name || !start_date || !end_date) {
    throw new Error("Name, start date and end date are required")
  }
  if (end_date < start_date) {
    throw new Error("End date must be on or after start date")
  }
  if (start_time && end_time && start_time >= end_time) {
    throw new Error("End time must be after start time")
  }

  // Insert the holiday
  const { data: holiday, error } = await supabase
    .from("studio_holidays")
    .insert({ studio_id: studioId, name, start_date, end_date, start_time, end_time })
    .select("id")
    .single()

  if (error) throw new Error(error.message)

  // Find all confirmed bookings in the holiday date range, narrowing by class
  // start_time when a partial-day window is set
  const { data: bookingsRaw } = await supabase
    .from("bookings")
    .select("schedule_id, date, schedule:schedule_id(start_time)")
    .eq("studio_id", studioId)
    .eq("status", "confirmed")
    .gte("date", start_date)
    .lte("date", end_date)

  type BookingRow = { schedule_id: string; date: string; schedule: { start_time: string } | null }
  const bookings = ((bookingsRaw ?? []) as unknown as BookingRow[]).filter((b) => {
    if (!start_time || !end_time) return true
    const slotStart = b.schedule?.start_time
    if (!slotStart) return true
    return slotStart >= start_time && slotStart < end_time
  })

  // Cancel each unique schedule_id + date combination
  const seen = new Set<string>()
  let totalCancelled = 0
  let totalRefunded = 0
  let totalRefundFailed = 0

  for (const b of bookings ?? []) {
    const key = `${b.schedule_id}:${b.date}`
    if (seen.has(key)) continue
    seen.add(key)

    const result = await cancelClassInstance(
      b.schedule_id,
      b.date,
      `Studio holiday: ${name}`,
      "holiday_cancel"
    )
    totalCancelled += result.cancelledCount
    totalRefunded += result.refundedCount
    totalRefundFailed += result.refundFailedCount
  }

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")

  return { holidayId: holiday.id, totalCancelled, totalRefunded, totalRefundFailed }
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
