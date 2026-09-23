import { formatTime } from "@/lib/utils"
import type { StudioEvent } from "@/lib/types"

const TZ = "Europe/London"

/** Minutes the UK is ahead of UTC at a given instant (0 in GMT, 60 in BST). */
function ukOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at)
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"))
  return Math.round((asUtc - at.getTime()) / 60000)
}

/**
 * A UK wall-clock date and time ("2026-10-11", "19:00") as an ISO instant.
 * Vercel runs in UTC, so `new Date("2026-10-11T19:00")` would be an hour out
 * all summer.
 */
export function ukWallClockToIso(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number)
  const [hh, mm] = time.split(":").map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  // The offset at the guess is right except within an hour of a clock change;
  // a second pass settles it.
  let instant = guess - ukOffsetMinutes(new Date(guess)) * 60000
  instant = guess - ukOffsetMinutes(new Date(instant)) * 60000
  return new Date(instant).toISOString()
}

/** An instant as UK wall-clock `{ date: "YYYY-MM-DD", time: "HH:MM" }`, for form defaults. */
export function isoToUkWallClock(iso: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`,
  }
}

/** "Saturday 11 October, 18:00–20:00" */
export function formatEventWhen(
  event: Pick<StudioEvent, "event_date" | "start_time" | "end_time">,
): string {
  const date = new Date(`${event.event_date}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  if (!event.start_time) return date
  const times = event.end_time
    ? `${formatTime(event.start_time)}–${formatTime(event.end_time)}`
    : formatTime(event.start_time)
  return `${date}, ${times}`
}

/** "12 Oct, 19:00" in UK time */
export function formatUkInstant(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatPounds(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`
}
