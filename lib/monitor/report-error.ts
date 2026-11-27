/**
 * Writing to the monitor's tables from either app: app_errors (something
 * broke) and app_events (something happened worth seeing later: a payment
 * handled, a checkout started, a request refused, an action that showed Lucy
 * an error).
 *
 * Talks to PostgREST with fetch instead of supabase-js so it stays tiny and
 * works in any runtime. Nothing here throws: reporting a problem must never
 * cause one.
 *
 * Kept in step with burn-mat-studio/lib/monitor/report-error.ts.
 */

import { monitorContext } from "./context"

export type MonitorApp = "admin" | "public"

export interface ErrorReport {
  app: MonitorApp
  kind: string
  message: string
  path?: string | null
  method?: string | null
  route?: string | null
  digest?: string | null
  stack?: string | null
  userAgent?: string | null
  requestId?: string | null
  correlation?: string | null
  profileId?: string | null
  data?: Record<string, unknown> | null
  /** When it happened, if not now (the write can land a moment later). */
  at?: string
}

export interface EventReport {
  app: MonitorApp
  level?: "info" | "warn" | "error"
  category: string
  event: string
  message?: string | null
  path?: string | null
  statusCode?: number | null
  durationMs?: number | null
  requestId?: string | null
  correlation?: string | null
  profileId?: string | null
  data?: Record<string, unknown> | null
  at?: string
}

// Same error, different ids and numbers: group them as one.
export function normaliseMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b(pi|ch|cus|acct|evt|re|in|sub|price|prod|seti|py|po)_[A-Za-z0-9]+/g, "<stripe>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\d+/g, "<n>")
    .slice(0, 300)
}

async function fingerprint(r: ErrorReport): Promise<string> {
  const basis = `${r.app}|${r.kind}|${r.route ?? r.path?.split("?")[0] ?? ""}|${normaliseMessage(r.message)}`
  const bytes = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(basis))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16)
}

// Next.js control flow, not failures.
const IGNORED = /NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING/

function rest() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" } }
}

const release = () => process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null

export async function reportError(r: ErrorReport): Promise<void> {
  const at = r.at ?? new Date().toISOString()
  try {
    if (IGNORED.test(r.message) || IGNORED.test(r.digest ?? "")) return
    const api = rest()
    if (!api) return
    const ctx = monitorContext()
    const fp = await fingerprint(r)

    // A loop that throws on every request shouldn't write thousands of rows:
    // 50 of one error an hour is plenty to see it.
    const since = new Date(Date.now() - 3_600_000).toISOString()
    const count = await fetch(
      `${api.url}/rest/v1/app_errors?select=id&fingerprint=eq.${fp}&occurred_at=gte.${encodeURIComponent(since)}`,
      { method: "HEAD", headers: { ...api.headers, Prefer: "count=exact" }, signal: AbortSignal.timeout(3000) },
    )
    const total = Number(count.headers.get("content-range")?.split("/")[1] ?? 0)
    if (total >= 50) return

    await fetch(`${api.url}/rest/v1/app_errors`, {
      method: "POST",
      headers: { ...api.headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        app: r.app,
        kind: r.kind.slice(0, 40),
        fingerprint: fp,
        message: r.message.slice(0, 1000) || "(no message)",
        path: (r.path ?? ctx?.path)?.slice(0, 300) ?? null,
        method: r.method?.slice(0, 10) ?? null,
        route: r.route?.slice(0, 200) ?? null,
        digest: r.digest?.slice(0, 100) ?? null,
        stack: r.stack?.slice(0, 4000) ?? null,
        user_agent: r.userAgent?.slice(0, 300) ?? null,
        request_id: r.requestId ?? ctx?.requestId ?? null,
        correlation: r.correlation ?? ctx?.correlation ?? null,
        profile_id: r.profileId ?? ctx?.profileId ?? null,
        release: release(),
        data: r.data ?? null,
        occurred_at: at,
      }),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // Nowhere left to report to.
  }
}

export async function logEvent(e: EventReport): Promise<void> {
  const at = e.at ?? new Date().toISOString()
  try {
    const api = rest()
    if (!api) return
    const ctx = monitorContext()
    await fetch(`${api.url}/rest/v1/app_events`, {
      method: "POST",
      headers: { ...api.headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        app: e.app,
        level: e.level ?? "info",
        category: e.category.slice(0, 40),
        event: e.event.slice(0, 120),
        message: e.message?.slice(0, 1000) ?? null,
        path: (e.path ?? ctx?.path)?.slice(0, 300) ?? null,
        status_code: e.statusCode ?? null,
        duration_ms: e.durationMs ?? null,
        request_id: e.requestId ?? ctx?.requestId ?? null,
        correlation: e.correlation ?? ctx?.correlation ?? null,
        profile_id: e.profileId ?? ctx?.profileId ?? null,
        data: e.data ?? null,
        occurred_at: at,
      }),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // Logging must never break the request.
  }
}
