import Link from "next/link"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  groupState,
  loadChecks,
  loadEmails,
  loadErrorGroups,
  loadJobs,
  loadPayments,
  loadRefusals,
  loadUptime,
} from "@/lib/monitor/dashboard"
import { checkInsight, pageLabel } from "@/lib/monitor/insights"
import { ago, Chip, dayTime, Dot, Empty, InsightBar, Panel, Row, Sub, UptimeRows } from "@/components/dashboard/status/ui"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

const renderedAt = () => Date.now()
const STATE_LABEL = { new: "New", ongoing: "Ongoing", resolved: "Resolved", muted: "Muted" }
const EMAIL_STATUS: Record<string, [string, string]> = {
  delivered: ["ok", "Delivered"],
  opened: ["ok", "Opened"],
  clicked: ["ok", "Clicked"],
  sent: ["muted", "Sent"],
  queued: ["muted", "Queued"],
  scheduled: ["muted", "Scheduled"],
  delivery_delayed: ["warn", "Delayed"],
  bounced: ["failed", "Bounced"],
  complained: ["failed", "Marked spam"],
  failed: ["failed", "Failed"],
  suppressed: ["failed", "Blocked"],
}

export default async function AdminStatus() {
  const db = createAdminClient()
  const now = renderedAt()
  const checks = await loadChecks(db)
  const domain = checks.find((c) => c.key.startsWith("site.admin."))?.key.replace("site.admin.", "") ?? "burnmatstudio.co.uk"

  const [uptime, payments, emails, lucy, jobs, groups] = await Promise.all([
    loadUptime(db, [
      { key: `site.admin.${domain}`, label: "Admin login", sub: `admin.${domain}` },
      { key: "stripe.webhooks", label: "Stripe webhook", sub: "payments turning into bookings" },
      { key: "supabase.database", label: "Database", sub: "Supabase, London" },
      { key: "supabase.auth", label: "Logins", sub: "Supabase Auth" },
    ], checks),
    loadPayments(db, 25),
    loadEmails(db),
    loadRefusals(db, "admin", "action", 7),
    loadJobs(db),
    loadErrorGroups(db, "admin", 7),
  ])

  const failedPayments = payments.filter((p) => p.level === "error" && now - new Date(p.at).getTime() < 86_400_000)
  const warnPayments = payments.filter((p) => p.level === "warn" && now - new Date(p.at).getTime() < 86_400_000)
  const bad = emails.rows.filter((e) => ["bounced", "complained", "failed", "suppressed"].includes(e.status))
  const badJobs = jobs.filter((j) => j.problem)
  const dataChecks = checks.filter((c) => ["stripe.fulfilment", "stripe.account", "bookings.stranded", "bookings.products", "resend.delivery", "resend.domains"].includes(c.key))

  return (
    <div className="space-y-5">
      <Panel title="Uptime, last 90 days" sub="Checked every 5 minutes from London">
        <UptimeRows rows={uptime} />
      </Panel>

      <Panel title="Payments coming in from Stripe" sub="Every event Stripe sent and what the admin app did with it">
        {payments.length ? (
          <ul>
            {payments.map((p) => (
              <Row
                key={p.id}
                aside={
                  <>
                    <Chip tone={p.level === "error" ? "failed" : p.level === "warn" ? "warn" : "done"}>
                      {p.level === "error" ? "Failed" : p.level === "warn" ? "Check" : "Done"}
                    </Chip>
                    <Sub>{dayTime(p.at)}</Sub>
                  </>
                }
              >
                <div className="font-medium text-cocoa">{p.label}{p.amount ? ` · ${p.amount}` : ""}</div>
                <Sub>{p.who}{p.what ? ` · ${p.what}` : ""}</Sub>
                <div className="mt-1 break-words text-[0.78rem] text-slate sm:text-[0.74rem]">{p.outcome}</div>
              </Row>
            ))}
          </ul>
        ) : (
          <Empty>No payment events logged yet. They appear here as Stripe sends them.</Empty>
        )}
        <InsightBar status={failedPayments.length ? "down" : warnPayments.length ? "warn" : "ok"}>
          {failedPayments.length ? (
            <><b className="text-cocoa">{failedPayments.length} payment event{failedPayments.length === 1 ? "" : "s"} failed in the last day.</b> Stripe retries for 3 days, so a temporary problem fixes itself; if the same one keeps failing, open it under Errors below.</>
          ) : warnPayments.length ? (
            <><b className="text-cocoa">{warnPayments.length} to check:</b> {warnPayments.slice(0, 2).map((p) => `${p.who}: ${p.outcome}`).join("; ")}. A class that filled while someone paid is refunded automatically; anything else, open the error below.</>
          ) : (
            <><b className="text-cocoa">All handled.</b> Every payment event in the last day turned into a booking, pack, ticket or gift card.</>
          )}
        </InsightBar>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Emails" sub={`Latest ${emails.rows.length} from Burn's domain`}>
          {emails.error ? (
            <Empty>Couldn&apos;t read emails from Resend: {emails.error}</Empty>
          ) : (
            // No scroll box inside the page (it traps the thumb on a phone):
            // the latest 10, then the rest behind "Show more".
            <>
              <ul>{emails.rows.slice(0, 10).map((e, i) => <EmailRow key={i} e={e} />)}</ul>
              {emails.rows.length > 10 && (
                <details className="group border-t border-[#f0e9dc]">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-[0.8rem] font-medium text-cocoa hover:bg-cream/60 sm:min-h-0 sm:px-5 sm:py-2.5 [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Show {Math.min(30, emails.rows.length - 10)} more</span>
                    <span className="hidden group-open:inline">Show fewer</span>
                  </summary>
                  <ul>{emails.rows.slice(10, 40).map((e, i) => <EmailRow key={i} e={e} />)}</ul>
                </details>
              )}
            </>
          )}
          <InsightBar status={bad.length ? "warn" : "ok"}>
            {bad.length ? (
              <><b className="text-cocoa">{bad.length} not delivered</b> ({[...new Set(bad.map((b) => b.to))].join(", ")}). A bounce or block is almost always a mistyped address: ask Lucy to check it with the member and fix it in Members.</>
            ) : (
              <><b className="text-cocoa">Everything delivered.</b></>
            )}
          </InsightBar>
        </Panel>

        <Panel title="What went wrong for Lucy" sub="Buttons that showed her an error · 7 days">
          {lucy.length ? (
            <ul>
              {lucy.map((r, i) => (
                <Row key={i} aside={`${r.count}×`}>
                  <div className="font-medium text-cocoa">{r.what}</div>
                  <div className="mt-0.5 break-words text-slate">&ldquo;{r.message}&rdquo;</div>
                  <Sub>last {ago(r.last, now)}</Sub>
                </Row>
              ))}
            </ul>
          ) : (
            <Empty>Nothing in the last 7 days. When a button tells Lucy no, it shows up here with the page and the exact message.</Empty>
          )}
          <InsightBar status={lucy.some((r) => r.count >= 3) ? "warn" : "ok"}>
            {lucy.some((r) => r.count >= 3)
              ? <><b className="text-cocoa">The same message keeps coming up.</b> Something there may be confusing or broken: worth asking Lucy what she was trying to do.</>
              : <>These are the app saying no for a reason (no credits left, class full). Repeats of the same one are worth asking Lucy about.</>}
          </InsightBar>
        </Panel>
      </div>

      <Panel title="Background jobs" sub="Last 14 runs each, oldest to newest">
        <ul>
          {jobs.map((j) => (
            <Row
              key={j.name}
              aside={
                <>
                  <div className="text-cocoa">{j.last ? dayTime(j.last) : "–"}</div>
                  <Sub>{j.ms === null ? "" : j.ms < 1000 ? `${j.ms}ms` : `${(j.ms / 1000).toFixed(1)}s`}</Sub>
                </>
              }
            >
              <div className="font-semibold text-cocoa">{j.name}</div>
              <Sub>{j.when}</Sub>
              <div className="mt-1.5 flex flex-wrap gap-[3px]" aria-label="Last runs, oldest to newest">
                {j.runs.map((r, i) => (
                  <i key={i} title={`${dayTime(r.at)}${r.note ? `: ${r.note}` : ""}`} className={cn("h-3 w-3 rounded-[2px] sm:h-2.5 sm:w-2.5", r.ok ? "bg-success" : "bg-red-700")} />
                ))}
              </div>
              {j.problem && <div className="mt-1 break-words text-[0.76rem] text-[#9a4a16] sm:text-[0.7rem]">{j.problem}</div>}
            </Row>
          ))}
        </ul>
        <InsightBar status={badJobs.length ? "warn" : "ok"}>
          {badJobs.length
            ? <><b className="text-cocoa">{badJobs.length} job{badJobs.length === 1 ? "" : "s"} had a problem recently.</b> A single red square is usually a blip (the next run was fine). Two or more in a row means it&apos;s stuck: tell Claude.</>
            : <><b className="text-cocoa">All running.</b></>}
        </InsightBar>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Errors" sub="Grouped by cause · last 7 days">
          {groups.length ? (
            <ul>
              {groups.map((g) => {
                const state = groupState(g, now)
                return (
                  <Row key={g.fingerprint} aside={<><Chip tone={state}>{STATE_LABEL[state]}</Chip><Sub>{g.occurrences}× · {ago(g.last_seen, now)}</Sub></>}>
                    <Link href={`/dashboard/status/errors/${g.fingerprint}`} className="break-words font-semibold text-cocoa hover:underline">{g.title}</Link>
                    <Sub>{pageLabel(g.path)} · {g.kind}</Sub>
                  </Row>
                )
              })}
            </ul>
          ) : (
            <Empty>No errors in the admin app in the last 7 days.</Empty>
          )}
        </Panel>

        <Panel title="Money and bookings checks" sub="Things that go wrong quietly">
          <ul>
            {dataChecks.map((c) => {
              const insight = checkInsight(c.key, c.status, c.summary ?? "")
              return (
                <li key={c.key} className="border-t border-sand px-4 py-3 first:border-t-0 sm:px-5">
                  <div className="flex items-center gap-2 text-[0.8rem] font-semibold text-cocoa"><Dot status={c.status} />{c.label}</div>
                  <p className={cn("text-[0.76rem]", c.status === "ok" ? "text-warm-grey" : "text-[#9a4a16]")}>{c.summary}</p>
                  {insight && <p className="mt-1 text-[0.74rem] text-slate">{insight.steps[0]}</p>}
                </li>
              )
            })}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

function EmailRow({ e }: { e: { at: string; to: string; name: string | null; subject: string; status: string } }) {
  const [tone, label] = EMAIL_STATUS[e.status] ?? ["muted", e.status]
  return (
    <Row aside={<><Chip tone={tone}>{label}</Chip><Sub>{dayTime(e.at)}</Sub></>}>
      <div className="break-words text-cocoa">{e.subject}</div>
      <Sub><span className="break-all">to {e.name ? `${e.name} (${e.to})` : e.to}</span></Sub>
    </Row>
  )
}
