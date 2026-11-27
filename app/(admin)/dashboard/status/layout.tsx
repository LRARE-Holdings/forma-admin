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
    // pt-5 on phones: the fixed top bar is exactly as tall as the page's top
    // padding, so without it the headline sits flush against the bar.
    <div className="mx-auto max-w-[1320px] pt-5 md:pt-0">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className={cn("font-heading text-[2.1rem] font-medium leading-[1.05] sm:text-[2.4rem] sm:leading-none", urgent ? "text-red-700" : needs.length ? "text-ember" : "text-cocoa")}>
            {headline}
          </h2>
          <p className="mt-2 text-[0.84rem] text-warm-grey sm:text-[0.8rem]">
            {needs.length ? `${parts.join(", ")}. ` : ""}Checked {ago(lastRun, now)}.
            {stale && <span className="ml-1.5 font-semibold text-red-700">Checks have stopped: see Background jobs.</span>}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <RunChecksButton />
          <Link href="/dashboard/status/alerts" className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted sm:h-8 sm:flex-none sm:px-2.5">
            Alert settings
          </Link>
        </div>
      </header>
      <StatusTabs
        tabs={[
          { href: "/dashboard/status", label: "Overview", short: "Overview", urgent: urgent, look: needs.length - urgent },
          { href: "/dashboard/status/website", label: "burnmatstudio.co.uk", short: "Website", urgent: count("website", "urgent"), look: count("website", "look") },
          { href: "/dashboard/status/admin", label: "Admin app", short: "Admin", urgent: count("admin", "urgent"), look: count("admin", "look") },
        ]}
      />
      {children}
    </div>
  )
}
