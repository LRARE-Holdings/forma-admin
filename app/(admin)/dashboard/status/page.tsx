import Link from "next/link"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  attentionItems,
  avgMsToday,
  errorsToday,
  loadCheckout,
  loadChecks,
  loadEmails,
  loadErrorGroups,
  loadSpeed,
  loadTimeline,
  uptimeSince,
  type CheckRow,
} from "@/lib/monitor/dashboard"
import { platformOf } from "@/lib/monitor/insights"
import { AttentionCard, Chip, Dot, Panel, Sparkline, Stat, Timeline } from "@/components/dashboard/status/ui"

export const dynamic = "force-dynamic"

const renderedAt = () => Date.now()

function worst(checks: CheckRow[]): "ok" | "warn" | "down" {
  const loud = checks.filter((c) => !c.detail?.quiet)
  if (loud.some((c) => c.status === "down")) return "down"
  if (loud.some((c) => c.status === "warn")) return "warn"
  return "ok"
}

const pct = (v: number | null) => (v === null ? "–" : `${v >= 99.995 ? "100" : v.toFixed(2)}%`)
const secs = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(2)}s`)

export default async function StatusOverview() {
  const db = createAdminClient()
  const now = renderedAt()
  const [checks, groups] = await Promise.all([loadChecks(db), loadErrorGroups(db)])
  const items = attentionItems(checks, groups, now)
  const siteKeys = checks.filter((c) => platformOf(c.key) === "website").map((c) => c.key)
  const adminKeys = checks.filter((c) => c.key.startsWith("site.admin.")).map((c) => c.key)

  const [siteUp, adminUp, siteMs, adminMs, siteErr, adminErr, checkout, emails, siteSpeed, adminSpeed, timeline] = await Promise.all([
    uptimeSince(db, siteKeys, 30),
    uptimeSince(db, adminKeys, 30),
    avgMsToday(db, "site.public."),
    avgMsToday(db, "site.admin."),
    errorsToday(db, "public"),
    errorsToday(db, "admin"),
    loadCheckout(),
    loadEmails(db),
    loadSpeed(db, "site.public."),
    loadSpeed(db, "site.admin."),
    loadTimeline(db),
  ])
  const emailsToday = Object.values(emails.today).reduce((a, b) => a + b, 0)

  const card = (
    platform: "website" | "admin",
    title: string,
    href: string,
    stats: [React.ReactNode, string][],
    speed: { ms: number }[],
  ) => {
    const mine = items.filter((i) => i.platform === platform && i.severity !== "info")
    const urgent = mine.filter((i) => i.severity === "urgent").length
    return (
      <div className="rounded-2xl border border-sand bg-white px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-heading text-[1.4rem] font-medium text-cocoa">{title}</h3>
          {urgent ? <Chip tone="urgent">{urgent} urgent</Chip> : mine.length ? <Chip tone="look">{mine.length} to look at</Chip> : <Chip tone="ok">Working</Chip>}
        </div>
        <div className="mt-3 grid grid-cols-2 border-t border-sand sm:grid-cols-4">
          {stats.map(([v, l]) => <Stat key={l} value={v} label={l} />)}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {speed.length >= 6 && <div className="min-w-0 overflow-hidden"><Sparkline points={speed.map((p) => p.ms)} /></div>}
          <Link href={href} className="inline-flex min-h-10 w-full shrink-0 items-center justify-center rounded-lg border border-sand px-3 text-[0.82rem] font-medium text-cocoa hover:bg-cream sm:min-h-0 sm:w-auto sm:py-1.5 sm:text-[0.76rem]">
            Open dashboard →
          </Link>
        </div>
      </div>
    )
  }

  // One line per service: what's wrong if anything is, otherwise its main figure.
  const services: { name: string; keys: string[]; main: string }[] = [
    { name: "Supabase", keys: ["supabase.database", "supabase.auth", "supabase.jobs", "supabase.status"], main: "supabase.database" },
    { name: "Vercel", keys: ["vercel.status", "vercel.jobs"], main: "vercel.jobs" },
    { name: "Resend", keys: ["resend.domains", "resend.delivery", "resend.status"], main: "resend.delivery" },
    { name: "Stripe", keys: ["stripe.account", "stripe.webhooks", "stripe.fulfilment", "stripe.status"], main: "stripe.account" },
  ]
  const serviceLine = (mine: CheckRow[], main: string) =>
    (mine.find((c) => !c.detail?.quiet && (c.status === "down" || c.status === "warn")) ?? mine.find((c) => c.key === main))?.summary ?? "Not checked yet"

  return (
    <div className="space-y-5">
      {items.length > 0 && <div className="space-y-3">{items.map((i) => <AttentionCard key={i.id} item={i} now={now} />)}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {card("website", "burnmatstudio.co.uk", "/dashboard/status/website", [
          [pct(siteUp), "Uptime, 30 days"],
          [secs(siteMs), "Page load"],
          [siteErr, "Errors today"],
          [checkout.error ? "–" : checkout.paidToday, "Payments today"],
        ], siteSpeed)}
        {card("admin", "Admin app", "/dashboard/status/admin", [
          [pct(adminUp), "Uptime, 30 days"],
          [secs(adminMs), "Page load"],
          [adminErr, "Errors today"],
          [emails.error ? "–" : emailsToday >= 100 ? "100+" : emailsToday, "Emails today"],
        ], adminSpeed)}
      </div>

      <Panel title="Services">
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          {services.map((s) => {
            const mine = checks.filter((c) => s.keys.includes(c.key))
            return (
              <div key={s.name} className="border-b border-sand px-4 py-3.5 last:border-b-0 sm:border-r sm:px-5 xl:border-b-0 [&:last-child]:border-r-0">
                <div className="flex items-center gap-2 text-[0.84rem] font-semibold text-cocoa"><Dot status={worst(mine)} />{s.name}</div>
                <p className="mt-1 text-[0.76rem] text-warm-grey">{serviceLine(mine, s.main)}</p>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="Today">
        <Timeline items={timeline} />
      </Panel>
    </div>
  )
}
