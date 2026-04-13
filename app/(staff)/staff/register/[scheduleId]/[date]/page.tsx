import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUser, getInstructorForUser } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { formatTime, getInitial } from "@/lib/utils"
import { DAY_NAMES } from "@/lib/constants"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { CapacityRing } from "@/components/shared/capacity-ring"
import { AttendanceDropdown } from "@/components/shared/attendance-dropdown"
import type { AttendanceStatus } from "@/lib/types"

interface Props {
  params: Promise<{ scheduleId: string; date: string }>
}

function paymentLabel(method: string) {
  switch (method) {
    case "pack_credit":
      return "Pack"
    case "membership":
      return "Membership"
    case "complimentary":
      return "Comp"
    default:
      return "Drop-in"
  }
}

function paymentStyle(method: string) {
  switch (method) {
    case "pack_credit":
      return "bg-gold/15 text-gold"
    case "membership":
      return "bg-purple-100 text-purple-700"
    case "complimentary":
      return "bg-green-100 text-green-700"
    default:
      return "bg-ember/12 text-ember"
  }
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
      id: b.id,
      full_name: profile?.full_name ?? null,
      payment_method: b.payment_method,
      attendance_status: b.attendance_status as AttendanceStatus | null,
    }
  })

  const booked = attendees.length
  const attended = attendees.filter((a) => a.attendance_status === "attended").length
  const noShow = attendees.filter((a) => a.attendance_status === "no_show").length

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

        {/* Quick stats */}
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-cream px-4 py-3 text-center">
            <span className="block font-heading text-[1.4rem] font-semibold text-cocoa">{booked}</span>
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-warm-grey">
              Booked
            </span>
          </div>
          <div className="rounded-xl bg-cream px-4 py-3 text-center">
            <span className="block font-heading text-[1.4rem] font-semibold text-success">{attended}</span>
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-warm-grey">
              Attended
            </span>
          </div>
          <div className="rounded-xl bg-cream px-4 py-3 text-center">
            <span className="block font-heading text-[1.4rem] font-semibold text-red-500">{noShow}</span>
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-warm-grey">
              No-show
            </span>
          </div>
        </div>
      </div>

      {/* Register list */}
      <div className="rounded-2xl border border-sand bg-white overflow-hidden">
        <div className="flex justify-between bg-cocoa px-6 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-wheat/70">
          <span>Register ({booked} of {capacity})</span>
          <div className="flex gap-8">
            <span>Payment</span>
            <span>Attendance</span>
          </div>
        </div>

        {/* Booked attendees */}
        {attendees.map((att, i) => (
          <div
            key={att.id}
            className="flex items-center gap-3 border-b border-sand/40 px-6 py-3 last:border-b-0"
          >
            <span className="w-5 text-center text-[0.72rem] font-medium text-warm-grey">
              {i + 1}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sand font-heading text-[0.75rem] font-semibold text-cocoa">
              {getInitial(att.full_name)}
            </div>
            <span className="flex-1 text-[0.88rem] font-medium text-cocoa">
              {att.full_name ?? "Unknown"}
            </span>
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase ${paymentStyle(att.payment_method)}`}
            >
              {paymentLabel(att.payment_method)}
            </span>
            <AttendanceDropdown
              bookingId={att.id}
              currentStatus={att.attendance_status}
            />
          </div>
        ))}

        {/* Empty spots */}
        {Array.from({ length: capacity - booked }, (_, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center gap-3 border-b border-sand/40 px-6 py-3 last:border-b-0"
          >
            <span className="w-5 text-center text-[0.72rem] font-medium text-warm-grey">
              {booked + i + 1}
            </span>
            <div className="h-8 w-8 rounded-full border-[1.5px] border-dashed border-sand" />
            <span className="text-[0.82rem] italic text-sand">Open spot</span>
          </div>
        ))}

        {booked === 0 && (
          <div className="px-6 py-10 text-center">
            <p className="text-[0.88rem] text-warm-grey">No bookings yet for this class.</p>
          </div>
        )}
      </div>
    </>
  )
}
