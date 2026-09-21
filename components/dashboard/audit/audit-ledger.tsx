"use client"

import { useEffect, useState, useTransition } from "react"
import { Download, Search, AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { getAuditRows, exportAuditCsv } from "@/app/actions/audit"
import { KIND_LABELS, KIND_STYLES, KIND_STRIPES } from "@/lib/audit-types"
import type { AuditFilters, AuditKind, AuditRow } from "@/lib/audit-types"
import { formatTime } from "@/lib/utils"
import { toast } from "sonner"

const KIND_TABS: { value: AuditKind | "all"; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "debit", label: "Credits used" },
  { value: "refund", label: "Credits returned" },
  { value: "refund_failed", label: "Not returned" },
  { value: "manual_adjustment", label: "By hand" },
  { value: "purchase", label: "Purchases" },
]

function formatStamp(iso: string): { day: string; time: string } {
  const d = new Date(iso)
  return {
    day: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  }
}

function formatDay(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
}

/** "Lucy Healy", or where the movement came from when no person signed it. */
function describeActor(row: AuditRow): string {
  if (row.actorName) return row.actorName
  if (row.actorRole === "member") return "Member, on the website"
  if (row.actorRole === "studio") return "Studio"
  return "System"
}

export function AuditLedger({
  initialRows,
  initialTotal,
}: {
  initialRows: AuditRow[]
  initialTotal: number
}) {
  const [rows, setRows] = useState(initialRows)
  const [total, setTotal] = useState(initialTotal)
  const [kind, setKind] = useState<AuditKind | "all">("all")
  const [search, setSearch] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [isPending, startTransition] = useTransition()
  const [exporting, setExporting] = useState(false)

  const filters: AuditFilters = { kind, search, from, to }

  // Debounced so typing a member's name doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      startTransition(async () => {
        try {
          const res = await getAuditRows({ kind, search, from, to })
          setRows(res.rows)
          setTotal(res.total)
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not load the audit")
        }
      })
    }, 250)
    return () => clearTimeout(t)
  }, [kind, search, from, to])

  async function handleExport() {
    setExporting(true)
    try {
      const csv = await exportAuditCsv(filters)
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `credit-audit-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${rows.length} rows`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed")
    } finally {
      setExporting(false)
    }
  }

  const failures = rows.filter((r) => r.kind === "refund_failed").length

  return (
    <div className="space-y-4">
      {failures > 0 && kind !== "refund_failed" && (
        <button
          type="button"
          onClick={() => setKind("refund_failed")}
          className="flex w-full items-center gap-2.5 rounded-[14px] border border-ember/30 bg-ember/10 px-4 py-3 text-left text-[0.82rem] text-ember transition-colors hover:bg-ember/15"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-semibold">
              {failures} cancellation{failures === 1 ? "" : "s"} returned nothing
            </strong>{" "}
            in this view. Show only those.
          </span>
        </button>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-warm-grey"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by member name or email"
            className="pl-9"
            aria-label="Search the audit by member"
          />
        </div>
        <div>
          <label
            htmlFor="audit-from"
            className="block text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-warm-grey"
          >
            From
          </label>
          <Input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label
            htmlFor="audit-to"
            className="block text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-warm-grey"
          >
            To
          </label>
          <Input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
          />
        </div>
        <Button onClick={handleExport} disabled={exporting || rows.length === 0} variant="outline">
          <Download className="mr-1.5 size-4" aria-hidden="true" />
          {exporting ? "Preparing…" : "Export CSV"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {KIND_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setKind(t.value)}
            aria-pressed={kind === t.value}
            className={`rounded-full border px-3.5 py-1.5 text-[0.76rem] font-semibold transition-all ${
              kind === t.value
                ? "border-cocoa bg-cocoa text-wheat"
                : "border-sand bg-white text-slate hover:border-gold"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span
          className="ml-auto text-[0.72rem] tabular-nums text-warm-grey"
          aria-live="polite"
        >
          {isPending ? "Loading…" : `${rows.length} of ${total}`}
        </span>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-sand bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {[
                  "When",
                  "Member",
                  "Event",
                  "Credits",
                  "Balance",
                  "Class",
                  "Pack",
                  "Who",
                  "Detail",
                ].map((h) => (
                  <th
                    key={h}
                    className={`border-b border-sand bg-cream px-4 py-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey ${
                      h === "Credits" || h === "Balance" ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <p className="text-[0.85rem] text-cocoa">Nothing matches these filters.</p>
                    <p className="mt-1 text-[0.74rem] text-warm-grey">
                      Credit movements appear here as they happen, from this dashboard and
                      the member site alike.
                    </p>
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const stamp = formatStamp(r.createdAt)
                return (
                  <tr
                    key={r.id}
                    className={`relative border-b border-sand/50 transition-colors last:border-b-0 hover:bg-cream/50 before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] ${KIND_STRIPES[r.kind]} ${
                      r.kind === "refund_failed" ? "bg-ember/[0.04]" : ""
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 pl-5 text-[0.76rem] text-slate">
                      {stamp.day}
                      <span className="block text-[0.68rem] tabular-nums text-warm-grey">
                        {stamp.time}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[0.8rem] font-medium text-cocoa">
                        {r.memberName ?? "Unknown member"}
                      </span>
                      {r.memberEmail && (
                        <span className="block text-[0.68rem] text-warm-grey">
                          {r.memberEmail}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ${KIND_STYLES[r.kind]}`}
                      >
                        {KIND_LABELS[r.kind]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[0.82rem] font-semibold tabular-nums">
                      {r.delta === 0 ? (
                        <span className="text-warm-grey">&mdash;</span>
                      ) : r.delta > 0 ? (
                        <span className="text-success">+{r.delta}</span>
                      ) : (
                        <span className="text-slate">{r.delta}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[0.8rem] tabular-nums text-warm-grey">
                      {r.balanceAfter ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[0.78rem] text-slate">
                      {r.className ? (
                        <>
                          {r.className}
                          {r.classDate && (
                            <span className="block text-[0.68rem] text-warm-grey">
                              {formatDay(r.classDate)}
                              {r.classTime ? ` · ${formatTime(r.classTime)}` : ""}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-warm-grey">&mdash;</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[0.78rem] text-slate">
                      {r.packName ?? <span className="text-warm-grey">&mdash;</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[0.76rem] text-slate">
                      {describeActor(r)}
                    </td>
                    <td className="max-w-72 px-4 py-3 text-[0.72rem] leading-snug text-warm-grey">
                      {r.reason ?? "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
