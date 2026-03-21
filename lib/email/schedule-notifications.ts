import { createAdminClient } from "@/lib/supabase/admin"
import { sendStudioEmail } from "./send"
import { scheduleChangeEmail } from "./templates"
import { dayName, formatTime } from "@/lib/utils"

type ChangeType = "assigned" | "changed" | "removed"

interface ScheduleDetails {
  className: string
  dayOfWeek: number
  startTime: string
}

/**
 * Notify an instructor about a schedule change. Fire-and-forget.
 * Looks up the instructor's email via profile_id, then sends the email.
 */
export async function notifyInstructorScheduleChange(
  studioId: string,
  instructorId: string,
  changeType: ChangeType,
  details: ScheduleDetails
) {
  try {
    const supabase = createAdminClient()

    // Look up instructor → profile → email
    const { data: instructor } = await supabase
      .from("instructors")
      .select("name, profile_id, profiles:profile_id(email)")
      .eq("id", instructorId)
      .single()

    if (!instructor?.profiles) return

    const profile = instructor.profiles as unknown as { email: string | null }
    if (!profile.email) return

    // Get studio name for the email
    const { data: studio } = await supabase
      .from("studios")
      .select("name")
      .eq("id", studioId)
      .single()

    const { subject, html } = scheduleChangeEmail({
      type: changeType,
      instructorName: instructor.name ?? "there",
      className: details.className,
      day: dayName(details.dayOfWeek),
      time: formatTime(details.startTime),
      studioName: studio?.name ?? "Your studio",
    })

    await sendStudioEmail(studioId, { to: profile.email, subject, html })
  } catch (err) {
    console.error("[schedule-notifications] Failed:", err)
  }
}
