/**
 * Writes one row to app_errors. Used by instrumentation.ts (unhandled server
 * errors) and the client-error endpoint (error pages members actually saw).
 *
 * Talks to PostgREST with fetch instead of supabase-js so it stays tiny and
 * works in any runtime. It never throws: reporting an error must not cause one.
 *
 * Kept in step with burn-mat-studio/lib/monitor/report-error.ts.
 */

export interface ErrorReport {
  app: "admin" | "public"
  kind: string
  message: string
  path?: string | null
  method?: string | null
  route?: string | null
  digest?: string | null
  stack?: string | null
  userAgent?: string | null
}

// Same error, different ids and numbers: group them as one.
function normalise(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b(pi|ch|cus|acct|evt|re|in|sub|price|prod)_[A-Za-z0-9]+/g, "<stripe>")
    .replace(/\d+/g, "<n>")
    .slice(0, 300)
}

async function fingerprint(r: ErrorReport): Promise<string> {
  const basis = `${r.app}|${r.kind}|${r.route ?? r.path?.split("?")[0] ?? ""}|${normalise(r.message)}`
  const bytes = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(basis))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16)
}

// Next.js control flow, not failures.
const IGNORED = /NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING/

export async function reportError(r: ErrorReport): Promise<void> {
  try {
    if (IGNORED.test(r.message) || IGNORED.test(r.digest ?? "")) return
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return

    const fp = await fingerprint(r)
    const headers = { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" }

    // A loop that throws on every request shouldn't write thousands of rows:
    // 50 of one error an hour is plenty to see it.
    const since = new Date(Date.now() - 3_600_000).toISOString()
    const count = await fetch(
      `${url}/rest/v1/app_errors?select=id&fingerprint=eq.${fp}&occurred_at=gte.${encodeURIComponent(since)}`,
      { method: "HEAD", headers: { ...headers, Prefer: "count=exact" }, signal: AbortSignal.timeout(3000) }
    )
    const total = Number(count.headers.get("content-range")?.split("/")[1] ?? 0)
    if (total >= 50) return

    await fetch(`${url}/rest/v1/app_errors`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        app: r.app,
        kind: r.kind.slice(0, 40),
        fingerprint: fp,
        message: r.message.slice(0, 1000) || "(no message)",
        path: r.path?.slice(0, 300) ?? null,
        method: r.method?.slice(0, 10) ?? null,
        route: r.route?.slice(0, 200) ?? null,
        digest: r.digest?.slice(0, 100) ?? null,
        stack: r.stack?.slice(0, 4000) ?? null,
        user_agent: r.userAgent?.slice(0, 300) ?? null,
      }),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // Nowhere left to report to.
  }
}
