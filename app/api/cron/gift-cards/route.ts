import { NextResponse } from "next/server"
import { deliverDueGiftCards } from "@/lib/gift-cards"
import { recordJobRun } from "@/lib/monitor/run"

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
  const startedAt = Date.now()
  try {
    const outcome = await deliverDueGiftCards()
    await recordJobRun("admin.gift-cards", true, JSON.stringify(outcome).slice(0, 300), Date.now() - startedAt)
    return NextResponse.json(outcome)
  } catch (err) {
    console.error("[cron/gift-cards]", err)
    await recordJobRun("admin.gift-cards", false, err instanceof Error ? err.message : String(err), Date.now() - startedAt)
    return NextResponse.json({ error: "Gift card delivery failed" }, { status: 500 })
  }
}
