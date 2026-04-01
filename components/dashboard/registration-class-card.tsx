"use client"

import { ClassColorBar } from "@/components/shared/class-color-bar"
import { CapacityBadge } from "@/components/shared/capacity-badge"
import { AttendanceDropdown } from "@/components/shared/attendance-dropdown"
import { formatTime, getInitial } from "@/lib/utils"
import type { AttendanceStatus } from "@/lib/types"

interface AttendeeData {
  id: string
  full_name: string | null
  payment_method: string
  attendance_status: AttendanceStatus | null
}

interface RegistrationClassCardProps {
  className: string
  classSlug: string
  startTime: string
  endTime: string
  instructorName: string
  capacity: number
  attendees: AttendeeData[]
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

export function RegistrationClassCard({
  className,
  classSlug,
  startTime,
  endTime,
  instructorName,
  capacity,
  attendees,
}: RegistrationClassCardProps) {
  const booked = attendees.length

  return (
    <div className="overflow-hidden rounded-2xl border border-sand bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sand px-5 py-4">
        <div className="flex items-center gap-3">
          <ClassColorBar classSlug={classSlug} className="w-1 h-10" />
          <div>
            <h3 className="font-heading text-[1.05rem] font-semibold text-cocoa">
              {className}
            </h3>
            <p className="mt-0.5 text-[0.75rem] text-warm-grey">
              {formatTime(startTime)}&ndash;{formatTime(endTime)} &middot; {instructorName}
            </p>
          </div>
        </div>
        <CapacityBadge booked={booked} capacity={capacity} />
      </div>

      {/* Attendee table */}
      {booked > 0 ? (
        <>
          <div className="flex items-center bg-cream px-5 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-warm-grey">
            <span className="w-7">#</span>
            <span className="flex-1">Name</span>
            <span className="w-20 text-center">Payment</span>
            <span className="w-28 text-right">Attendance</span>
          </div>

          {attendees.map((att, i) => (
            <div
              key={att.id}
              className="flex items-center border-b border-sand/40 px-5 py-2.5 text-[0.82rem] last:border-b-0"
            >
              <span className="w-7 text-[0.7rem] text-warm-grey">
                {i + 1}
              </span>
              <div className="flex flex-1 items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sand font-heading text-[0.7rem] font-semibold text-cocoa">
                  {getInitial(att.full_name)}
                </div>
                <span className="font-medium text-cocoa">
                  {att.full_name ?? "Unknown"}
                </span>
              </div>
              <span className="w-20 text-center">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase ${paymentStyle(att.payment_method)}`}
                >
                  {paymentLabel(att.payment_method)}
                </span>
              </span>
              <span className="w-28 text-right">
                <AttendanceDropdown
                  bookingId={att.id}
                  currentStatus={att.attendance_status}
                />
              </span>
            </div>
          ))}

          {/* Empty spots */}
          {Array.from({ length: capacity - booked }, (_, i) => (
            <div
              key={`empty-${i}`}
              className="flex items-center border-b border-sand/40 px-5 py-2.5 last:border-b-0"
            >
              <span className="w-7 text-[0.7rem] text-warm-grey">
                {booked + i + 1}
              </span>
              <div className="flex flex-1 items-center gap-2.5">
                <div className="h-7 w-7 rounded-full border-[1.5px] border-dashed border-sand" />
                <span className="text-[0.78rem] italic text-sand">Open spot</span>
              </div>
            </div>
          ))}
        </>
      ) : (
        <div className="px-5 py-6 text-center text-[0.82rem] text-warm-grey">
          No bookings for this class.
        </div>
      )}
    </div>
  )
}
