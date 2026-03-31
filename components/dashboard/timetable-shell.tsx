"use client"

import { useState, useMemo, useCallback } from "react"
import { WeekCalendar } from "./week-calendar"
import { RealtimeBookingListener } from "./realtime-booking-listener"
import type { WeekSlot, StudioHoliday } from "@/lib/types"

interface ClassOption {
  id: string
  name: string
  slug: string
  price_pence: number
  capacity: number
  duration_mins: number
}

interface InstructorOption {
  id: string
  name: string
}

interface TimetableShellProps {
  slots: WeekSlot[]
  holidays: StudioHoliday[]
  weekStart: string
  weekEnd: string
  classes: ClassOption[]
  instructors: InstructorOption[]
  isCurrentWeek: boolean
  studioId: string
}

export function TimetableShell({
  slots: initialSlots,
  holidays,
  weekStart,
  weekEnd,
  classes,
  instructors,
  isCurrentWeek,
  studioId,
}: TimetableShellProps) {
  // Track booking counts in local state, initialized from server data
  const [bookingCounts, setBookingCounts] = useState<Record<string, number>>(
    () => {
      const counts: Record<string, number> = {}
      for (const slot of initialSlots) {
        counts[`${slot.scheduleId}:${slot.date}`] = slot.bookingCount
      }
      return counts
    }
  )

  // Merge server slots with live booking counts
  const slots = useMemo(
    () =>
      initialSlots.map((slot) => ({
        ...slot,
        bookingCount:
          bookingCounts[`${slot.scheduleId}:${slot.date}`] ??
          slot.bookingCount,
      })),
    [initialSlots, bookingCounts]
  )

  // Callback for the realtime listener to patch individual booking counts
  const handleBookingChange = useCallback(
    (scheduleId: string, date: string, delta: number) => {
      setBookingCounts((prev) => {
        const key = `${scheduleId}:${date}`
        return {
          ...prev,
          [key]: Math.max(0, (prev[key] ?? 0) + delta),
        }
      })
    },
    []
  )

  return (
    <>
      <WeekCalendar
        slots={slots}
        holidays={holidays}
        weekStart={weekStart}
        weekEnd={weekEnd}
        classes={classes}
        instructors={instructors}
        isCurrentWeek={isCurrentWeek}
      />
      <RealtimeBookingListener
        studioId={studioId}
        weekStart={weekStart}
        weekEnd={weekEnd}
        onBookingChange={handleBookingChange}
      />
    </>
  )
}
