import Link from "next/link"
import { cn } from "@/lib/utils"
import type { AttentionItem, TimelineItem, UptimeRow } from "@/lib/monitor/dashboard"
import type { Insight } from "@/lib/monitor/insights"

/** Server-rendered building blocks for the status dashboards. */

export function clock(iso: string | null): string {
  if (!iso) return "–"
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
}

export function dayTime(iso: string | null): string {
  if (!iso) return "–"
  const d = new Date(iso)
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" })
  const day = d.toLocaleDateString("en-CA", { timeZone: "Europe/London" })
  return day === today
    ? clock(iso)
    : d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
}

export function ago(iso: string | null, now: number): string {
  if (!iso) return "never"
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)} days ago`
}

export const DOT: Record<string, string> = {
  ok: "bg-success", warn: "bg-ember", down: "bg-red-700", unknown: "bg-sand", info: "bg-sand", none: "bg-sand/70",
}

export function Dot({ status, className }: { status: string; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[status] ?? "bg-sand", className)} aria-hidden />
}

const CHIP: Record<string, string> = {
  new: "bg-red-50 text-red-700",
  urgent: "bg-red-50 text-red-700",
  failed: "bg-red-50 text-red-700",
  ongoing: "bg-[#FBF1E7] text-[#9a4a16]",
  look: "bg-[#FBF1E7] text-[#9a4a16]",
  warn: "bg-[#FBF1E7] text-[#9a4a16]",
  resolved: "bg-success-bg text-success",
  ok: "bg-success-bg text-success",
  done: "bg-success-bg text-success",
  muted: "bg-sand/60 text-warm-grey",
  noted: "bg-sand/60 text-warm-grey",
}

export function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide", CHIP[tone] ?? CHIP.muted)}>
      {children}
    </span>
  )
}

export function Panel({
  title,
  sub,
  action,
  children,
  className,
}: {
  title: string
  sub?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-sand bg-white", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-sand px-4 py-3.5 sm:px-5">
        <h3 className="text-[0.84rem] font-semibold text-cocoa">{title}</h3>
        <div className="flex items-center gap-3 text-[0.74rem] text-warm-grey">
          {sub}
          {action}
        </div>
      </div>
      {children}
    </section>
  )
}

export function InsightBar({ status, children }: { status: "ok" | "warn" | "down"; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 border-t border-sand bg-[#fcfaf6] px-4 py-3 text-[0.8rem] text-slate sm:px-5 sm:text-[0.78rem]">
      <Dot status={status} className="mt-1.5" />
      <div>{children}</div>
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-[0.82rem] text-warm-grey sm:px-5 sm:text-[0.8rem]">{children}</p>
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn("whitespace-nowrap border-b border-sand px-5 py-2.5 text-left text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-warm-grey", className)}>
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("border-t border-[#f0e9dc] px-5 py-2.5 align-top text-[0.8rem]", className)}>{children}</td>
}

export function Steps({ insight, compact }: { insight: Insight; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl bg-cream px-4 py-3", compact && "py-2.5")}>
      <div className="mb-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-warm-grey">What to do</div>
      <ol className="list-decimal space-y-1 pl-4 text-[0.8rem] text-cocoa">
        {insight.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {insight.prevent && (
        <p className="mt-2 border-t border-sand pt-2 text-[0.74rem] text-slate">
          <span className="font-semibold text-cocoa">Stop it happening again: </span>
          {insight.prevent}
        </p>
      )}
    </div>
  )
}

const SEV = {
  urgent: { bar: "bg-red-700", label: "Urgent", text: "text-red-700" },
  look: { bar: "bg-ember", label: "Look at", text: "text-ember" },
  info: { bar: "bg-sand", label: "For info", text: "text-warm-grey" },
}

const PLATFORM = { website: "burnmatstudio.co.uk", admin: "Admin app", services: "Services" }

export function AttentionCard({ item, now }: { item: AttentionItem; now: number }) {
  const s = SEV[item.severity]
  return (
    <article className="grid grid-cols-[4px_1fr] overflow-hidden rounded-2xl border border-sand bg-white">
      <div className={s.bar} />
      <div className={cn("grid gap-4 px-4 py-4 sm:gap-5 sm:px-5", item.insight && item.severity !== "info" && "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}>
        <div className="min-w-0">
          <div className={cn("text-[0.6rem] font-semibold uppercase tracking-[0.12em]", s.text)}>
            {s.label} · {PLATFORM[item.platform]} · {item.topic}
          </div>
          <h4 className="mt-1 break-words text-[1rem] font-semibold leading-snug text-cocoa sm:text-[0.95rem]">{item.title}</h4>
          {item.insight && <p className="mt-1.5 text-[0.8rem] text-slate">{item.insight.meaning}</p>}
          {item.detail && <p className="mt-1.5 break-words text-[0.76rem] text-warm-grey">{item.detail}</p>}
          <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[0.72rem] text-warm-grey">
            <span>Since {dayTime(item.since)} · {ago(item.since, now)}</span>
            {item.meta.map((m, i) => <span key={i}>{m}</span>)}
          </div>
          {item.href && (
            <Link href={item.href} className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-cocoa px-3.5 text-[0.8rem] font-medium text-cream hover:bg-cocoa/90 sm:min-h-0 sm:py-1.5 sm:text-[0.76rem]">
              See what happened
            </Link>
          )}
        </div>
        {item.insight && item.severity !== "info" && <Steps insight={item.insight} compact />}
      </div>
    </article>
  )
}

export function UptimeRows({ rows }: { rows: UptimeRow[] }) {
  const pct = (r: UptimeRow) => (r.pct === null ? "–" : `${r.pct >= 99.995 ? "100" : r.pct.toFixed(2)}%`)
  return (
    <div>
      {rows.map((r) => (
        // Phone: name and figures on one line, the 90 days full width below.
        // Wider: name · bars · uptime · speed in one row.
        <div
          key={r.key}
          className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-t border-sand px-4 py-3 first:border-t-0 sm:px-5 md:grid-cols-[210px_1fr_72px_64px] md:py-2.5"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[0.84rem] font-semibold text-cocoa md:text-[0.8rem]"><Dot status={r.status} />{r.label}</div>
            {r.sub && <div className="truncate text-[0.72rem] text-warm-grey md:text-[0.7rem]">{r.sub}</div>}
          </div>
          <div
            className="col-span-2 row-start-2 flex h-6 gap-px md:col-span-1 md:row-start-auto md:h-5 md:gap-[2px]"
            role="img"
            aria-label={`${r.label}: last 90 days`}
          >
            {r.days.map((d) => (
              <i
                key={d.day}
                title={`${d.day}: ${d.runs ? `${d.ok} of ${d.runs} checks fine` : "not checked"}`}
                className={cn("min-w-0 flex-1 rounded-[1px] md:rounded-[2px]", d.state === "ok" ? "bg-success/85" : d.state === "warn" ? "bg-ember" : d.state === "down" ? "bg-red-700" : "bg-[#e9e1d3]")}
              />
            ))}
          </div>
          <div className="text-right text-[0.8rem] tabular-nums text-cocoa md:text-[0.76rem]">
            {pct(r)}
            <span className="block text-[0.72rem] text-warm-grey md:hidden">{r.ms ? `${r.ms}ms` : ""}</span>
          </div>
          <div className="hidden text-right text-[0.72rem] tabular-nums text-warm-grey md:block">{r.ms ? `${r.ms}ms` : ""}</div>
        </div>
      ))}
      <div className="flex justify-between px-4 pb-2.5 pt-0.5 text-[0.66rem] text-warm-grey sm:px-5 md:pl-[246px] md:pr-[156px]">
        <span>90 days ago</span><span>today</span>
      </div>
    </div>
  )
}

export function Sparkline({ points, width = 240, height = 34 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 6) return <div style={{ width, height }} className="flex items-center text-[0.72rem] text-warm-grey">Speed chart fills in over the next few hours</div>
  const max = Math.max(...points), min = Math.min(...points)
  const y = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6)
  const step = width / (points.length - 1)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cocoa"
        points={points.map((p, i) => `${(i * step).toFixed(1)},${y(p).toFixed(1)}`).join(" ")} />
    </svg>
  )
}

export function SpeedChart({ points }: { points: { at: string; ms: number }[] }) {
  if (points.length < 6) return <Empty>Fills in over the next few hours.</Empty>
  const W = 1000, H = 150
  const max = Math.max(1000, ...points.map((p) => p.ms))
  const t0 = new Date(points[0].at).getTime(), t1 = new Date(points[points.length - 1].at).getTime()
  const x = (iso: string) => ((new Date(iso).getTime() - t0) / (t1 - t0 || 1)) * W
  const y = (ms: number) => H - (ms / max) * H
  const worst = points.reduce((a, b) => (b.ms > a.ms ? b : a))
  const typical = [...points].sort((a, b) => a.ms - b.ms)[Math.floor(points.length / 2)].ms
  return (
    <div className="px-4 pb-3 pt-3 sm:px-5">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.76rem] text-slate">
        <span>Typical: <b className="tabular-nums text-cocoa">{(typical / 1000).toFixed(2)}s</b></span>
        <span>Slowest: <b className="tabular-nums text-cocoa">{(worst.ms / 1000).toFixed(2)}s</b> at {clock(worst.at)}</span>
      </div>
      <div className="relative">
        {/* The line stretches to fit; labels are HTML so they stay readable at any width. */}
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Load time over the last 24 hours" className="block">
          <line x1="0" y1={y(1000)} x2={W} y2={y(1000)} stroke="#E8DCC8" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="#E8DCC8" vectorEffect="non-scaling-stroke" />
          <polyline fill="none" stroke="#473728" strokeWidth="1.6" vectorEffect="non-scaling-stroke"
            points={points.map((p) => `${x(p.at).toFixed(1)},${y(p.ms).toFixed(1)}`).join(" ")} />
        </svg>
        <span className="absolute right-0 text-[0.64rem] text-warm-grey" style={{ top: `calc(${(y(1000) / H) * 100}% - 14px)` }}>1s</span>
        {worst.ms > 1500 && (
          <span
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ember"
            style={{ left: `${(x(worst.at) / W) * 100}%`, top: `${(y(worst.ms) / H) * 100}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[0.66rem] text-warm-grey">
        <span>{dayTime(points[0].at)}</span><span>now</span>
      </div>
    </div>
  )
}

/** One line of a list panel: main content on the left, figures or a status on the right. */
export function Row({ children, aside, className }: { children: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <li className={cn("flex items-start justify-between gap-3 border-t border-[#f0e9dc] px-4 py-3 first:border-t-0 sm:px-5 sm:py-2.5", className)}>
      <div className="min-w-0 flex-1 text-[0.84rem] sm:text-[0.8rem]">{children}</div>
      {aside !== undefined && <div className="shrink-0 text-right text-[0.8rem] tabular-nums">{aside}</div>}
    </li>
  )
}

export function Sub({ children }: { children: React.ReactNode }) {
  return <div className="mt-0.5 text-[0.74rem] text-warm-grey sm:text-[0.7rem]">{children}</div>
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <Empty>Nothing yet.</Empty>
  return (
    <ul className="px-4 py-2 sm:px-5">
      {items.map((t, i) => (
        <li key={i} className="grid grid-cols-[44px_10px_1fr] gap-2 py-1.5 text-[0.8rem] sm:grid-cols-[52px_12px_1fr] sm:gap-2.5 sm:text-[0.78rem]">
          <time className="pt-px text-[0.7rem] tabular-nums text-warm-grey">{clock(t.at)}</time>
          <Dot status={t.status} className="mt-1.5" />
          <span className="text-slate">{t.text}</span>
        </li>
      ))}
    </ul>
  )
}

export function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="pt-3">
      <b className="block font-heading text-[1.45rem] font-medium leading-tight tabular-nums text-cocoa">{value}</b>
      <span className="text-[0.7rem] text-warm-grey">{label}</span>
    </div>
  )
}
