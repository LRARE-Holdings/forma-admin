"use client"

import { useState } from "react"
import Link from "next/link"
import { EmptyState } from "@/components/shared/empty-state"
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog"
import { EventFormDialog } from "./event-form-dialog"
import { deleteEvent } from "@/app/actions/events"
import { Button } from "@/components/ui/button"
import { formatTime } from "@/lib/utils"
import { formatPounds, formatUkInstant } from "@/lib/events"
import type { StudioEvent } from "@/lib/types"
import { Plus } from "lucide-react"
import { toast } from "sonner"

interface EventsTableProps {
  upcoming: StudioEvent[]
  past: StudioEvent[]
  placesSold: Record<string, number>
  stripeConnected: boolean
}

function formatEventDate(event: StudioEvent): string {
  const date = new Date(`${event.event_date}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
  if (!event.start_time) return date
  const times = event.end_time
    ? `${formatTime(event.start_time)}–${formatTime(event.end_time)}`
    : formatTime(event.start_time)
  return `${date} · ${times}`
}

export function EventsTable({ upcoming, past, placesSold, stripeConnected }: EventsTableProps) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<StudioEvent | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletingEvent, setDeletingEvent] = useState<StudioEvent | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  function openCreate() {
    setEditingEvent(null)
    setFormOpen(true)
  }

  function openEdit(event: StudioEvent) {
    setEditingEvent(event)
    setFormOpen(true)
  }

  function openDelete(event: StudioEvent) {
    setDeletingEvent(event)
    setDeleteOpen(true)
  }

  async function handleDelete() {
    if (!deletingEvent) return
    setDeleteLoading(true)
    try {
      const result = await deleteEvent(deletingEvent.id)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success("Event deleted")
      setDeleteOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete event")
    } finally {
      setDeleteLoading(false)
    }
  }

  const newButton = (
    <Button onClick={openCreate} size="sm">
      <Plus className="mr-1.5 h-3.5 w-3.5" />
      New event
    </Button>
  )

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="flex items-center justify-between border-b border-sand px-5 py-4">
          <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
            Upcoming events
          </h3>
          {upcoming.length > 0 && newButton}
        </div>
        {upcoming.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No upcoming events"
            description="Post a workshop, social or special class. It shows on your website's home page until the day has passed."
            action={newButton}
          />
        ) : (
          <EventRows events={upcoming} placesSold={placesSold} onEdit={openEdit} onDelete={openDelete} />
        )}
      </div>

      {past.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-sand bg-white">
          <div className="border-b border-sand px-5 py-4">
            <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
              Past events
            </h3>
          </div>
          <EventRows events={past} placesSold={placesSold} onEdit={openEdit} onDelete={openDelete} muted />
        </div>
      )}

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingEvent={editingEvent}
        stripeConnected={stripeConnected}
        placesSold={editingEvent ? placesSold[editingEvent.id] ?? 0 : 0}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete event"
        description={`Delete "${deletingEvent?.title}"? It will be removed from your website straight away.`}
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </>
  )
}

function TicketSummary({ event, sold }: { event: StudioEvent; sold: number }) {
  if (!event.tickets_enabled) return null
  const onSaleLater = event.sales_open_at && new Date(event.sales_open_at) > new Date()
  const soldOut = sold >= (event.capacity ?? 0)
  return (
    <div className="mt-0.5 text-[0.72rem] text-warm-grey">
      <span className="font-semibold text-cocoa">{sold}/{event.capacity}</span> sold
      {" · "}
      {formatPounds(event.price_pence)} each
      {!event.cancelled_at && (
        <>
          {" · "}
          {soldOut ? (
            <span className="font-semibold text-ember">Sold out</span>
          ) : onSaleLater ? (
            <span>On sale {formatUkInstant(event.sales_open_at!)}</span>
          ) : (
            <span className="font-semibold text-gold">On sale</span>
          )}
        </>
      )}
    </div>
  )
}

function EventRows({
  events,
  placesSold,
  onEdit,
  onDelete,
  muted,
}: {
  events: StudioEvent[]
  placesSold: Record<string, number>
  onEdit: (event: StudioEvent) => void
  onDelete: (event: StudioEvent) => void
  muted?: boolean
}) {
  return (
    <ul>
      {events.map((event) => (
        <li
          key={event.id}
          className="flex items-center gap-4 border-b border-sand/50 px-5 py-3 transition-colors last:border-b-0 hover:bg-cream/50"
        >
          {event.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.image_url}
              alt=""
              className={`hidden h-12 w-[85px] shrink-0 rounded-md object-cover sm:block ${muted ? "opacity-60" : ""}`}
            />
          ) : (
            <div className="hidden h-12 w-[85px] shrink-0 rounded-md bg-sand/50 sm:block" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className={`truncate text-[0.82rem] ${muted ? "text-warm-grey" : "text-cocoa"}`}>
                {event.title}
              </strong>
              {event.cancelled_at && (
                <span className="rounded-full bg-ember/10 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-ember">
                  Cancelled
                </span>
              )}
              {!event.is_published && (
                <span className="rounded-full bg-sand/60 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-warm-grey">
                  Draft
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[0.75rem] text-warm-grey">
              {formatEventDate(event)}
              {event.location && ` · ${event.location}`}
            </div>
            <TicketSummary event={event} sold={placesSold[event.id] ?? 0} />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {event.tickets_enabled && (
              <Link
                href={`/dashboard/events/${event.id}`}
                className="text-[0.75rem] font-semibold text-cocoa hover:text-gold"
              >
                Tickets
              </Link>
            )}
            {!event.cancelled_at && (
            <button
              onClick={() => onEdit(event)}
              className="text-[0.75rem] font-semibold text-gold hover:text-ember"
            >
              Edit
            </button>
            )}
            <button
              onClick={() => onDelete(event)}
              className="text-[0.75rem] font-semibold text-warm-grey hover:text-red-600"
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
