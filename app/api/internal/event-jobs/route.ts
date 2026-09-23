import { NextRequest, NextResponse } from "next/server"
import { runEventJobs } from "@/lib/event-tickets"

export const maxDuration = 60

/**
 * POST /api/internal/event-jobs
 *
 * Called every minute by the `event-jobs` pg_cron job (see
 * supabase/migrations/20260923_02_event_jobs_cron.sql). Sends "tickets are on
 * sale" alerts and offers freed event places to the waitlist.
 *
 * Nothing about who can buy depends on this running — sale times, holds and
 * offers are all checked live at purchase — so a missed tick only delays email.
 *
 * Authenticated with CRON_SECRET, the same secret /api/cron uses, which pg_cron
 * reads from Vault.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[internal/event-jobs] CRON_SECRET not set")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runEventJobs()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[internal/event-jobs] Failed:", err)
    return NextResponse.json({ error: "Job failed" }, { status: 500 })
  }
}
