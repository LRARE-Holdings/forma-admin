"use client"

import { useState } from "react"
import { formatTime } from "@/lib/utils"
import { EmptyState } from "@/components/shared/empty-state"
import { BookingFormDialog, type MemberOption } from "./booking-form-dialog"
import { cancelBooking } from "@/app/actions/bookings"
import { Button } from "@/components/ui/button"
import { MemberNameButton } from "@/components/member-profile/member-name-button"
import { Plus } from "lucide-react"
import { toast } from "sonner"

interface BookingRow {
  id: string
  date: string
  status: string
  payment_method: string
  profile_id: string
  profile_name: string
  class_name: string
  start_time: string | null
  day_of_week: number | null
}

interface BookingsTableProps {
  bookings: BookingRow[]
  members: MemberOption[]
}

const PAYMENT_BADGES: Record<string, { className: string; label: string }> = {
  stripe: { className: "bg-success-bg text-success", label: "Stripe" },
  pack_credit: { className: "bg-gold/15 text-gold", label: "Pack credit" },
  membership: { className: "bg-clay/15 text-clay", label: "Membership" },
  complimentary: { className: "bg-warm-grey/10 text-warm-grey", label: "Comp" },
}

export function BookingsTable({ bookings, members }: BookingsTableProps) {
  const [formOpen, setFormOpen] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  async function handleCancel(bookingId: string) {
    setCancellingId(bookingId)
    try {
      const res = await cancelBooking(bookingId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success("Booking cancelled")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel booking")
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-sand px-4 py-4 md:px-5">
          <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
            Recent bookings
          </h3>
          {bookings.length > 0 && (
            <Button onClick={() => setFormOpen(true)} size="sm">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add booking
            </Button>
          )}
        </div>
        {bookings.length === 0 ? (
          <EmptyState
            icon="check-square"
            title="No bookings yet"
            description="Bookings will appear here when members book classes."
            action={
              <Button onClick={() => setFormOpen(true)} size="sm">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add booking
              </Button>
            }
          />
        ) : (
          <>
          {/* Phones: one card per booking. */}
          <ul className="divide-y divide-sand/60 md:hidden">
            {bookings.map((booking) => {
              const badge = PAYMENT_BADGES[booking.payment_method] ?? PAYMENT_BADGES.stripe
              return (
                <li key={booking.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <MemberNameButton profileId={booking.profile_id}>
                      <strong className="text-[0.92rem] text-cocoa">{booking.profile_name}</strong>
                    </MemberNameButton>
                    <div className="mt-0.5 text-[0.8rem] text-slate">
                      {booking.class_name} ·{" "}
                      {new Date(booking.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                      {booking.start_time ? `, ${formatTime(booking.start_time)}` : ""}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase ${badge.className}`}>{badge.label}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase ${booking.status === "confirmed" ? "bg-success-bg text-success" : "bg-warm-grey/10 text-warm-grey"}`}>{booking.status}</span>
                    </div>
                  </div>
                  {booking.status === "confirmed" && (
                    <button
                      onClick={() => handleCancel(booking.id)}
                      disabled={cancellingId === booking.id}
                      className="min-h-10 shrink-0 rounded-lg border border-sand px-3 text-[0.8rem] font-semibold text-warm-grey disabled:opacity-50"
                    >
                      {cancellingId === booking.id ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Member", "Class", "Date & time", "Payment", "Status", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="border-b border-sand bg-cream px-5 py-2.5 text-left text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => {
                  const badge = PAYMENT_BADGES[booking.payment_method] ?? PAYMENT_BADGES.stripe

                  return (
                    <tr
                      key={booking.id}
                      className="border-b border-sand/50 transition-colors last:border-b-0 hover:bg-cream/50"
                    >
                      <td className="px-5 py-3 text-[0.82rem]">
                        <MemberNameButton profileId={booking.profile_id}>
                          <strong className="text-cocoa">
                            {booking.profile_name}
                          </strong>
                        </MemberNameButton>
                      </td>
                      <td className="px-5 py-3 text-[0.82rem] text-slate">
                        {booking.class_name}
                      </td>
                      <td className="px-5 py-3 text-[0.82rem] text-slate">
                        {new Date(booking.date).toLocaleDateString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                        {booking.start_time
                          ? `, ${formatTime(booking.start_time)}`
                          : ""}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase ${
                            booking.status === "confirmed"
                              ? "bg-success-bg text-success"
                              : "bg-warm-grey/10 text-warm-grey"
                          }`}
                        >
                          {booking.status}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {booking.status === "confirmed" && (
                          <button
                            onClick={() => handleCancel(booking.id)}
                            disabled={cancellingId === booking.id}
                            className="min-h-10 text-[0.8rem] font-semibold md:min-h-0 md:text-[0.75rem] text-warm-grey hover:text-red-600 disabled:opacity-50"
                          >
                            {cancellingId === booking.id ? "Cancelling…" : "Cancel"}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <BookingFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        members={members}
      />
    </>
  )
}
