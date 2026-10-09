import { createClient } from "@/lib/supabase/server"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { getStudioId } from "@/lib/studio-context"
import { localDateStr } from "@/lib/utils"
import { PageHeader } from "@/components/shared/page-header"
import { MembersTable } from "@/components/dashboard/members-table"
import { isPackUsableNow } from "@/lib/booking-rules"
import { activityByProfile, isActive, isLapsed, type MemberActivity } from "@/lib/member-activity"

export default async function MembersPage() {
  const supabase = await createClient()
  const studioId = await getStudioId()

  // Get all members for this studio
  const members = await fetchAllRows((from, to) =>
    supabase
      .from("studio_memberships")
      .select(
        "profile_id, created_at, profiles:profile_id(id, full_name, email, phone, date_of_birth)",
      )
      .eq("studio_id", studioId)
      .eq("role", "member")
      .order("id")
      .range(from, to),
  )

  const memberIds = members
    .map((m) => {
      const p = m.profiles as unknown as { id: string } | null
      return p?.id
    })
    .filter(Boolean) as string[]

  const bookingCounts: Record<string, number> = {}
  const totalAttendance: Record<string, number> = {}
  const creditsByProfile: Record<string, number> = {}
  let activity = new Map<string, MemberActivity>()
  const packsByProfile: Record<string, Array<{
    id: string
    pack_type: string
    credits_total: number
    credits_remaining: number
    valid_from: string | null
    expires_at: string
  }>> = {}
  const membershipByProfile: Record<string, { status: string; tierName: string }> = {}

  const todayStr = localDateStr()

  if (memberIds.length > 0) {
    const monthStart = todayStr.slice(0, 8) + "01"

    const [confirmedBookings, packs, membershipsRes] = await Promise.all([
      // Every confirmed booking: all-time attendance, this month's count and
      // active/lapsed status all come from here
      fetchAllRows((from, to) =>
        supabase
          .from("bookings")
          .select("profile_id, date")
          .eq("studio_id", studioId)
          .eq("status", "confirmed")
          .order("id")
          .range(from, to),
      ),
      // All packs for member balance management
      fetchAllRows((from, to) =>
        supabase
          .from("class_packs")
          .select("id, profile_id, pack_type, credits_total, credits_remaining, valid_from, expires_at")
          .eq("studio_id", studioId)
          .order("expires_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      // Active memberships with tier names
      supabase
        .from("memberships")
        .select("profile_id, status, membership_tiers:membership_tier_id(name)")
        .eq("studio_id", studioId),
    ])

    for (const b of confirmedBookings) {
      totalAttendance[b.profile_id] = (totalAttendance[b.profile_id] ?? 0) + 1
      if (b.date >= monthStart) {
        bookingCounts[b.profile_id] = (bookingCounts[b.profile_id] ?? 0) + 1
      }
    }
    activity = activityByProfile(confirmedBookings, todayStr)

    for (const m of membershipsRes.data ?? []) {
      const tier = m.membership_tiers as unknown as { name: string } | null
      // Keep the most "active" membership if multiple exist
      const existing = membershipByProfile[m.profile_id]
      if (!existing || m.status === "active") {
        membershipByProfile[m.profile_id] = {
          status: m.status as string,
          tierName: tier?.name ?? "Unknown",
        }
      }
    }

    const today = localDateStr()
    for (const p of packs) {
      if (!packsByProfile[p.profile_id]) packsByProfile[p.profile_id] = []
      packsByProfile[p.profile_id].push({
        id: p.id as string,
        pack_type: p.pack_type as string,
        credits_total: p.credits_total as number,
        credits_remaining: p.credits_remaining as number,
        valid_from: p.valid_from as string | null,
        expires_at: p.expires_at as string,
      })
      // Only credits that could be spent today count as remaining.
      if (p.credits_remaining > 0 && isPackUsableNow(p, today)) {
        creditsByProfile[p.profile_id] =
          (creditsByProfile[p.profile_id] ?? 0) + p.credits_remaining
      }
    }
  }

  const rows = members.map((m) => {
    const profile = m.profiles as unknown as {
      id: string
      full_name: string | null
      email: string | null
      phone: string | null
      date_of_birth: string | null
    }
    const a = activity.get(profile.id) ?? null
    const membership = membershipByProfile[profile.id] ?? null
    return {
      id: profile.id,
      name: profile.full_name ?? "Unknown",
      email: profile.email ?? "",
      phone: profile.phone ?? "",
      dateOfBirth: profile.date_of_birth ?? null,
      credits: creditsByProfile[profile.id] ?? 0,
      totalClasses: totalAttendance[profile.id] ?? 0,
      classesThisMonth: bookingCounts[profile.id] ?? 0,
      joinedAt: new Date(m.created_at as string).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
      }),
      joinedRaw: m.created_at as string,
      packs: packsByProfile[profile.id] ?? [],
      lastBookingDate: a?.lastBookingDate ?? null,
      lastClassDate: a?.lastClassDate ?? null,
      membershipStatus: membership?.status ?? null,
      membershipTier: membership?.tierName ?? null,
      active: a ? isActive(a, todayStr) : false,
      lapsed: a ? isLapsed(a, todayStr) : false,
    }
  })

  const activeCount = rows.filter((r) => r.active).length

  return (
    <>
      <PageHeader
        title="Members"
        description={`${rows.length} members, ${activeCount} active in the last 30 days.`}
      />
      <MembersTable members={rows} />
    </>
  )
}
