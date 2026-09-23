"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/shared/empty-state"
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog"
import { cancelEvent, cancelTicket } from "@/app/actions/events"
import { adjustEventCheckIn, checkInEventByCode, type EventCheckInResult } from "@/app/actions/check-in"
import { QrScanView } from "@/components/shared/qr-scan-view"
import { formatPounds } from "@/lib/events"
import { Check, Minus, Plus, QrCode, XCircle, AlertTriangle } from "lucide-react"

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
  /** People on this ticket checked in at the door */
  checkedIn: number
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
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<EventCheckInResult | null>(null)
  // Check-in counts updated here since the last server render.
  const [checkedIn, setCheckedIn] = useState<Record<string, number>>({})
  const countFor = (t: TicketRow) => checkedIn[t.id] ?? t.checkedIn

  const peopleExpected = tickets.filter((t) => t.status === "confirmed").reduce((n, t) => n + t.quantity, 0)
  const peopleIn = tickets.filter((t) => t.status === "confirmed").reduce((n, t) => n + countFor(t), 0)

  async function handleScan(code: string) {
    const res = await checkInEventByCode(eventId, code)
    setScanResult(res)
    if (res.status === "checked_in") {
      setCheckedIn((c) => ({ ...c, [res.ticketId]: res.checkedIn }))
      navigator.vibrate?.(60)
    }
  }

  async function adjust(t: TicketRow, delta: 1 | -1) {
    const res = await adjustEventCheckIn(eventId, t.id, delta)
    if (res.status === "error") {
      toast.error(res.message)
      return
    }
    setCheckedIn((c) => ({ ...c, [t.id]: res.checkedIn }))
  }

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
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setScanning((s) => !s)
                  setScanResult(null)
                }}
              >
                <QrCode className="mr-1.5 h-3.5 w-3.5" />
                {scanning ? "Close scanner" : "Check in"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCancelEventOpen(true)}>
                Cancel event
              </Button>
            </div>
          )}
        </div>

        {peopleExpected > 0 && (
          <div className="border-b border-sand bg-cream px-5 py-2.5 text-[0.78rem] text-cocoa">
            <strong>{peopleIn}</strong> of {peopleExpected} {peopleExpected === 1 ? "person" : "people"} checked in
          </div>
        )}

        {scanning && (
          <div className="space-y-3 border-b border-sand p-5">
            <QrScanView onScan={handleScan} />
            <p className="text-center text-[0.75rem] text-warm-grey">
              Scan the QR on their ticket — from their Wallet pass or confirmation email.
            </p>
            {scanResult && <EventScanResult result={scanResult} />}
          </div>
        )}

        {tickets.length === 0 ? (
          <EmptyState icon="users" title="No tickets yet" description="Tickets appear here as soon as they're paid for." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Member", "Tickets", "Paid", "Status", "Checked in", ""].map((h) => (
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
                    <td className="px-5 py-3">
                      {t.status === "confirmed" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => adjust(t, -1)}
                            disabled={countFor(t) === 0}
                            aria-label={`Undo a check-in for ${t.name}`}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-sand text-warm-grey hover:border-gold disabled:opacity-30"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span
                            className={`min-w-[3rem] text-center text-[0.8rem] font-semibold ${
                              countFor(t) === t.quantity ? "text-success" : "text-cocoa"
                            }`}
                          >
                            {countFor(t)}/{t.quantity}
                          </span>
                          <button
                            onClick={() => adjust(t, 1)}
                            disabled={countFor(t) >= t.quantity}
                            aria-label={`Check in one person for ${t.name}`}
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-cocoa text-wheat hover:bg-gold hover:text-cocoa disabled:opacity-30"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ) : (
                        <span className="text-[0.75rem] text-warm-grey">—</span>
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

function EventScanResult({ result }: { result: EventCheckInResult }) {
  if (result.status === "error") {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-red-700">
        <XCircle className="h-6 w-6 shrink-0" />
        <p className="text-[0.88rem] font-medium">{result.message}</p>
      </div>
    )
  }
  const full = result.status === "all_checked_in"
  return (
    <div
      role="status"
      className={`flex items-center gap-3 rounded-2xl px-5 py-4 ${full ? "bg-amber-100 text-cocoa" : "bg-success text-white"}`}
    >
      {full ? <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" /> : <Check className="h-7 w-7 shrink-0" />}
      <div>
        <p className="text-[1.05rem] font-semibold">{result.name}</p>
        <p className="text-[0.8rem] opacity-90">
          {full
            ? `Everyone on this ticket is already in (${result.quantity} of ${result.quantity})`
            : result.quantity > 1
              ? `Checked in — ${result.checkedIn} of ${result.quantity} on this ticket`
              : "Checked in"}
        </p>
      </div>
    </div>
  )
}
