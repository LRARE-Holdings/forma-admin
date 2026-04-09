"use client"

import { useState, useEffect, useRef } from "react"
import { formatTime, formatPence, getInitial } from "@/lib/utils"
import { unskipClassInstance } from "@/app/actions/schedule-exceptions"
import { deleteScheduleSlot } from "@/app/actions/schedule"
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
import { Button } from "@/components/ui/button"
import { Repeat, Pencil, SkipForward, Undo2, Ban, Trash2, Upload, Users, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import type { WeekSlot } from "@/lib/types"

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

function paymentStyle(method: string) {
  switch (method) {
    case "pack_credit":
      return "bg-gold/15 text-gold"
    case "membership":
      return "bg-purple-100 text-purple-700"
    case "complimentary":
      return "bg-green-100 text-green-700"
    default:
      return "bg-ember/12 text-ember"
  }
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
      await unskipClassInstance(childSlot.scheduleId, childSlot.date)
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
      await deleteScheduleSlot(childSlot.scheduleId)
      toast.success("Schedule slot removed")
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={handleParentCloseComplete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClassColorBar
                classSlug={childSlot.classSlug}
                className="w-[3px] h-5"
              />
              {childSlot.className}
              {childSlot.ruleId && (
                <Repeat className="h-3.5 w-3.5 shrink-0 text-gold" />
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* Details */}
            <div className="space-y-1.5 text-[0.82rem]">
              <div className="flex justify-between">
                <span className="text-warm-grey">Date</span>
                <span className="font-medium text-cocoa">{formattedDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-warm-grey">Time</span>
                <span className="font-medium text-cocoa">
                  {formatTime(childSlot.startTime)}–{formatTime(childSlot.endTime)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-warm-grey">Instructor</span>
                <span className="font-medium text-cocoa">
                  {childSlot.instructorName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-warm-grey">Price</span>
                <span className="font-medium text-cocoa">
                  &pound;{formatPence(childSlot.pricePence)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-warm-grey">Bookings</span>
                <CapacityBadge
                  booked={childSlot.bookingCount}
                  capacity={childSlot.capacity}
                  isPast={childSlot.isPast}
                />
              </div>
            </div>

            {/* Attendee list */}
            {showAttendees && (
              <div className="rounded-xl border border-sand overflow-hidden">
                <div className="flex items-center justify-between bg-cream px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-warm-grey">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3 w-3" />
                    Attendees ({childSlot.bookingCount} of {childSlot.capacity})
                    {childSlot.bookingCount >= childSlot.capacity ? " — FULL" : ""}
                  </span>
                  <span>Payment</span>
                </div>

                {attendeesLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-warm-grey" />
                  </div>
                ) : (
                  <div className="max-h-[200px] overflow-y-auto">
                    {attendees.map((att, i) => (
                      <div
                        key={att.id}
                        className="group flex items-center gap-2.5 border-b border-sand/40 px-3 py-1.5 text-[0.78rem] last:border-b-0"
                      >
                        <span className="w-4 text-center text-[0.65rem] text-warm-grey">
                          {i + 1}
                        </span>
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-sand font-heading text-[0.65rem] font-semibold text-cocoa">
                          {getInitial(att.full_name)}
                        </div>
                        <span className="flex-1 truncate font-medium text-cocoa">
                          {att.full_name ?? "Unknown"}
                        </span>
                        <AttendanceDropdown
                          bookingId={att.id}
                          currentStatus={att.attendance_status}
                          onStatusChange={(newStatus) =>
                            setAttendees((prev) =>
                              prev.map((a) =>
                                a.id === att.id ? { ...a, attendance_status: newStatus } : a
                              )
                            )
                          }
                          size="sm"
                        />
                        <span
                          className={`inline-block rounded-full px-1.5 py-0.5 text-[0.58rem] font-semibold uppercase ${paymentStyle(att.payment_method)}`}
                        >
                          {paymentLabel(att.payment_method)}
                        </span>
                        {!childSlot.isPast && (
                          <button
                            type="button"
                            disabled={cancellingId === att.id}
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (!confirm(`Remove ${att.full_name ?? "this attendee"} from the class?`)) return
                              setCancellingId(att.id)
                              try {
                                await cancelBooking(att.id)
                                setAttendees((prev) => prev.filter((a) => a.id !== att.id))
                                toast.success(`${att.full_name ?? "Attendee"} removed`)
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Failed to cancel booking")
                              } finally {
                                setCancellingId(null)
                              }
                            }}
                            className="hidden shrink-0 rounded p-0.5 text-warm-grey transition-colors hover:bg-red-50 hover:text-red-600 group-hover:inline-flex"
                            title={`Remove ${att.full_name ?? "attendee"}`}
                          >
                            {cancellingId === att.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <X className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    ))}

                    {/* Empty spots */}
                    {Array.from(
                      { length: childSlot.capacity - attendees.length },
                      (_, i) => (
                        <div
                          key={`empty-${i}`}
                          className="flex items-center gap-2.5 border-b border-sand/40 px-3 py-1.5 last:border-b-0"
                        >
                          <span className="w-4 text-center text-[0.65rem] text-warm-grey">
                            {attendees.length + i + 1}
                          </span>
                          <div className="h-6 w-6 rounded-full border-[1.5px] border-dashed border-sand" />
                          <span className="text-[0.72rem] italic text-sand">
                            Open spot
                          </span>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {/* No bookings message */}
            {childSlot.bookingCount === 0 && !childSlot.isSkipped && !childSlot.isHoliday && (
              <div className="rounded-lg bg-sand/30 px-3 py-2 text-center text-[0.78rem] text-warm-grey">
                No bookings yet
              </div>
            )}

            {/* Status badges */}
            {childSlot.isSkipped && (
              <div className="rounded-lg bg-sand/50 px-3 py-2 text-[0.78rem] text-warm-grey">
                This class is <strong>skipped</strong> this week.
              </div>
            )}
            {childSlot.isHoliday && (
              <div className="rounded-lg bg-ember/10 px-3 py-2 text-[0.78rem] text-cocoa">
                Studio is on <strong>holiday</strong> this date.
              </div>
            )}
            {childSlot.isPast && (
              <div className="rounded-lg bg-sand/50 px-3 py-2 text-[0.78rem] text-warm-grey">
                This class has already passed.
              </div>
            )}

            {/* Actions */}
            {(canEdit || canSkip || canUnskip || canCancel || canImport) && (
              <div className="flex flex-wrap gap-2 border-t border-sand pt-3">
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUnskip}
                    disabled={unskipLoading}
                  >
                    <Undo2 className="mr-1.5 h-3 w-3" />
                    Unskip
                  </Button>
                )}
                {canCancel && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      pendingDialog.current = "cancel"
                      onOpenChange(false)
                    }}
                  >
                    <Ban className="mr-1.5 h-3 w-3" />
                    Cancel
                  </Button>
                )}
                {canImport && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      pendingDialog.current = "csv"
                      onOpenChange(false)
                    }}
                  >
                    <Upload className="mr-1.5 h-3 w-3" />
                    Import bookings
                  </Button>
                )}
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      pendingDialog.current = "delete"
                      onOpenChange(false)
                    }}
                    className="text-warm-grey hover:text-red-600"
                  >
                    <Trash2 className="mr-1.5 h-3 w-3" />
                    Remove
                  </Button>
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
        description={`Remove this ${childSlot.className} slot from the timetable permanently?`}
        onConfirm={handleDelete}
        loading={deleteLoading}
        actionLabel="Remove"
      />
    </>
  )
}
