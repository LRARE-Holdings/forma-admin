import { createClient } from "@/lib/supabase/server"
import { getUser, getInstructorForUser } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { dateToDateStr, localDateStr, ukDayOfWeek, ukTimeStr } from "@/lib/utils"
import { StatCard } from "@/components/shared/stat-card"
import { StaffScheduleView } from "@/components/staff/staff-schedule-view"
import { EditOwnProfile } from "@/components/staff/edit-own-profile"
import { formatTime } from "@/lib/utils"

export default async function StaffPage() {
  const supabase = await createClient()
  const studioId = await getStudioId()
  const user = await getUser()
  const instructor = await getInstructorForUser()

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user!.id)
    .single()

  const firstName = profile?.full_name?.split(" ")[0] ?? "there"

  // If no linked instructor, show a message
  if (!instructor) {
    return (
      <div className="py-12 text-center">
        <h2 className="font-heading text-[1.8rem] font-medium text-cocoa">
          Hi {firstName}
        </h2>
        <p className="mt-2 text-warm-grey">
          Your instructor profile hasn&apos;t been linked yet. Please ask your admin
          to connect your account.
        </p>
      </div>
    )
  }

  // Fetch this instructor's schedule
  const { data: schedule } = await supabase
    .from("schedule")
    .select("*, classes(*)")
    .eq("studio_id", studioId)
    .eq("instructor_id", instructor.id)
    .eq("is_active", true)
    .order("day_of_week")
    .order("start_time")

  const slots = schedule ?? []

  // Get booking counts for this week
  const today = localDateStr() // UK time YYYY-MM-DD
  const ukToday = new Date(today + "T12:00:00Z")
  const jsDow = ukToday.getDay()
  const mondayOffset = jsDow === 0 ? -6 : 1 - jsDow
  const monday = new Date(ukToday)
  monday.setDate(ukToday.getDate() + mondayOffset)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const mondayStr = dateToDateStr(monday)
  const sundayStr = dateToDateStr(sunday)

  const slotIds = slots.map((s: { id: string }) => s.id)

  let weekBookings: { id: string; schedule_id: string; profile_id: string; date: string; payment_method: string; attendance_status: string | null }[] = []
  let bookingProfiles: Record<string, { full_name: string | null }> = {}

  if (slotIds.length > 0) {
    const { data } = await supabase
      .from("bookings")
      .select("id, schedule_id, profile_id, date, payment_method, attendance_status, profiles:profile_id(full_name)")
      .eq("studio_id", studioId)
      .eq("status", "confirmed")
      .gte("date", mondayStr)
      .lte("date", sundayStr)
      .in("schedule_id", slotIds)

    weekBookings = (data ?? []) as typeof weekBookings

    for (const b of data ?? []) {
      const p = (b as Record<string, unknown>).profiles as unknown as { full_name: string | null } | null
      if (p) {
        bookingProfiles[b.profile_id] = p
      }
    }
  }

  // Stats
  const totalClassesThisWeek = slots.length
  const totalAttendees = weekBookings.length

  // Find next class
  const currentDow = ukDayOfWeek()
  const currentTime = ukTimeStr()

  let nextClass = slots.find(
    (s: { day_of_week: number; start_time: string }) =>
      s.day_of_week === currentDow && s.start_time > currentTime
  )
  if (!nextClass) {
    // Find next day with a class
    for (let d = 1; d <= 7; d++) {
      const checkDow = (currentDow + d) % 7
      const found = slots.find(
        (s: { day_of_week: number }) => s.day_of_week === checkDow
      )
      if (found) {
        nextClass = found
        break
      }
    }
  }

  const nextClassInfo = nextClass
    ? {
        time: formatTime((nextClass as unknown as { start_time: string }).start_time),
        name: ((nextClass as unknown as { classes: { name: string } }).classes).name,
      }
    : null

  // Group bookings by schedule_id and date
  const bookingsBySlotDate: Record<string, { id: string; full_name: string | null; payment_method: string; attendance_status: string | null }[]> = {}
  for (const b of weekBookings) {
    const key = `${b.schedule_id}:${b.date}`
    if (!bookingsBySlotDate[key]) bookingsBySlotDate[key] = []
    bookingsBySlotDate[key].push({
      id: b.id,
      full_name: bookingProfiles[b.profile_id]?.full_name ?? null,
      payment_method: b.payment_method,
      attendance_status: b.attendance_status ?? null,
    })
  }

  // Serialize for client component
  const serializedSlots = slots.map((s: Record<string, unknown>) => ({
    id: s.id as string,
    day_of_week: s.day_of_week as number,
    start_time: s.start_time as string,
    end_time: s.end_time as string,
    classes: s.classes as unknown as { name: string; slug: string; price_pence: number; duration_mins: number; capacity: number },
  }))

  return (
    <>
      <div className="mb-7">
        <h2 className="font-heading text-[1.8rem] font-medium text-cocoa">
          Hi {firstName}
        </h2>
        <p className="mt-0.5 text-[0.85rem] text-warm-grey">
          Here are your classes for this week.
        </p>
        <EditOwnProfile
          instructor={{
            id: instructor.id,
            name: instructor.name,
            bio: instructor.bio ?? "",
            photo_url: instructor.photo_url ?? null,
          }}
        />
      </div>

      <div className="mb-7 grid grid-cols-3 gap-4">
        <StatCard
          label="Your classes this week"
          value={totalClassesThisWeek}
          subtitle={`Across ${new Set(slots.map((s: { day_of_week: number }) => s.day_of_week)).size} days`}
        />
        <StatCard
          label="Total attendees booked"
          value={totalAttendees}
          subtitle={
            totalClassesThisWeek > 0
              ? `${Math.round((totalAttendees / (totalClassesThisWeek * 10)) * 100)}% capacity`
              : undefined
          }
        />
        <StatCard
          label="Next class"
          value={nextClassInfo?.time ?? "—"}
          subtitle={nextClassInfo?.name ?? "No upcoming classes"}
        />
      </div>

      <StaffScheduleView
        slots={serializedSlots}
        bookingsBySlotDate={bookingsBySlotDate}
        weekStart={mondayStr}
      />
    </>
  )
}
