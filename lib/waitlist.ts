import { createAdminClient } from "@/lib/supabase/admin"
import { sendStudioEmail } from "@/lib/email/send"
import { waitlistOfferEmail } from "@/lib/email/templates"
import { formatTime, localDateStr } from "@/lib/utils"
import type { StudioBranding } from "@/lib/types"

const OFFER_WINDOW_MINUTES = 30

/**
 * Promote the next person on the waitlist for a given class instance.
 * Sets their status to "offered" and sends them an email with a claim link.
 */
export async function promoteNextInWaitlist(
  studioId: string,
  scheduleId: string,
  date: string
) {
  const supabase = createAdminClient()

  // Find the next waiting entry
  const { data: nextEntry } = await supabase
    .from("waitlist")
    .select("id, profile_id, claim_token")
    .eq("studio_id", studioId)
    .eq("schedule_id", scheduleId)
    .eq("date", date)
    .eq("status", "waiting")
    .order("position", { ascending: true })
    .limit(1)
    .single()

  if (!nextEntry) return // No one waiting

  const now = new Date()
  const expiresAt = new Date(now.getTime() + OFFER_WINDOW_MINUTES * 60 * 1000)

  // Update the entry to "offered"
  await supabase
    .from("waitlist")
    .update({
      status: "offered",
      offered_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .eq("id", nextEntry.id)

  // Get member info and class details for the email
  const [profileRes, slotRes, studioRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", nextEntry.profile_id)
      .single(),
    supabase
      .from("schedule")
      .select("start_time, classes:class_id(name)")
      .eq("id", scheduleId)
      .single(),
    supabase
      .from("studios")
      .select("name, domain, branding")
      .eq("id", studioId)
      .single(),
  ])

  const profile = profileRes.data
  const slot = slotRes.data
  const studio = studioRes.data

  if (!profile?.email || !slot) return

  const cls = slot.classes as unknown as { name: string }
  const branding = studio?.branding as StudioBranding | null
  const formattedDate = new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  // Build claim URL (points to burn-public)
  const publicDomain = studio?.domain ?? "burnmatstudio.co.uk"
  const claimUrl = `https://${publicDomain}/waitlist/claim/${nextEntry.claim_token}`

  const { subject, html } = waitlistOfferEmail({
    memberName: profile.full_name?.split(" ")[0] ?? "there",
    className: cls?.name ?? "Class",
    date: formattedDate,
    time: formatTime(slot.start_time),
    claimUrl,
    expiresInMinutes: OFFER_WINDOW_MINUTES,
    studioName: studio?.name ?? "Your studio",
    branding,
  })

  sendStudioEmail(studioId, { to: profile.email, subject, html }).catch((err) =>
    console.error("[waitlist] Email failed:", err)
  )
}

/**
 * Expire all unclaimed offers and promote the next person for each.
 * Called by the cron job.
 */
export async function expireUnclaimedOffers() {
  const supabase = createAdminClient()

  // Find all offered entries that have expired
  const { data: expiredOffers } = await supabase
    .from("waitlist")
    .select("id, studio_id, schedule_id, date")
    .eq("status", "offered")
    .lt("expires_at", new Date().toISOString())

  if (!expiredOffers || expiredOffers.length === 0) return

  for (const offer of expiredOffers) {
    // Mark as expired
    await supabase
      .from("waitlist")
      .update({ status: "expired" })
      .eq("id", offer.id)

    // Promote the next person
    await promoteNextInWaitlist(offer.studio_id, offer.schedule_id, offer.date)
  }
}

/**
 * Get all waitlist entries for a studio's upcoming classes.
 */
export async function getUpcomingWaitlist(studioId: string) {
  const supabase = createAdminClient()
  const today = localDateStr()

  const { data } = await supabase
    .from("waitlist")
    .select("*, profiles:profile_id(full_name, email), schedule:schedule_id(start_time, classes:class_id(name))")
    .eq("studio_id", studioId)
    .gte("date", today)
    .in("status", ["waiting", "offered"])
    .order("date", { ascending: true })
    .order("position", { ascending: true })

  return data ?? []
}
