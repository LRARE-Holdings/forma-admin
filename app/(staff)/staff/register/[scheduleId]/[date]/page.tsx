import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUser, getInstructorForUser } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { formatTime } from "@/lib/utils"
import { DAY_NAMES } from "@/lib/constants"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { CapacityRing } from "@/components/shared/capacity-ring"
import { ClassCheckIn } from "@/components/shared/class-check-in"
import type { AttendanceStatus } from "@/lib/types"

interface Props {
  params: Promise<{ scheduleId: string; date: string }>
}

export default async function RegisterPage({ params }: Props) {
  const { scheduleId, date } = await params
  const supabase = await createClient()
  const studioId = await getStudioId()
  const user = await getUser()
  const instructor = await getInstructorForUser()

  if (!user || !instructor) notFound()

  // Fetch schedule slot — verify it belongs to this instructor
  const { data: slot } = await supabase
    .from("schedule")
    .select("*, classes(*), instructors(name)")
    .eq("id", scheduleId)
    .eq("studio_id", studioId)
    .eq("instructor_id", instructor.id)
    .single()

  if (!slot) notFound()

  const cls = slot.classes as { name: string; slug: string; duration_mins: number; price_pence: number; capacity: number }
  const capacity = cls.capacity ?? 10

  // Fetch bookings for this slot and date
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, profile_id, payment_method, attendance_status, profiles:profile_id(full_name)")
    .eq("studio_id", studioId)
    .eq("schedule_id", scheduleId)
    .eq("date", date)
    .eq("status", "confirmed")

  const attendees = (bookings ?? []).map((b) => {
    const profile = (b as Record<string, unknown>).profiles as { full_name: string | null } | null
    return {
      id: b.id as string,
      profile_id: b.profile_id as string,
      full_name: profile?.full_name ?? null,
      payment_method: b.payment_method as string,
      attendance_status: b.attendance_status as AttendanceStatus | null,
    }
  })

  const booked = attendees.length

  // Format the date for display
  const dateObj = new Date(date + "T00:00:00")
  const jsDow = dateObj.getDay()
  const schemaDow = jsDow === 0 ? 6 : jsDow - 1
  const dayName = DAY_NAMES[schemaDow]
  const dateDisplay = dateObj.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  return (
    <>
      {/* Back link */}
      <Link
        href="/staff"
        className="mb-5 inline-flex items-center gap-1.5 text-[0.78rem] font-medium text-warm-grey hover:text-cocoa transition-colors"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to dashboard
      </Link>

      {/* Class header */}
      <div className="mb-6 rounded-2xl border border-sand bg-white p-6">
        <div className="flex items-start gap-4">
          <ClassColorBar classSlug={cls.slug} className="w-1.5 h-14 mt-0.5" />
          <div className="flex-1">
            <h2 className="font-heading text-[1.5rem] font-semibold text-cocoa">
              {cls.name}
            </h2>
            <p className="mt-0.5 text-[0.84rem] text-warm-grey">
              {dayName} {dateDisplay} &middot; {formatTime(slot.start_time)}&ndash;{formatTime(slot.end_time)} &middot; {cls.duration_mins} min
            </p>
          </div>
          <CapacityRing booked={booked} capacity={capacity} classSlug={cls.slug} />
        </div>

      </div>

      <ClassCheckIn scheduleId={scheduleId} date={date} capacity={capacity} attendees={attendees} />
    </>
  )
}
