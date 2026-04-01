import type { AttendanceStatus } from "@/lib/types"

export type AttendanceStatusOrNull = AttendanceStatus | null

/** Cycle through attendance states: null → attended → no_show → late_cancel → null */
export function nextAttendanceStatus(
  current: AttendanceStatusOrNull
): AttendanceStatusOrNull {
  switch (current) {
    case null:
      return "attended"
    case "attended":
      return "no_show"
    case "no_show":
      return "late_cancel"
    case "late_cancel":
      return null
  }
}

/** Human-readable label for an attendance state */
export function attendanceLabel(status: AttendanceStatusOrNull): string {
  switch (status) {
    case "attended":
      return "Attended"
    case "no_show":
      return "No-show"
    case "late_cancel":
      return "Late cancel"
    default:
      return "Mark attendance"
  }
}

/** Tailwind classes for attendance icon color */
export function attendanceColor(status: AttendanceStatusOrNull): string {
  switch (status) {
    case "attended":
      return "text-success"
    case "no_show":
      return "text-red-500"
    case "late_cancel":
      return "text-amber-500"
    default:
      return "text-sand"
  }
}
