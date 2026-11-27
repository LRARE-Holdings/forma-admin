import { createAdminClient } from "@/lib/supabase/admin"
import { buildChecks, type CheckDef } from "./checks"
import { deliverAlert, type Alert, type AlertLevel } from "./alerts"
import { checkInsight, errorInsight, pageLabel } from "./insights"
import type { CheckResult, CheckStatus, LiveStudio, MonitorConfig } from "./types"

/**
 * One monitor run: run the checks that are due, store what changed, and send
 * one combined alert for anything that went wrong, got worse or recovered.
 *
 * When to alert:
 *   - a check goes bad and stays bad for two runs in a row (ten minutes), so a
 *     single dropped request doesn't wake anyone; `urgent` checks alert at once
 *   - it gets worse (warn → down) or eases (down → warn)
 *   - it's still down three hours after the last alert (a reminder)
 *   - it recovers after an alert went out
 *   - an error appears in the apps that hasn't been seen in the last 30 days
 * `quiet` results (third-party status page notices, the odd bounced email)
 * show on the status page but never push.
 */

const CHECK_TIMEOUT_MS = 25_000
const REMIND_AFTER_MS = 3 * 3_600_000

interface StoredCheck {
  key: string
  status: CheckStatus
  checked_at: string | null
  streak: number
  alerted_status: string | null
  alerted_at: string | null
  last_ok_at: string | null
  changed_at: string | null
}

export interface RunReport {
  ran: number
  skipped: number
  alerted: boolean
  results: { key: string; status: CheckStatus; summary: string }[]
  durationMs: number
}

function timeout(def: CheckDef): Promise<CheckResult> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          key: def.key,
          label: def.label,
          area: def.area,
          status: "unknown",
          summary: `Check didn't finish within ${CHECK_TIMEOUT_MS / 1000}s`,
        }),
      CHECK_TIMEOUT_MS
    )
  )
}

async function safeRun(def: CheckDef): Promise<CheckResult> {
  try {
    return await Promise.race([def.run(), timeout(def)])
  } catch (e) {
    return {
      key: def.key,
      label: def.label,
      area: def.area,
      status: "unknown",
      summary: `Check crashed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function loadMonitorConfig(): Promise<MonitorConfig> {
  const db = createAdminClient()
  const { data } = await db.rpc("monitor_config")
  return (data ?? {}) as MonitorConfig
}

export async function loadLiveStudios(): Promise<LiveStudio[]> {
  const db = createAdminClient()
  const { data } = await db
    .from("studios")
    .select("id, name, domain, email_domain, stripe_account_id")
    .eq("stripe_onboarding_complete", true)
    .not("domain", "is", null)
  return (data ?? []) as LiveStudio[]
}

export async function runMonitor(options: { force?: boolean; only?: string[] } = {}): Promise<RunReport> {
  const started = Date.now()
  const db = createAdminClient()
  const [studios, stored, config] = await Promise.all([
    loadLiveStudios(),
    db.from("monitor_checks").select("key, status, checked_at, streak, alerted_status, alerted_at, last_ok_at, changed_at"),
    loadMonitorConfig(),
  ])
  const previous = new Map((stored.data ?? []).map((r) => [r.key, r as StoredCheck]))
  const defs = buildChecks(db, studios)

  // A check is due once its interval has passed, with a minute's slack so a
  // run that starts a few seconds early doesn't skip a beat.
  const due = defs.filter((d) => {
    if (options.only && !options.only.includes(d.key)) return false
    if (options.force) return true
    const last = previous.get(d.key)?.checked_at
    return !last || Date.now() - new Date(last).getTime() >= (d.every - 1) * 60_000
  })

  const results = await Promise.all(due.map(safeRun))
  const now = new Date().toISOString()
  const alertItems: { level: AlertLevel; heading: string; lines?: string[] }[] = []
  const events: Record<string, unknown>[] = []
  const rows: Record<string, unknown>[] = []

  for (const r of results) {
    const prev = previous.get(r.key)
    const bad = r.status === "warn" || r.status === "down"
    const streak = r.status === "ok" ? 0 : (prev && prev.status !== "ok" ? prev.streak + 1 : 1)
    let alertedStatus = prev?.alerted_status ?? null
    let alertedAt = prev?.alerted_at ?? null

    if (bad && !r.quiet) {
      const confirmed = r.urgent || streak >= 2
      const stale = alertedAt ? Date.now() - new Date(alertedAt).getTime() > REMIND_AFTER_MS : true
      const reminder = r.status === "down" && alertedStatus === "down" && stale
      if (confirmed && (alertedStatus !== r.status || reminder)) {
        // The alert says what to do, not just what broke.
        const insight = checkInsight(r.key, r.status, r.summary)
        alertItems.push({
          level: r.status as AlertLevel,
          heading: `${reminder ? "Still down: " : ""}${r.label}: ${r.summary}`,
          lines: [
            ...(insight ? [insight.meaning, ...insight.steps.slice(0, 3).map((step, i) => `${i + 1}. ${step}`)] : []),
            ...(r.lines ?? []).slice(0, 4),
          ],
        })
        alertedStatus = r.status
        alertedAt = now
      }
    } else if (r.status === "ok" && (alertedStatus === "warn" || alertedStatus === "down")) {
      const since = prev?.last_ok_at ? ` (problem started after ${new Date(prev.last_ok_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })})` : ""
      alertItems.push({ level: "ok", heading: `${r.label} is back to normal${since}`, lines: [r.summary] })
      alertedStatus = null
      alertedAt = null
    }

    // A check's very first result isn't a change, so it stays off the timeline.
    if (prev && prev.status !== r.status) {
      events.push({
        check_key: r.key,
        label: r.label,
        status: r.status,
        previous_status: prev?.status ?? null,
        summary: r.summary,
        alerted: alertItems.some((a) => a.heading.includes(r.label)),
      })
    }

    rows.push({
      key: r.key,
      label: r.label,
      area: r.area,
      status: r.status,
      summary: r.summary,
      detail: { lines: r.lines ?? [], quiet: !!r.quiet, ms: r.ms ?? null },
      checked_at: now,
      changed_at: !prev || prev.status !== r.status ? now : prev.changed_at ?? now,
      last_ok_at: r.status === "ok" ? now : prev?.last_ok_at ?? null,
      streak,
      alerted_status: alertedStatus,
      alerted_at: alertedAt,
    })
  }

  // Error groups to alert on: new ones, and ones that came back after being
  // marked resolved (the trigger clears alerted_at then). Muted groups never.
  const { data: pending } = await db
    .from("error_groups")
    .select("fingerprint, app, kind, title, path, occurrences, reopened")
    .eq("status", "open")
    .is("alerted_at", null)
    .order("first_seen")
    .limit(20)
  const errorAlerts = pending ?? []
  for (const g of errorAlerts.slice(0, 4)) {
    const insight = errorInsight(g)
    alertItems.push({
      level: "warn",
      heading: `${g.reopened ? "Error came back" : "New error"} on ${g.app === "public" ? "the website" : "the admin app"}: ${g.title.slice(0, 120)}`,
      lines: [
        `${pageLabel(g.path)} · ${g.occurrences}× so far · ${g.kind}`,
        insight.meaning,
        ...insight.steps.slice(0, 2).map((step, i) => `${i + 1}. ${step}`),
      ],
    })
  }
  if (errorAlerts.length > 4) {
    alertItems.push({ level: "warn", heading: `${errorAlerts.length - 4} more new errors`, lines: [] })
  }

  let alerted = false
  if (alertItems.length) {
    const worst: AlertLevel = alertItems.some((a) => a.level === "down")
      ? "down"
      : alertItems.some((a) => a.level === "warn")
        ? "warn"
        : "ok"
    const title =
      alertItems.length === 1
        ? alertItems[0].heading
        : worst === "ok"
          ? `${alertItems.length} things back to normal`
          : alertItems.every((a) => /^(New error|Error came back)/.test(a.heading))
          ? `${alertItems.length} new errors`
          : `${alertItems.filter((a) => a.level !== "ok").length} problems need a look`
    const alert: Alert = {
      level: worst,
      title: title.length > 120 ? `${title.slice(0, 117)}…` : title,
      items: alertItems.length === 1 && alertItems[0].lines?.length
        ? [{ heading: alertItems[0].heading, lines: alertItems[0].lines }]
        : alertItems,
    }
    const delivery = await deliverAlert(config, alert)
    alerted = delivery.telegram === "sent" || delivery.push === "sent" || delivery.email === "sent"
    if (errorAlerts.length) {
      await db.from("error_groups").update({ alerted_at: new Date().toISOString() })
        .in("fingerprint", errorAlerts.map((g) => g.fingerprint))
    }
  }

  if (rows.length) await db.from("monitor_checks").upsert(rows)
  if (events.length) await db.from("monitor_events").insert(events)
  const durationMs = Date.now() - started
  // History for the uptime bars and speed charts.
  if (results.length) {
    await db.rpc("monitor_record_results", {
      p_results: results.map((r) => ({ key: r.key, status: r.status, ms: typeof r.ms === "number" ? r.ms : "" })),
    })
  }
  await db.from("monitor_runs").insert({ job: "monitor", ok: true, duration_ms: durationMs, note: `${results.length} checks` })
  if (new Date().getMinutes() < 5) await db.rpc("monitor_prune")

  return {
    ran: results.length,
    skipped: defs.length - results.length,
    alerted,
    results: results.map((r) => ({ key: r.key, status: r.status, summary: r.summary })),
    durationMs,
  }
}

/** Heartbeat for scheduled jobs, read by the "Daily scheduled jobs" check. */
export async function recordJobRun(job: string, ok: boolean, note?: string, durationMs?: number): Promise<void> {
  try {
    await createAdminClient().from("monitor_runs").insert({ job, ok, note: note?.slice(0, 500) ?? null, duration_ms: durationMs ?? null })
  } catch (e) {
    console.error("[monitor] heartbeat failed:", e)
  }
}
