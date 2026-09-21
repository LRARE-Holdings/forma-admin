"use client"

import { useState, useTransition } from "react"
import { Check, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { restoreMissingCredits } from "@/app/actions/credit-reconciliation"
import type { ShortfallRow } from "@/lib/audit-types"
import { toast } from "sonner"

interface Props {
  rows: ShortfallRow[]
  skippedLegacyMembers: number
}

/**
 * Members owed credits from cancellations made before any of this was recorded.
 *
 * The arithmetic is shown per member rather than just the total, because the
 * figure is a reconstruction: there is no record of which pack each old booking
 * charged, so an admin should be able to see the sum they are approving.
 */
export function CreditShortfalls({ rows, skippedLegacyMembers }: Props) {
  const [done, setDone] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const outstanding = rows.filter((r) => !done.has(r.profileId))
  const totalOwed = outstanding.reduce((sum, r) => sum + r.missing, 0)

  async function restore(row: ShortfallRow) {
    setBusy(row.profileId)
    try {
      const res = await restoreMissingCredits(row.profileId, row.missing)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setDone((prev) => new Set(prev).add(row.profileId))
      toast.success(
        `${row.missing} credit${row.missing === 1 ? "" : "s"} back on ${row.name ?? "the member"}'s account`
      )
      startTransition(() => {})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not restore those credits")
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-[14px] border border-sand bg-white p-10 text-center">
        <Check className="mx-auto size-6 text-success" aria-hidden="true" />
        <p className="mt-2 font-heading text-[1.1rem] text-cocoa">Everything balances</p>
        <p className="mt-1 text-[0.8rem] text-warm-grey">
          Every credit bought is either still on a balance or spent on a booking.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border border-sand bg-cream/60 p-4">
        <p className="text-[0.82rem] text-slate">
          <strong className="font-semibold text-cocoa">
            {totalOwed} credit{totalOwed === 1 ? "" : "s"} owed across{" "}
            {outstanding.length} member{outstanding.length === 1 ? "" : "s"}.
          </strong>{" "}
          For each of these, a pack credit was spent on a booking that was later
          cancelled, and the credit never came back.
        </p>
        <p className="mt-1.5 text-[0.72rem] text-warm-grey">
          Restoring tops up a live pack where there is room, otherwise it issues a
          new 6-week pack for the difference. Either way it appears in Activity as
          an adjustment in your name.
          {skippedLegacyMembers > 0 && (
            <>
              {" "}
              {skippedLegacyMembers} member{skippedLegacyMembers === 1 ? " is" : "s are"}{" "}
              left out: they hold packs imported in March that arrived part-used, so
              their sums cannot be checked this way.
            </>
          )}
        </p>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-sand bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Member", "Bought", "Used", "Left", "Owed", ""].map((h, i) => (
                  <th
                    key={h || i}
                    className={`border-b border-sand bg-cream px-4 py-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey ${
                      i === 0 || i === 5 ? "text-left" : "text-right"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const settled = done.has(r.profileId)
                return (
                  <tr
                    key={r.profileId}
                    className={`border-b border-sand/50 last:border-b-0 transition-colors ${
                      settled ? "bg-success-bg/50" : "hover:bg-cream/50"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="text-[0.82rem] font-medium text-cocoa">
                        {r.name ?? "Unknown member"}
                      </span>
                      {r.email && (
                        <span className="block text-[0.68rem] text-warm-grey">{r.email}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[0.8rem] tabular-nums text-slate">
                      {r.bought}
                    </td>
                    <td className="px-4 py-3 text-right text-[0.8rem] tabular-nums text-slate">
                      {r.used}
                      <span className="block text-[0.64rem] text-warm-grey">
                        {r.cancelled} cancelled
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[0.8rem] tabular-nums text-slate">
                      {r.remaining}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`inline-block rounded-full px-2.5 py-1 text-[0.75rem] font-semibold tabular-nums ${
                          settled ? "bg-success-bg text-success" : "bg-ember/15 text-ember"
                        }`}
                      >
                        {settled ? "settled" : `+${r.missing}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {settled ? (
                        <span className="inline-flex items-center gap-1 text-[0.72rem] font-semibold text-success">
                          <Check className="size-3.5" aria-hidden="true" />
                          Done
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === r.profileId}
                          onClick={() => restore(r)}
                        >
                          <Undo2 className="mr-1.5 size-3.5" aria-hidden="true" />
                          {busy === r.profileId ? "Restoring…" : "Restore"}
                        </Button>
                      )}
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
