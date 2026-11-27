import { AsyncLocalStorage } from "node:async_hooks"

/**
 * What the monitor knows about the request it's running in: its id (set by
 * proxy.ts), the path, and for payments the Stripe id that links the website,
 * Stripe and the webhook. Errors and events logged inside withMonitorContext()
 * carry it, so the status page can show one request step by step.
 *
 * The store lives on globalThis: instrumentation.ts and each route are bundled
 * separately, and they must share one store, not one each.
 *
 * Kept in step with burn-mat-studio/lib/monitor/context.ts.
 */

export interface MonitorContext {
  requestId?: string
  path?: string
  correlation?: string
  profileId?: string
  /** One line saying how a webhook event ended ("Pack added, 5 credits"). */
  outcome?: string
  outcomeLevel?: "info" | "warn"
  /** console.error messages logged while handling this request. */
  errors?: string[]
}

const KEY = Symbol.for("forma.monitor.context")
type Store = AsyncLocalStorage<MonitorContext>
const g = globalThis as unknown as Record<symbol, Store | undefined>
const store: Store = (g[KEY] ??= new AsyncLocalStorage<MonitorContext>())

export function withMonitorContext<T>(context: MonitorContext, fn: () => T): T {
  return store.run({ ...store.getStore(), ...context }, fn)
}

export function monitorContext(): MonitorContext | undefined {
  return store.getStore()
}

/** Add to the current context (e.g. the payment id once it's known). */
export function setMonitorContext(patch: Partial<MonitorContext>): void {
  const current = store.getStore()
  if (current) Object.assign(current, patch)
}

/** Ids from the request headers proxy.ts sets. */
export function requestIds(headers: Headers): { requestId?: string; path?: string } {
  return {
    requestId: headers.get("x-request-id") ?? undefined,
    path: headers.get("x-forma-path") ?? undefined,
  }
}

/** A short random id for requests that didn't come through the proxy. */
export function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12)
}
