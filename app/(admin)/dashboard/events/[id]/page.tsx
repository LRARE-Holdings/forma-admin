import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { requireAdmin } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { EventTicketsPanel, type TicketRow, type WaitlistRow } from "@/components/dashboard/event-tickets-panel"
import { formatEventWhen, formatPounds, formatUkInstant } from "@/lib/events"
import type { StudioEvent } from "@/lib/types"
import { ChevronLeft } from "lucide-react"

type Person = { full_name: string | null; email: string | null } | null

export default async function EventTicketsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const supabase = await createClient()
  const studioId = await getStudioId()

  const { data: event } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .eq("studio_id", studioId)
    .maybeSingle()
  if (!event) notFound()
  const ev = event as StudioEvent

  const [{ data: tickets }, { data: waitlist }, { count: alertCount }] = await Promise.all([
    supabase
      .from("event_tickets")
      .select("id, quantity, amount_pence, status, cancelled_by, refunded_at, refund_amount_pence, confirmed_at, created_at, profiles:profile_id(full_name, email)")
      .eq("event_id", id)
      .in("status", ["confirmed", "cancelled"])
      .order("created_at"),
    supabase
      .from("event_waitlist")
      .select("id, quantity, status, expires_at, created_at, profiles:profile_id(full_name, email)")
      .eq("event_id", id)
      .in("status", ["waiting", "offered"])
      .order("created_at"),
    supabase
      .from("event_sale_alerts")
      .select("id", { count: "exact", head: true })
      .eq("event_id", id),
  ])

  const ticketRows: TicketRow[] = (tickets ?? []).map((t) => {
    const p = t.profiles as unknown as Person
    return {
      id: t.id as string,
      name: p?.full_name ?? "Unknown",
      email: p?.email ?? "",
      quantity: t.quantity as number,
      amountPence: t.amount_pence as number,
      status: t.status as "confirmed" | "cancelled",
      cancelledBy: t.cancelled_by as TicketRow["cancelledBy"],
      refundedPence: t.refunded_at ? ((t.refund_amount_pence as number | null) ?? 0) : null,
      boughtAt: (t.confirmed_at ?? t.created_at) as string,
    }
  })

  const waitlistRows: WaitlistRow[] = (waitlist ?? []).map((w) => {
    const p = w.profiles as unknown as Person
    return {
      id: w.id as string,
      name: p?.full_name ?? "Unknown",
      email: p?.email ?? "",
      quantity: w.quantity as number,
      status: w.status as "waiting" | "offered",
      offerExpires: w.expires_at ? formatUkInstant(w.expires_at as string) : null,
    }
  })

  const confirmed = ticketRows.filter((t) => t.status === "confirmed")
  const placesSold = confirmed.reduce((sum, t) => sum + t.quantity, 0)
  const takings = ticketRows.reduce((sum, t) => sum + t.amountPence - (t.refundedPence ?? 0), 0)
  const salesNote = ev.cancelled_at
    ? "Cancelled"
    : ev.sales_open_at && new Date(ev.sales_open_at) > new Date()
      ? `On sale ${formatUkInstant(ev.sales_open_at)}`
      : placesSold >= (ev.capacity ?? 0)
        ? "Sold out"
        : "On sale"

  return (
    <>
      <Link
        href="/dashboard/events"
        className="mb-3 inline-flex items-center gap-1 text-[0.75rem] font-semibold text-warm-grey hover:text-cocoa"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Events
      </Link>
      <PageHeader
        title={ev.title}
        description={`${formatEventWhen(ev)}${ev.location ? ` · ${ev.location}` : ""} · ${formatPounds(ev.price_pence)} per ticket`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Places sold" value={`${placesSold} / ${ev.capacity ?? 0}`} />
        <StatCard label="Taken (after refunds)" value={formatPounds(takings)} />
        <StatCard label="On the waitlist" value={String(waitlistRows.length)} />
        <StatCard label={ev.sales_open_at ? "Asked to be notified" : "Status"} value={ev.sales_open_at ? String(alertCount ?? 0) : salesNote} />
      </div>

      <EventTicketsPanel
        eventId={ev.id}
        eventTitle={ev.title}
        cancelled={!!ev.cancelled_at}
        salesNote={salesNote}
        tickets={ticketRows}
        waitlist={waitlistRows}
      />
    </>
  )
}
