import tls from "node:tls"
import type { SupabaseClient } from "@supabase/supabase-js"
import { stripe } from "@/lib/stripe"
import { findStrandedBookings } from "@/lib/schedule-integrity"
import type { CheckArea, CheckResult, CheckStatus, LiveStudio } from "./types"

/**
 * Every health check the monitor runs. Each one returns a CheckResult and
 * never throws: a check that can't reach what it checks says so as its result.
 *
 * `every` is how often a check is worth running, in minutes. The monitor runs
 * every five; slower checks (certificates, domain renewals) keep their last
 * result in between.
 */
export interface CheckDef {
  key: string
  label: string
  area: CheckArea
  every: number
  run: () => Promise<CheckResult>
}

const TIMEOUT_MS = 8000
const DAY = 86_400_000

function result(
  def: { key: string; label: string; area: CheckArea },
  status: CheckStatus,
  summary: string,
  extra: Partial<CheckResult> = {}
): CheckResult {
  return { key: def.key, label: def.label, area: def.area, status, summary, ...extra }
}

function errorText(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return `no reply within ${TIMEOUT_MS / 1000}s`
    const cause = (e as { cause?: { code?: string } }).cause?.code
    return cause ? `${e.message} (${cause})` : e.message
  }
  return String(e)
}

function daysUntil(date: Date): number {
  return Math.floor((date.getTime() - Date.now()) / DAY)
}

function ukDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })
}

function ukDateTime(date: Date): string {
  return date.toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  })
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

// ---------------------------------------------------------------------------
// Websites
// ---------------------------------------------------------------------------

async function fetchPage(url: string): Promise<{ status: number; body: string; ms: number }> {
  const started = Date.now()
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: { "user-agent": "FormaMonitor/1.0" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = await res.text()
  return { status: res.status, body, ms: Date.now() - started }
}

function pageCheck(
  key: string,
  label: string,
  url: string,
  looksRight: (body: string) => boolean,
  slowMs = 4000
): CheckDef {
  const def = { key, label, area: "site" as const }
  return {
    ...def,
    every: 5,
    run: async () => {
      // One quiet retry: a single dropped request isn't an outage.
      let last = ""
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const page = await fetchPage(url)
          if (page.status >= 500) {
            last = `${url} returned ${page.status}`
          } else if (page.status >= 400) {
            last = `${url} returned ${page.status}`
          } else if (!looksRight(page.body)) {
            last = `${url} loaded but the page looks wrong (expected content missing)`
          } else if (page.ms > slowMs) {
            return result(def, "warn", `Slow: took ${(page.ms / 1000).toFixed(1)}s to load`, { lines: [url] })
          } else {
            return result(def, "ok", `Up, ${page.ms}ms`)
          }
        } catch (e) {
          last = `${url}: ${errorText(e)}`
        }
        if (attempt === 0) await new Promise((r) => setTimeout(r, 2000))
      }
      return result(def, "down", last)
    },
  }
}

function certificateExpiry(host: string): Promise<Date> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate()
      socket.end()
      if (!cert?.valid_to) reject(new Error("no certificate"))
      else resolve(new Date(cert.valid_to))
    })
    socket.on("timeout", () => {
      socket.destroy()
      reject(new Error("timed out"))
    })
    socket.on("error", reject)
  })
}

function certificatesCheck(hosts: string[]): CheckDef {
  const def = { key: "site.certificates", label: "HTTPS certificates", area: "site" as const }
  return {
    ...def,
    every: 360,
    run: async () => {
      const lines: string[] = []
      let worst: CheckStatus = "ok"
      let soonest = Infinity
      for (const host of hosts) {
        try {
          const expires = await certificateExpiry(host)
          const days = daysUntil(expires)
          soonest = Math.min(soonest, days)
          lines.push(`${host}: renews automatically, current one ends ${ukDate(expires)} (${days} days)`)
          // Vercel renews about 30 days out; under 14 means renewal is stuck.
          if (days < 3) worst = "down"
          else if (days < 14 && worst !== "down") worst = "warn"
        } catch (e) {
          lines.push(`${host}: couldn't check (${errorText(e)})`)
          if (worst === "ok") worst = "warn"
        }
      }
      if (worst === "ok") return result(def, "ok", `All valid, next ends in ${soonest} days`, { lines })
      return result(def, worst, worst === "down"
        ? "An HTTPS certificate is about to expire and hasn't renewed"
        : "An HTTPS certificate hasn't renewed on time", { lines })
    },
  }
}

function domainsCheck(domains: string[]): CheckDef {
  const def = { key: "site.domains", label: "Domain renewals", area: "site" as const }
  return {
    ...def,
    every: 720,
    run: async () => {
      const lines: string[] = []
      let worst: CheckStatus = "ok"
      for (const domain of domains) {
        try {
          const res = await fetch(`https://rdap.org/domain/${domain}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
          const data = (await res.json()) as { events?: { eventAction: string; eventDate: string }[] }
          const expiry = data.events?.find((e) => e.eventAction === "expiration")?.eventDate
          if (!expiry) {
            lines.push(`${domain}: registry didn't give an expiry date`)
            continue
          }
          const days = daysUntil(new Date(expiry))
          lines.push(`${domain}: registered until ${ukDate(new Date(expiry))} (${days} days)`)
          if (days < 7) worst = "down"
          else if (days < 45 && worst !== "down") worst = "warn"
        } catch (e) {
          lines.push(`${domain}: couldn't check (${errorText(e)})`)
        }
      }
      if (worst === "ok") return result(def, "ok", "All registered for 45+ days", { lines })
      return result(def, worst, "A domain is due for renewal. Check auto-renew is on", { lines })
    },
  }
}

// ---------------------------------------------------------------------------
// Third-party status pages
// ---------------------------------------------------------------------------

interface StatusSummary {
  status?: { indicator?: string; description?: string }
  incidents?: { name: string; impact?: string; status?: string; components?: { name: string }[] }[]
  scheduled_maintenances?: { name: string; scheduled_for?: string; components?: { name: string }[] }[]
}

function vendorStatusCheck(
  area: CheckArea,
  vendor: string,
  url: string,
  relevant: RegExp | null
): CheckDef {
  const def = { key: `${area}.status`, label: `${vendor} status page`, area }
  return {
    ...def,
    every: 5,
    run: async () => {
      try {
        const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) })
        const data = (await res.json()) as StatusSummary
        const touches = (components?: { name: string }[]) =>
          !relevant || !components?.length || components.some((c) => relevant.test(c.name))

        const incidents = (data.incidents ?? []).filter((i) => i.status !== "resolved" && touches(i.components))
        const soon = (data.scheduled_maintenances ?? []).filter((m) => {
          if (!m.scheduled_for || !touches(m.components)) return false
          const at = new Date(m.scheduled_for).getTime()
          return at - Date.now() < 2 * DAY
        })
        const indicator = data.status?.indicator ?? "none"
        const lines = [
          ...incidents.map((i) => `Incident: ${i.name}${i.impact ? ` (${i.impact})` : ""}`),
          ...soon.map((m) => `Planned maintenance: ${m.name}, ${ukDateTime(new Date(m.scheduled_for!))}`),
        ]

        // Their status page alone never marks us down: our own checks decide
        // that. A major outage on their side still pushes an alert.
        const serious = indicator === "major" || indicator === "critical"
        if (serious || incidents.length) {
          return result(def, "warn", `${vendor} reports: ${data.status?.description ?? incidents[0]?.name ?? "an incident"}`, {
            lines,
            quiet: !serious,
          })
        }
        if (soon.length) {
          return result(def, "warn", `${vendor} has maintenance planned in the next 48 hours`, { lines, quiet: true })
        }
        if (relevant && indicator !== "none") {
          return result(def, "ok", `${vendor}: ${data.status?.description ?? "minor issue"} (not in services we use)`)
        }
        return result(def, indicator === "none" ? "ok" : "warn", data.status?.description ?? "Operational", {
          quiet: true,
        })
      } catch (e) {
        return result(def, "unknown", `Couldn't read ${vendor}'s status page: ${errorText(e)}`, { quiet: true })
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

interface DbStats {
  db_bytes: number
  connections: number
  max_connections: number
  cron_failures: { job: string; message: string; at: string }[]
  cron_last_success: Record<string, string | null>
  http_failures: number
  http_failure_sample: string | null
}

// Pro plan: 8 GB of disk included before it starts billing for more.
const DB_INCLUDED_BYTES = 8 * 1024 ** 3

function supabaseChecks(db: SupabaseClient): CheckDef[] {
  const database = { key: "supabase.database", label: "Database", area: "supabase" as const }
  const auth = { key: "supabase.auth", label: "Logins (Supabase Auth)", area: "supabase" as const }
  const jobs = { key: "supabase.jobs", label: "Background jobs", area: "supabase" as const }

  let stats: Promise<{ data: DbStats | null; error: string | null; ms: number }> | null = null
  const loadStats = () => {
    stats ??= (async () => {
      const started = Date.now()
      const { data, error } = await db.rpc("monitor_db_stats")
      return { data: data as DbStats | null, error: error?.message ?? null, ms: Date.now() - started }
    })()
    return stats
  }

  return [
    {
      ...database,
      every: 5,
      run: async () => {
        try {
          const { data, error, ms } = await loadStats()
          if (error || !data) return result(database, "down", `Database query failed: ${error ?? "no data"}`)
          const connPct = Math.round((data.connections / data.max_connections) * 100)
          const sizeGb = data.db_bytes / 1024 ** 3
          const lines = [
            `Replied in ${ms}ms`,
            `Connections: ${data.connections} of ${data.max_connections} (${connPct}%)`,
            `Size: ${(data.db_bytes / 1024 ** 2).toFixed(0)} MB of 8 GB included`,
          ]
          if (connPct >= 90) return result(database, "down", `Database is nearly out of connections (${connPct}%)`, { lines })
          if (connPct >= 75) return result(database, "warn", `Database connections running high (${connPct}%)`, { lines })
          if (data.db_bytes > DB_INCLUDED_BYTES * 0.8) {
            return result(database, "warn", `Database is ${sizeGb.toFixed(1)} GB, close to the 8 GB included`, { lines })
          }
          if (ms > 1500) return result(database, "warn", `Database is slow to reply (${ms}ms)`, { lines })
          return result(database, "ok", `Up, ${ms}ms`, { lines })
        } catch (e) {
          return result(database, "down", `Couldn't reach the database: ${errorText(e)}`)
        }
      },
    },
    {
      ...auth,
      every: 5,
      run: async () => {
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
            headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
          if (!res.ok) return result(auth, "down", `Supabase Auth returned ${res.status}: nobody can log in`)
          return result(auth, "ok", "Up")
        } catch (e) {
          return result(auth, "down", `Couldn't reach Supabase Auth: ${errorText(e)}`)
        }
      },
    },
    {
      ...jobs,
      every: 5,
      run: async () => {
        try {
          const { data, error } = await loadStats()
          if (error || !data) return result(jobs, "unknown", "Couldn't read the job history")
          const lines: string[] = []
          for (const f of data.cron_failures) lines.push(`${f.job} failed: ${f.message}`)
          if (data.http_failures) {
            lines.push(`${plural(data.http_failures, "call")} from the database to the apps failed in 15 min`)
            if (data.http_failure_sample) lines.push(`Latest: ${data.http_failure_sample}`)
          }
          // event-jobs runs every minute, waitlist-expiry every five.
          const late: string[] = []
          for (const [job, maxMinutes] of [["event-jobs", 10], ["waitlist-expiry", 15]] as const) {
            const last = data.cron_last_success[job]
            if (last && Date.now() - new Date(last).getTime() > maxMinutes * 60_000) late.push(job)
          }
          for (const job of late) lines.push(`${job} hasn't run since ${ukDateTime(new Date(data.cron_last_success[job]!))}`)

          if (late.length) return result(jobs, "down", "Scheduled database jobs have stopped running", { lines })
          if (data.cron_failures.length || data.http_failures >= 3) {
            return result(jobs, "warn", "Some background jobs are failing", { lines })
          }
          return result(jobs, "ok", "Running on time", { lines })
        } catch (e) {
          return result(jobs, "unknown", `Couldn't read the job history: ${errorText(e)}`)
        }
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Vercel: scheduled jobs that run on Vercel report a heartbeat when they finish
// ---------------------------------------------------------------------------

const HEARTBEATS: { job: string; label: string; hours: number }[] = [
  { job: "admin.daily", label: "Nightly Stripe sync (03:00)", hours: 26 },
  { job: "admin.gift-cards", label: "Gift card deliveries (08:00)", hours: 26 },
  { job: "public.birthdays", label: "Birthday emails (08:00)", hours: 26 },
]

function heartbeatCheck(db: SupabaseClient): CheckDef {
  const def = { key: "vercel.jobs", label: "Daily scheduled jobs", area: "vercel" as const }
  return {
    ...def,
    every: 30,
    run: async () => {
      const lines: string[] = []
      const late: string[] = []
      let anyFailed = false
      const { data: firstRun } = await db
        .from("monitor_runs")
        .select("created_at")
        .eq("job", "monitor")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
      const watchingHours = firstRun ? (Date.now() - new Date(firstRun.created_at).getTime()) / 3_600_000 : 0
      for (const hb of HEARTBEATS) {
        const { data } = await db
          .from("monitor_runs")
          .select("ok, note, created_at")
          .eq("job", hb.job)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!data) {
          lines.push(`${hb.label}: no run recorded yet`)
          if (watchingHours > hb.hours) late.push(hb.label)
          continue
        }
        const at = new Date(data.created_at)
        const hours = (Date.now() - at.getTime()) / 3_600_000
        lines.push(`${hb.label}: last ran ${ukDateTime(at)}${data.ok ? "" : ` and failed: ${data.note ?? ""}`}`)
        if (!data.ok) anyFailed = true
        if (hours > hb.hours) late.push(hb.label)
      }
      if (late.length) return result(def, "down", `Didn't run on schedule: ${late.join(", ")}`, { lines })
      if (anyFailed) return result(def, "warn", "A daily job ran but hit errors", { lines })
      if (lines.some((l) => l.endsWith("no run recorded yet"))) {
        return result(def, "unknown", "Waiting for each job's first run", { lines })
      }
      return result(def, "ok", "All ran on schedule", { lines })
    },
  }
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

// Resend dates look like "2026-11-26 12:33:36.860000+00", which Date can't read.
function resendDate(value: string): number {
  return new Date(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).getTime()
}

async function resendGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status === 401 || res.status === 403) throw new Error("Resend rejected the API key")
  if (!res.ok) throw new Error(`Resend returned ${res.status}`)
  return (await res.json()) as T
}

function resendChecks(studios: LiveStudio[]): CheckDef[] {
  const domainsDef = { key: "resend.domains", label: "Sending domains", area: "resend" as const }
  const deliveryDef = { key: "resend.delivery", label: "Email delivery", area: "resend" as const }
  const sendingDomains = [
    ...new Set([...studios.map((s) => s.email_domain).filter(Boolean) as string[], "useforma.co.uk"]),
  ]

  return [
    {
      ...domainsDef,
      every: 30,
      run: async () => {
        try {
          const { data } = await resendGet<{ data: { name: string; status: string; capabilities?: { sending?: string } }[] }>("/domains")
          const lines: string[] = []
          const broken: string[] = []
          for (const name of sendingDomains) {
            const d = data.find((x) => x.name === name)
            const ok = d?.status === "verified" && d.capabilities?.sending !== "disabled"
            lines.push(`${name}: ${d ? d.status : "missing from Resend"}`)
            if (!ok) broken.push(name)
          }
          if (broken.length) {
            return result(domainsDef, "down", `Email can't send from ${broken.join(", ")}: domain not verified`, { lines, urgent: true })
          }
          return result(domainsDef, "ok", "API key works, domains verified", { lines })
        } catch (e) {
          return result(domainsDef, "down", errorText(e))
        }
      },
    },
    {
      ...deliveryDef,
      every: 15,
      run: async () => {
        try {
          // The Resend account also sends for other businesses: only count
          // mail from the studios' own domains.
          const { data } = await resendGet<{
            data: { from: string; to: string[]; created_at: string; last_event: string; subject: string }[]
          }>("/emails?limit=100")
          const since = Date.now() - DAY
          const ours = data.filter((e) => {
            const at = resendDate(e.created_at)
            return at > since && sendingDomains.some((d) => e.from.toLowerCase().includes(`@${d}`))
          })
          const failed = ours.filter((e) => e.last_event === "bounced" || e.last_event === "failed" || e.last_event === "complained")
          const stuck = ours.filter((e) => {
            const age = Date.now() - resendDate(e.created_at)
            return (e.last_event === "queued" || e.last_event === "sent" || e.last_event === "delivery_delayed") && age > 30 * 60_000
          })
          const suppressed = new Set(ours.filter((e) => e.last_event === "suppressed").flatMap((e) => e.to))
          const lines = [
            `${ours.length} emails in the last 24 hours (latest 100 checked)`,
            ...failed.slice(0, 5).map((e) => `${e.last_event}: "${e.subject}" to ${e.to.join(", ")}`),
            ...(stuck.length ? [`${plural(stuck.length, "email")} not delivered after 30+ minutes`] : []),
            ...(suppressed.size ? [`Resend blocks sends to: ${[...suppressed].join(", ")} (they bounced before)`] : []),
          ]
          const failRate = ours.length ? failed.length / ours.length : 0
          if (ours.length >= 10 && failRate > 0.2) {
            return result(deliveryDef, "down", `${Math.round(failRate * 100)}% of emails are bouncing or failing`, { lines })
          }
          if (stuck.length >= 3) return result(deliveryDef, "warn", "Emails are being delayed", { lines })
          if (failed.length) {
            return result(deliveryDef, "warn", `${plural(failed.length, "email")} bounced or failed today`, { lines, quiet: failed.length < 3 })
          }
          return result(deliveryDef, "ok", `${ours.length} sent in 24h, all delivered`, { lines })
        } catch (e) {
          return result(deliveryDef, "unknown", `Couldn't read email history: ${errorText(e)}`)
        }
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

function stripeChecks(db: SupabaseClient, studios: LiveStudio[]): CheckDef[] {
  const accountDef = { key: "stripe.account", label: "Payments account", area: "stripe" as const }
  const webhookDef = { key: "stripe.webhooks", label: "Payment notifications", area: "stripe" as const }
  const paidDef = { key: "stripe.fulfilment", label: "Paid orders delivered", area: "stripe" as const }
  const withStripe = studios.filter((s) => s.stripe_account_id)

  return [
    {
      ...accountDef,
      every: 30,
      run: async () => {
        const lines: string[] = []
        let worst: CheckStatus = "ok"
        let summary = "Taking payments, payouts on"
        for (const s of withStripe) {
          try {
            const acct = await stripe.accounts.retrieve(s.stripe_account_id!)
            const req = acct.requirements
            if (!acct.charges_enabled) {
              worst = "down"
              summary = `${s.name} can't take payments: Stripe has paused charges`
            } else if (!acct.payouts_enabled) {
              worst = "down"
              summary = `Stripe has paused payouts to ${s.name}'s bank`
            }
            if (req?.disabled_reason) lines.push(`Stripe says: ${req.disabled_reason}`)
            if (req?.past_due?.length) {
              worst = "down"
              summary = `Stripe needs details from ${s.name} now (overdue)`
              lines.push(`Overdue: ${req.past_due.join(", ")}`)
            } else if (req?.currently_due?.length) {
              if (worst === "ok") worst = "warn"
              const deadline = req.current_deadline ? ` by ${ukDate(new Date(req.current_deadline * 1000))}` : ""
              summary = `Stripe needs details from ${s.name}${deadline}`
              lines.push(`Due: ${req.currently_due.join(", ")}`)
            } else if (req?.eventually_due?.length) {
              lines.push(`Stripe will need eventually: ${req.eventually_due.join(", ")}`)
            }
            lines.push(`${s.name}: charges ${acct.charges_enabled ? "on" : "off"}, payouts ${acct.payouts_enabled ? "on" : "off"}`)
          } catch (e) {
            if (worst === "ok") worst = "unknown"
            lines.push(`${s.name}: couldn't read the Stripe account (${errorText(e)})`)
          }
        }
        if (worst === "unknown") summary = "Couldn't read the Stripe account"
        return result(accountDef, worst, summary, { lines, urgent: worst === "down" })
      },
    },
    {
      ...webhookDef,
      every: 5,
      run: async () => {
        const lines: string[] = []
        let stuck = 0
        try {
          const endpoints = await stripe.webhookEndpoints.list({ limit: 20 })
          const ours = endpoints.data.filter((e) => e.url.includes("/api/stripe/webhook"))
          for (const e of ours) lines.push(`${e.url}: ${e.status}`)
          if (!ours.length || ours.every((e) => e.status !== "enabled")) {
            return result(webhookDef, "down", "The Stripe webhook is missing or disabled: paid orders won't be fulfilled", {
              lines, urgent: true,
            })
          }
          // Events Stripe still hasn't managed to deliver 10+ minutes on.
          for (const s of withStripe) {
            const events = await stripe.events.list(
              { created: { gte: Math.floor((Date.now() - DAY) / 1000) }, limit: 100 },
              { stripeAccount: s.stripe_account_id! }
            )
            const pending = events.data.filter((ev) => ev.pending_webhooks > 0 && Date.now() / 1000 - ev.created > 600)
            stuck += pending.length
            for (const ev of pending.slice(0, 5)) lines.push(`Not delivered: ${ev.type} at ${ukDateTime(new Date(ev.created * 1000))}`)
          }
        } catch (e) {
          return result(webhookDef, "unknown", `Couldn't check with Stripe: ${errorText(e)}`, { lines })
        }
        if (stuck) {
          return result(webhookDef, "down", `Stripe can't deliver ${plural(stuck, "payment event")} to the admin app`, { lines })
        }
        return result(webhookDef, "ok", "Stripe is reaching the webhook", { lines })
      },
    },
    {
      ...paidDef,
      every: 10,
      run: async () => {
        // Each successful payment in the last 48 hours should have made a
        // pack, booking, ticket or gift card. One that hasn't after 15 minutes
        // means someone paid and got nothing.
        const lines: string[] = []
        const missing: string[] = []
        let checked = 0
        try {
          for (const s of withStripe) {
            const pis = await stripe.paymentIntents.list(
              { created: { gte: Math.floor((Date.now() - 2 * DAY) / 1000) }, limit: 100 },
              { stripeAccount: s.stripe_account_id! }
            )
            for (const pi of pis.data) {
              if (pi.status !== "succeeded" || Date.now() / 1000 - pi.created < 900) continue
              const type = pi.metadata?.type
              let found: boolean | null = null
              if (type === "pack_tier") {
                found = await exists(db, "class_packs", "stripe_session_id", pi.id)
              } else if (type === "drop_in_class" || type === "waitlist_claim") {
                found = await exists(db, "bookings", "stripe_session_id", pi.id)
              } else if (type === "gift_card") {
                const { data } = await db.from("gift_cards").select("status").eq("stripe_payment_intent_id", pi.id).maybeSingle()
                found = !!data && data.status !== "pending"
              } else if (type === "event_ticket") {
                found = await exists(db, "event_tickets", "stripe_payment_intent_id", pi.id)
              }
              if (found === null) continue
              checked++
              if (!found) {
                const who = pi.receipt_email ?? pi.metadata?.buyer_email ?? pi.metadata?.profile_id ?? "unknown buyer"
                missing.push(pi.id)
                lines.push(`£${(pi.amount / 100).toFixed(2)} ${type} by ${who} at ${ukDateTime(new Date(pi.created * 1000))} (${pi.id})`)
              }
            }
          }
        } catch (e) {
          return result(paidDef, "unknown", `Couldn't check recent payments: ${errorText(e)}`)
        }
        if (missing.length) {
          return result(paidDef, "down", `${plural(missing.length, "customer")} paid but didn't get what they bought`, {
            lines, urgent: true,
          })
        }
        return result(paidDef, "ok", `${plural(checked, "payment")} in 48h, all delivered`)
      },
    },
  ]
}

async function exists(db: SupabaseClient, table: string, column: string, value: string): Promise<boolean> {
  const { count } = await db.from(table).select("id", { count: "exact", head: true }).eq(column, value)
  return (count ?? 0) > 0
}

// ---------------------------------------------------------------------------
// Bookings and data
// ---------------------------------------------------------------------------

function dataChecks(db: SupabaseClient, studios: LiveStudio[]): CheckDef[] {
  const strandedDef = { key: "bookings.stranded", label: "Bookings on removed classes", area: "bookings" as const }
  const unsyncedDef = { key: "bookings.products", label: "Products ready to sell", area: "bookings" as const }

  return [
    {
      ...strandedDef,
      every: 15,
      run: async () => {
        try {
          const lines: string[] = []
          let total = 0
          for (const s of studios) {
            const stranded = await findStrandedBookings(s.id, db)
            total += stranded.length
            for (const b of stranded.slice(0, 5)) {
              lines.push(`${s.name}: booking on ${b.date} sits on a class that's no longer on the timetable`)
            }
          }
          if (total) {
            return result(strandedDef, "warn", `${plural(total, "member")} booked into a class nobody can see`, { lines })
          }
          return result(strandedDef, "ok", "Every upcoming booking is on a live class")
        } catch (e) {
          return result(strandedDef, "unknown", `Couldn't check: ${errorText(e)}`)
        }
      },
    },
    {
      ...unsyncedDef,
      every: 30,
      run: async () => {
        const lines: string[] = []
        for (const s of studios) {
          const [packs, classes, memberships] = await Promise.all([
            db.from("pack_tiers").select("name").eq("studio_id", s.id).eq("is_active", true).is("stripe_price_id", null),
            db.from("classes").select("name").eq("studio_id", s.id).is("stripe_price_id", null),
            db.from("membership_tiers").select("name").eq("studio_id", s.id).eq("is_active", true).is("stripe_price_id", null),
          ])
          for (const row of [...(packs.data ?? []), ...(classes.data ?? []), ...(memberships.data ?? [])]) {
            lines.push(`${s.name}: "${row.name}" has no Stripe price yet`)
          }
        }
        if (lines.length) {
          return result(unsyncedDef, "warn", `${plural(lines.length, "product")} can't be bought until the nightly sync`, { lines })
        }
        return result(unsyncedDef, "ok", "Everything on sale has a price in Stripe")
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Errors from the apps (instrumentation.ts and the error pages report them)
// ---------------------------------------------------------------------------

function errorsCheck(db: SupabaseClient): CheckDef {
  const def = { key: "errors.recent", label: "Errors in the last hour", area: "errors" as const }
  return {
    ...def,
    every: 5,
    run: async () => {
      const since = new Date(Date.now() - 3_600_000).toISOString()
      const { data, error } = await db
        .from("app_errors")
        .select("app, fingerprint, message, path")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(500)
      if (error) return result(def, "unknown", "Couldn't read the error log")
      const groups = new Map<string, { app: string; message: string; path: string | null; count: number }>()
      for (const e of data ?? []) {
        const g = groups.get(e.fingerprint)
        if (g) g.count++
        else groups.set(e.fingerprint, { app: e.app, message: e.message, path: e.path, count: 1 })
      }
      const sorted = [...groups.values()].sort((a, b) => b.count - a.count)
      const lines = sorted.slice(0, 6).map((g) =>
        `${g.count}× ${g.app === "public" ? "website" : "admin"}${g.path ? ` ${g.path}` : ""}: ${g.message.slice(0, 140)}`
      )
      const total = data?.length ?? 0
      if (total >= 25) return result(def, "down", `${total} errors in the last hour`, { lines })
      if (total >= 5) return result(def, "warn", `${total} errors in the last hour`, { lines })
      return result(def, "ok", total ? `${plural(total, "error")} in the last hour` : "No errors", { lines })
    },
  }
}

// ---------------------------------------------------------------------------

export function buildChecks(db: SupabaseClient, studios: LiveStudio[]): CheckDef[] {
  const sites: CheckDef[] = studios.flatMap((s) => [
    pageCheck(`site.public.${s.domain}`, `${s.domain}`, `https://${s.domain}/`, (b) => b.includes(s.name.split(" ")[0])),
    pageCheck(`site.timetable.${s.domain}`, `${s.domain} timetable`, `https://${s.domain}/api/timetable`, (b) => b.trim().startsWith("{") || b.trim().startsWith("[")),
    pageCheck(`site.admin.${s.domain}`, `admin.${s.domain}`, `https://admin.${s.domain}/login`, (b) => b.length > 500),
  ])
  const hosts = studios.flatMap((s) => [s.domain, `admin.${s.domain}`])

  return [
    ...sites,
    certificatesCheck(hosts),
    domainsCheck([...new Set([...studios.map((s) => s.domain), "useforma.co.uk"])]),
    ...supabaseChecks(db),
    vendorStatusCheck("supabase", "Supabase", "https://status.supabase.com/api/v2/summary.json", null),
    heartbeatCheck(db),
    vendorStatusCheck(
      "vercel",
      "Vercel",
      "https://www.vercel-status.com/api/v2/summary.json",
      /Functions|CDN|Edge|Build|Deploy|Cron|DNS|TLS|Routing|Image|London|lhr1|API/i
    ),
    ...resendChecks(studios),
    vendorStatusCheck("resend", "Resend", "https://resend-status.com/api/v2/summary.json", /Single Email|Batch|API|Email Events|SMTP/i),
    ...stripeChecks(db, studios),
    vendorStatusCheck(
      "stripe",
      "Stripe",
      "https://www.stripestatus.com/api/v2/summary.json",
      /API|Global payments|core|Dashboard|Payouts|Connect|Cards|Webhooks/i
    ),
    ...dataChecks(db, studios),
    errorsCheck(db),
  ]
}
