import type { Instrumentation } from "next"

// Every unhandled server error (pages, route handlers, server actions, proxy)
// goes to app_errors, where the monitor picks it up and alerts on new ones.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { reportError } = await import("@/lib/monitor/report-error")
  const error = err instanceof Error ? err : new Error(String(err))
  const header = request.headers["user-agent"]
  await reportError({
    app: "admin",
    kind: context.routeType,
    message: error.message,
    path: request.path,
    method: request.method,
    route: context.routePath,
    digest: typeof err === "object" && err && "digest" in err ? String((err as { digest: unknown }).digest) : null,
    stack: error.stack ?? null,
    userAgent: Array.isArray(header) ? header[0] : header ?? null,
  })
}
