import { NextResponse } from "next/server"
import { deliverDueGiftCards } from "@/lib/gift-cards"

export const maxDuration = 300

/**
 * GET /api/cron/gift-cards
 *
 * Daily at 08:00 UTC (8am UK in winter, 9am in summer). Emails each gift card
 * to its recipient on the date the buyer chose, and retries any buyer copy
 * that failed straight after payment.
 */
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    return NextResponse.json(await deliverDueGiftCards())
  } catch (err) {
    console.error("[cron/gift-cards]", err)
    return NextResponse.json({ error: "Gift card delivery failed" }, { status: 500 })
  }
}
