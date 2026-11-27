import type { Instrumentation } from "next"

// Starts error and refusal capture for this server process (see
// lib/monitor/capture.ts). Node only: the proxy runs elsewhere.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installCapture } = await import("@/lib/monitor/capture")
    installCapture("admin")
  }
}

// Every unhandled server error (pages, route handlers, server actions, proxy)
// goes to app_errors, where the monitor picks it up and alerts on new ones.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { reportError } = await import("@/lib/monitor/report-error")
  const error = err instanceof Error ? err : new Error(String(err))
  const header = (name: string) => {
    const v = request.headers[name]
    return (Array.isArray(v) ? v[0] : v) ?? null
  }
  await reportError({
    app: "admin",
    kind: context.routeType,
    message: error.message,
    path: request.path,
    method: request.method,
    route: context.routePath,
    digest: typeof err === "object" && err && "digest" in err ? String((err as { digest: unknown }).digest) : null,
    stack: error.stack ?? null,
    userAgent: header("user-agent"),
    requestId: header("x-request-id"),
  })
}
