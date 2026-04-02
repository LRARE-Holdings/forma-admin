import { createAdminClient } from "@/lib/supabase/admin"
import { sendStudioEmail } from "./send"
import { bookingNotificationEmail } from "./templates"
import { formatTime } from "@/lib/utils"
import type { StudioBranding } from "@/lib/types"

/**
 * Notify the instructor (and admin, if different) about a new booking.
 * Fire-and-forget — logs errors but never throws.
 *
 * Sends one email to the instructor for the class, plus one email to every
 * admin on the studio. If the instructor is also an admin, they only get
 * one email (deduplicated by email address).
 */
export async function sendBookingNotification(
  studioId: string,
  profileId: string,
  scheduleId: string,
  date: string,
  paymentMethod: string,
) {
  try {
    const supabase = createAdminClient()

    // Fetch member, schedule+class+instructor, studio, and admin emails in parallel
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
      // All admins for this studio (owner + admin roles)
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

    const bookedAt = new Date().toLocaleString("en-GB", {
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

    // Collect unique recipients: instructor + admins, deduplicated by email
    const recipients = new Map<string, string>() // email -> first name

    // Add the instructor
    const instructorEmail = instructor?.profiles?.email
    if (instructorEmail) {
      recipients.set(instructorEmail, instructor.name?.split(" ")[0] ?? "there")
    }

    // Add all admins
    if (admins) {
      for (const row of admins) {
        const adminProfile = row.profiles as unknown as { full_name: string | null; email: string | null }
        if (adminProfile?.email && !recipients.has(adminProfile.email)) {
          recipients.set(adminProfile.email, adminProfile.full_name?.split(" ")[0] ?? "there")
        }
      }
    }

    // Send one email per unique recipient
    const sends = Array.from(recipients.entries()).map(([email, recipientName]) => {
      const { subject, html } = bookingNotificationEmail({
        recipientName,
        memberName,
        memberEmail,
        className,
        date: formattedDate,
        time: formatTime(slot.start_time),
        paymentMethod,
        bookedAt,
        studioName,
        branding,
      })

      return sendStudioEmail(studioId, { to: email, subject, html })
    })

    await Promise.all(sends)
  } catch (err) {
    console.error("[booking-notification] Failed to send:", err)
  }
}
