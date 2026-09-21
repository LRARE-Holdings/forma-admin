import { ArrowDownLeft, AlertTriangle, PencilLine, Scale } from "lucide-react"
import type { AuditSummary } from "@/app/actions/audit"

interface Props {
  summary: AuditSummary
  owedCredits: number
  owedMembers: number
}

/**
 * The four numbers worth knowing before reading a single row.
 *
 * Credits that failed to return and credits still owed are the two that need
 * action, so they carry ember and sit next to each other; the rest stay quiet.
 */
export function AuditSummaryBand({ summary, owedCredits, owedMembers }: Props) {
  const tiles = [
    {
      label: "Credits returned",
      value: summary.creditsReturned,
      hint: "Cancellations that gave the credit back",
      icon: ArrowDownLeft,
      tone: "calm" as const,
    },
    {
      label: "Failed to return",
      value: summary.failedReturns,
      hint: "Cancelled, but nothing went back",
      icon: AlertTriangle,
      tone: summary.failedReturns > 0 ? ("alert" as const) : ("calm" as const),
    },
    {
      label: "Credits owed",
      value: owedCredits,
      hint:
        owedMembers === 1
          ? "To 1 member, from before this tracking"
          : `To ${owedMembers} members, from before this tracking`,
      icon: Scale,
      tone: owedCredits > 0 ? ("alert" as const) : ("calm" as const),
    },
    {
      label: "Adjusted by hand",
      value: summary.manualAdjustments,
      hint: "Balances changed outside a booking",
      icon: PencilLine,
      tone: "calm" as const,
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => {
        const Icon = t.icon
        const alert = t.tone === "alert"
        return (
          <div
            key={t.label}
            className={`rounded-[14px] border bg-white p-4 transition-all ${
              alert
                ? "border-ember/35 shadow-[0_2px_10px_rgba(212,113,58,0.08)]"
                : "border-sand hover:border-gold"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[0.66rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
                {t.label}
              </span>
              <Icon
                className={`size-3.5 shrink-0 ${alert ? "text-ember" : "text-warm-grey/60"}`}
                aria-hidden="true"
              />
            </div>
            <div
              className={`mt-1 font-heading text-[1.9rem] font-medium tabular-nums ${
                alert ? "text-ember" : "text-cocoa"
              }`}
            >
              {t.value}
            </div>
            <p className="mt-0.5 text-[0.68rem] leading-snug text-warm-grey">{t.hint}</p>
          </div>
        )
      })}
    </div>
  )
}
