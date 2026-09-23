"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/shared/empty-state"
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog"
import { cancelEvent, cancelTicket } from "@/app/actions/events"
import { formatPounds } from "@/lib/events"

export interface TicketRow {
  id: string
  name: string
  email: string
  quantity: number
  amountPence: number
  status: "confirmed" | "cancelled"
  cancelledBy: "member" | "studio" | "stripe" | null
  /** Null when not refunded */
  refundedPence: number | null
  boughtAt: string
}

export interface WaitlistRow {
  id: string
  name: string
  email: string
  quantity: number
  status: "waiting" | "offered"
  offerExpires: string | null
}

const CANCELLED_BY: Record<string, string> = {
  member: "Cancelled by member",
  studio: "Cancelled by studio",
  stripe: "Refunded in Stripe",
}

interface Props {
  eventId: string
  eventTitle: string
  cancelled: boolean
  salesNote: string
  tickets: TicketRow[]
  waitlist: WaitlistRow[]
}

export function EventTicketsPanel({ eventId, eventTitle, cancelled, salesNote, tickets, waitlist }: Props) {
  const router = useRouter()
  const [target, setTarget] = useState<TicketRow | null>(null)
  const [cancelEventOpen, setCancelEventOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirmedCount = tickets.filter((t) => t.status === "confirmed").length

  async function handleTicket() {
    if (!target) return
    setBusy(true)
    try {
      const result = await cancelTicket(target.id)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      if (result.refundFailed) {
        toast.warning("Ticket cancelled, but the refund failed. Refund it in Stripe.")
      } else {
        toast.success(
          result.refundPence ? `Refunded ${formatPounds(result.refundPence)}` : "Ticket cancelled",
        )
      }
      setTarget(null)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  async function handleCancelEvent() {
    setBusy(true)
    try {
      const result = await cancelEvent(eventId)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      if (result.failed > 0) {
        toast.warning(`Event cancelled. ${result.failed} refund${result.failed === 1 ? "" : "s"} failed — refund them in Stripe.`)
      } else {
        toast.success(`Event cancelled and ${result.refunded} ticket${result.refunded === 1 ? "" : "s"} refunded`)
      }
      setCancelEventOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  const isRefund = target?.status === "cancelled"

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand px-5 py-4">
          <div>
            <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">Tickets</h3>
            <p className="text-[0.72rem] text-warm-grey">{salesNote}</p>
          </div>
          {!cancelled && (
            <Button size="sm" variant="outline" onClick={() => setCancelEventOpen(true)}>
              Cancel event
            </Button>
          )}
        </div>

        {tickets.length === 0 ? (
          <EmptyState icon="users" title="No tickets yet" description="Tickets appear here as soon as they're paid for." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Member", "Tickets", "Paid", "Status", ""].map((h) => (
                    <th
                      key={h}
                      className="border-b border-sand bg-cream px-5 py-2.5 text-left text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className="border-b border-sand/50 last:border-b-0 hover:bg-cream/50">
                    <td className="px-5 py-3">
                      <div className={`text-[0.82rem] font-semibold ${t.status === "confirmed" ? "text-cocoa" : "text-warm-grey"}`}>
                        {t.name}
                      </div>
                      <div className="text-[0.72rem] text-warm-grey">{t.email}</div>
                    </td>
                    <td className="px-5 py-3 text-[0.82rem] text-slate">{t.quantity}</td>
                    <td className="px-5 py-3 text-[0.82rem] text-slate">
                      {formatPounds(t.amountPence)}
                      {t.refundedPence !== null && (
                        <div className="text-[0.7rem] text-warm-grey">Refunded {formatPounds(t.refundedPence)}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-[0.75rem]">
                      {t.status === "confirmed" ? (
                        <span className="font-semibold text-gold">Confirmed</span>
                      ) : (
                        <span className="text-warm-grey">{CANCELLED_BY[t.cancelledBy ?? ""] ?? "Cancelled"}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {t.status === "confirmed" ? (
                        <button
                          onClick={() => setTarget(t)}
                          className="text-[0.75rem] font-semibold text-warm-grey hover:text-red-600"
                        >
                          Cancel &amp; refund
                        </button>
                      ) : t.refundedPence === null ? (
                        <button
                          onClick={() => setTarget(t)}
                          className="text-[0.75rem] font-semibold text-gold hover:text-ember"
                        >
                          Refund
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {waitlist.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-sand bg-white">
          <div className="border-b border-sand px-5 py-4">
            <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">Waitlist</h3>
            <p className="text-[0.72rem] text-warm-grey">
              When a place frees up, the next person whose request fits is emailed and has it held for 12 hours (1 hour on the day before and the day of the event).
            </p>
          </div>
          <ol>
            {waitlist.map((w, i) => (
              <li key={w.id} className="flex items-center gap-4 border-b border-sand/50 px-5 py-3 last:border-b-0">
                <span className="w-5 text-[0.75rem] font-semibold text-warm-grey">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[0.82rem] font-semibold text-cocoa">{w.name}</div>
                  <div className="text-[0.72rem] text-warm-grey">{w.email}</div>
                </div>
                <span className="text-[0.75rem] text-slate">
                  {w.quantity} ticket{w.quantity === 1 ? "" : "s"}
                </span>
                <span className="w-40 text-right text-[0.72rem]">
                  {w.status === "offered" ? (
                    <span className="font-semibold text-gold">Offered until {w.offerExpires}</span>
                  ) : (
                    <span className="text-warm-grey">Waiting</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <DeleteConfirmDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title={isRefund ? "Refund ticket" : "Cancel and refund ticket"}
        description={
          target
            ? isRefund
              ? `Refund ${formatPounds(target.amountPence)} to ${target.name}? They already cancelled, so their place has been released.`
              : `Cancel ${target.name}'s ${target.quantity === 1 ? "ticket" : `${target.quantity} tickets`} and refund ${formatPounds(target.amountPence)}? They'll be emailed, and the place goes to the waitlist.`
            : ""
        }
        onConfirm={handleTicket}
        loading={busy}
        actionLabel={isRefund ? "Refund" : "Cancel & refund"}
        loadingLabel="Refunding…"
      />

      <DeleteConfirmDialog
        open={cancelEventOpen}
        onOpenChange={setCancelEventOpen}
        title="Cancel event"
        description={`Cancel "${eventTitle}"? It comes off the website, ${confirmedCount} ticket holder${confirmedCount === 1 ? " is" : "s are"} refunded in full and emailed, and the waitlist is cleared. This can't be undone.`}
        onConfirm={handleCancelEvent}
        loading={busy}
        actionLabel="Cancel event"
        loadingLabel="Cancelling and refunding…"
      />
    </>
  )
}
