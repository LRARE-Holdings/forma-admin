import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { offerWaitlistPlaces } from "@/lib/event-tickets"

const schema = z.object({
  studioId: z.string().uuid(),
  eventId: z.string().uuid(),
})

/**
 * POST /api/internal/event-waitlist-offer
 *
 * Called by burn-public the moment a member frees event places — cancelling
 * their tickets, or turning down a waitlist offer — so the next person in the
 * queue is offered them straight away rather than on the event job's next
 * tick. Offering is idempotent (offer_event_waitlist only offers places that
 * are actually free), so a duplicate call is harmless.
 *
 * Authenticated with the same shared secret as /api/internal/waitlist-promote.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.INTERNAL_EMAIL_SECRET
  if (!secret) {
    console.error("[internal/event-waitlist-offer] INTERNAL_EMAIL_SECRET not set")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }

  const { studioId, eventId } = parsed.data
  const { data: event } = await createAdminClient()
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("studio_id", studioId)
    .maybeSingle()
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  try {
    const offered = await offerWaitlistPlaces(eventId)
    return NextResponse.json({ offered })
  } catch (err) {
    console.error("[internal/event-waitlist-offer] Failed:", err)
    return NextResponse.json({ error: "Offer failed" }, { status: 500 })
  }
}
