import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { promoteNextInWaitlist } from "@/lib/waitlist"
import { localDateStr } from "@/lib/utils"

const schema = z.object({
  studioId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

/**
 * POST /api/internal/waitlist-promote
 *
 * Internal endpoint called by burn-public when a member cancels their own
 * booking, so the spot they freed is offered to the next person waiting.
 *
 * Waitlist promotion lives here because the offer email and its 30-minute claim
 * window are owned by this app. Until then only admin-side cancellations
 * promoted anyone: a member cancelling on the public site left the waitlist
 * untouched, and the spot sat empty while people waited for it.
 *
 * Authenticated with the same shared secret as /api/internal/booking-emails.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.INTERNAL_EMAIL_SECRET
  if (!secret) {
    console.error("[internal/waitlist-promote] INTERNAL_EMAIL_SECRET not set")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const { studioId, scheduleId, date } = parsed.data

  // Nothing to offer for a class that has already been and gone.
  if (date < localDateStr()) {
    return NextResponse.json({ promoted: false, reason: "past" })
  }

  try {
    await promoteNextInWaitlist(studioId, scheduleId, date)
  } catch (err) {
    console.error("[internal/waitlist-promote] Promotion failed:", err)
    return NextResponse.json({ error: "Promotion failed" }, { status: 500 })
  }

  return NextResponse.json({ promoted: true })
}
