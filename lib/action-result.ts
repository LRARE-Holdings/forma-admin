import { unstable_rethrow } from "next/navigation"

/**
 * Getting a server action's error message to the person who clicked.
 *
 * Next.js replaces a thrown error's message with a generic one in production,
 * so "This member has no pack credits left" reached Lucy as "An error occurred
 * in the Server Components render". Instead:
 *
 *   server:  export async function doThing() { return runAction(async () => { ... throw new Error("Readable reason") ... }) }
 *   client:  unwrap(await doThing())   // throws Error("Readable reason") in the browser, where it survives
 *
 * Redirects and other Next.js control-flow errors still propagate.
 */
export type ActionFailure = { error: string }

export async function runAction<T>(fn: () => Promise<T>): Promise<T | ActionFailure> {
  try {
    return await fn()
  } catch (e) {
    unstable_rethrow(e)
    const message = e instanceof Error && e.message ? e.message : "Something went wrong. Please try again."
    // A bug goes to the error log (and alerts); a deliberate "no" with a
    // readable reason goes to "What went wrong for Lucy" on the status page.
    if (isUnexpected(e)) console.error("[action] Unexpected error:", e)
    else recordRefusal(message, e)
    return { error: message }
  }
}

const TECHNICAL = /violates|duplicate key|relation |column |syntax|fetch failed|ECONN|ETIMEDOUT|timed? ?out|undefined|null|JSON|Unexpected token|permission denied|JWT|PGRST|Failed to|Cannot read/i

function isUnexpected(e: unknown): boolean {
  if (!(e instanceof Error)) return true
  if (["TypeError", "ReferenceError", "RangeError", "SyntaxError"].includes(e.name)) return true
  if ("code" in e && (e as { code?: unknown }).code) return true
  return TECHNICAL.test(e.message)
}

// Set by the monitor at server start (lib/monitor/capture.ts). Looked up
// rather than imported, because this file is also loaded in the browser for
// unwrap().
function recordRefusal(message: string, e: unknown) {
  const hook = (globalThis as unknown as Record<symbol, ((m: string, e: unknown) => void) | undefined>)[
    Symbol.for("forma.monitor.actionRefusal")
  ]
  hook?.(message, e)
}

export function isActionFailure(res: unknown): res is ActionFailure {
  return !!res && typeof res === "object" && typeof (res as { error?: unknown }).error === "string"
}

/** Client side: turn a returned failure back into a thrown Error with its message intact. */
export function unwrap<T>(res: T | ActionFailure): T {
  if (isActionFailure(res)) throw new Error(res.error)
  return res as T
}
