"use client"

import { getInitial } from "@/lib/utils"
import { MemberNameButton } from "@/components/member-profile/member-name-button"
import { AttendanceDropdown } from "@/components/shared/attendance-dropdown"
import type { AttendanceStatus } from "@/lib/types"

interface Attendee {
  id: string
  profile_id: string
  full_name: string | null
  payment_method: string
  attendance_status: AttendanceStatus | null
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

export function RegisterAttendees({ attendees }: { attendees: Attendee[] }) {
  return (
    <>
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
          <MemberNameButton
            profileId={att.profile_id}
            className="flex-1 text-[0.88rem] font-medium text-cocoa"
          >
            {att.full_name ?? "Unknown"}
          </MemberNameButton>
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
    </>
  )
}
