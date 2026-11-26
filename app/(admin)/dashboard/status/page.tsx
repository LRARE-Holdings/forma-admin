import { createAdminClient } from "@/lib/supabase/admin"
import { requirePlatformOwner } from "@/lib/monitor/owner"
import { loadMonitorConfig } from "@/lib/monitor/run"
import { AREA_LABELS, type CheckArea, type CheckStatus } from "@/lib/monitor/types"
import { RunChecksButton } from "@/components/dashboard/status/run-checks-button"
import { AlertChannels } from "@/components/dashboard/status/alert-channels"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

interface CheckRow {
  key: string
  label: string
  area: CheckArea
  status: CheckStatus
  summary: string | null
  detail: { lines?: string[]; quiet?: boolean } | null
  checked_at: string | null
  changed_at: string
}

const AREA_ORDER: CheckArea[] = ["site", "stripe", "supabase", "vercel", "resend", "bookings", "errors"]

const STATUS_STYLE: Record<CheckStatus, { dot: string; text: string; word: string }> = {
  ok: { dot: "bg-success", text: "text-success", word: "Working" },
  warn: { dot: "bg-ember", text: "text-ember", word: "Needs a look" },
  down: { dot: "bg-red-600", text: "text-red-700", word: "Down" },
  unknown: { dot: "bg-warm-grey/50", text: "text-warm-grey", word: "Not checked" },
}

function ago(iso: string | null, now: number): string {
  if (!iso) return "never"
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)} days ago`
}

function clock(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  })
}

const renderedAt = () => Date.now()

export default async function StatusPage() {
  await requirePlatformOwner()
  const db = createAdminClient()
  const now = renderedAt()

  const [checksRes, eventsRes, errorsRes, lastRunRes, config] = await Promise.all([
    db.from("monitor_checks").select("key, label, area, status, summary, detail, checked_at, changed_at"),
    db.from("monitor_events").select("id, label, status, previous_status, summary, alerted, created_at")
      .order("created_at", { ascending: false }).limit(25),
    db.from("app_errors").select("fingerprint, app, kind, message, path, occurred_at")
      .gte("occurred_at", new Date(now - 86_400_000).toISOString())
      .order("occurred_at", { ascending: false }).limit(500),
    db.from("monitor_runs").select("created_at").eq("job", "monitor")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    loadMonitorConfig(),
  ])

  // The bot's @name, for the "open it in Telegram" link while setting up.
  let telegramBot: string | null = null
  if (config.telegram_token) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.telegram_token}/getMe`, { signal: AbortSignal.timeout(4000) })
      telegramBot = ((await res.json()) as { result?: { username?: string } }).result?.username ?? null
    } catch {
      telegramBot = null
    }
  }

  const checks = (checksRes.data ?? []) as CheckRow[]
  const loud = checks.filter((c) => !c.detail?.quiet)
  const down = loud.filter((c) => c.status === "down")
  const warn = loud.filter((c) => c.status === "warn")
  const lastRun = lastRunRes.data?.created_at ?? null
  const stale = !lastRun || now - new Date(lastRun).getTime() > 15 * 60_000

  const headline = down.length
    ? `${down.length === 1 ? "Something is" : `${down.length} things are`} down.`
    : warn.length
      ? `${warn.length === 1 ? "One thing needs" : `${warn.length} things need`} a look.`
      : "Everything's working."

  const errorGroups = new Map<string, { app: string; kind: string; message: string; path: string | null; count: number; last: string }>()
  for (const e of errorsRes.data ?? []) {
    const g = errorGroups.get(e.fingerprint)
    if (g) g.count++
    else errorGroups.set(e.fingerprint, { app: e.app, kind: e.kind, message: e.message, path: e.path, count: 1, last: e.occurred_at })
  }

  // Areas with a problem float to the top; the error log has its own section.
  const byArea = AREA_ORDER.filter((area) => area !== "errors")
    .map((area) => {
      const list = checks
        .filter((c) => c.area === area)
        .sort((a, b) => rank(b.status) - rank(a.status) || a.label.localeCompare(b.label))
      const worst = list.reduce<CheckStatus>((w, c) => (rank(c.status) > rank(w) ? c.status : w), "ok")
      return { area, checks: list, worst }
    })
    .filter((g) => g.checks.length)
    .sort((a, b) => rank(b.worst) - rank(a.worst))
  const errorCheck = checks.find((c) => c.key === "errors.recent")

  return (
    <div className="mx-auto max-w-[1180px]">
      {/* Headline */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-sand pb-6">
        <div>
          <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-warm-grey">
            Forma status · {checks.length} checks · every 5 minutes
          </p>
          <h2 className={cn(
            "font-heading text-[2.4rem] font-medium leading-none",
            down.length ? "text-red-700" : warn.length ? "text-ember" : "text-cocoa"
          )}>
            {headline}
          </h2>
          <p className="mt-2 text-[0.82rem] text-warm-grey">
            {lastRun ? `Last checked ${ago(lastRun, now)}` : "Not checked yet"}
            {stale && lastRun && (
              <span className="ml-2 font-semibold text-red-700">
                The monitor has stopped running. Check the Supabase cron job.
              </span>
            )}
          </p>
        </div>
        <RunChecksButton />
      </header>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Checks by area */}
        <div className="space-y-8">
          {byArea.map(({ area, checks, worst }) => {
            return (
              <section key={area} className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)]">
                <div className="pt-3">
                  <h3 className="font-heading text-[1.25rem] font-medium text-cocoa">{AREA_LABELS[area]}</h3>
                  <p className={cn("mt-0.5 text-[0.72rem] font-semibold", STATUS_STYLE[worst].text)}>
                    {STATUS_STYLE[worst].word}
                  </p>
                </div>
                <ul className="divide-y divide-sand overflow-hidden rounded-xl border border-sand bg-white">
                  {checks.map((c) => {
                    const lines = c.detail?.lines ?? []
                    const style = STATUS_STYLE[c.status]
                    const row = (
                      <div className="flex items-start gap-3 px-4 py-3">
                        <span className={cn("mt-[0.4rem] h-2 w-2 flex-shrink-0 rounded-full", style.dot)} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="text-[0.86rem] font-semibold text-cocoa">{c.label}</span>
                            {c.status !== "ok" && (
                              <span className="text-[0.7rem] text-warm-grey">since {ago(c.changed_at, now)}</span>
                            )}
                          </div>
                          <p className={cn("text-[0.8rem]", c.status === "ok" ? "text-warm-grey" : style.text)}>
                            {c.summary}
                            {c.detail?.quiet && c.status !== "ok" && (
                              <span className="ml-1.5 text-warm-grey">(no alert sent)</span>
                            )}
                          </p>
                        </div>
                      </div>
                    )
                    return (
                      <li key={c.key}>
                        {lines.length ? (
                          <details className="group">
                            <summary className="cursor-pointer list-none hover:bg-cream/60 [&::-webkit-details-marker]:hidden">
                              {row}
                            </summary>
                            <ul className="space-y-1 bg-cream/50 px-4 py-3 pl-9 text-[0.76rem] text-slate">
                              {lines.map((l, i) => <li key={i}>{l}</li>)}
                            </ul>
                          </details>
                        ) : row}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}

          {/* Errors */}
          <section className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)]">
            <div className="pt-3">
              <h3 className="font-heading text-[1.25rem] font-medium text-cocoa">Errors</h3>
              <p className={cn("mt-0.5 text-[0.72rem] font-semibold", STATUS_STYLE[errorCheck?.status ?? "ok"].text)}>
                {errorCheck && errorCheck.status !== "ok" ? errorCheck.summary : "Last 24 hours"}
              </p>
            </div>
            {errorGroups.size ? (
              <ul className="divide-y divide-sand overflow-hidden rounded-xl border border-sand bg-white">
                {[...errorGroups.values()].map((e, i) => (
                  <li key={i} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-[0.74rem] font-semibold uppercase tracking-wide text-warm-grey">
                        {e.app === "public" ? "Website" : "Admin"} · {e.kind}{e.path ? ` · ${e.path}` : ""}
                      </span>
                      <span className="text-[0.7rem] text-warm-grey">{e.count}× · last {ago(e.last, now)}</span>
                    </div>
                    <p className="mt-1 break-words font-mono text-[0.76rem] text-cocoa">{e.message}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-sand px-4 py-5 text-[0.82rem] text-warm-grey">
                No errors from either app in the last 24 hours.
              </p>
            )}
          </section>
        </div>

        {/* Right rail */}
        <aside className="space-y-8">
          <AlertChannels
            telegram={config.telegram_token ? (config.telegram_chat_id ? "connected" : "waiting") : "off"}
            telegramBot={telegramBot}
            pushTopic={config.ntfy_topic ?? null}
            email={config.alert_email ?? null}
          />

          <section>
            <h3 className="mb-3 font-heading text-[1.25rem] font-medium text-cocoa">Recent changes</h3>
            {eventsRes.data?.length ? (
              <ol className="relative space-y-4 border-l border-sand pl-4">
                {eventsRes.data.map((e) => (
                  <li key={e.id} className="relative">
                    <span className={cn(
                      "absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-cream",
                      STATUS_STYLE[e.status as CheckStatus]?.dot ?? "bg-warm-grey"
                    )} />
                    <p className="text-[0.7rem] text-warm-grey">
                      {clock(e.created_at)}{e.alerted ? " · alert sent" : ""}
                    </p>
                    <p className="text-[0.8rem] font-semibold text-cocoa">{e.label}</p>
                    <p className="text-[0.76rem] text-slate">{e.summary}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[0.8rem] text-warm-grey">Nothing has changed yet.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

function rank(s: CheckStatus): number {
  return { ok: 0, unknown: 1, warn: 2, down: 3 }[s]
}
