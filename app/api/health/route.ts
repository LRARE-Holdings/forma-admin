import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

/**
 * GET /api/health
 *
 * Public and deliberately thin: whether this app can reach its database, when
 * the monitor last ran and how many checks are failing. No names, no detail.
 * The GitHub Actions watchdog reads it from outside Vercel and Supabase, so a
 * dead monitor or an unreachable database still gets noticed.
 */
export async function GET() {
  try {
    const db = createAdminClient()
    const [run, failing] = await Promise.all([
      db.from("monitor_runs").select("created_at").eq("job", "monitor").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("monitor_checks").select("key", { count: "exact", head: true }).eq("status", "down"),
    ])
    if (run.error) throw new Error(run.error.message)
    return NextResponse.json(
      { status: "ok", database: "ok", monitor_last_run: run.data?.created_at ?? null, checks_down: failing.count ?? 0 },
      { headers: { "cache-control": "no-store" } }
    )
  } catch {
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } })
  }
}
