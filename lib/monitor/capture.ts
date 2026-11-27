import { after } from "next/server"
import { monitorContext, requestIds } from "./context"
import { reportError, logEvent, type MonitorApp } from "./report-error"

/**
 * Installed once per server process from instrumentation.ts. Catches what the
 * apps already say but nobody reads:
 *
 *   console.error("[webhook] Email failed:", err)   → app_errors ("logged")
 *   NextResponse.json({ error }, { status: 4xx })   → app_events ("request")
 *   NextResponse.json({ error }, { status: 5xx })   → app_events + app_errors
 *
 * Only console.error calls that start with a message string are taken: the
 * apps write them that way, while Next.js logs its own unhandled errors as an
 * Error object, which onRequestError already reports.
 *
 * Kept in step with burn-mat-studio/lib/monitor/capture.ts.
 */

const INSTALLED = Symbol.for("forma.monitor.capture")
const building = () => process.env.NEXT_PHASE === "phase-production-build"

// Keep the function alive until the write lands (inside a request), or just
// let it run (outside one, e.g. at startup).
function track(p: Promise<unknown>) {
  try {
    after(() => p)
  } catch {
    void p
  }
}

/** Request id and path: from withMonitorContext, else the proxy's headers. */
async function context(): Promise<{ requestId?: string; path?: string; fromMonitor?: boolean }> {
  const ctx = monitorContext()
  if (ctx?.requestId) return ctx
  if (building()) return {}
  try {
    const { headers } = await import("next/headers")
    const h = await headers()
    // The monitor's own probes (e.g. the checkout check's empty request)
    // aren't members being turned away.
    return { ...requestIds(h), fromMonitor: /FormaMonitor/.test(h.get("user-agent") ?? "") }
  } catch {
    return {}
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const v = value as { message?: unknown; error?: unknown; code?: unknown }
    if (typeof v.message === "string") return v.code ? `${v.message} (${String(v.code)})` : v.message
    if (typeof v.error === "string") return v.error
    try {
      return JSON.stringify(value).slice(0, 300)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export function installCapture(app: MonitorApp): void {
  const g = globalThis as unknown as Record<symbol, unknown>
  if (g[INSTALLED]) return
  g[INSTALLED] = true

  // runAction() (lib/action-result.ts) calls this when an action says no with
  // a readable reason: it shows under "What went wrong for Lucy", keyed by
  // the page she was on.
  g[Symbol.for("forma.monitor.actionRefusal")] = (message: string, e: unknown) => {
    const action = e instanceof Error ? e.stack?.match(/at (?:async )?(\w+) \([^)]*app\/actions\//)?.[1] : undefined
    track(
      context().then((c) =>
        logEvent({ app, level: "warn", category: "action", event: action ?? "refused", message, path: c.path, requestId: c.requestId }),
      ),
    )
  }

  const originalError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    originalError(...args)
    if (typeof args[0] !== "string" || building()) return
    const first = args[0] as string
    // React and Next.js warnings, not our errors.
    if (/^(Warning:|⨯|\s*$)/.test(first)) return
    const err = args.find((a): a is Error => a instanceof Error)
    const rest = args.slice(1).map(describe).filter(Boolean).join(" ")
    const message = `${first.replace(/:\s*$/, "")}${rest ? `: ${rest}` : ""}`.slice(0, 1000)
    const stack = err?.stack ?? new Error(first).stack?.split("\n").slice(2).join("\n") ?? null
    // Let the request's own summary (e.g. the webhook's outcome) know.
    const ctx = monitorContext()
    if (ctx) (ctx.errors ??= []).push(message)
    const at = new Date().toISOString()
    track(
      context().then((c) =>
        reportError({ app, kind: "logged", message, stack, path: c.path, requestId: c.requestId, at }),
      ),
    )
  }

  const originalJson = Response.json.bind(Response)
  Response.json = ((body: unknown, init?: ResponseInit) => {
    const response = originalJson(body, init)
    const status = init?.status ?? 200
    if (status >= 400 && !building()) {
      const message =
        body && typeof body === "object" && "error" in body ? describe((body as { error: unknown }).error) : null
      track(
        context().then(async (c) => {
          if (c.fromMonitor) return
          await logEvent({
            app,
            level: status >= 500 ? "error" : "warn",
            category: "request",
            event: status >= 500 ? "failed" : "refused",
            statusCode: status,
            message,
            path: c.path,
            requestId: c.requestId,
          })
          if (status >= 500) {
            await reportError({
              app,
              kind: "response",
              message: `${status}${message ? `: ${message}` : ""}`,
              path: c.path,
              requestId: c.requestId,
            })
          }
        }),
      )
    }
    return response
  }) as typeof Response.json
}
