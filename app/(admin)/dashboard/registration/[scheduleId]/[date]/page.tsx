import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { requireReception } from "@/lib/auth"
import { formatTime } from "@/lib/utils"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { ClassCheckIn, type CheckInAttendee } from "@/components/shared/class-check-in"
import type { AttendanceStatus } from "@/lib/types"
import { ChevronLeft } from "lucide-react"

/** The studio's check-in for any class — the instructor's version lives at /staff/register. */
export default async function RegistrationCheckInPage({
  params,
}: {
  params: Promise<{ scheduleId: string; date: string }>
}) {
  await requireReception()
  const { scheduleId, date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  const supabase = await createClient()
  const studioId = await getStudioId()

  const [{ data: slot }, { data: bookings }] = await Promise.all([
    supabase
      .from("schedule")
      .select("start_time, end_time, classes:class_id(name, slug, capacity), instructors:instructor_id(name)")
      .eq("id", scheduleId)
      .eq("studio_id", studioId)
      .maybeSingle(),
    supabase
      .from("bookings")
      .select("id, profile_id, payment_method, attendance_status, profiles:profile_id(full_name)")
      .eq("studio_id", studioId)
      .eq("schedule_id", scheduleId)
      .eq("date", date)
      .eq("status", "confirmed"),
  ])
  if (!slot) notFound()

  const cls = slot.classes as unknown as { name: string; slug: string; capacity: number | null }
  const instructor = slot.instructors as unknown as { name: string } | null
  const attendees: CheckInAttendee[] = (bookings ?? []).map((b) => ({
    id: b.id as string,
    profile_id: b.profile_id as string,
    full_name: (b.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null,
    payment_method: b.payment_method as string,
    attendance_status: b.attendance_status as AttendanceStatus | null,
  }))

  const dateDisplay = new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/dashboard/registration?date=${date}`}
        className="mb-4 inline-flex items-center gap-1 text-[0.75rem] font-semibold text-warm-grey hover:text-cocoa"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Registration
      </Link>
      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-sand bg-white p-5">
        <ClassColorBar classSlug={cls.slug} className="h-12 w-1.5" />
        <div>
          <h2 className="font-heading text-[1.4rem] font-semibold text-cocoa">{cls.name}</h2>
          <p className="text-[0.8rem] text-warm-grey">
            {dateDisplay} · {formatTime(slot.start_time as string)}–{formatTime(slot.end_time as string)}
            {instructor?.name ? ` · ${instructor.name}` : ""}
          </p>
        </div>
      </div>
      <ClassCheckIn scheduleId={scheduleId} date={date} capacity={cls.capacity ?? 10} attendees={attendees} />
    </div>
  )
}
