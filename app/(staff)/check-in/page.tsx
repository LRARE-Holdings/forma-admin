import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { getInstructorForUser, getUserRole } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { getWeekData } from "@/lib/schedule-utils"
import { dateToDateStr, formatTime, localDateStr, ukDayOfWeek, ukTimeStr } from "@/lib/utils"
import { minutesOfDay, pickCurrentClass } from "@/lib/current-class"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { ClassCheckIn, type CheckInAttendee } from "@/components/shared/class-check-in"
import type { AttendanceStatus, WeekSlot } from "@/lib/types"

export const dynamic = "force-dynamic"

/**
 * The door check-in (checkin.<studio domain>). Opens on whichever class is on
 * now — the instructor's own classes for an instructor, any class for the
 * studio — with the scanner already running and the name list underneath.
 * Today's other classes are one tap away.
 *
 * The staff layout has already checked the role (admin or instructor); the
 * check-in actions re-check every scan on the server.
 */
export default async function DoorCheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>
}) {
  const [{ class: chosenId }, role, studioId] = await Promise.all([searchParams, getUserRole(), getStudioId()])

  const instructor = role === "staff" ? await getInstructorForUser() : null
  if (role === "staff" && !instructor) {
    return <Notice title="No instructor profile">Ask the studio to link your account to your instructor profile.</Notice>
  }

  // Today's classes, in UK time (the server runs in UTC).
  const today = localDateStr()
  const monday = new Date(`${today}T00:00:00`)
  monday.setDate(monday.getDate() - ukDayOfWeek())
  const { slots } = await getWeekData(studioId, dateToDateStr(monday))
  const todays = slots
    .filter((s) => s.date === today && !s.isSkipped && !s.isHoliday)
    .filter((s) => !instructor || s.instructorId === instructor.id)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  const nowMins = minutesOfDay(ukTimeStr())
  const current = chosenId
    ? (todays.find((s) => s.scheduleId === chosenId) ?? null)
    : pickCurrentClass(todays, nowMins)

  if (!current) {
    const next = todays.find((s) => minutesOfDay(s.startTime) > nowMins)
    return (
      <div className="mx-auto max-w-xl">
        <Notice title={todays.length ? "No class on right now" : "No classes today"}>
          {todays.length
            ? next
              ? `Next up: ${next.className} at ${formatTime(next.startTime)}. Check-in opens 45 minutes before.`
              : "That's everything for today."
            : instructor
              ? "You're not teaching today."
              : "There's nothing on the timetable today."}
        </Notice>
        {todays.length > 0 && <ClassPicker classes={todays} currentId={null} />}
      </div>
    )
  }

  const supabase = await createClient()
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, profile_id, payment_method, attendance_status, profiles:profile_id(full_name)")
    .eq("studio_id", studioId)
    .eq("schedule_id", current.scheduleId)
    .eq("date", today)
    .eq("status", "confirmed")

  const attendees: CheckInAttendee[] = (bookings ?? []).map((b) => ({
    id: b.id as string,
    profile_id: b.profile_id as string,
    full_name: (b.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null,
    payment_method: b.payment_method as string,
    attendance_status: b.attendance_status as AttendanceStatus | null,
  }))

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-sand bg-white p-5">
        <ClassColorBar classSlug={current.classSlug} className="h-12 w-1.5" />
        <div>
          <h2 className="font-heading text-[1.4rem] font-semibold text-cocoa">{current.className}</h2>
          <p className="text-[0.8rem] text-warm-grey">
            Today · {formatTime(current.startTime)}–{formatTime(current.endTime)}
            {!instructor && current.instructorName ? ` · ${current.instructorName}` : ""}
          </p>
        </div>
      </div>
      {todays.length > 1 && <ClassPicker classes={todays} currentId={current.scheduleId} />}
      {/* keyed so switching class remounts with a fresh scanner and state */}
      <ClassCheckIn
        key={current.scheduleId}
        scheduleId={current.scheduleId}
        date={today}
        capacity={current.capacity}
        attendees={attendees}
        initialMode="scan"
      />
    </div>
  )
}

function ClassPicker({ classes, currentId }: { classes: WeekSlot[]; currentId: string | null }) {
  return (
    <nav aria-label="Today's classes" className="mb-5 flex gap-2 overflow-x-auto pb-1">
      {classes.map((s) => {
        const active = s.scheduleId === currentId
        return (
          <Link
            key={s.scheduleId}
            href={`/check-in?class=${s.scheduleId}`}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[0.78rem] font-medium transition-colors ${
              active ? "border-cocoa bg-cocoa text-cream" : "border-sand bg-white text-cocoa hover:bg-cream"
            }`}
          >
            {formatTime(s.startTime)} {s.className}
          </Link>
        )
      })}
    </nav>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-2xl border border-sand bg-white p-6 text-center">
      <h2 className="font-heading text-[1.3rem] font-semibold text-cocoa">{title}</h2>
      <p className="mt-1 text-[0.85rem] text-warm-grey">{children}</p>
    </div>
  )
}
