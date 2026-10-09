import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { sendStudioEmail } from "./send"
import { lapsedDigestEmail } from "./templates"
import { formatUkDate } from "@/lib/money-periods"
import { formatUKPhoneDisplay } from "@/lib/phone-utils"
import { ACTIVE_WINDOW_DAYS, activityByProfile, addDays, isLapsed } from "@/lib/member-activity"
import type { StudioBranding } from "@/lib/types"

/**
 * Monday email to the studio's owners and admins listing regulars who lapsed
 * in the past week: 3+ classes, nothing for 30 days, nothing booked. Only
 * people whose last booking crossed the 30-day line in the last 7 days are
 * listed, so each name appears once, the week they go quiet. Nothing is sent
 * in a week with no one new. Uses the same definition as the Members page's
 * Lapsed filter (lib/member-activity.ts).
 */
export async function sendLapsedDigest(
  studioId: string,
  today: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ lapsedThisWeek: number; totalLapsed: number; sent: number; recipients: number }> {
  const supabase = createAdminClient()

  const [members, bookings, studioRes, adminsRes] = await Promise.all([
    fetchAllRows((rf, rt) =>
      supabase
        .from("studio_memberships")
        .select("profile_id, profiles:profile_id(full_name, email, phone)")
        .eq("studio_id", studioId)
        .eq("role", "member")
        .order("id")
        .range(rf, rt),
    ),
    fetchAllRows((rf, rt) =>
      supabase
        .from("bookings")
        .select("profile_id, date")
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .order("id")
        .range(rf, rt),
    ),
    supabase.from("studios").select("name, domain, branding").eq("id", studioId).single(),
    supabase
      .from("studio_memberships")
      .select("profiles:profile_id(full_name, email)")
      .eq("studio_id", studioId)
      .in("role", ["owner", "admin"]),
  ])

  const activity = activityByProfile(bookings, today)
  // Lapsed, and their last booking was 31–37 days ago: they crossed this week.
  const crossedFrom = addDays(today, -ACTIVE_WINDOW_DAYS - 7)

  let totalLapsed = 0
  const thisWeek: Array<{ name: string; email: string; phone: string; lastClass: string; classes: number; sortKey: string }> = []
  for (const m of members) {
    const a = activity.get(m.profile_id as string)
    if (!a || !isLapsed(a, today)) continue
    totalLapsed++
    if (a.lastBookingDate! < crossedFrom) continue
    const p = m.profiles as unknown as { full_name: string | null; email: string | null; phone: string | null } | null
    thisWeek.push({
      name: p?.full_name ?? "Unknown",
      email: p?.email ?? "",
      phone: p?.phone ? formatUKPhoneDisplay(p.phone) : "",
      lastClass: a.lastClassDate ? formatUkDate(a.lastClassDate) : "",
      classes: a.pastClasses,
      sortKey: a.lastClassDate ?? "",
    })
  }
  thisWeek.sort((x, y) => (x.sortKey < y.sortKey ? 1 : -1))

  const studio = studioRes.data
  if (thisWeek.length === 0 || !studio) return { lapsedThisWeek: 0, totalLapsed, sent: 0, recipients: 0 }

  const membersUrl = studio.domain
    ? `https://admin.${studio.domain}/dashboard/members?filter=lapsed`
    : "/dashboard/members?filter=lapsed"

  const recipients = new Map<string, string>()
  for (const r of adminsRes.data ?? []) {
    const p = r.profiles as unknown as { full_name: string | null; email: string | null } | null
    if (p?.email) recipients.set(p.email.toLowerCase(), p.full_name?.split(" ")[0] ?? "there")
  }

  if (dryRun) return { lapsedThisWeek: thisWeek.length, totalLapsed, sent: 0, recipients: recipients.size }

  let sent = 0
  for (const [email, firstName] of recipients) {
    const { subject, html } = lapsedDigestEmail({
      recipientName: firstName,
      members: thisWeek,
      totalLapsed,
      membersUrl,
      studioName: studio.name as string,
      branding: studio.branding as StudioBranding | null,
    })
    const res = await sendStudioEmail(studioId, { to: email, subject, html })
    if (res.success) sent++
  }
  return { lapsedThisWeek: thisWeek.length, totalLapsed, sent, recipients: recipients.size }
}
