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
    console.error("[action]", e)
    return { error: e instanceof Error && e.message ? e.message : "Something went wrong. Please try again." }
  }
}

export function isActionFailure(res: unknown): res is ActionFailure {
  return !!res && typeof res === "object" && typeof (res as { error?: unknown }).error === "string"
}

/** Client side: turn a returned failure back into a thrown Error with its message intact. */
export function unwrap<T>(res: T | ActionFailure): T {
  if (isActionFailure(res)) throw new Error(res.error)
  return res as T
}
