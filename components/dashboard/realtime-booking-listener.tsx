"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

interface RealtimeBookingListenerProps {
  studioId: string
  /** When provided with onBookingChange, patches counts client-side (fast). */
  weekStart?: string
  weekEnd?: string
  onBookingChange?: (scheduleId: string, date: string, delta: number) => void
}

/**
 * Subscribes to booking changes via Supabase Realtime.
 *
 * Two modes:
 * 1. Smart mode (weekStart + weekEnd + onBookingChange): patches booking
 *    counts in parent state — no server round-trip.
 * 2. Simple mode (just studioId): falls back to debounced router.refresh()
 *    for pages like the dashboard overview.
 */
export function RealtimeBookingListener({
  studioId,
  weekStart,
  weekEnd,
  onBookingChange,
}: RealtimeBookingListenerProps) {
  const router = useRouter()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const smartMode = !!(weekStart && weekEnd && onBookingChange)

  useEffect(() => {
    const supabase = createClient()

    function debouncedRefresh() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        router.refresh()
      }, 300)
    }

    const channel = supabase
      .channel(`bookings:${studioId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bookings",
          filter: `studio_id=eq.${studioId}`,
        },
        (payload) => {
          if (smartMode) {
            const { schedule_id, date, status } = payload.new as {
              schedule_id: string
              date: string
              status: string
            }
            if (
              status === "confirmed" &&
              date >= weekStart &&
              date <= weekEnd
            ) {
              onBookingChange(schedule_id, date, +1)
            }
          } else {
            debouncedRefresh()
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "bookings",
          filter: `studio_id=eq.${studioId}`,
        },
        (payload) => {
          if (smartMode) {
            const oldRow = payload.old as { status?: string }
            const newRow = payload.new as {
              schedule_id: string
              date: string
              status: string
            }
            if (newRow.date < weekStart || newRow.date > weekEnd) return

            const wasConfirmed = oldRow.status === "confirmed"
            const isConfirmed = newRow.status === "confirmed"

            if (wasConfirmed && !isConfirmed) {
              onBookingChange(newRow.schedule_id, newRow.date, -1)
            } else if (!wasConfirmed && isConfirmed) {
              onBookingChange(newRow.schedule_id, newRow.date, +1)
            }
          } else {
            debouncedRefresh()
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "bookings",
          filter: `studio_id=eq.${studioId}`,
        },
        (payload) => {
          if (smartMode) {
            const { schedule_id, date, status } = payload.old as {
              schedule_id: string
              date: string
              status: string
            }
            if (
              status === "confirmed" &&
              date >= weekStart &&
              date <= weekEnd
            ) {
              onBookingChange(schedule_id, date, -1)
            }
          } else {
            debouncedRefresh()
          }
        }
      )
      .subscribe()

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      supabase.removeChannel(channel)
    }
  }, [studioId, weekStart, weekEnd, onBookingChange, smartMode, router])

  return null
}
