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
    sub: string,
    href: string,
    stats: [React.ReactNode, string][],
    speed: { ms: number }[],
  ) => {
    const mine = items.filter((i) => i.platform === platform && i.severity !== "info")
    const urgent = mine.filter((i) => i.severity === "urgent").length
    return (
      <div className="rounded-2xl border border-sand bg-white px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-heading text-[1.4rem] font-medium text-cocoa">{title}</h3>
          {urgent ? <Chip tone="urgent">{urgent} urgent</Chip> : mine.length ? <Chip tone="look">{mine.length} to look at</Chip> : <Chip tone="ok">Working</Chip>}
        </div>
        <p className="text-[0.74rem] text-warm-grey">{sub}</p>
        <div className="mt-3 grid grid-cols-2 border-t border-sand sm:grid-cols-4">
          {stats.map(([v, l]) => <Stat key={l} value={v} label={l} />)}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0 overflow-hidden"><Sparkline points={speed.map((p) => p.ms)} /></div>
          <Link href={href} className="inline-flex shrink-0 rounded-lg border border-sand px-3 py-1.5 text-[0.76rem] font-medium text-cocoa hover:bg-cream">
            Open dashboard →
          </Link>
        </div>
      </div>
    )
  }

  const services: { name: string; keys: string[]; line: (c: CheckRow[]) => string }[] = [
    {
      name: "Supabase",
      keys: ["supabase.database", "supabase.auth", "supabase.jobs", "supabase.status"],
      line: (c) => c.find((x) => x.key === "supabase.database")?.detail?.lines?.join(" · ") ?? "Not checked yet",
    },
    {
      name: "Vercel",
      keys: ["vercel.status", "vercel.jobs"],
      line: (c) => [c.find((x) => x.key === "vercel.jobs")?.summary, c.find((x) => x.key === "vercel.status")?.summary].filter(Boolean).join(" · "),
    },
    {
      name: "Resend",
      keys: ["resend.domains", "resend.delivery", "resend.status"],
      line: (c) => [c.find((x) => x.key === "resend.delivery")?.summary, c.find((x) => x.key === "resend.domains")?.summary].filter(Boolean).join(" · "),
    },
    {
      name: "Stripe",
      keys: ["stripe.account", "stripe.webhooks", "stripe.fulfilment", "stripe.status"],
      line: (c) => [c.find((x) => x.key === "stripe.account")?.summary, c.find((x) => x.key === "stripe.webhooks")?.summary].filter(Boolean).join(" · "),
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-warm-grey">Needs attention</p>
        {items.length ? (
          <div className="space-y-3">{items.map((i) => <AttentionCard key={i.id} item={i} now={now} />)}</div>
        ) : (
          <p className="rounded-2xl border border-dashed border-sand px-5 py-5 text-[0.84rem] text-warm-grey">
            Nothing. Every check passed on its last run and no new errors in the last day.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {card("website", "burnmatstudio.co.uk", "Members' website: booking, checkout, gift cards", "/dashboard/status/website", [
          [pct(siteUp), "Up, last 30 days"],
          [secs(siteMs), "Typical page load today"],
          [siteErr, "Errors today"],
          [checkout.error ? "–" : checkout.paidToday, "Payments today"],
        ], siteSpeed)}
        {card("admin", "Admin app", "Lucy's dashboard, payment handling, emails, daily jobs", "/dashboard/status/admin", [
          [pct(adminUp), "Up, last 30 days"],
          [secs(adminMs), "Typical page load today"],
          [adminErr, "Errors today"],
          [emails.error ? "–" : emailsToday >= 100 ? "100+" : emailsToday, "Emails today"],
        ], adminSpeed)}
      </div>

      <Panel title="Services both apps rely on" sub="Our own checks, plus each provider's status page">
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          {services.map((s) => {
            const mine = checks.filter((c) => s.keys.includes(c.key))
            return (
              <div key={s.name} className="border-b border-sand px-5 py-3.5 sm:border-r xl:border-b-0 [&:last-child]:border-r-0">
                <div className="flex items-center gap-2 text-[0.84rem] font-semibold text-cocoa"><Dot status={worst(mine)} />{s.name}</div>
                <p className="mt-1 text-[0.74rem] text-warm-grey">{s.line(mine) || "Not checked yet"}</p>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="What changed today" sub="Both apps, newest first">
        <Timeline items={timeline} />
      </Panel>
    </div>
  )
}
