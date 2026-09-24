import { createClient } from "@/lib/supabase/server"
import type { TimetableEvent } from "@/lib/types"

/**
 * Events between two dates (inclusive) for the admin timetable. Drafts are
 * included and labelled; cancelled events are left out.
 */
export async function getTimetableEvents(studioId: string, from: string, to: string): Promise<TimetableEvent[]> {
  const supabase = await createClient()
  const { data: events } = await supabase
    .from("events")
    .select("id, title, event_date, start_time, end_time, capacity, is_published")
    .eq("studio_id", studioId)
    .is("cancelled_at", null)
    .gte("event_date", from)
    .lte("event_date", to)
    .order("event_date")
    .order("start_time")
  if (!events || events.length === 0) return []

  const { data: tickets } = await supabase
    .from("event_tickets")
    .select("event_id, quantity")
    .in("event_id", events.map((e) => e.id as string))
    .eq("status", "confirmed")
  const sold = new Map<string, number>()
  for (const t of tickets ?? []) {
    sold.set(t.event_id as string, (sold.get(t.event_id as string) ?? 0) + (t.quantity as number))
  }

  return events.map((e) => ({
    id: e.id as string,
    title: e.title as string,
    date: e.event_date as string,
    startTime: (e.start_time as string | null) ?? null,
    endTime: (e.end_time as string | null) ?? null,
    capacity: e.capacity as number,
    ticketsSold: sold.get(e.id as string) ?? 0,
    isPublished: !!e.is_published,
  }))
}
