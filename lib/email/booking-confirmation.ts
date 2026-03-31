import { createAdminClient } from "@/lib/supabase/admin"
import { sendStudioEmail } from "./send"
import { bookingConfirmationEmail } from "./templates"
import { formatTime } from "@/lib/utils"
import type { StudioBranding } from "@/lib/types"

/**
 * Send a booking confirmation email to the member. Fire-and-forget.
 * Looks up the member profile, schedule/class info, and studio branding,
 * then sends the branded email.
 */
export async function sendBookingConfirmation(
  studioId: string,
  profileId: string,
  scheduleId: string,
  date: string
) {
  try {
    const supabase = createAdminClient()

    const [profileRes, slotRes, studioRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", profileId)
        .single(),
      supabase
        .from("schedule")
        .select("start_time, classes:class_id(name)")
        .eq("id", scheduleId)
        .single(),
      supabase
        .from("studios")
        .select("name, branding")
        .eq("id", studioId)
        .single(),
    ])

    const profile = profileRes.data
    const slot = slotRes.data
    const studio = studioRes.data

    if (!profile?.email || !slot) return

    const cls = slot.classes as unknown as { name: string }
    const className = cls?.name ?? "Class"
    const branding = studio?.branding as StudioBranding | null

    const formattedDate = new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })

    const { subject, html } = bookingConfirmationEmail({
      memberName: profile.full_name?.split(" ")[0] ?? "there",
      className,
      date: formattedDate,
      time: formatTime(slot.start_time),
      studioName: studio?.name ?? "Your studio",
      branding,
    })

    await sendStudioEmail(studioId, { to: profile.email, subject, html })
  } catch (err) {
    console.error("[booking-confirmation] Failed to send:", err)
  }
}
