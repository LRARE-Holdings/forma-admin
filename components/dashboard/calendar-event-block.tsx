"use client"

import Link from "next/link"
import { Ticket } from "lucide-react"
import { formatTime } from "@/lib/utils"
import type { TimetableEvent } from "@/lib/types"

/** "12/13 tickets", with drafts saying so instead of a count. */
function ticketsLabel(event: TimetableEvent): string {
  if (!event.isPublished) return "Draft"
  return `${event.ticketsSold}/${event.capacity}`
}

function eventTimes(event: TimetableEvent): string {
  if (!event.startTime) return "All day"
  return event.endTime ? `${formatTime(event.startTime)}–${formatTime(event.endTime)}` : formatTime(event.startTime)
}

/**
 * An event on the week grid. Dark so it can't be mistaken for a class, and a
 * link to the event in the dashboard rather than the class pop-up.
 */
export function CalendarEventBlock({
  event,
  position,
  lane,
}: {
  event: TimetableEvent
  position: { top: number; height: number }
  lane?: { lane: number; lanes: number }
}) {
  const lanes = lane?.lanes ?? 1
  const index = lane?.lane ?? 0
  const isCompact = position.height < 60

  return (
    <Link
      href={`/dashboard/events/${event.id}`}
      data-slot-block
      onClick={(e) => e.stopPropagation()}
      title={`${event.title} · ${eventTimes(event)} · event`}
      className={`absolute z-20 overflow-hidden rounded-lg px-2 py-1 transition-shadow hover:shadow-md ${
        event.isPublished ? "bg-cocoa text-cream" : "border border-dashed border-cocoa/50 bg-cream text-cocoa"
      }`}
      style={{
        top: `${position.top + 2}px`,
        height: `${position.height - 4}px`,
        left: `calc(${(index / lanes) * 100}% + 4px)`,
        width: `calc(${100 / lanes}% - 8px)`,
      }}
    >
      <div className="flex items-center gap-1">
        <Ticket className="h-2.5 w-2.5 shrink-0 text-gold" />
        <span className="truncate text-[0.72rem] font-semibold">{event.title}</span>
      </div>
      {!isCompact && (
        <>
          <div className="text-[0.58rem] font-semibold uppercase tracking-[0.08em] text-gold">Event</div>
          <div className="mt-0.5 flex items-center justify-between gap-1">
            <span className={`text-[0.6rem] ${event.isPublished ? "text-cream/75" : "text-warm-grey"}`}>{eventTimes(event)}</span>
            <span className="text-[0.58rem] font-semibold">{ticketsLabel(event)}</span>
          </div>
        </>
      )}
    </Link>
  )
}

/** An all-day event, as a banner at the top of its day column. */
export function CalendarAllDayEvent({ event }: { event: TimetableEvent }) {
  return (
    <Link
      href={`/dashboard/events/${event.id}`}
      data-slot-block
      onClick={(e) => e.stopPropagation()}
      className={`relative z-30 mx-1 mt-1 flex items-center gap-1 truncate rounded-md px-2 py-1 text-[0.62rem] font-semibold ${
        event.isPublished ? "bg-cocoa text-cream" : "border border-dashed border-cocoa/50 bg-cream text-cocoa"
      }`}
      title={`${event.title} · all day · event`}
    >
      <Ticket className="h-2.5 w-2.5 shrink-0 text-gold" />
      <span className="truncate">{event.title}</span>
    </Link>
  )
}

/** An event in a list (mobile day view). */
export function EventListRow({ event }: { event: TimetableEvent }) {
  return (
    <Link
      href={`/dashboard/events/${event.id}`}
      className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
        event.isPublished ? "bg-cocoa text-cream hover:bg-cocoa/90" : "border border-dashed border-cocoa/50 bg-cream text-cocoa"
      }`}
    >
      <Ticket className="h-4 w-4 shrink-0 text-gold" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.85rem] font-semibold">{event.title}</div>
        <div className={`text-[0.72rem] ${event.isPublished ? "text-cream/75" : "text-warm-grey"}`}>
          Event &middot; {eventTimes(event)}
        </div>
      </div>
      <span className="text-[0.7rem] font-semibold">{event.isPublished ? `${ticketsLabel(event)} tickets` : "Draft"}</span>
    </Link>
  )
}

export { ticketsLabel, eventTimes }
