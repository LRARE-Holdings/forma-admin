"use client"

import { useState } from "react"
import { formatTime } from "@/lib/utils"
import { EmptyState } from "@/components/shared/empty-state"
import { BookingFormDialog, type MemberOption } from "./booking-form-dialog"
import { cancelBooking } from "@/app/actions/bookings"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { toast } from "sonner"

interface BookingRow {
  id: string
  date: string
  status: string
  payment_method: string
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
      await cancelBooking(bookingId)
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
        <div className="flex items-center justify-between border-b border-sand px-5 py-4">
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
          <div className="overflow-x-auto">
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
                        <strong className="text-cocoa">
                          {booking.profile_name}
                        </strong>
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
                            className="text-[0.75rem] font-semibold text-warm-grey hover:text-red-600 disabled:opacity-50"
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
