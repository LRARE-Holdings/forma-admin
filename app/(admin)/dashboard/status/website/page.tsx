import Link from "next/link"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  groupState,
  loadCheckout,
  loadChecks,
  loadErrorGroups,
  loadRefusals,
  loadSpeed,
  loadUptime,
} from "@/lib/monitor/dashboard"
import { pageLabel } from "@/lib/monitor/insights"
import { ago, Chip, Empty, InsightBar, Panel, Row, SpeedChart, Sub, UptimeRows } from "@/components/dashboard/status/ui"

export const dynamic = "force-dynamic"

const renderedAt = () => Date.now()
const STATE_LABEL = { new: "New", ongoing: "Ongoing", resolved: "Resolved", muted: "Muted" }

export default async function WebsiteStatus() {
  const db = createAdminClient()
  const now = renderedAt()
  const checks = await loadChecks(db)
  const domain = checks.find((c) => c.key.startsWith("site.public."))?.key.replace("site.public.", "") ?? "burnmatstudio.co.uk"

  const [uptime, checkout, groups, refusals, speed] = await Promise.all([
    loadUptime(db, [
      { key: `site.public.${domain}`, label: "Homepage", sub: "" },
      { key: `site.timetable.${domain}`, label: "Timetable", sub: "" },
      { key: `site.checkout.${domain}`, label: "Checkout", sub: "" },
      { key: `site.gift.${domain}`, label: "Gift cards", sub: "" },
    ], checks),
    loadCheckout(),
    loadErrorGroups(db, "public", 7),
    loadRefusals(db, "public", "request", 7),
    loadSpeed(db, `site.public.${domain}`),
  ])
  const certs = checks.find((c) => c.key === "site.certificates")
  const domains = checks.find((c) => c.key === "site.domains")
  const failPct = checkout.failRate === null ? null : Math.round(checkout.failRate * 100)
  const weekPct = checkout.weekFailRate === null ? null : Math.round(checkout.weekFailRate * 100)
  const steps: [string, number, string][] = [
    ["Opened checkout", checkout.started, "bg-cocoa"],
    ["Paid", checkout.paid, "bg-success"],
    ["Card declined", checkout.declined, "bg-ember"],
    ["Didn't finish", checkout.unfinished, "bg-warm-grey"],
  ]

  return (
    <div className="space-y-5">
      <Panel title="Uptime">
        <UptimeRows rows={uptime} />
        {[certs, domains].some((c) => c && c.status !== "ok" && c.status !== "unknown") && (
          <InsightBar status="warn"><b className="text-cocoa">HTTPS or domain.</b> {certs?.summary}. {domains?.summary}</InsightBar>
        )}
      </Panel>

      <Panel title="Checkout today">
        {checkout.error ? (
          <Empty>Couldn&apos;t read payments from Stripe: {checkout.error}</Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4">
              {steps.map(([label, n, bar]) => (
                <div key={label} className="border-b border-r border-sand px-4 py-3.5 even:border-r-0 sm:px-5 md:border-b-0 md:even:border-r md:last:border-r-0">
                  <span className="text-[0.72rem] text-warm-grey">{label}</span>
                  <b className="block font-heading text-[1.9rem] font-medium leading-none tabular-nums text-cocoa">{n}</b>
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-sand">
                    <i className={`block h-full ${bar}`} style={{ width: `${checkout.started ? Math.round((n / checkout.started) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
            {checkout.reasons.length > 0 && (
              <ul className="border-t border-sand">
                {checkout.reasons.map((r) => (
                  <Row key={r.label} aside={`${r.count}×`}>
                    <div className="font-medium text-cocoa">{r.label}</div>
                    <Sub>{r.meaning}</Sub>
                  </Row>
                ))}
              </ul>
            )}
            {failPct !== null && failPct > 25 ? (
              <InsightBar status="warn">
                <b className="text-cocoa">{failPct}% of cards declined today</b> (7 days: {weekPct ?? "–"}%). Different banks and reasons: chance. All the same error: check Stripe on the Overview tab.
              </InsightBar>
            ) : (
              <p className="border-t border-sand px-4 py-2.5 text-[0.76rem] text-warm-grey sm:px-5">
                {failPct === null ? "No card payments yet" : `${failPct}% declined`} · 7 days: {weekPct ?? "–"}% declined
              </p>
            )}
          </>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Errors" sub="7 days">
          {groups.length ? (
            <ul>
              {groups.map((g) => {
                const state = groupState(g, now)
                return (
                  <Row key={g.fingerprint} aside={<><Chip tone={state}>{STATE_LABEL[state]}</Chip><Sub>{g.occurrences}× · {ago(g.last_seen, now)}</Sub></>}>
                    <Link href={`/dashboard/status/errors/${g.fingerprint}`} className="break-words font-semibold text-cocoa hover:underline">{g.title}</Link>
                    <Sub>{pageLabel(g.path)} · {g.kind === "browser" ? "seen in a browser" : g.kind}</Sub>
                  </Row>
                )
              })}
            </ul>
          ) : (
            <Empty>None.</Empty>
          )}
        </Panel>

        <Panel title="Refused" sub="7 days · deliberate, not errors">
          {refusals.length ? (
            <ul>
              {refusals.map((r, i) => (
                <Row key={i} aside={`${r.count}×`}>
                  <div className="font-medium text-cocoa">{r.what}</div>
                  <Sub>{r.message} · last {ago(r.last, now)}</Sub>
                </Row>
              ))}
            </ul>
          ) : (
            <Empty>None.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="Homepage speed" sub="24 hours">
        <SpeedChart points={speed} />
      </Panel>
    </div>
  )
}
