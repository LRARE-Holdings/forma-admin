"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireReception, requireManager, getUser, getUserRole } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { promoteNextInWaitlist } from "@/lib/waitlist"
import { sendStudioEmail } from "@/lib/email/send"
import { bookingCancelledEmail } from "@/lib/email/templates"
import { formatTime } from "@/lib/utils"
import type { StudioBranding } from "@/lib/types"
import { getWeekData } from "@/lib/schedule-utils"
import { sendBookingConfirmation } from "@/lib/email/booking-confirmation"
import { sendBookingNotification } from "@/lib/email/booking-notification"
import { sendBookingCancellationNotification } from "@/lib/email/booking-cancellation-notification"
import { issueAdminRefund } from "@/lib/stripe/refunds"
import type { AttendanceStatus } from "@/lib/types"
import { confirmedCount, findEligiblePack, PACK_REFUSAL } from "@/lib/booking-rules"

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

  // The date picker fires on each keystroke, so we can receive partial strings
  // ("2026-07-2") that would build "NaN-NaN-NaN" queries. Ignore anything that
  // isn't a complete YYYY-MM-DD date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return []
  }

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

/**
 * Book a member in from the dashboard. Returns `{ error }` rather than throwing
 * so the message reaches the person booking (Next.js hides thrown messages in
 * production).
 */
export async function createManualBooking(formData: FormData): Promise<{ error?: string }> {
  await requireReception()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const profile_id = formData.get("profile_id") as string
  const schedule_id = formData.get("schedule_id") as string
  const date = formData.get("date") as string
  const payment_method = formData.get("payment_method") as string

  if (!profile_id || !schedule_id || !date || !payment_method) {
    return { error: "All fields are required." }
  }

  const { data: slot } = await supabase
    .from("schedule")
    .select("class_id, classes:class_id(capacity)")
    .eq("id", schedule_id)
    .eq("studio_id", studioId)
    .maybeSingle()
  if (!slot) return { error: "That class isn't on the timetable any more." }
  const capacity = (slot.classes as unknown as { capacity: number | null } | null)?.capacity ?? 10

  // The same limit the member site enforces.
  if ((await confirmedCount(supabase, schedule_id, date)) >= capacity) {
    return { error: "This class is full." }
  }

  // Pick the pack up front but charge it only after the booking is in, so a
  // failed insert (e.g. a duplicate) never burns a credit. Same rule as the
  // member site: oldest valid pack whose tier isn't excluded from this class.
  let packId: string | null = null
  if (payment_method === "pack_credit") {
    const pack = await findEligiblePack(supabase, studioId, slot.class_id as string, profile_id)
    if (!pack.ok) return { error: PACK_REFUSAL[pack.reason] }
    packId = pack.packId
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      studio_id: studioId,
      profile_id,
      schedule_id,
      date,
      status: "confirmed",
      payment_method,
      // Recorded before the credit moves, so a later cancellation returns it to
      // the pack it actually came from instead of guessing at the member's packs.
      class_pack_id: packId,
    })
    .select("id")
    .single()

  if (error || !booking) {
    // 23505 = unique_violation on bookings_unique_confirmed: this member already
    // has a confirmed booking for this session on this date.
    if (error?.code === "23505") return { error: "This member is already booked into this session." }
    // 23514 = the pack weekly cap (Beginner's Course). Its message is written
    // for the person reading it, so pass it straight through.
    if (error?.code === "23514") return { error: error.message }
    console.error("[bookings] Manual booking failed:", error?.message)
    return { error: "Couldn't create the booking. Please try again." }
  }

  // Booking is in — now charge the pack credit. The RPC locks the pack, so two
  // simultaneous bookings can't both spend the same last credit, and it records
  // the debit against this booking in the ledger.
  if (packId) {
    const { error: creditError } = await supabase.rpc("spend_pack_credit", {
      p_pack_id: packId,
      p_booking_id: booking.id,
    })
    if (creditError) {
      // Undo rather than leave a booking nobody paid for.
      console.error("[bookings] Pack credit failed for pack", packId, "—", creditError.message)
      await supabase.from("bookings").delete().eq("id", booking.id)
      return { error: "Their pack credit couldn't be used, so they weren't booked in. Please try again." }
    }
  }

  // Emails go out after the response, and Vercel keeps the function alive
  // until they finish.
  after(async () => {
    const results = await Promise.allSettled([
      sendBookingConfirmation(studioId, profile_id, schedule_id, date),
      sendBookingNotification(studioId, profile_id, schedule_id, date, payment_method),
    ])
    for (const r of results) {
      if (r.status === "rejected") console.error("[bookings] Email failed:", r.reason)
    }
  })

  revalidatePath("/dashboard/bookings")
  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
  return {}
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

/** Fetch confirmed attendees for all slots on a given date (bulk). */
export async function getDateAttendees(
  date: string
): Promise<Record<string, SlotAttendee[]>> {
  await requireReception()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("bookings")
    .select("id, schedule_id, payment_method, attendance_status, profiles:profile_id(full_name)")
    .eq("studio_id", studioId)
    .eq("date", date)
    .eq("status", "confirmed")
    .order("created_at", { ascending: true })

  if (error) throw new Error(error.message)

  const grouped: Record<string, SlotAttendee[]> = {}
  for (const b of data ?? []) {
    const scheduleId = b.schedule_id as string
    if (!grouped[scheduleId]) grouped[scheduleId] = []
    grouped[scheduleId].push({
      id: b.id,
      full_name: (b.profiles as unknown as { full_name: string | null })?.full_name ?? null,
      payment_method: b.payment_method,
      attendance_status: (b.attendance_status as AttendanceStatus) ?? null,
    })
  }
  return grouped
}

export async function cancelBooking(bookingId: string): Promise<{ error?: string }> {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Get the booking with profile and class info for email
  const { data: booking } = await supabase
    .from("bookings")
    .select("*, profiles:profile_id(full_name, email), schedule:schedule_id(start_time, classes:class_id(name))")
    .eq("id", bookingId)
    .eq("studio_id", studioId)
    .single()

  if (!booking) return { error: "Booking not found." }
  if (booking.status === "cancelled") return { error: "This booking is already cancelled." }

  // Issue Stripe refund for drop-in payers
  let refundPence: number | null = null
  let refundFailed = false
  if (booking.payment_method === "stripe" && booking.stripe_session_id) {
    const { data: studio } = await supabase
      .from("studios")
      .select("stripe_account_id, stripe_onboarding_complete")
      .eq("id", studioId)
      .single()

    const connectedAccountId =
      studio?.stripe_onboarding_complete && studio?.stripe_account_id
        ? (studio.stripe_account_id as string)
        : null

    if (connectedAccountId) {
      const refund = await issueAdminRefund({
        stripeId: booking.stripe_session_id as string,
        connectedAccountId,
        initiatedBy: "booking_cancel",
        bookingId: booking.id,
      })
      if (refund.ok) {
        refundPence = refund.amountPence
      } else {
        refundFailed = true
        console.error("[bookings] Refund failed for booking", booking.id, "—", refund.reason)
      }
    } else {
      refundFailed = true
      console.error(
        "[bookings] Cannot refund booking",
        booking.id,
        "— studio has no connected Stripe account"
      )
    }
  }

  const { error } = await supabase
    .from("bookings")
    // 'studio' — not 'admin'. bookings_cancelled_by_check only permits
    // 'member' | 'studio', so writing 'admin' made every admin-side cancel
    // fail on a check violation *after* the credit and Stripe refund had
    // already been issued.
    .update({ status: "cancelled", cancelled_by: "studio" })
    .eq("id", bookingId)
    .eq("studio_id", studioId)

  if (error) {
    console.error("[bookings] Cancel failed for booking", bookingId, "—", error.message)
    return { error: "Couldn't cancel the booking. Please try again." }
  }

  // Return the credit. This replaces an inline block that picked the member's
  // pack with the earliest expires_at — including long-expired ones — so 263 of
  // 431 refunds landed somewhere the member could never spend them.
  //
  // The function returns the credit to the pack the booking actually charged,
  // reviving it if it has since expired, and refuses to pay out twice for the
  // same booking. That last part is what lets this call coexist with the
  // database trigger that covers cancellations made on the member site.
  let creditRestored = false
  if (booking.payment_method === "pack_credit") {
    const { data: outcome, error: creditError } = await supabase.rpc(
      "restore_pack_credit_for_booking",
      { p_booking_id: bookingId }
    )

    if (creditError) {
      console.error("[bookings] Credit restore failed for booking", bookingId, "—", creditError.message)
    } else {
      creditRestored = outcome === "refunded" || outcome === "already_refunded"
      if (!creditRestored) {
        console.warn("[bookings] Credit not restored for booking", bookingId, "—", outcome)
      }
    }
  }

  // Offer the place to the waitlist, and send the emails, after the response.
  // after() keeps the function alive until they finish; an un-awaited promise
  // can be cut off when the serverless function returns.
  after(() =>
    promoteNextInWaitlist(studioId, booking.schedule_id, booking.date).catch((err) =>
      console.error("[bookings] Waitlist promotion failed:", err)
    )
  )

  const profile = booking.profiles as unknown as { full_name: string | null; email: string | null }
  const schedule = booking.schedule as unknown as { start_time: string; classes: { name: string } } | null
  if (profile?.email && schedule) {
    const { data: studio } = await supabase
      .from("studios")
      .select("name, branding")
      .eq("id", studioId)
      .single()

    const formattedDate = new Date(booking.date + "T00:00:00").toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })

    const { subject, html } = bookingCancelledEmail({
      memberName: profile.full_name?.split(" ")[0] ?? "there",
      className: schedule.classes?.name ?? "Class",
      date: formattedDate,
      time: formatTime(schedule.start_time),
      // What actually happened, not what was assumed. The old value claimed a
      // credit was restored for every pack booking, including the ones where
      // the restore silently failed.
      creditRestored,
      refundPence,
      refundFailed,
      studioName: studio?.name ?? "Your studio",
      branding: studio?.branding as StudioBranding | null,
    })

    const to = profile.email
    after(() =>
      sendStudioEmail(studioId, { to, subject, html }).catch((err) =>
        console.error("[bookings] Cancellation email failed:", err)
      )
    )
  }

  after(() =>
    sendBookingCancellationNotification(
      studioId,
      booking.profile_id,
      booking.schedule_id,
      booking.date,
      booking.payment_method,
      "admin",
    ).catch((err) =>
      console.error("[bookings] Cancellation notification failed:", err)
    )
  )

  revalidatePath("/dashboard/bookings")
  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
  return {}
}

/** Mark attendance for a single booking. Staff can mark their own classes; reception+ can mark any. */
export async function markAttendance(
  bookingId: string,
  status: AttendanceStatus | null
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const studioId = await getStudioId()
  const user = await getUser()
  if (!user) return { error: "Please sign in again." }

  const role = await getUserRole()

  if (role === "staff") {
    // Staff: verify they are the instructor for this booking's class
    const { data: booking } = await supabase
      .from("bookings")
      .select("schedule_id, schedule:schedule_id(instructor_id, instructors:instructor_id(profile_id))")
      .eq("id", bookingId)
      .eq("studio_id", studioId)
      .single()

    if (!booking) return { error: "Booking not found." }

    const schedule = booking.schedule as unknown as {
      instructor_id: string
      instructors: { profile_id: string | null }
    }

    if (schedule.instructors.profile_id !== user.id) {
      return { error: "You can only mark attendance for your own classes." }
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

  if (error) {
    console.error("[bookings] Attendance update failed:", error.message)
    return { error: "Couldn't update attendance. Please try again." }
  }

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard/analytics")
  revalidatePath("/dashboard")
  revalidatePath("/staff")
  return {}
}
