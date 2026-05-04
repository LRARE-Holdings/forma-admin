import { createAdminClient } from "@/lib/supabase/admin"
import { sendStudioEmail } from "./send"
import { bookingCancellationNotificationEmail } from "./templates"
import { formatTime } from "@/lib/utils"
import type { StudioBranding } from "@/lib/types"

/**
 * Notify the instructor (and admins) that a member has cancelled their booking.
 * Mirrors sendBookingNotification for the inverse event. Fire-and-forget.
 */
export async function sendBookingCancellationNotification(
  studioId: string,
  profileId: string,
  scheduleId: string,
  date: string,
  paymentMethod: string,
  cancelledBy: "member" | "admin",
) {
  try {
    const supabase = createAdminClient()

    const [profileRes, slotRes, studioRes, adminsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", profileId)
        .single(),
      supabase
        .from("schedule")
        .select("start_time, classes:class_id(name), instructors:instructor_id(name, profile_id, profiles:profile_id(email))")
        .eq("id", scheduleId)
        .single(),
      supabase
        .from("studios")
        .select("name, branding")
        .eq("id", studioId)
        .single(),
      supabase
        .from("studio_memberships")
        .select("profiles:profile_id(full_name, email)")
        .eq("studio_id", studioId)
        .in("role", ["owner", "admin"]),
    ])

    const member = profileRes.data
    const slot = slotRes.data
    const studio = studioRes.data
    const admins = adminsRes.data

    if (!member?.email || !slot) return

    const cls = slot.classes as unknown as { name: string }
    const instructor = slot.instructors as unknown as {
      name: string
      profile_id: string | null
      profiles: { email: string | null } | null
    }

    const className = cls?.name ?? "Class"
    const branding = studio?.branding as StudioBranding | null
    const studioName = studio?.name ?? "Your studio"

    const formattedDate = new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })

    const cancelledAt = new Date().toLocaleString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })

    const memberName = member.full_name ?? "Unknown member"
    const memberEmail = member.email

    const recipients = new Map<string, string>()

    const instructorEmail = instructor?.profiles?.email
    if (instructorEmail) {
      recipients.set(instructorEmail, instructor.name?.split(" ")[0] ?? "there")
    }

    if (admins) {
      for (const row of admins) {
        const adminProfile = row.profiles as unknown as { full_name: string | null; email: string | null }
        if (adminProfile?.email && !recipients.has(adminProfile.email)) {
          recipients.set(adminProfile.email, adminProfile.full_name?.split(" ")[0] ?? "there")
        }
      }
    }

    const sends = Array.from(recipients.entries()).map(([email, recipientName]) => {
      const { subject, html } = bookingCancellationNotificationEmail({
        recipientName,
        memberName,
        memberEmail,
        className,
        date: formattedDate,
        time: formatTime(slot.start_time),
        paymentMethod,
        cancelledAt,
        cancelledBy,
        studioName,
        branding,
      })

      return sendStudioEmail(studioId, { to: email, subject, html })
    })

    await Promise.all(sends)
  } catch (err) {
    console.error("[booking-cancellation-notification] Failed to send:", err)
  }
}
