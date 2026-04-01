"use client"

import { useState } from "react"
import { Check, XCircle, Clock, Undo2, Loader2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { markAttendance } from "@/app/actions/bookings"
import { attendanceLabel, attendanceColor } from "@/lib/attendance"
import { toast } from "sonner"
import type { AttendanceStatus } from "@/lib/types"

interface AttendanceDropdownProps {
  bookingId: string
  currentStatus: AttendanceStatus | null
  onStatusChange?: (newStatus: AttendanceStatus | null) => void
  size?: "sm" | "default"
}

export function AttendanceDropdown({
  bookingId,
  currentStatus,
  onStatusChange,
  size = "default",
}: AttendanceDropdownProps) {
  const [status, setStatus] = useState<AttendanceStatus | null>(currentStatus)
  const [loading, setLoading] = useState(false)

  async function handleSelect(newStatus: AttendanceStatus | null) {
    if (newStatus === status) return
    setLoading(true)
    try {
      await markAttendance(bookingId, newStatus)
      setStatus(newStatus)
      onStatusChange?.(newStatus)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update attendance")
    } finally {
      setLoading(false)
    }
  }

  const isSmall = size === "sm"
  const label = status ? attendanceLabel(status) : "\u2014"
  const colorClass = attendanceColor(status)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={loading}
        className={`inline-flex items-center gap-1 rounded-full border border-sand font-semibold uppercase transition-colors hover:border-gold focus:outline-none disabled:opacity-50 ${
          isSmall ? "px-1.5 py-0.5 text-[0.58rem]" : "px-2.5 py-1 text-[0.65rem]"
        } ${status ? colorClass : "text-warm-grey"}`}
      >
        {loading ? (
          <Loader2 className={`animate-spin ${isSmall ? "h-3 w-3" : "h-3.5 w-3.5"}`} />
        ) : status === "attended" ? (
          <Check className={isSmall ? "h-3 w-3" : "h-3.5 w-3.5"} />
        ) : status === "no_show" ? (
          <XCircle className={isSmall ? "h-3 w-3" : "h-3.5 w-3.5"} />
        ) : status === "late_cancel" ? (
          <Clock className={isSmall ? "h-3 w-3" : "h-3.5 w-3.5"} />
        ) : null}
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        <DropdownMenuItem
          onClick={() => handleSelect("attended")}
          className="gap-2 text-success"
        >
          <Check className="h-3.5 w-3.5" />
          Attended
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleSelect("no_show")}
          className="gap-2 text-red-500"
        >
          <XCircle className="h-3.5 w-3.5" />
          No-show
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleSelect("late_cancel")}
          className="gap-2 text-amber-500"
        >
          <Clock className="h-3.5 w-3.5" />
          Late cancel
        </DropdownMenuItem>
        {status !== null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleSelect(null)}
              className="gap-2 text-warm-grey"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Clear
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
