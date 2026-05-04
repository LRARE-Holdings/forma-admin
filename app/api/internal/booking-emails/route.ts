import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sendBookingConfirmation } from "@/lib/email/booking-confirmation"
import { sendBookingNotification } from "@/lib/email/booking-notification"
import { sendBookingCancellationNotification } from "@/lib/email/booking-cancellation-notification"

const schema = z.object({
  event: z.enum(["created", "cancelled"]).default("created"),
  studioId: z.string().uuid(),
  profileId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(["stripe", "pack_credit", "membership", "complimentary", "birthday"]),
  cancelledBy: z.enum(["member", "admin"]).optional(),
})

/**
 * POST /api/internal/booking-emails
 *
 * Internal endpoint called by burn-public when a non-Stripe booking is created
 * or cancelled. For "created", sends member confirmation + instructor/admin
 * notification. For "cancelled", sends instructor/admin cancellation notification
 * (member email is sent locally by the caller).
 *
 * Authenticated with a shared secret (INTERNAL_EMAIL_SECRET) via Authorization
 * bearer header.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.INTERNAL_EMAIL_SECRET
  if (!secret) {
    console.error("[internal/booking-emails] INTERNAL_EMAIL_SECRET not set")
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

  const { event, studioId, profileId, scheduleId, date, paymentMethod, cancelledBy } = parsed.data

  const tasks =
    event === "cancelled"
      ? [
          sendBookingCancellationNotification(
            studioId,
            profileId,
            scheduleId,
            date,
            paymentMethod,
            cancelledBy ?? "member",
          ),
        ]
      : [
          sendBookingConfirmation(studioId, profileId, scheduleId, date),
          sendBookingNotification(studioId, profileId, scheduleId, date, paymentMethod),
        ]

  const results = await Promise.allSettled(tasks)

  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[internal/booking-emails] Email failed:", r.reason)
    }
  }

  return NextResponse.json({ success: true })
}
