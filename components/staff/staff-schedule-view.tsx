"use client"

import { useState } from "react"
import { DAY_SHORT } from "@/lib/constants"
import { dateToDateStr } from "@/lib/utils"
import { StaffClassCard } from "./staff-class-card"

interface SlotData {
  id: string
  day_of_week: number
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

interface StaffScheduleViewProps {
  slots: SlotData[]
  bookingsBySlotDate: Record<
    string,
    { id: string; full_name: string | null; payment_method: string; attendance_status: string | null }[]
  >
  weekStart: string
}

export function StaffScheduleView({
  slots,
  bookingsBySlotDate,
  weekStart,
}: StaffScheduleViewProps) {
  const now = new Date()
  const jsDow = now.getDay()
  const todayDow = jsDow === 0 ? 6 : jsDow - 1

  const [selectedDay, setSelectedDay] = useState(todayDow)

  // Calculate dates for each day tab
  const monday = new Date(weekStart + "T00:00:00")
  const dayDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d.getDate()
  })

  const daySlots = slots.filter((s) => s.day_of_week === selectedDay)
  const selectedDate = new Date(monday)
  selectedDate.setDate(monday.getDate() + selectedDay)
  const dateStr = dateToDateStr(selectedDate)

  return (
    <>
      {/* Day tabs */}
      <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
        {DAY_SHORT.map((day, i) => (
          <button
            key={i}
            onClick={() => setSelectedDay(i)}
            className={`flex flex-col items-center rounded-full border px-4 py-2 text-[0.75rem] font-semibold transition-all ${
              selectedDay === i
                ? "border-cocoa bg-cocoa text-wheat"
                : "border-sand bg-white text-slate hover:border-gold"
            }`}
          >
            <span
              className={`text-[0.62rem] font-medium ${
                selectedDay === i ? "text-gold" : "text-warm-grey"
              }`}
            >
              {day}
            </span>
            {dayDates[i]}
          </button>
        ))}
      </div>

      {/* Class cards */}
      {daySlots.length === 0 ? (
        <div className="py-12 text-center text-warm-grey">
          <h3 className="font-heading text-[1.3rem] font-medium text-cocoa">
            No classes on {DAY_SHORT[selectedDay] === "Mon" ? "Monday" : DAY_SHORT[selectedDay] === "Tue" ? "Tuesday" : DAY_SHORT[selectedDay] === "Wed" ? "Wednesday" : DAY_SHORT[selectedDay] === "Thu" ? "Thursday" : DAY_SHORT[selectedDay] === "Fri" ? "Friday" : DAY_SHORT[selectedDay] === "Sat" ? "Saturday" : "Sunday"}
          </h3>
          <p className="mt-1 text-sm">
            You don&apos;t have any classes scheduled for this day.
          </p>
        </div>
      ) : (
        daySlots.map((slot) => {
          const key = `${slot.id}:${dateStr}`
          const attendees = bookingsBySlotDate[key] ?? []
          return (
            <StaffClassCard
              key={slot.id}
              slot={slot}
              attendees={attendees}
            />
          )
        })
      )}
    </>
  )
}
