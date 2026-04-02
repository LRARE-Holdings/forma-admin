import Link from "next/link"
import { getStudioId } from "@/lib/studio-context"
import { PageHeader } from "@/components/shared/page-header"
import { getWeekData } from "@/lib/schedule-utils"
import { getDateAttendees } from "@/app/actions/bookings"
import { RegistrationClassCard } from "@/components/dashboard/registration-class-card"
import { dateToDateStr, formatTime, localDateStr } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { AttendanceStatus } from "@/lib/types"

interface RegistrationPageProps {
  searchParams: Promise<{ date?: string }>
}

export default async function RegistrationPage({
  searchParams,
}: RegistrationPageProps) {
  const params = await searchParams
  const studioId = await getStudioId()

  // Resolve selected date (defaults to today in UK time)
  const todayStr = localDateStr()
  const todayDate = new Date(todayStr + "T12:00:00Z")
  let selectedDate: Date
  if (params.date) {
    selectedDate = new Date(params.date + "T12:00:00Z")
  } else {
    selectedDate = todayDate
  }
  const dateStr = dateToDateStr(selectedDate)

  // Get Monday of the week containing selectedDate
  const dow = selectedDate.getDay()
  const offset = dow === 0 ? -6 : 1 - dow
  const monday = new Date(selectedDate)
  monday.setDate(selectedDate.getDate() + offset)
  const mondayStr = dateToDateStr(monday)

  // Fetch week data + attendees in parallel
  const [weekData, attendeesBySlot] = await Promise.all([
    getWeekData(studioId, mondayStr),
    getDateAttendees(dateStr),
  ])

  // Filter to today's active slots, sorted by start time
  const daySlots = weekData.slots
    .filter((s) => s.date === dateStr && !s.isSkipped && !s.isHoliday)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  // Prev/next date links
  const prevDate = new Date(selectedDate)
  prevDate.setDate(selectedDate.getDate() - 1)
  const nextDate = new Date(selectedDate)
  nextDate.setDate(selectedDate.getDate() + 1)

  const isToday = dateStr === todayStr

  const formattedDate = selectedDate.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  return (
    <>
      <PageHeader
        title="Registration"
        description="Take the register for each class."
      />

      {/* Date navigation */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={`/dashboard/registration?date=${dateToDateStr(prevDate)}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-warm-grey transition-colors hover:border-gold hover:text-cocoa"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 text-center">
          <span className="font-heading text-[1.1rem] font-semibold text-cocoa">
            {formattedDate}
          </span>
          {isToday && (
            <span className="ml-2 inline-block rounded-full bg-gold/15 px-2 py-0.5 text-[0.6rem] font-semibold uppercase text-gold">
              Today
            </span>
          )}
        </div>
        <Link
          href={`/dashboard/registration?date=${dateToDateStr(nextDate)}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-warm-grey transition-colors hover:border-gold hover:text-cocoa"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
        {!isToday && (
          <Link
            href="/dashboard/registration"
            className="rounded-lg border border-sand bg-white px-3 py-1.5 text-[0.75rem] font-semibold text-warm-grey transition-colors hover:border-gold hover:text-cocoa"
          >
            Today
          </Link>
        )}
      </div>

      {/* Class cards */}
      {daySlots.length === 0 ? (
        <div className="rounded-2xl border border-sand bg-white px-5 py-12 text-center">
          <h3 className="font-heading text-[1.2rem] font-medium text-cocoa">
            No classes scheduled
          </h3>
          <p className="mt-1 text-[0.82rem] text-warm-grey">
            There are no classes on this date.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {daySlots.map((slot) => (
            <RegistrationClassCard
              key={slot.scheduleId}
              className={slot.className}
              classSlug={slot.classSlug}
              startTime={slot.startTime}
              endTime={slot.endTime}
              instructorName={slot.instructorName}
              capacity={slot.capacity}
              isPast={slot.isPast}
              attendees={(attendeesBySlot[slot.scheduleId] ?? []).map((a) => ({
                ...a,
                attendance_status: a.attendance_status as AttendanceStatus | null,
              }))}
            />
          ))}
        </div>
      )}
    </>
  )
}
