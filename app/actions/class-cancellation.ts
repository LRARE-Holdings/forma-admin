"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { sendStudioEmail } from "@/lib/email/send"
import { classCancelledEmail } from "@/lib/email/templates"
import { formatTime } from "@/lib/utils"
import { issueAdminRefund } from "@/lib/stripe/refunds"
import type { StudioBranding } from "@/lib/types"

/**
 * Cancel a specific class instance (schedule_id + date).
 * Marks the slot as cancelled on the timetable, cancels all confirmed
 * bookings, restores pack credits, and notifies members.
 */
export async function cancelClassInstance(
  scheduleId: string,
  date: string,
  reason?: string,
  initiatedBy: "class_cancel" | "holiday_cancel" = "class_cancel"
): Promise<{
  cancelledCount: number
  refundedCount: number
  refundFailedCount: number
  error?: string
}> {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Get class and schedule info for the email
  const { data: slot } = await supabase
    .from("schedule")
    .select("start_time, classes:class_id(name)")
    .eq("id", scheduleId)
    .eq("studio_id", studioId)
    .single()

  if (!slot) return { cancelledCount: 0, refundedCount: 0, refundFailedCount: 0, error: "Schedule slot not found" }

  // Mark the slot as cancelled on the timetable. schedule_exceptions has a
  // UNIQUE (schedule_id, date) constraint and the type CHECK currently only
  // allows 'skip', so reuse that. Ignore conflicts: skipClassInstance and
  // createStudioHoliday may have already inserted a row before delegating here.
  await supabase
    .from("schedule_exceptions")
    .upsert(
      {
        studio_id: studioId,
        schedule_id: scheduleId,
        date,
        type: "skip",
        reason: reason ?? null,
      },
      { onConflict: "schedule_id,date", ignoreDuplicates: true }
    )

  const cls = slot.classes as unknown as { name: string }
  const className = cls?.name ?? "Class"
  const startTime = formatTime(slot.start_time)

  // Get studio name, branding, and connected Stripe account for refunds
  const { data: studio } = await supabase
    .from("studios")
    .select("name, branding, stripe_account_id, stripe_onboarding_complete")
    .eq("id", studioId)
    .single()

  const studioName = studio?.name ?? "Your studio"
  const branding = studio?.branding as StudioBranding | null
  const connectedAccountId =
    studio?.stripe_onboarding_complete && studio?.stripe_account_id
      ? (studio.stripe_account_id as string)
      : null

  // Fetch all confirmed bookings for this slot + date
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, profile_id, payment_method, stripe_session_id, profiles:profile_id(full_name, email)")
    .eq("studio_id", studioId)
    .eq("schedule_id", scheduleId)
    .eq("date", date)
    .eq("status", "confirmed")

  if (!bookings || bookings.length === 0) {
    return { cancelledCount: 0, refundedCount: 0, refundFailedCount: 0 }
  }

  const formattedDate = new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  let cancelledCount = 0
  let refundedCount = 0
  let refundFailedCount = 0

  for (const booking of bookings) {
    // Cancel the booking
    const { error: cancelError } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_by: "studio",
        cancellation_reason: reason || null,
      })
      .eq("id", booking.id)
      .eq("studio_id", studioId)

    if (cancelError) {
      console.error("[class-cancellation] Failed to cancel booking:", cancelError.message)
      continue
    }

    cancelledCount++

    // Restore pack credit if applicable
    let creditRestored = false
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

        creditRestored = true
      }
    }

    // Issue Stripe refund for drop-in payers. Memberships/comps/pack_credit
    // bookings have no charge to refund.
    let refundPence: number | null = null
    let refundFailed = false
    if (
      booking.payment_method === "stripe" &&
      booking.stripe_session_id &&
      connectedAccountId
    ) {
      const refund = await issueAdminRefund({
        stripeId: booking.stripe_session_id as string,
        connectedAccountId,
        initiatedBy,
        bookingId: booking.id,
      })

      if (refund.ok) {
        refundPence = refund.amountPence
        if (refund.amountPence > 0) refundedCount++
      } else {
        refundFailed = true
        refundFailedCount++
        console.error(
          "[class-cancellation] Refund failed for booking",
          booking.id,
          "—",
          refund.reason
        )
      }
    } else if (
      booking.payment_method === "stripe" &&
      booking.stripe_session_id &&
      !connectedAccountId
    ) {
      // Studio paid via Stripe but no connected account on file — surface to admin
      refundFailed = true
      refundFailedCount++
      console.error(
        "[class-cancellation] Cannot refund booking",
        booking.id,
        "— studio has no connected Stripe account"
      )
    }

    // Send cancellation email (fire-and-forget)
    const profile = booking.profiles as unknown as { full_name: string | null; email: string | null }
    if (profile?.email) {
      const { subject, html } = classCancelledEmail({
        memberName: profile.full_name?.split(" ")[0] ?? "there",
        className,
        date: formattedDate,
        time: startTime,
        reason: reason || undefined,
        creditRestored,
        refundPence,
        refundFailed,
        studioName,
        branding,
      })

      sendStudioEmail(studioId, { to: profile.email, subject, html }).catch((err) =>
        console.error("[class-cancellation] Email failed:", err)
      )
    }
  }

  // Also cancel any waitlist entries for this class instance
  // (don't promote — the class itself is cancelled)
  await supabase
    .from("waitlist")
    .update({ status: "cancelled" })
    .eq("studio_id", studioId)
    .eq("schedule_id", scheduleId)
    .eq("date", date)
    .in("status", ["waiting", "offered"])

  revalidatePath("/dashboard/bookings")
  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")

  return { cancelledCount, refundedCount, refundFailedCount }
}
