import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { PageHeader } from "@/components/shared/page-header"
import { MembersTable } from "@/components/dashboard/members-table"

export default async function MembersPage() {
  const supabase = await createClient()
  const studioId = await getStudioId()

  // Get all members for this studio
  const { data: memberships } = await supabase
    .from("studio_memberships")
    .select("profile_id, created_at, profiles:profile_id(id, full_name, email)")
    .eq("studio_id", studioId)
    .eq("role", "member")

  const members = memberships ?? []

  const memberIds = members
    .map((m) => {
      const p = m.profiles as unknown as { id: string } | null
      return p?.id
    })
    .filter(Boolean) as string[]

  let bookingCounts: Record<string, number> = {}
  let creditsByProfile: Record<string, number> = {}
  let lastBookingByProfile: Record<string, string> = {}
  let packsByProfile: Record<string, Array<{
    id: string
    pack_type: string
    credits_total: number
    credits_remaining: number
    expires_at: string
  }>> = {}

  if (memberIds.length > 0) {
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`

    const [bookingsRes, lastBookingsRes, packsRes] = await Promise.all([
      supabase
        .from("bookings")
        .select("profile_id")
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .gte("date", monthStart)
        .in("profile_id", memberIds),
      // Most recent confirmed booking per member (for at-risk calculation)
      supabase
        .from("bookings")
        .select("profile_id, date")
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .in("profile_id", memberIds)
        .order("date", { ascending: false }),
      // All packs for member balance management
      supabase
        .from("class_packs")
        .select("id, profile_id, pack_type, credits_total, credits_remaining, expires_at")
        .eq("studio_id", studioId)
        .in("profile_id", memberIds)
        .order("expires_at", { ascending: false }),
    ])

    for (const b of bookingsRes.data ?? []) {
      bookingCounts[b.profile_id] = (bookingCounts[b.profile_id] ?? 0) + 1
    }

    for (const b of lastBookingsRes.data ?? []) {
      if (!lastBookingByProfile[b.profile_id]) {
        lastBookingByProfile[b.profile_id] = b.date
      }
    }

    for (const p of packsRes.data ?? []) {
      if (!packsByProfile[p.profile_id]) packsByProfile[p.profile_id] = []
      packsByProfile[p.profile_id].push({
        id: p.id as string,
        pack_type: p.pack_type as string,
        credits_total: p.credits_total as number,
        credits_remaining: p.credits_remaining as number,
        expires_at: p.expires_at as string,
      })
      if (p.credits_remaining > 0) {
        creditsByProfile[p.profile_id] =
          (creditsByProfile[p.profile_id] ?? 0) + p.credits_remaining
      }
    }
  }

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0]

  const rows = members.map((m) => {
    const profile = m.profiles as unknown as {
      id: string
      full_name: string | null
      email: string | null
    }
    const lastBooking = lastBookingByProfile[profile.id] ?? null
    return {
      id: profile.id,
      name: profile.full_name ?? "Unknown",
      email: profile.email ?? "",
      credits: creditsByProfile[profile.id] ?? 0,
      classesThisMonth: bookingCounts[profile.id] ?? 0,
      joinedAt: new Date(m.created_at as string).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
      }),
      packs: packsByProfile[profile.id] ?? [],
      lastBookingDate: lastBooking,
      atRisk:
        // Only flag as at-risk if they joined 30+ days ago
        new Date(m.created_at as string).getTime() <= thirtyDaysAgo.getTime() &&
        (!lastBooking || lastBooking < thirtyDaysAgoStr),
    }
  })

  return (
    <>
      <PageHeader
        title="Members"
        description={`${members.length} active member${members.length !== 1 ? "s" : ""}.`}
      />
      <MembersTable members={rows} />
    </>
  )
}
