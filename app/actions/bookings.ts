"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireReception, requireManager, getUser, getUserRole } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { promoteNextInWaitlist } from "@/lib/waitlist"
import { getWeekData } from "@/lib/schedule-utils"
import { sendBookingConfirmation } from "@/lib/email/booking-confirmation"
import type { AttendanceStatus } from "@/lib/types"

export interface SessionOption {
  scheduleId: string
  className: string
  instructorName: string
  startTime: string
  endTime: string
  bookingCount: number
  capacity: number
  isFull: boolean
}

/** Look up valid timetable sessions for a given date. */
export async function getSessionsForDate(
  dateStr: string
): Promise<SessionOption[]> {
  await requireReception()
  const studioId = await getStudioId()

  // getWeekData expects a Monday. Compute the Monday of the week containing dateStr.
  const d = new Date(dateStr + "T00:00:00")
  const dayIndex = (d.getDay() + 6) % 7 // 0=Mon
  const monday = new Date(d)
  monday.setDate(d.getDate() - dayIndex)
  const mondayStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`

  const { slots } = await getWeekData(studioId, mondayStr)

  // Filter to the requested date, exclude skipped/holiday
  return slots
    .filter((s) => s.date === dateStr && !s.isSkipped && !s.isHoliday)
    .map((s) => ({
      scheduleId: s.scheduleId,
      className: s.className,
      instructorName: s.instructorName,
      startTime: s.startTime,
      endTime: s.endTime,
      bookingCount: s.bookingCount,
      capacity: s.capacity,
      isFull: s.bookingCount >= s.capacity,
    }))
}

export async function createManualBooking(formData: FormData) {
  await requireReception()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const profile_id = formData.get("profile_id") as string
  const schedule_id = formData.get("schedule_id") as string
  const date = formData.get("date") as string
  const payment_method = formData.get("payment_method") as string

  if (!profile_id || !schedule_id || !date || !payment_method) {
    throw new Error("All fields are required")
  }

  // If paying with pack credit, decrement the member's credits
  if (payment_method === "pack_credit") {
    const { data: packs } = await supabase
      .from("class_packs")
      .select("id, credits_remaining")
      .eq("studio_id", studioId)
      .eq("profile_id", profile_id)
      .gt("credits_remaining", 0)
      .gte("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true })
      .limit(1)

    if (!packs || packs.length === 0) {
      throw new Error("This member has no available pack credits")
    }

    const pack = packs[0]
    const { error: creditError } = await supabase
      .from("class_packs")
      .update({ credits_remaining: pack.credits_remaining - 1 })
      .eq("id", pack.id)

    if (creditError) throw new Error(creditError.message)
  }

  const { error } = await supabase.from("bookings").insert({
    studio_id: studioId,
    profile_id,
    schedule_id,
    date,
    status: "confirmed",
    payment_method,
  })

  if (error) throw new Error(error.message)

  // Send booking confirmation email (fire-and-forget)
  sendBookingConfirmation(studioId, profile_id, schedule_id, date).catch((err) =>
    console.error("[bookings] Confirmation email failed:", err)
  )

  revalidatePath("/dashboard/bookings")
  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}

export interface SlotAttendee {
  id: string
  full_name: string | null
  payment_method: string
  attendance_status: AttendanceStatus | null
}

/** Fetch confirmed attendees for a specific schedule slot on a given date. */
export async function getSlotAttendees(
  scheduleId: string,
  date: string
): Promise<SlotAttendee[]> {
  await requireReception()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("bookings")
    .select("id, payment_method, attendance_status, profiles:profile_id(full_name)")
    .eq("studio_id", studioId)
    .eq("schedule_id", scheduleId)
    .eq("date", date)
    .eq("status", "confirmed")
    .order("created_at", { ascending: true })

  if (error) throw new Error(error.message)

  return (data ?? []).map((b) => ({
    id: b.id,
    full_name: (b.profiles as unknown as { full_name: string | null })?.full_name ?? null,
    payment_method: b.payment_method,
    attendance_status: (b.attendance_status as AttendanceStatus) ?? null,
  }))
}

export async function cancelBooking(bookingId: string) {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Get the booking to check payment method
  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("studio_id", studioId)
    .single()

  if (!booking) throw new Error("Booking not found")
  if (booking.status === "cancelled") throw new Error("Booking is already cancelled")

  // If was pack credit, refund the credit
  if (booking.payment_method === "pack_credit") {
    const { data: packs } = await supabase
      .from("class_packs")
      .select("id, credits_remaining, credits_total")
      .eq("studio_id", studioId)
      .eq("profile_id", booking.profile_id)
      .order("expires_at", { ascending: true })
      .limit(1)

    if (packs && packs.length > 0) {
      const pack = packs[0]
      await supabase
        .from("class_packs")
        .update({
          credits_remaining: Math.min(
            pack.credits_remaining + 1,
            pack.credits_total
          ),
        })
        .eq("id", pack.id)
    }
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", cancelled_by: "member" })
    .eq("id", bookingId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)

  // Promote next person on waitlist (fire-and-forget)
  promoteNextInWaitlist(studioId, booking.schedule_id, booking.date).catch((err) =>
    console.error("[bookings] Waitlist promotion failed:", err)
  )

  revalidatePath("/dashboard/bookings")
  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}

/** Mark attendance for a single booking. Staff can mark their own classes; reception+ can mark any. */
export async function markAttendance(
  bookingId: string,
  status: AttendanceStatus | null
) {
  const supabase = await createClient()
  const studioId = await getStudioId()
  const user = await getUser()
  if (!user) throw new Error("Not authenticated")

  const role = await getUserRole()

  if (role === "staff") {
    // Staff: verify they are the instructor for this booking's class
    const { data: booking } = await supabase
      .from("bookings")
      .select("schedule_id, schedule:schedule_id(instructor_id, instructors:instructor_id(profile_id))")
      .eq("id", bookingId)
      .eq("studio_id", studioId)
      .single()

    if (!booking) throw new Error("Booking not found")

    const schedule = booking.schedule as unknown as {
      instructor_id: string
      instructors: { profile_id: string | null }
    }

    if (schedule.instructors.profile_id !== user.id) {
      throw new Error("You can only mark attendance for your own classes")
    }
  } else {
    // Non-staff: require at least reception role
    await requireReception()
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      attendance_status: status,
      attendance_marked_at: status ? new Date().toISOString() : null,
      attendance_marked_by: status ? user.id : null,
    })
    .eq("id", bookingId)
    .eq("studio_id", studioId)
    .eq("status", "confirmed")

  if (error) throw new Error(error.message)

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard/analytics")
  revalidatePath("/dashboard")
  revalidatePath("/staff")
}
