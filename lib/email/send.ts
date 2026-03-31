import { resend } from "./index"
import { createAdminClient } from "@/lib/supabase/admin"

interface SendOptions {
  to: string
  subject: string
  html: string
}

/**
 * Send an email branded as the studio (reads email_from / email_domain from studios table).
 * Fire-and-forget: logs errors but never throws.
 */
export async function sendStudioEmail(
  studioId: string,
  options: SendOptions
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createAdminClient()

    const { data: studio } = await supabase
      .from("studios")
      .select("name, email_from, email_domain")
      .eq("id", studioId)
      .single()

    const studioName = studio?.name ?? "Forma Studio"
    const emailFrom = studio?.email_from ?? "noreply@useforma.co.uk"
    const from = `${studioName} <${emailFrom}>`

    const { error } = await resend.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    })

    if (error) {
      console.error("[email] Resend error:", error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown email error"
    console.error("[email] Failed to send:", message)
    return { success: false, error: message }
  }
}
