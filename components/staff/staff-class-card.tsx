"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { CapacityRing } from "@/components/shared/capacity-ring"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { AttendanceDropdown } from "@/components/shared/attendance-dropdown"
import { formatTime, formatPence, getInitial } from "@/lib/utils"
import type { AttendanceStatus } from "@/lib/types"

interface SlotData {
  id: string
  start_time: string
  end_time: string
  classes: {
    name: string
    slug: string
    price_pence: number
    duration_mins: number
    capacity: number
  }
}

interface StaffAttendee {
  id: string
  full_name: string | null
  payment_method: string
  attendance_status: string | null
}

interface StaffClassCardProps {
  slot: SlotData
  attendees: StaffAttendee[]
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

export function StaffClassCard({ slot, attendees }: StaffClassCardProps) {
  const [open, setOpen] = useState(false)
  const cls = slot.classes
  const capacity = cls.capacity ?? 10
  const booked = attendees.length

  return (
    <div
      className={`mb-4 overflow-hidden rounded-2xl border bg-white transition-all ${
        open ? "border-gold shadow-[0_4px_16px_rgba(71,55,40,0.06)]" : "border-sand hover:border-gold hover:shadow-[0_4px_16px_rgba(71,55,40,0.06)]"
      }`}
    >
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between px-5 py-4"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-3">
          <ClassColorBar classSlug={cls.slug} className="w-1 h-10" />
          <div className="min-w-[50px] text-[1.1rem] font-semibold text-cocoa">
            {formatTime(slot.start_time)}
          </div>
          <div>
            <h3 className="text-[0.95rem] font-semibold text-cocoa">
              {cls.name}
            </h3>
            <p className="text-[0.75rem] text-warm-grey">
              {cls.duration_mins} min &middot; &pound;
              {formatPence(cls.price_pence)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <CapacityRing
            booked={booked}
            capacity={capacity}
            classSlug={cls.slug}
          />
          <div
            className={`flex h-5 w-5 items-center justify-center text-warm-grey transition-transform ${
              open ? "rotate-180" : ""
            }`}
          >
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />
          </div>
        </div>
      </div>

      {/* Attendee list */}
      <div
        className={`overflow-hidden border-t border-sand transition-[max-height] duration-300 ${
          open ? "max-h-[600px]" : "max-h-0 border-t-0"
        }`}
      >
        <div className="flex justify-between bg-cream px-5 py-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-warm-grey">
          <span>
            Attendees ({booked} of {capacity})
            {booked >= capacity ? " \u2014 FULL" : ""}
          </span>
          <span>Payment</span>
        </div>

        {/* Booked attendees */}
        {attendees.map((att, i) => (
          <div
            key={att.id}
            className="flex items-center gap-3 border-b border-sand/40 px-5 py-2 text-[0.82rem] last:border-b-0"
          >
            <span className="w-5 text-center text-[0.7rem] text-warm-grey">
              {i + 1}
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sand font-heading text-[0.7rem] font-semibold text-cocoa">
              {getInitial(att.full_name)}
            </div>
            <span className="flex-1 font-medium text-cocoa">
              {att.full_name ?? "Unknown"}
            </span>
            <AttendanceDropdown
              bookingId={att.id}
              currentStatus={att.attendance_status as AttendanceStatus | null}
              size="sm"
            />
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase ${paymentStyle(att.payment_method)}`}
            >
              {paymentLabel(att.payment_method)}
            </span>
          </div>
        ))}

        {/* Empty spots */}
        {Array.from({ length: capacity - booked }, (_, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center gap-3 border-b border-sand/40 px-5 py-2 last:border-b-0"
          >
            <span className="w-5 text-center text-[0.7rem] text-warm-grey">
              {booked + i + 1}
            </span>
            <div className="h-7 w-7 rounded-full border-[1.5px] border-dashed border-sand" />
            <span className="text-[0.78rem] italic text-sand">Open spot</span>
          </div>
        ))}
      </div>
    </div>
  )
}
