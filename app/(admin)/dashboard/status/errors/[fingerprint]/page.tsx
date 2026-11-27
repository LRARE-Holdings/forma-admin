import Link from "next/link"
import { notFound } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { device, groupState, loadErrorDetail } from "@/lib/monitor/dashboard"
import { pageLabel } from "@/lib/monitor/insights"
import { ago, Chip, dayTime, Empty, Panel, Steps } from "@/components/dashboard/status/ui"
import { ErrorActions } from "@/components/dashboard/status/error-actions"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

const renderedAt = () => Date.now()
const STATE_LABEL = { new: "New", ongoing: "Ongoing", resolved: "Resolved", muted: "Muted" }

export default async function ErrorDetail({ params }: { params: Promise<{ fingerprint: string }> }) {
  const { fingerprint } = await params
  if (!/^[0-9a-f]{16}$/.test(fingerprint)) notFound()
  const now = renderedAt()
  const detail = await loadErrorDetail(createAdminClient(), fingerprint)
  if (!detail) notFound()
  const { group, insight, latest, occurrences, trace, person, people, perDay } = detail
  const state = groupState(group, now)
  const app = group.app === "public" ? "burnmatstudio.co.uk" : "Admin app"
  const back = group.app === "public" ? "/dashboard/status/website" : "/dashboard/status/admin"
  const max = Math.max(1, ...perDay.map((d) => d.count))

  // Everything Claude needs to look into it, as plain text.
  const report = [
    `Error on ${app} (${group.kind}): ${group.title}`,
    `Page: ${group.path ?? "unknown"} · first seen ${group.first_seen} · last seen ${group.last_seen} · ${group.occurrences} times · ${people} people`,
    latest?.route && `Route: ${latest.route}`,
    latest?.release && `Version: ${latest.release}`,
    latest?.request_id && `Request id: ${latest.request_id}`,
    latest?.correlation && `Payment: ${latest.correlation}`,
    latest?.user_agent && `Device: ${latest.user_agent}`,
    trace.length && `\nWhat happened:\n${trace.map((t) => `${t.at} [${t.source}] ${t.text}`).join("\n")}`,
    latest?.stack && `\nStack:\n${latest.stack}`,
  ].filter(Boolean).join("\n")

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-[0.74rem] text-warm-grey">
          <Link href={back} className="hover:text-cocoa hover:underline">{app}</Link> / Errors
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <Chip tone={state}>{STATE_LABEL[state]}{group.reopened && state === "new" ? " · came back" : ""}</Chip>
            <h3 className="mt-2 break-words font-heading text-[1.6rem] font-medium leading-tight text-cocoa sm:text-[1.9rem]">{group.title}</h3>
            <p className="mt-1 text-[0.78rem] text-warm-grey">
              {app} · {pageLabel(group.path)} · first seen {dayTime(group.first_seen)} · last {ago(group.last_seen, now)} · {group.occurrences} time{group.occurrences === 1 ? "" : "s"}
              {people ? ` · ${people} ${people === 1 ? "person" : "people"}` : ""}
            </p>
          </div>
          <ErrorActions fingerprint={group.fingerprint} state={state} report={report} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="What happened, step by step" sub={latest?.request_id ? <span className="font-mono">request {latest.request_id}</span> : undefined}>
            {trace.length ? (
              <ol className="px-4 py-3 sm:px-5">
                {trace.map((t, i) => (
                  // Phone: time and app on a line of their own above what happened.
                  <li key={i} className="relative ml-1.5 grid grid-cols-[auto_1fr] gap-x-3 border-l border-sand py-1.5 pl-4 text-[0.82rem] sm:grid-cols-[72px_64px_1fr] sm:text-[0.78rem]">
                    <span className={cn("absolute -left-[4px] top-3 h-[7px] w-[7px] rounded-full", t.bad ? "bg-red-700" : "bg-sand")} />
                    <span className="tabular-nums text-warm-grey">{new Date(t.at).toLocaleTimeString("en-GB", { timeZone: "Europe/London" })}</span>
                    <span className="text-warm-grey">{t.source}</span>
                    <span className={cn("col-span-2 break-words sm:col-span-1", t.bad ? "font-semibold text-red-700" : "text-slate")}>{t.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>Only the error itself was recorded.</Empty>
            )}
          </Panel>

          <Panel title="Technical detail">
            <dl className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-1.5 px-4 py-3.5 text-[0.8rem] sm:grid-cols-[110px_1fr] sm:px-5 sm:text-[0.78rem]">
              <dt className="text-warm-grey">Error</dt><dd className="break-words font-mono text-[0.74rem]">{latest?.message ?? group.title}</dd>
              <dt className="text-warm-grey">Where</dt><dd className="break-words font-mono text-[0.74rem]">{latest?.route ?? latest?.path ?? "–"} · {group.kind}{latest?.method ? ` · ${latest.method}` : ""}</dd>
              {latest?.correlation && (<><dt className="text-warm-grey">Payment</dt><dd className="font-mono text-[0.74rem]">{latest.correlation}</dd></>)}
              <dt className="text-warm-grey">Version</dt><dd>{latest?.release ?? "–"}</dd>
            </dl>
            {latest?.stack ? (
              <pre className="max-h-[320px] overflow-auto bg-[#2b211a] px-4 py-3.5 sm:px-5 font-mono text-[0.72rem] leading-relaxed text-[#eadfca]">{latest.stack}</pre>
            ) : (
              <Empty>No stack trace.</Empty>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="What this means">
            <div className="space-y-3 px-5 py-4">
              <p className="text-[0.82rem] text-slate">{insight.meaning}</p>
              <Steps insight={insight} />
            </div>
          </Panel>

          <Panel title="Who it affected">
            <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 px-5 py-3.5 text-[0.78rem]">
              <dt className="text-warm-grey">Person</dt><dd>{person ?? "Not signed in, or not known"}</dd>
              <dt className="text-warm-grey">Device</dt><dd>{device(latest?.user_agent)}</dd>
              <dt className="text-warm-grey">Page</dt><dd className="break-words">{latest?.path ?? "–"}</dd>
            </dl>
          </Panel>

          <Panel title="Times this happened" sub="30 days">
            <div className="px-5 pb-4 pt-3">
              <div className="flex h-10 items-end gap-[2px]">
                {perDay.map((d) => (
                  <i key={d.day} title={`${d.day}: ${d.count}`}
                    className={cn("flex-1 rounded-[2px]", d.count ? "bg-red-700" : "bg-[#e9e1d3]")}
                    style={{ height: d.count ? `${Math.max(18, (d.count / max) * 100)}%` : "18%" }} />
                ))}
              </div>
              <ul className="mt-3 space-y-1 text-[0.74rem] text-warm-grey">
                {occurrences.slice(0, 6).map((o) => (
                  <li key={o.id}>{dayTime(o.occurred_at)} · {o.path ?? "–"} · {device(o.user_agent)}</li>
                ))}
              </ul>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
