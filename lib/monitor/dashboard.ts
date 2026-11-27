import { createAdminClient } from "@/lib/supabase/admin"
import { stripe } from "@/lib/stripe"
import { loadLiveStudios } from "./run"
import {
  checkInsight,
  declineReason,
  errorInsight,
  pageLabel,
  platformOf,
  stripeEventLabel,
  type Insight,
  type Platform,
} from "./insights"
import type { CheckArea, CheckStatus } from "./types"

/**
 * Everything the status dashboards show, loaded on the server per request.
 * Each loader degrades on its own: a Stripe or Resend hiccup leaves that
 * panel saying so instead of breaking the page.
 */

type DB = ReturnType<typeof createAdminClient>
const DAY = 86_400_000

export function ukMidnight(): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date())
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  // Hours since UK midnight, so this works in GMT and BST alike.
  const now = new Date()
  const ukHour = get("hour")
  const midnight = new Date(now)
  midnight.setUTCMinutes(0, 0, 0)
  midnight.setTime(midnight.getTime() - ukHour * 3_600_000)
  return midnight
}

export interface CheckRow {
  key: string
  label: string
  area: CheckArea
  status: CheckStatus
  summary: string | null
  detail: { lines?: string[]; quiet?: boolean; ms?: number | null } | null
  checked_at: string | null
  changed_at: string
}

export async function loadChecks(db: DB): Promise<CheckRow[]> {
  const { data } = await db.from("monitor_checks").select("key, label, area, status, summary, detail, checked_at, changed_at")
  return (data ?? []) as CheckRow[]
}

export async function lastMonitorRun(db: DB): Promise<string | null> {
  const { data } = await db.from("monitor_runs").select("created_at").eq("job", "monitor")
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  return data?.created_at ?? null
}

// ---------------------------------------------------------------------------
// Attention list
// ---------------------------------------------------------------------------

export interface AttentionItem {
  id: string
  severity: "urgent" | "look" | "info"
  platform: Platform
  topic: string
  title: string
  detail: string
  since: string
  meta: string[]
  insight: Insight | null
  href?: string
}

export interface ErrorGroup {
  fingerprint: string
  app: "admin" | "public"
  kind: string
  title: string
  path: string | null
  first_seen: string
  last_seen: string
  occurrences: number
  status: "open" | "resolved" | "muted"
  muted_until: string | null
  resolved_at: string | null
  reopened: boolean
}

export async function loadErrorGroups(db: DB, app?: "admin" | "public", days = 7): Promise<ErrorGroup[]> {
  let q = db.from("error_groups").select("*").gte("last_seen", new Date(Date.now() - days * DAY).toISOString())
    .order("last_seen", { ascending: false }).limit(60)
  if (app) q = q.eq("app", app)
  const { data } = await q
  return (data ?? []) as ErrorGroup[]
}

export function groupState(g: ErrorGroup, now: number): "new" | "ongoing" | "resolved" | "muted" {
  if (g.status === "resolved") return "resolved"
  if (g.status === "muted" && (!g.muted_until || new Date(g.muted_until).getTime() > now)) return "muted"
  return now - new Date(g.first_seen).getTime() < DAY || g.reopened ? "new" : "ongoing"
}

const TOPIC: Record<string, string> = {
  site: "Website", supabase: "Supabase", vercel: "Vercel", resend: "Emails", stripe: "Payments", bookings: "Bookings", errors: "Errors",
}

export function attentionItems(checks: CheckRow[], groups: ErrorGroup[], now: number): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const c of checks) {
    if (c.status !== "warn" && c.status !== "down") continue
    const quiet = !!c.detail?.quiet
    const insight = checkInsight(c.key, c.status, c.summary ?? "")
    items.push({
      id: `check:${c.key}`,
      severity: c.status === "down" ? "urgent" : quiet ? "info" : "look",
      platform: platformOf(c.key),
      topic: TOPIC[c.area] ?? c.area,
      title: `${c.label}: ${c.summary ?? ""}`,
      detail: (c.detail?.lines ?? []).slice(0, 3).join(" · "),
      since: c.changed_at,
      meta: (c.detail?.lines ?? []).slice(3, 6),
      insight,
    })
  }
  for (const g of groups) {
    const state = groupState(g, now)
    if (state !== "new") continue
    if (now - new Date(g.last_seen).getTime() > DAY) continue
    const insight = errorInsight(g)
    items.push({
      id: `error:${g.fingerprint}`,
      severity: g.occurrences >= 20 ? "urgent" : "look",
      platform: g.app === "public" ? "website" : "admin",
      topic: "Error",
      title: `${g.reopened ? "Came back: " : ""}${g.title}`,
      detail: "",
      since: g.first_seen,
      meta: [`${g.occurrences}×`, pageLabel(g.path)],
      insight,
      href: `/dashboard/status/errors/${g.fingerprint}`,
    })
  }
  const rank = { urgent: 0, look: 1, info: 2 }
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || b.since.localeCompare(a.since))
}

// ---------------------------------------------------------------------------
// Uptime and speed history
// ---------------------------------------------------------------------------

export interface UptimeRow {
  key: string
  label: string
  sub: string
  status: CheckStatus
  /** 90 entries, oldest first: "ok" | "warn" | "down" | "none" */
  days: { day: string; state: "ok" | "warn" | "down" | "none"; ok: number; runs: number }[]
  pct: number | null
  ms: number | null
}

function dayList(n: number): string[] {
  const out: string[] = []
  const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()) + "T12:00:00Z")
  for (let i = n - 1; i >= 0; i--) out.push(new Date(today.getTime() - i * DAY).toISOString().slice(0, 10))
  return out
}

export async function loadUptime(db: DB, rows: { key: string; label: string; sub: string }[], checks: CheckRow[]): Promise<UptimeRow[]> {
  const days = dayList(90)
  const { data } = await db.from("monitor_daily").select("check_key, day, runs, ok, warn, down, ms_sum, ms_count")
    .in("check_key", rows.map((r) => r.key)).gte("day", days[0])
  const byKey = new Map<string, Map<string, { runs: number; ok: number; warn: number; down: number }>>()
  for (const d of data ?? []) {
    if (!byKey.has(d.check_key)) byKey.set(d.check_key, new Map())
    byKey.get(d.check_key)!.set(d.day, d)
  }
  return rows.map((r) => {
    const m = byKey.get(r.key) ?? new Map()
    let runs = 0, ok = 0
    const list = days.map((day) => {
      const d = m.get(day)
      if (!d || !d.runs) return { day, state: "none" as const, ok: 0, runs: 0 }
      runs += d.runs
      ok += d.ok + d.warn
      // A day counts as down if it was down for 30+ minutes (6 checks).
      const state = d.down >= 6 ? "down" as const : d.down > 0 || d.warn >= 6 ? "warn" as const : "ok" as const
      return { day, state, ok: d.ok + d.warn, runs: d.runs }
    })
    const c = checks.find((x) => x.key === r.key)
    return { ...r, status: c?.status ?? "unknown", days: list, pct: runs ? (ok / runs) * 100 : null, ms: c?.detail?.ms ?? null }
  })
}

export async function loadSpeed(db: DB, keyPrefix: string): Promise<{ at: string; ms: number }[]> {
  const { data } = await db.from("monitor_results").select("checked_at, ms")
    .like("check_key", `${keyPrefix}%`).not("ms", "is", null)
    .gte("checked_at", new Date(Date.now() - DAY).toISOString()).order("checked_at")
  return (data ?? []).map((d) => ({ at: d.checked_at, ms: d.ms as number }))
}

export async function uptimeSince(db: DB, keys: string[], days: number): Promise<number | null> {
  const { data } = await db.from("monitor_daily").select("runs, ok, warn").in("check_key", keys)
    .gte("day", dayList(days)[0])
  let runs = 0, ok = 0
  for (const d of data ?? []) { runs += d.runs; ok += d.ok + d.warn }
  return runs ? (ok / runs) * 100 : null
}

// ---------------------------------------------------------------------------
// Website: checkout breakdown, refused requests
// ---------------------------------------------------------------------------

export interface CheckoutBreakdown {
  started: number
  paid: number
  declined: number
  unfinished: number
  reasons: { label: string; meaning: string; count: number }[]
  failRate: number | null
  weekFailRate: number | null
  paidToday: number
  error?: string
}

export async function loadCheckout(): Promise<CheckoutBreakdown> {
  const empty = { started: 0, paid: 0, declined: 0, unfinished: 0, reasons: [], failRate: null, weekFailRate: null, paidToday: 0 }
  try {
    const studios = await loadLiveStudios()
    const midnight = ukMidnight().getTime() / 1000
    const week = Math.floor((Date.now() - 7 * DAY) / 1000)
    let today = { started: 0, paid: 0, declined: 0, unfinished: 0 }
    let weekPaid = 0, weekDeclined = 0
    const reasons = new Map<string, { label: string; meaning: string; count: number }>()
    for (const s of studios.filter((x) => x.stripe_account_id)) {
      const list = await stripe.paymentIntents.list(
        { created: { gte: week }, limit: 100 },
        { stripeAccount: s.stripe_account_id! },
      ).autoPagingToArray({ limit: 500 })
      for (const pi of list) {
        const declined = !!pi.last_payment_error && pi.status !== "succeeded"
        if (pi.status === "succeeded") weekPaid++
        if (declined) weekDeclined++
        if (pi.created < midnight) continue
        today.started++
        if (pi.status === "succeeded") today.paid++
        else if (declined) {
          today.declined++
          const e = pi.last_payment_error!
          const r = declineReason(e.code, e.decline_code, e.message)
          const cur = reasons.get(r.label) ?? { ...r, count: 0 }
          cur.count++
          reasons.set(r.label, cur)
        } else today.unfinished++
      }
    }
    return {
      ...today,
      reasons: [...reasons.values()].sort((a, b) => b.count - a.count),
      failRate: today.paid + today.declined ? today.declined / (today.paid + today.declined) : null,
      weekFailRate: weekPaid + weekDeclined ? weekDeclined / (weekPaid + weekDeclined) : null,
      paidToday: today.paid,
    }
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface Refusal {
  what: string
  message: string
  count: number
  last: string
}

export async function loadRefusals(db: DB, app: "admin" | "public", category: "request" | "action", days = 7): Promise<Refusal[]> {
  const { data } = await db.from("app_events").select("path, message, occurred_at")
    .eq("app", app).eq("category", category).eq("level", "warn")
    .gte("occurred_at", new Date(Date.now() - days * DAY).toISOString())
    .order("occurred_at", { ascending: false }).limit(1000)
  const groups = new Map<string, Refusal>()
  for (const e of data ?? []) {
    const what = pageLabel(e.path)
    const message = e.message ?? "No reason given"
    const k = `${what}|${message}`
    const g = groups.get(k)
    if (g) g.count++
    else groups.set(k, { what, message, count: 1, last: e.occurred_at })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 12)
}

// ---------------------------------------------------------------------------
// Admin: payments, emails, jobs
// ---------------------------------------------------------------------------

export interface PaymentEvent {
  id: number
  at: string
  event: string
  label: string
  level: "info" | "warn" | "error"
  outcome: string
  who: string
  what: string
  amount: string | null
  correlation: string | null
  requestId: string | null
}

export async function loadPayments(db: DB, limit = 25): Promise<PaymentEvent[]> {
  const { data } = await db.from("app_events").select("id, occurred_at, event, level, message, profile_id, data, correlation, request_id")
    .eq("category", "payment").order("occurred_at", { ascending: false }).limit(limit)
  const rows = data ?? []
  const ids = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: people } = await db.from("profiles").select("id, full_name, email").in("id", ids)
    for (const p of people ?? []) names.set(p.id, p.full_name || p.email || "Member")
  }
  return rows.map((r) => {
    const d = (r.data ?? {}) as Record<string, unknown>
    const amount = typeof d.amount_pence === "number" ? `£${(d.amount_pence / 100).toFixed(2)}` : null
    return {
      id: r.id,
      at: r.occurred_at,
      event: r.event,
      label: stripeEventLabel(r.event),
      level: r.level,
      outcome: r.message ?? "",
      who: (r.profile_id && names.get(r.profile_id)) || (d.buyer_email as string) || "Guest",
      what: [d.purpose, d.description].filter(Boolean).join(" · ") as string,
      amount,
      correlation: r.correlation,
      requestId: r.request_id,
    }
  })
}

export interface EmailRow {
  at: string
  to: string
  name: string | null
  subject: string
  status: string
}

export async function loadEmails(db: DB): Promise<{ rows: EmailRow[]; today: Record<string, number>; error?: string }> {
  try {
    const studios = await loadLiveStudios()
    const domains = studios.map((s) => s.email_domain).filter(Boolean) as string[]
    const res = await fetch("https://api.resend.com/emails?limit=100", {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, cache: "no-store", signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`Resend returned ${res.status}`)
    const json = (await res.json()) as { data: { created_at: string; to: string[]; from: string; subject: string; last_event: string }[] }
    const ours = json.data.filter((e) => domains.some((d) => e.from.toLowerCase().includes(`@${d}`)))
    const at = (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).toISOString()
    const addresses = [...new Set(ours.flatMap((e) => e.to.map((t) => t.toLowerCase())))]
    const names = new Map<string, string>()
    if (addresses.length) {
      const { data } = await db.from("profiles").select("email, full_name").in("email", addresses)
      for (const p of data ?? []) if (p.email && p.full_name) names.set(p.email.toLowerCase(), p.full_name)
    }
    const midnight = ukMidnight().getTime()
    const today: Record<string, number> = {}
    const rows = ours.map((e) => {
      const iso = at(e.created_at)
      if (new Date(iso).getTime() >= midnight) today[e.last_event] = (today[e.last_event] ?? 0) + 1
      const to = e.to[0] ?? ""
      return { at: iso, to, name: names.get(to.toLowerCase()) ?? null, subject: e.subject, status: e.last_event }
    })
    return { rows, today }
  } catch (e) {
    return { rows: [], today: {}, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface JobRow {
  name: string
  when: string
  last: string | null
  ms: number | null
  runs: { ok: boolean; at: string; note?: string | null }[]
  problem: string | null
}

const PG_JOBS: Record<string, [string, string]> = {
  "event-jobs": ["Event reminders and ticket holds", "every minute"],
  "waitlist-expiry": ["Waitlist offers expiring", "every 5 minutes"],
  "instructor-schedule-reminder": ["Instructors' weekly schedule email", "Sundays 10:00"],
  "owner-weekly-summary": ["Lucy's weekly summary email", "Mondays 07:00"],
  "cron-history-cleanup": ["Job history clean-up", "daily 03:30"],
  monitor: ["Status checks (this page)", "every 5 minutes"],
}

const VERCEL_JOBS: [string, string, string][] = [
  ["admin.daily", "Nightly Stripe sync (Money page)", "daily 03:00"],
  ["admin.gift-cards", "Gift card emails", "daily 08:00"],
  ["public.birthdays", "Birthday emails", "daily 08:00"],
]

export async function loadJobs(db: DB): Promise<JobRow[]> {
  const out: JobRow[] = []
  for (const [job, name, when] of VERCEL_JOBS) {
    const { data } = await db.from("monitor_runs").select("ok, note, duration_ms, created_at").eq("job", job)
      .order("created_at", { ascending: false }).limit(14)
    const runs = (data ?? []).map((r) => ({ ok: r.ok, at: r.created_at, note: r.note }))
    const bad = runs.find((r) => !r.ok)
    out.push({
      name, when, last: runs[0]?.at ?? null, ms: data?.[0]?.duration_ms ?? null, runs: runs.reverse(),
      problem: !runs.length ? "No run recorded yet" : bad ? `Failed ${new Date(bad.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}: ${bad.note ?? ""}` : null,
    })
  }
  const { data: pg } = await db.rpc("monitor_jobs")
  for (const j of (pg ?? []) as { job: string; active: boolean; runs: { status: string; start: string; ms: number; message: string }[] }[]) {
    const [name, when] = PG_JOBS[j.job] ?? [j.job, ""]
    const runs = j.runs.map((r) => ({ ok: r.status === "succeeded", at: r.start, note: r.message }))
    const bad = runs.find((r) => !r.ok)
    out.push({
      name, when, last: runs[0]?.at ?? null, ms: j.runs[0]?.ms ?? null, runs: [...runs].reverse(),
      problem: !j.active ? "Switched off" : bad ? `Failed at ${new Date(bad.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}: ${bad.note ?? ""}` : null,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Counts for the overview cards
// ---------------------------------------------------------------------------

export async function errorsToday(db: DB, app: "admin" | "public"): Promise<number> {
  const { count } = await db.from("app_errors").select("id", { count: "exact", head: true })
    .eq("app", app).gte("occurred_at", ukMidnight().toISOString())
  return count ?? 0
}

export async function avgMsToday(db: DB, keyPrefix: string): Promise<number | null> {
  const { data } = await db.from("monitor_results").select("ms").like("check_key", `${keyPrefix}%`)
    .not("ms", "is", null).gte("checked_at", ukMidnight().toISOString())
  const list = (data ?? []).map((d) => d.ms as number).sort((a, b) => a - b)
  return list.length ? list[Math.floor(list.length / 2)] : null
}

export interface TimelineItem {
  at: string
  status: "ok" | "warn" | "down" | "info"
  text: string
}

export async function loadTimeline(db: DB): Promise<TimelineItem[]> {
  const since = ukMidnight().toISOString()
  const [events, errors, payments, runs] = await Promise.all([
    db.from("monitor_events").select("label, status, previous_status, summary, alerted, created_at").gte("created_at", since)
      .order("created_at", { ascending: false }).limit(30),
    db.from("error_groups").select("title, app, first_seen, reopened").gte("first_seen", since).limit(20),
    db.from("app_events").select("event, level, message, occurred_at").eq("category", "payment").neq("level", "info")
      .gte("occurred_at", since).limit(20),
    db.from("monitor_runs").select("job, ok, note, created_at").neq("job", "monitor").gte("created_at", since).limit(20),
  ])
  const items: TimelineItem[] = []
  for (const e of events.data ?? []) {
    items.push({
      at: e.created_at,
      status: e.status === "ok" ? "ok" : e.status === "down" ? "down" : e.status === "warn" ? "warn" : "info",
      text: `${e.label}: ${e.status === "ok" && e.previous_status ? "back to normal" : e.summary}${e.alerted ? " (alert sent)" : ""}`,
    })
  }
  for (const g of errors.data ?? []) {
    items.push({ at: g.first_seen, status: "warn", text: `New error on the ${g.app === "public" ? "website" : "admin app"}: ${g.title}` })
  }
  for (const p of payments.data ?? []) {
    items.push({ at: p.occurred_at, status: p.level === "error" ? "down" : "warn", text: `${stripeEventLabel(p.event)}: ${p.message}` })
  }
  const jobName = Object.fromEntries(VERCEL_JOBS.map(([k, n]) => [k, n]))
  for (const r of runs.data ?? []) {
    items.push({ at: r.created_at, status: r.ok ? "ok" : "down", text: `${jobName[r.job] ?? r.job} ran${r.ok ? "" : " with errors"}: ${r.note ?? ""}` })
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 25)
}

// ---------------------------------------------------------------------------
// One error group
// ---------------------------------------------------------------------------

export interface TraceStep {
  at: string
  source: string
  text: string
  bad: boolean
}

export async function loadErrorDetail(db: DB, fingerprint: string) {
  const { data: group } = await db.from("error_groups").select("*").eq("fingerprint", fingerprint).maybeSingle()
  if (!group) return null
  const { data: occurrences } = await db.from("app_errors").select("*").eq("fingerprint", fingerprint)
    .order("occurred_at", { ascending: false }).limit(50)
  const latest = occurrences?.[0] ?? null

  // Everything logged for the same request, and for the same payment on
  // either app, in time order.
  const trace: TraceStep[] = []
  if (latest && (latest.request_id || latest.correlation)) {
    const or = [latest.request_id && `request_id.eq.${latest.request_id}`, latest.correlation && `correlation.eq.${latest.correlation}`]
      .filter(Boolean).join(",")
    const [ev, er] = await Promise.all([
      db.from("app_events").select("app, category, event, level, message, occurred_at").or(or).order("occurred_at").limit(40),
      db.from("app_errors").select("app, kind, message, occurred_at").or(or).order("occurred_at").limit(20),
    ])
    for (const e of ev.data ?? []) {
      trace.push({
        at: e.occurred_at,
        source: e.app === "public" ? "website" : "admin",
        text: e.category === "payment" ? `${stripeEventLabel(e.event)}: ${e.message ?? ""}` : e.category === "checkout" ? `Checkout started: ${e.message ?? ""}` : `${e.event}: ${e.message ?? ""}`,
        bad: e.level === "error",
      })
    }
    for (const e of er.data ?? []) {
      trace.push({ at: e.occurred_at, source: e.app === "public" ? "website" : "admin", text: e.message, bad: true })
    }
    trace.sort((a, b) => a.at.localeCompare(b.at))
  }

  let person: string | null = null
  if (latest?.profile_id) {
    const { data } = await db.from("profiles").select("full_name, email").eq("id", latest.profile_id).maybeSingle()
    person = data?.full_name || data?.email || null
  }
  const people = new Set((occurrences ?? []).map((o) => o.profile_id).filter(Boolean)).size

  const days = dayList(30)
  const perDay = new Map<string, number>()
  for (const o of occurrences ?? []) {
    const d = new Date(o.occurred_at).toLocaleDateString("en-CA", { timeZone: "Europe/London" })
    perDay.set(d, (perDay.get(d) ?? 0) + 1)
  }

  return {
    group: group as ErrorGroup,
    insight: errorInsight(group as ErrorGroup),
    latest,
    occurrences: occurrences ?? [],
    trace,
    person,
    people,
    perDay: days.map((d) => ({ day: d, count: perDay.get(d) ?? 0 })),
  }
}

export function device(userAgent?: string | null): string {
  if (!userAgent) return "Unknown"
  if (/FormaMonitor/.test(userAgent)) return "The monitor"
  const os = /iPhone|iPad/.test(userAgent) ? "iPhone" : /Android/.test(userAgent) ? "Android" : /Mac OS/.test(userAgent) ? "Mac" : /Windows/.test(userAgent) ? "Windows" : null
  const browser = /CriOS|Chrome\//.test(userAgent) ? "Chrome" : /FxiOS|Firefox/.test(userAgent) ? "Firefox" : /Safari/.test(userAgent) ? "Safari" : /WebKit|Network/.test(userAgent) ? "the phone itself (not a browser)" : null
  return [os, browser].filter(Boolean).join(", ") || userAgent.slice(0, 60)
}
