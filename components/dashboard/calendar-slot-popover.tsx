"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { formatTime, formatPence, getInitial, localDateStr } from "@/lib/utils"
import { unskipClassInstance } from "@/app/actions/schedule-exceptions"
import { deleteScheduleSlot, getSlotRemovalSummary } from "@/app/actions/schedule"
import { getSlotAttendees, cancelBooking, type SlotAttendee } from "@/app/actions/bookings"
import { AttendanceDropdown } from "@/components/shared/attendance-dropdown"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { CapacityBadge } from "@/components/shared/capacity-badge"
import { SkipClassDialog } from "./skip-class-dialog"
import { CancelClassDialog } from "./cancel-class-dialog"
import { CsvUploadDialog } from "./csv-upload-dialog"
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Repeat, Pencil, SkipForward, Undo2, Ban, Trash2, Upload, Users, Loader2, X, QrCode } from "lucide-react"
import { toast } from "sonner"
import type { WeekSlot } from "@/lib/types"
import { unwrap } from "@/lib/action-result"

interface CalendarSlotPopoverProps {
  slot: WeekSlot | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (slot: WeekSlot) => void
}

function paymentLabel(method: string) {
  switch (method) {
    case "pack_credit":
      return "Pack"
    case "membership":
      return "Membership"
    case "complimentary":
      return "Comp"
    default:
      return "Drop-in"
  }
}

/**
 * What the Remove button is actually about to do. A recurring slot is one row,
 * so removing it takes out every future occurrence, not just the date that was
 * clicked — and the members on those dates get cancelled and refunded.
 */
function describeRemoval(
  className: string,
  impact: { date: string; bookingCount: number }[] | null
): string {
  const base = `Remove this ${className} slot from the timetable permanently?`

  if (impact === null) return base
  if (impact.length === 0) {
    return `${base} Nothing upcoming is booked onto it.`
  }

  const totalBookings = impact.reduce((sum, d) => sum + d.bookingCount, 0)
  const dates = impact
    .map((d) =>
      new Date(d.date + "T00:00:00").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    )
    .join(", ")

  return (
    `${base} This will cancel ${totalBookings} upcoming booking` +
    `${totalBookings === 1 ? "" : "s"} across ${impact.length} date` +
    `${impact.length === 1 ? "" : "s"} (${dates}). ` +
    `Pack credits will be restored, drop-ins refunded, and members emailed.`
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-cream px-3 py-2">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-warm-grey">{label}</p>
      <p className="truncate text-[0.82rem] font-medium text-cocoa">{value}</p>
    </div>
  )
}

export function CalendarSlotPopover({
  slot,
  open,
  onOpenChange,
  onEdit,
}: CalendarSlotPopoverProps) {
  const [skipOpen, setSkipOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [csvUploadOpen, setCsvUploadOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [unskipLoading, setUnskipLoading] = useState(false)

  // Upcoming dates on this slot that still hold confirmed bookings. Removing
  // the slot cancels and refunds them, so the dialog has to say so first —
  // "Remove this slot?" reads like tidying up an empty row.
  const [removalImpact, setRemovalImpact] = useState<
    { date: string; bookingCount: number }[] | null
  >(null)

  // Track which child dialog to open after the parent fully closes
  const pendingDialog = useRef<"skip" | "cancel" | "csv" | "delete" | null>(null)

  // Keep a stashed copy of slot data so child dialogs can render even after
  // the parent nulls the slot prop on close
  const stashedSlot = useRef<WeekSlot | null>(null)
  if (slot) stashedSlot.current = slot

  // The slot to use for child dialogs — survives parent clearing the prop
  const childSlot = slot ?? stashedSlot.current

  const anyChildOpen = skipOpen || cancelOpen || csvUploadOpen || deleteOpen

  function handleParentCloseComplete(isOpen: boolean) {
    if (isOpen || !pendingDialog.current) return
    const target = pendingDialog.current
    pendingDialog.current = null
    if (target === "skip") setSkipOpen(true)
    else if (target === "cancel") setCancelOpen(true)
    else if (target === "csv") setCsvUploadOpen(true)
    else if (target === "delete") setDeleteOpen(true)
  }

  async function openDeleteDialog() {
    setRemovalImpact(null)
    pendingDialog.current = "delete"
    onOpenChange(false)
    if (!childSlot) return
    try {
      setRemovalImpact(await getSlotRemovalSummary(childSlot.scheduleId))
    } catch {
      // Leave it null — the dialog then warns in general terms rather than
      // claiming there is nothing booked.
    }
  }

  // Attendee state
  const [attendees, setAttendees] = useState<SlotAttendee[]>([])
  const [attendeesLoading, setAttendeesLoading] = useState(false)
  const [showAttendees, setShowAttendees] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  // Fetch attendees when dialog opens and slot has bookings
  useEffect(() => {
    if (open && slot && childSlot && childSlot.bookingCount > 0) {
      setAttendeesLoading(true)
      setShowAttendees(true)
      getSlotAttendees(childSlot.scheduleId, childSlot.date)
        .then(setAttendees)
        .catch(() => {
          setAttendees([])
          toast.error("Failed to load attendees")
        })
        .finally(() => setAttendeesLoading(false))
    } else {
      setShowAttendees(false)
      setAttendees([])
    }
  }, [open, slot, childSlot?.scheduleId, childSlot?.date, childSlot?.bookingCount])

  if (!slot && !anyChildOpen && !pendingDialog.current) return null
  if (!childSlot) return null

  const formattedDate = new Date(childSlot.date + "T00:00:00").toLocaleDateString(
    "en-GB",
    { weekday: "long", day: "numeric", month: "long" }
  )

  async function handleUnskip() {
    if (!childSlot) return
    setUnskipLoading(true)
    try {
      unwrap(await unskipClassInstance(childSlot.scheduleId, childSlot.date))
      toast.success("Class restored for this week")
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restore class")
    } finally {
      setUnskipLoading(false)
    }
  }

  async function handleDelete() {
    if (!childSlot) return
    setDeleteLoading(true)
    try {
      const result = unwrap(await deleteScheduleSlot(childSlot.scheduleId))
      if (result.cancelledCount > 0) {
        const refundPart =
          result.refundedCount > 0 ? `, ${result.refundedCount} refunded` : ""
        toast.success(
          `Slot removed — ${result.cancelledCount} booking${result.cancelledCount === 1 ? "" : "s"} cancelled${refundPart} and members emailed`
        )
        if (result.refundFailedCount > 0) {
          toast.error(
            `${result.refundFailedCount} refund${result.refundFailedCount === 1 ? "" : "s"} couldn't be processed — refund manually in Stripe`
          )
        }
      } else {
        toast.success("Schedule slot removed")
      }
      setDeleteOpen(false)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove slot")
    } finally {
      setDeleteLoading(false)
    }
  }

  const canEdit = !childSlot.isPast && !childSlot.isHoliday
  const canSkip =
    !childSlot.isPast && !childSlot.isHoliday && !childSlot.isSkipped && !!childSlot.ruleId
  const canUnskip = !childSlot.isPast && childSlot.isSkipped
  const canCancel = !childSlot.isPast && !childSlot.isHoliday && !childSlot.isSkipped
  const canImport = !childSlot.isHoliday && !childSlot.isSkipped
  // The door register, on the day itself.
  const canCheckIn = !childSlot.isHoliday && !childSlot.isSkipped && childSlot.date === localDateStr()

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={handleParentCloseComplete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center gap-2 pr-6">
              <ClassColorBar classSlug={childSlot.classSlug} className="h-5 w-[3px] shrink-0" />
              <span className="truncate">{childSlot.className}</span>
              {childSlot.ruleId && <Repeat className="h-3.5 w-3.5 shrink-0 text-gold" />}
            </DialogTitle>
            <p className="text-[0.8rem] text-warm-grey">
              {formattedDate} · {formatTime(childSlot.startTime)}–{formatTime(childSlot.endTime)}
            </p>
          </DialogHeader>

          {/* min-w-0 everywhere below: long names truncate instead of widening the dialog */}
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Fact label="Instructor" value={childSlot.instructorName} />
              <Fact label="Drop-in" value={`\u00a3${formatPence(childSlot.pricePence)}`} />
            </div>

            {!childSlot.isSkipped && !childSlot.isHoliday && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-[0.8rem] font-medium text-cocoa">
                    {childSlot.bookingCount} of {childSlot.capacity} booked
                  </span>
                  <CapacityBadge
                    booked={childSlot.bookingCount}
                    capacity={childSlot.capacity}
                    isPast={childSlot.isPast}
                  />
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-sand/50">
                  <div
                    className="h-full rounded-full bg-gold transition-[width]"
                    style={{
                      width: `${Math.min(100, (childSlot.bookingCount / Math.max(childSlot.capacity, 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Who's booked */}
            {showAttendees && (
              <div className="overflow-hidden rounded-xl border border-sand">
                <div className="flex items-center gap-1.5 bg-cream px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-warm-grey">
                  <Users className="h-3 w-3" />
                  Booked in
                </div>
                {attendeesLoading ? (
                  <div className="flex items-center justify-center py-5">
                    <Loader2 className="h-4 w-4 animate-spin text-warm-grey" />
                  </div>
                ) : (
                  <ul className="max-h-[240px] divide-y divide-sand/40 overflow-y-auto">
                    {attendees.map((att) => (
                      <li key={att.id} className="group flex min-w-0 items-center gap-2.5 px-3 py-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sand font-heading text-[0.7rem] font-semibold text-cocoa">
                          {getInitial(att.full_name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[0.8rem] font-medium text-cocoa">
                            {att.full_name ?? "Unknown"}
                          </p>
                          <p className="text-[0.66rem] text-warm-grey">{paymentLabel(att.payment_method)}</p>
                        </div>
                        <div className="shrink-0">
                          <AttendanceDropdown
                            bookingId={att.id}
                            currentStatus={att.attendance_status}
                            onStatusChange={(newStatus) =>
                              setAttendees((prev) =>
                                prev.map((a) => (a.id === att.id ? { ...a, attendance_status: newStatus } : a))
                              )
                            }
                            size="sm"
                          />
                        </div>
                        {!childSlot.isPast && (
                          <button
                            type="button"
                            disabled={cancellingId === att.id}
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (!confirm(`Remove ${att.full_name ?? "this attendee"} from the class?`)) return
                              setCancellingId(att.id)
                              try {
                                const res = await cancelBooking(att.id)
                                if (res.error) {
                                  toast.error(res.error)
                                  return
                                }
                                setAttendees((prev) => prev.filter((a) => a.id !== att.id))
                                toast.success(`${att.full_name ?? "Attendee"} removed`)
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Failed to cancel booking")
                              } finally {
                                setCancellingId(null)
                              }
                            }}
                            className="shrink-0 rounded p-1 text-warm-grey/60 transition-colors hover:bg-red-50 hover:text-red-600"
                            aria-label={`Remove ${att.full_name ?? "attendee"} from the class`}
                            title={`Remove ${att.full_name ?? "attendee"}`}
                          >
                            {cancellingId === att.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <X className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {childSlot.bookingCount === 0 && !childSlot.isSkipped && !childSlot.isHoliday && (
              <p className="rounded-lg bg-sand/30 px-3 py-2.5 text-center text-[0.78rem] text-warm-grey">
                No bookings yet
              </p>
            )}
            {childSlot.isSkipped && (
              <p className="rounded-lg bg-sand/50 px-3 py-2.5 text-[0.78rem] text-warm-grey">
                This class is <strong>cancelled</strong>
                {childSlot.ruleId ? " this week" : ""}.
              </p>
            )}
            {childSlot.isHoliday && (
              <p className="rounded-lg bg-ember/10 px-3 py-2.5 text-[0.78rem] text-cocoa">
                Studio is on <strong>holiday</strong> this date.
              </p>
            )}
            {childSlot.isPast && (
              <p className="rounded-lg bg-sand/50 px-3 py-2.5 text-[0.78rem] text-warm-grey">
                This class has already passed.
              </p>
            )}

            {/* Actions */}
            {(canCheckIn || canEdit || canSkip || canUnskip || canCancel || canImport) && (
              <div className="space-y-2 border-t border-sand pt-4">
                {canCheckIn && (
                  <Link
                    href={`/dashboard/registration/${childSlot.scheduleId}/${childSlot.date}`}
                    className={buttonVariants({ className: "w-full" })}
                  >
                    <QrCode className="mr-1.5 h-3.5 w-3.5" />
                    Check people in
                  </Link>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        onOpenChange(false)
                        onEdit(childSlot)
                      }}
                    >
                      <Pencil className="mr-1.5 h-3 w-3" />
                      Edit
                    </Button>
                  )}
                  {canSkip && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        pendingDialog.current = "skip"
                        onOpenChange(false)
                      }}
                    >
                      <SkipForward className="mr-1.5 h-3 w-3" />
                      Skip this week
                    </Button>
                  )}
                  {canUnskip && (
                    <Button variant="outline" size="sm" className="w-full" onClick={handleUnskip} disabled={unskipLoading}>
                      <Undo2 className="mr-1.5 h-3 w-3" />
                      Unskip
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        pendingDialog.current = "cancel"
                        onOpenChange(false)
                      }}
                    >
                      <Ban className="mr-1.5 h-3 w-3" />
                      Cancel class
                    </Button>
                  )}
                  {canImport && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        pendingDialog.current = "csv"
                        onOpenChange(false)
                      }}
                    >
                      <Upload className="mr-1.5 h-3 w-3" />
                      Import bookings
                    </Button>
                  )}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={openDeleteDialog}
                    className="inline-flex items-center gap-1.5 pt-1 text-[0.74rem] text-warm-grey transition-colors hover:text-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove from timetable
                  </button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Skip dialog */}
      <SkipClassDialog
        open={skipOpen}
        onOpenChange={setSkipOpen}
        scheduleId={childSlot.scheduleId}
        date={childSlot.date}
        className={childSlot.className}
        startTime={formatTime(childSlot.startTime)}
        bookingCount={childSlot.bookingCount}
      />

      {/* Cancel dialog */}
      <CancelClassDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        scheduleId={childSlot.scheduleId}
        date={childSlot.date}
        className={childSlot.className}
        startTime={formatTime(childSlot.startTime)}
        bookingCount={childSlot.bookingCount}
      />

      {/* CSV upload */}
      <CsvUploadDialog
        open={csvUploadOpen}
        onOpenChange={setCsvUploadOpen}
        scheduleId={childSlot.scheduleId}
        date={childSlot.date}
        className={childSlot.className}
        startTime={formatTime(childSlot.startTime)}
        capacity={childSlot.capacity}
        bookingCount={childSlot.bookingCount}
      />

      {/* Delete confirmation */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove slot"
        description={describeRemoval(childSlot.className, removalImpact)}
        onConfirm={handleDelete}
        loading={deleteLoading}
        actionLabel="Remove"
        loadingLabel={
          removalImpact && removalImpact.length > 0
            ? "Cancelling and refunding…"
            : undefined
        }
      />
    </>
  )
}
