"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

interface RealtimeBookingListenerProps {
  studioId: string
}

/**
 * Invisible component that subscribes to booking changes via Supabase Realtime.
 * On any change, calls router.refresh() (debounced) to re-render server components
 * with fresh booking counts.
 */
export function RealtimeBookingListener({ studioId }: RealtimeBookingListenerProps) {
  const router = useRouter()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`bookings:${studioId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
          filter: `studio_id=eq.${studioId}`,
        },
        () => {
          // Debounce: wait 300ms before refreshing to batch rapid changes
          if (timeoutRef.current) clearTimeout(timeoutRef.current)
          timeoutRef.current = setTimeout(() => {
            router.refresh()
          }, 300)
        }
      )
      .subscribe()

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      supabase.removeChannel(channel)
    }
  }, [studioId, router])

  return null
}
