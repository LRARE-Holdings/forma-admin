"use client"

import { useState } from "react"
import {
  reattachStrandedBooking,
  cancelStrandedInstance,
} from "@/app/actions/schedule-integrity"
import { Button } from "@/components/ui/button"
import { formatTime } from "@/lib/utils"
import { AlertTriangle, Loader2, ArrowRightLeft, Ban } from "lucide-react"
import { toast } from "sonner"
import type { StrandedBooking } from "@/lib/schedule-integrity"

interface StrandedBookingsBannerProps {
  stranded: StrandedBooking[]
}

/**
 * Bookings held against a class that is on nobody's timetable.
 *
 * This is the loud half of the fix. The failure itself is silent by
 * construction — the rows stay valid, the reads just filter them out — so the
 * only thing that catches it is an assertion that runs whether or not anyone
 * suspects a problem. It sits at the top of the dashboard because the people
 * affected have already paid and are already planning to turn up.
 */
export function StrandedBookingsBanner({ stranded }: StrandedBookingsBannerProps) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Set<string>>(new Set())

  const rows = stranded.filter((s) => !resolved.has(s.bookingId))
  if (rows.length === 0) return null

  // Group by class instance — one line per class, not per member, so a class of
  // eleven reads as one problem rather than eleven.
  const groups = new Map<string, StrandedBooking[]>()
  for (const row of rows) {
    const key = `${row.scheduleId}:${row.date}`
    const existing = groups.get(key)
    if (existing) existing.push(row)
    else groups.set(key, [row])
  }

  async function handleReattach(group: StrandedBooking[]) {
    const target = group[0].reattachTo
    if (!target) return
    const key = `${group[0].scheduleId}:${group[0].date}`
    setBusyId(key)

    const failures: string[] = []
    for (const row of group) {
      const result = await reattachStrandedBooking(row.bookingId, target.scheduleId)
      if (result.error) failures.push(`${row.name ?? "A member"}: ${result.error}`)
      else setResolved((prev) => new Set(prev).add(row.bookingId))
    }

    setBusyId(null)

    if (failures.length > 0) toast.error(failures[0])
    else
      toast.success(
        `${group.length} booking${group.length === 1 ? "" : "s"} moved onto the live class`
      )
  }

  async function handleCancel(group: StrandedBooking[]) {
    const first = group[0]
    const key = `${first.scheduleId}:${first.date}`
    setBusyId(key)

    try {
      const result = await cancelStrandedInstance(first.scheduleId, first.date)
      if (result.error) {
        toast.error(result.error)
        return
      }
      setResolved((prev) => {
        const next = new Set(prev)
        for (const row of group) next.add(row.bookingId)
        return next
      })
      const refundPart =
        result.refundedCount > 0
          ? `, ${result.refundedCount} refunded`
          : ""
      toast.success(
        `${result.cancelledCount} booking${result.cancelledCount === 1 ? "" : "s"} cancelled${refundPart} — members emailed`
      )
      if (result.refundFailedCount > 0) {
        toast.error(
          `${result.refundFailedCount} refund${result.refundFailedCount === 1 ? "" : "s"} couldn't be processed — refund manually in Stripe`
        )
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel")
    } finally {
      setBusyId(null)
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
  }

  const totalBookings = rows.length

  return (
    <div className="mb-5 overflow-hidden rounded-2xl border border-red-200 bg-red-50/60">
      <div className="flex items-start gap-2.5 border-b border-red-200 px-5 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
        <div>
          <h3 className="text-[0.85rem] font-semibold text-red-900">
            {totalBookings} booking{totalBookings === 1 ? " is" : "s are"} attached to a
            class that isn&apos;t on the timetable
          </h3>
          <p className="mt-0.5 text-[0.75rem] text-red-800/80">
            These members have paid and expect to attend, but the class shows on
            nobody&apos;s schedule and no instructor is rostered. Move them onto the
            live class, or cancel and refund them.
          </p>
        </div>
      </div>

      <div className="divide-y divide-red-200/60">
        {[...groups.entries()].map(([key, group]) => {
          const first = group[0]
          const busy = busyId === key
          return (
            <div
              key={key}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <div className="text-[0.82rem] font-medium text-cocoa">
                  {first.className}
                  <span className="ml-2 font-normal text-warm-grey">
                    {formatDate(first.date)} · {formatTime(first.startTime)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[0.72rem] text-warm-grey">
                  {group.map((g) => g.name ?? g.email ?? "Unknown").join(", ")}
                </div>
              </div>

              <div className="flex shrink-0 gap-2">
                {first.reattachTo ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => handleReattach(group)}
                  >
                    {busy ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <ArrowRightLeft className="mr-1.5 h-3 w-3" />
                    )}
                    Move to live class
                  </Button>
                ) : (
                  <span className="self-center text-[0.72rem] text-warm-grey">
                    No live class to move to
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => handleCancel(group)}
                  className="text-warm-grey hover:text-red-600"
                >
                  <Ban className="mr-1.5 h-3 w-3" />
                  Cancel &amp; refund
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
