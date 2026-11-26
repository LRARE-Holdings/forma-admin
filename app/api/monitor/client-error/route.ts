import { NextResponse } from "next/server"
import { reportError } from "@/lib/monitor/report-error"

/**
 * POST /api/monitor/client-error
 *
 * The error pages call this when they show, so a crash someone saw in their
 * browser reaches the monitor too. Anyone can post here, so it only takes a
 * short message and a path, and report-error caps each error at 50 an hour.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return new NextResponse(null, { status: 403 })
  }
  let body: { message?: unknown; path?: unknown; digest?: unknown; stack?: unknown }
  try {
    body = await request.json()
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  if (typeof body.message !== "string" || !body.message.trim()) return new NextResponse(null, { status: 400 })

  await reportError({
    app: "admin",
    kind: "browser",
    message: body.message.slice(0, 500),
    path: typeof body.path === "string" ? body.path.slice(0, 300) : null,
    digest: typeof body.digest === "string" ? body.digest : null,
    stack: typeof body.stack === "string" ? body.stack.slice(0, 2000) : null,
    userAgent: request.headers.get("user-agent"),
  })
  return new NextResponse(null, { status: 204 })
}
