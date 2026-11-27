import Link from "next/link"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePlatformOwner } from "@/lib/monitor/owner"
import { attentionItems, lastMonitorRun, loadChecks, loadErrorGroups } from "@/lib/monitor/dashboard"
import { StatusTabs } from "@/components/dashboard/status/status-tabs"
import { RunChecksButton } from "@/components/dashboard/status/run-checks-button"
import { ago } from "@/components/dashboard/status/ui"
import { cn } from "@/lib/utils"

const renderedAt = () => Date.now()

/**
 * The status area: a headline that says how many things need you, and tabs
 * for the combined overview, the website and the admin app. Forma's own
 * accounts only (platform_owners).
 */
export default async function StatusLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformOwner()
  const db = createAdminClient()
  const now = renderedAt()
  const [checks, groups, lastRun] = await Promise.all([loadChecks(db), loadErrorGroups(db), lastMonitorRun(db)])
  const items = attentionItems(checks, groups, now)
  const needs = items.filter((i) => i.severity !== "info")
  const urgent = needs.filter((i) => i.severity === "urgent").length
  const count = (p: string, sev: string) => items.filter((i) => i.platform === p && i.severity === sev).length
  const stale = !lastRun || now - new Date(lastRun).getTime() > 15 * 60_000
  const words = ["Nothing", "One thing needs", "Two things need", "Three things need", "Four things need", "Five things need"]
  const headline = needs.length === 0 ? "Everything's working." : `${words[needs.length] ?? `${needs.length} things need`} you.`
  const parts = ["website", "admin", "services"].map((p) => {
    const n = needs.filter((i) => i.platform === p)
    if (!n.length) return null
    const where = p === "website" ? "the website" : p === "admin" ? "the admin app" : "a service both apps use"
    return `${n.length} on ${where}`
  }).filter(Boolean)

  return (
    <div className="mx-auto max-w-[1320px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-warm-grey">
            Forma status · {checks.length} checks every 5 minutes · last checked {ago(lastRun, now)}
          </p>
          <h2 className={cn("mt-1.5 font-heading text-[2.4rem] font-medium leading-none", urgent ? "text-red-700" : needs.length ? "text-ember" : "text-cocoa")}>
            {headline}
          </h2>
          <p className="mt-2 text-[0.8rem] text-warm-grey">
            {needs.length ? `${parts.join(", ")}. Everything else is working.` : "Both apps and every service they rely on are fine."}
            {stale && (
              <span className="ml-2 font-semibold text-red-700">The checks have stopped running: see Background jobs on the Admin app tab.</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <RunChecksButton />
          <Link href="/dashboard/status/alerts" className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted">
            Alert settings
          </Link>
        </div>
      </header>
      <StatusTabs
        tabs={[
          { href: "/dashboard/status", label: "Overview", urgent: urgent, look: needs.length - urgent },
          { href: "/dashboard/status/website", label: "burnmatstudio.co.uk", urgent: count("website", "urgent"), look: count("website", "look") },
          { href: "/dashboard/status/admin", label: "Admin app", urgent: count("admin", "urgent"), look: count("admin", "look") },
        ]}
      />
      {children}
    </div>
  )
}
