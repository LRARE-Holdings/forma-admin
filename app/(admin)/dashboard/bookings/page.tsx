import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { PageHeader } from "@/components/shared/page-header"
import { BookingsTable } from "@/components/dashboard/bookings-table"
import { WaitlistSection } from "@/components/dashboard/waitlist-section"
import { getUpcomingWaitlist } from "@/lib/waitlist"

export default async function BookingsPage() {
  const supabase = await createClient()
  const studioId = await getStudioId()

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "*, profiles:profile_id(full_name, email), schedule:schedule_id(start_time, day_of_week, classes:class_id(name))"
    )
    .eq("studio_id", studioId)
    .order("created_at", { ascending: false })
    .limit(50)

  // Fetch members for the booking form
  const { data: memberMemberships } = await supabase
    .from("studio_memberships")
    .select("profile_id, profiles:profile_id(id, full_name)")
    .eq("studio_id", studioId)
    .eq("role", "member")

  // Get credits per member
  const memberIds = (memberMemberships ?? [])
    .map((m) => {
      const p = m.profiles as unknown as { id: string } | null
      return p?.id
    })
    .filter(Boolean) as string[]

  let creditsByProfile: Record<string, number> = {}
  let activeMembershipSet = new Set<string>()

  if (memberIds.length > 0) {
    const [packsRes, membershipsRes] = await Promise.all([
      supabase
        .from("class_packs")
        .select("profile_id, credits_remaining")
        .eq("studio_id", studioId)
        .gt("credits_remaining", 0)
        .in("profile_id", memberIds),
      supabase
        .from("memberships")
        .select("profile_id")
        .eq("studio_id", studioId)
        .eq("status", "active")
        .in("profile_id", memberIds),
    ])

    for (const p of packsRes.data ?? []) {
      creditsByProfile[p.profile_id] =
        (creditsByProfile[p.profile_id] ?? 0) + p.credits_remaining
    }

    for (const m of membershipsRes.data ?? []) {
      activeMembershipSet.add(m.profile_id)
    }
  }

  const members = (memberMemberships ?? []).map((m) => {
    const p = m.profiles as unknown as { id: string; full_name: string | null }
    return {
      id: p.id,
      name: p.full_name ?? "Unknown",
      credits: creditsByProfile[p.id] ?? 0,
      hasMembership: activeMembershipSet.has(p.id),
    }
  })

  // Serialize bookings as plain data
  const rows = (bookings ?? []).map((booking) => {
    const bookingProfile = booking.profiles as { full_name: string | null } | null
    const schedule = booking.schedule as {
      start_time: string
      day_of_week: number
      classes: { name: string }
    } | null

    return {
      id: booking.id as string,
      date: booking.date as string,
      status: booking.status as string,
      payment_method: booking.payment_method as string,
      profile_name: bookingProfile?.full_name ?? "Unknown",
      class_name: schedule?.classes?.name ?? "—",
      start_time: schedule?.start_time ?? null,
      day_of_week: schedule?.day_of_week ?? null,
    }
  })

  // Fetch waitlist entries
  const waitlistEntries = await getUpcomingWaitlist(studioId)

  return (
    <>
      <PageHeader
        title="Bookings"
        description="All bookings across every class."
      />
      <BookingsTable
        bookings={rows}
        members={members}
      />

      {/* Waitlist section */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="border-b border-sand px-5 py-4">
          <h3 className="font-heading text-[1.05rem] font-semibold text-cocoa">
            Waitlist
          </h3>
          <p className="mt-0.5 text-[0.7rem] text-warm-grey">
            Members waiting for spots in full classes.
          </p>
        </div>
        <WaitlistSection entries={waitlistEntries as unknown as Parameters<typeof WaitlistSection>[0]["entries"]} />
      </div>
    </>
  )
}
