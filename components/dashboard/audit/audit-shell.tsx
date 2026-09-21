"use client"

import { useState } from "react"
import { AuditLedger } from "./audit-ledger"
import { CreditShortfalls } from "./credit-shortfalls"
import type { AuditRow, ShortfallRow } from "@/lib/audit-types"

interface Props {
  initialRows: AuditRow[]
  initialTotal: number
  shortfalls: ShortfallRow[]
  skippedLegacyMembers: number
}

type View = "activity" | "owed"

/**
 * Two questions an admin brings to this page: what has been happening, and who
 * is out of pocket. They want different tables, so they get different views
 * rather than one table trying to answer both.
 */
export function AuditShell({
  initialRows,
  initialTotal,
  shortfalls,
  skippedLegacyMembers,
}: Props) {
  const [view, setView] = useState<View>("activity")
  const owed = shortfalls.reduce((sum, r) => sum + r.missing, 0)

  const tabs: { value: View; label: string; badge?: number }[] = [
    { value: "activity", label: "Activity" },
    { value: "owed", label: "Credits owed", badge: owed || undefined },
  ]

  return (
    <div className="space-y-5">
      <div
        className="flex gap-1 border-b border-sand"
        role="tablist"
        aria-label="Audit views"
      >
        {tabs.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={view === t.value}
            onClick={() => setView(t.value)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-[0.85rem] font-semibold transition-colors ${
              view === t.value
                ? "border-cocoa text-cocoa"
                : "border-transparent text-warm-grey hover:text-slate"
            }`}
          >
            {t.label}
            {t.badge !== undefined && (
              <span className="rounded-full bg-ember/15 px-2 py-0.5 text-[0.68rem] font-semibold tabular-nums text-ember">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {view === "activity" ? (
        <AuditLedger initialRows={initialRows} initialTotal={initialTotal} />
      ) : (
        <CreditShortfalls rows={shortfalls} skippedLegacyMembers={skippedLegacyMembers} />
      )}
    </div>
  )
}
