import { NextResponse } from "next/server"
import { runMonitor } from "@/lib/monitor/run"

// Some checks (certificates, Stripe, Resend) each take a few seconds; they run
// in parallel, and none is allowed more than 25s.
export const maxDuration = 60

/**
 * POST /api/internal/monitor
 *
 * Runs the health checks that are due and sends any alerts. Called every five
 * minutes by the `monitor` pg_cron job in Supabase. The GitHub Actions
 * watchdog checks from outside that this keeps happening (via /api/health).
 */
export async function POST(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // ?force=1 runs every check now; ?only=key,key runs just those.
  const url = new URL(request.url)
  const only = url.searchParams.get("only")?.split(",").filter(Boolean)
  const report = await runMonitor({ force: url.searchParams.get("force") === "1" || !!only, only })
  return NextResponse.json(report)
}
