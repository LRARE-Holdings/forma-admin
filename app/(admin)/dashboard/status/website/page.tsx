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
import { ago, Chip, Empty, InsightBar, Panel, SpeedChart, Td, Th, UptimeRows } from "@/components/dashboard/status/ui"

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
      { key: `site.public.${domain}`, label: "Homepage", sub: domain },
      { key: `site.timetable.${domain}`, label: "Timetable", sub: "what members book from" },
      { key: `site.checkout.${domain}`, label: "Checkout", sub: "starting a payment" },
      { key: `site.gift.${domain}`, label: "Gift card pages", sub: "buy, pay link, claim" },
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
      <Panel title="Uptime, last 90 days" sub="Checked every 5 minutes from London">
        <UptimeRows rows={uptime} />
        <InsightBar status={[certs, domains].some((c) => c && c.status !== "ok" && c.status !== "unknown") ? "warn" : "ok"}>
          <b className="text-cocoa">HTTPS and domain.</b> {certs?.summary ?? "Not checked yet"}. {domains?.summary ?? ""}
        </InsightBar>
      </Panel>

      <Panel title="Checkout today" sub="Every payment started on the website, from Stripe">
        {checkout.error ? (
          <Empty>Couldn&apos;t read payments from Stripe: {checkout.error}</Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4">
              {steps.map(([label, n, bar]) => (
                <div key={label} className="border-b border-r border-sand px-5 py-3.5 last:border-r-0 md:border-b-0">
                  <span className="text-[0.72rem] text-warm-grey">{label}</span>
                  <b className="block font-heading text-[1.9rem] font-medium leading-none tabular-nums text-cocoa">{n}</b>
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-sand">
                    <i className={`block h-full ${bar}`} style={{ width: `${checkout.started ? Math.round((n / checkout.started) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
            {checkout.reasons.length > 0 && (
              <table className="w-full border-collapse">
                <thead><tr><Th>Why cards were declined</Th><Th>Times</Th><Th>What it means</Th></tr></thead>
                <tbody>
                  {checkout.reasons.map((r) => (
                    <tr key={r.label}><Td>{r.label}</Td><Td className="tabular-nums">{r.count}</Td><Td className="text-slate">{r.meaning}</Td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <InsightBar status={failPct !== null && failPct > 25 ? "warn" : "ok"}>
              {failPct === null ? (
                <><b className="text-cocoa">No card payments yet today.</b> {weekPct !== null && `Over the last 7 days, ${weekPct}% of card attempts were declined.`}</>
              ) : failPct > 25 ? (
                <><b className="text-cocoa">More declines than usual.</b> {failPct}% of card attempts failed today (last 7 days: {weekPct ?? "–"}%). If the reasons above are all different banks, it&apos;s chance; if they&apos;re all the same error, check Stripe on the Overview tab.</>
              ) : (
                <><b className="text-cocoa">Healthy.</b> {failPct}% of card attempts were declined today (last 7 days: {weekPct ?? "–"}%). Up to a quarter is normal: people use the wrong card or don&apos;t finish the bank check.</>
              )}
              {checkout.unfinished > 0 && ` ${checkout.unfinished} checkout${checkout.unfinished === 1 ? "" : "s"} opened but not paid: people changing their mind, or still on the page.`}
            </InsightBar>
          </>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Errors" sub="Grouped by cause · last 7 days">
          {groups.length ? (
            <table className="w-full border-collapse">
              <thead><tr><Th>Error</Th><Th>Seen</Th><Th /></tr></thead>
              <tbody>
                {groups.map((g) => {
                  const state = groupState(g, now)
                  return (
                    <tr key={g.fingerprint} className="hover:bg-[#fbf8f2]">
                      <Td>
                        <Link href={`/dashboard/status/errors/${g.fingerprint}`} className="font-semibold text-cocoa hover:underline">{g.title}</Link>
                        <div className="text-[0.7rem] text-warm-grey">{pageLabel(g.path)} · {g.kind === "browser" ? "seen in a browser" : g.kind}</div>
                      </Td>
                      <Td className="whitespace-nowrap tabular-nums">{g.occurrences}×<div className="text-[0.7rem] text-warm-grey">{ago(g.last_seen, now)}</div></Td>
                      <Td><Chip tone={state}>{STATE_LABEL[state]}</Chip></Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <Empty>No errors on the website in the last 7 days.</Empty>
          )}
        </Panel>

        <Panel title="Refused requests" sub="Not errors: the site said no on purpose · 7 days">
          {refusals.length ? (
            <table className="w-full border-collapse">
              <thead><tr><Th>What was refused</Th><Th>Times</Th><Th>Why</Th></tr></thead>
              <tbody>
                {refusals.map((r, i) => (
                  <tr key={i}><Td>{r.what}</Td><Td className="tabular-nums">{r.count}</Td><Td className="text-slate">{r.message}</Td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Nothing refused in the last 7 days.</Empty>
          )}
          <InsightBar status="ok">
            Class full, wrong password, an expired pack: this is the site doing its job. It&apos;s worth a look if one reason suddenly appears a lot, e.g. &ldquo;class is full&rdquo; for a class that isn&apos;t.
          </InsightBar>
        </Panel>
      </div>

      <Panel title="Homepage load time" sub="Last 24 hours, measured from London">
        <SpeedChart points={speed} />
      </Panel>
    </div>
  )
}
