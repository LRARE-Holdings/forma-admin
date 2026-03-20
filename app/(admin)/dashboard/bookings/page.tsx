import { createClient } from "@/lib/supabase/server"
import { STUDIO_ID } from "@/lib/constants"
import { PageHeader } from "@/components/shared/page-header"
import { BookingsTable } from "@/components/dashboard/bookings-table"
import { dayShort, formatTime } from "@/lib/utils"

export default async function BookingsPage() {
  const supabase = await createClient()

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "*, profiles:profile_id(full_name, email), schedule:schedule_id(start_time, day_of_week, classes:class_id(name))"
    )
    .eq("studio_id", STUDIO_ID)
    .order("created_at", { ascending: false })
    .limit(50)

  // Fetch members for the booking form
  const { data: memberMemberships } = await supabase
    .from("studio_memberships")
    .select("profile_id, profiles:profile_id(id, full_name)")
    .eq("studio_id", STUDIO_ID)
    .eq("role", "member")

  // Get credits per member
  const memberIds = (memberMemberships ?? [])
    .map((m) => {
      const p = m.profiles as unknown as { id: string } | null
      return p?.id
    })
    .filter(Boolean) as string[]

  let creditsByProfile: Record<string, number> = {}
  if (memberIds.length > 0) {
    const { data: packs } = await supabase
      .from("class_packs")
      .select("profile_id, credits_remaining")
      .eq("studio_id", STUDIO_ID)
      .gt("credits_remaining", 0)
      .in("profile_id", memberIds)

    for (const p of packs ?? []) {
      creditsByProfile[p.profile_id] =
        (creditsByProfile[p.profile_id] ?? 0) + p.credits_remaining
    }
  }

  const members = (memberMemberships ?? []).map((m) => {
    const p = m.profiles as unknown as { id: string; full_name: string | null }
    return {
      id: p.id,
      name: p.full_name ?? "Unknown",
      credits: creditsByProfile[p.id] ?? 0,
    }
  })

  // Fetch active schedule slots for the booking form
  const { data: activeSlots } = await supabase
    .from("schedule")
    .select("id, day_of_week, start_time, classes:class_id(name)")
    .eq("studio_id", STUDIO_ID)
    .eq("is_active", true)
    .order("day_of_week")
    .order("start_time")

  const slotOptions = (activeSlots ?? []).map((s) => {
    const cls = s.classes as unknown as { name: string }
    return {
      id: s.id as string,
      label: `${dayShort(s.day_of_week as number)} ${formatTime(s.start_time as string)} — ${cls.name}`,
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

  return (
    <>
      <PageHeader
        title="Bookings"
        description="All bookings across every class."
      />
      <BookingsTable
        bookings={rows}
        members={members}
        slots={slotOptions}
      />
    </>
  )
}
