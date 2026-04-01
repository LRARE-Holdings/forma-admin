"use client"

import { useState, useEffect } from "react"
import { formatTime, formatPence, getInitial } from "@/lib/utils"
import { unskipClassInstance } from "@/app/actions/schedule-exceptions"
import { deleteScheduleSlot } from "@/app/actions/schedule"
import { getSlotAttendees, cancelBooking, markAttendance, type SlotAttendee } from "@/app/actions/bookings"
import { nextAttendanceStatus, attendanceLabel, attendanceColor } from "@/lib/attendance"
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
import { Repeat, Pencil, SkipForward, Undo2, Ban, Trash2, Upload, Users, Loader2, X, Check, XCircle, Clock, Circle } from "lucide-react"
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

  // Attendee state
  const [attendees, setAttendees] = useState<SlotAttendee[]>([])
  const [attendeesLoading, setAttendeesLoading] = useState(false)
  const [showAttendees, setShowAttendees] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)

  // Fetch attendees when dialog opens and slot has bookings
  useEffect(() => {
    if (open && slot && slot.bookingCount > 0) {
      setAttendeesLoading(true)
      setShowAttendees(true)
      getSlotAttendees(slot.scheduleId, slot.date)
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
  }, [open, slot?.scheduleId, slot?.date, slot?.bookingCount])

  if (!slot) return null

  const formattedDate = new Date(slot.date + "T00:00:00").toLocaleDateString(
    "en-GB",
    { weekday: "long", day: "numeric", month: "long" }
  )

  async function handleUnskip() {
    if (!slot) return
    setUnskipLoading(true)
    try {
      await unskipClassInstance(slot.scheduleId, slot.date)
      toast.success("Class restored for this week")
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restore class")
    } finally {
      setUnskipLoading(false)
    }
  }

  async function handleDelete() {
    if (!slot) return
    setDeleteLoading(true)
    try {
      await deleteScheduleSlot(slot.scheduleId)
      toast.success("Schedule slot removed")
      setDeleteOpen(false)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove slot")
    } finally {
      setDeleteLoading(false)
    }
  }

  const canEdit = !slot.isPast && !slot.isHoliday
  const canSkip =
    !slot.isPast && !slot.isHoliday && !slot.isSkipped && !!slot.ruleId
  const canUnskip = !slot.isPast && slot.isSkipped
  const canCancel = !slot.isPast && !slot.isHoliday && !slot.isSkipped
  const canImport = !slot.isHoliday && !slot.isSkipped

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClassColorBar
                classSlug={slot.classSlug}
                className="w-[3px] h-5"
              />
              {slot.className}
              {slot.ruleId && (
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
                  {formatTime(slot.startTime)}–{formatTime(slot.endTime)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-warm-grey">Instructor</span>
                <span className="font-medium text-cocoa">
                  {slot.instructorName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-warm-grey">Price</span>
                <span className="font-medium text-cocoa">
                  &pound;{formatPence(slot.pricePence)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-warm-grey">Bookings</span>
                <CapacityBadge
                  booked={slot.bookingCount}
                  capacity={slot.capacity}
                />
              </div>
            </div>

            {/* Attendee list */}
            {showAttendees && (
              <div className="rounded-xl border border-sand overflow-hidden">
                <div className="flex items-center justify-between bg-cream px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-warm-grey">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3 w-3" />
                    Attendees ({slot.bookingCount} of {slot.capacity})
                    {slot.bookingCount >= slot.capacity ? " — FULL" : ""}
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
                        <button
                          type="button"
                          disabled={markingId === att.id}
                          onClick={async (e) => {
                            e.stopPropagation()
                            const next = nextAttendanceStatus(att.attendance_status)
                            setMarkingId(att.id)
                            try {
                              await markAttendance(att.id, next)
                              setAttendees((prev) =>
                                prev.map((a) =>
                                  a.id === att.id ? { ...a, attendance_status: next } : a
                                )
                              )
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Failed to update attendance")
                            } finally {
                              setMarkingId(null)
                            }
                          }}
                          className={`shrink-0 rounded p-0.5 transition-colors hover:bg-cream ${attendanceColor(att.attendance_status)}`}
                          title={attendanceLabel(att.attendance_status)}
                        >
                          {markingId === att.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-warm-grey" />
                          ) : att.attendance_status === "attended" ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : att.attendance_status === "no_show" ? (
                            <XCircle className="h-3.5 w-3.5" />
                          ) : att.attendance_status === "late_cancel" ? (
                            <Clock className="h-3.5 w-3.5" />
                          ) : (
                            <Circle className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <span
                          className={`inline-block rounded-full px-1.5 py-0.5 text-[0.58rem] font-semibold uppercase ${paymentStyle(att.payment_method)}`}
                        >
                          {paymentLabel(att.payment_method)}
                        </span>
                        {!slot.isPast && (
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
                      { length: slot.capacity - attendees.length },
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
            {slot.bookingCount === 0 && !slot.isSkipped && !slot.isHoliday && (
              <div className="rounded-lg bg-sand/30 px-3 py-2 text-center text-[0.78rem] text-warm-grey">
                No bookings yet
              </div>
            )}

            {/* Status badges */}
            {slot.isSkipped && (
              <div className="rounded-lg bg-sand/50 px-3 py-2 text-[0.78rem] text-warm-grey">
                This class is <strong>skipped</strong> this week.
              </div>
            )}
            {slot.isHoliday && (
              <div className="rounded-lg bg-ember/10 px-3 py-2 text-[0.78rem] text-cocoa">
                Studio is on <strong>holiday</strong> this date.
              </div>
            )}
            {slot.isPast && (
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
                      onEdit(slot)
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
                      onOpenChange(false)
                      setSkipOpen(true)
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
                      onOpenChange(false)
                      setCancelOpen(true)
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
                      onOpenChange(false)
                      setCsvUploadOpen(true)
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
                      onOpenChange(false)
                      setDeleteOpen(true)
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
        scheduleId={slot.scheduleId}
        date={slot.date}
        className={slot.className}
        startTime={formatTime(slot.startTime)}
        bookingCount={slot.bookingCount}
      />

      {/* Cancel dialog */}
      <CancelClassDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        scheduleId={slot.scheduleId}
        date={slot.date}
        className={slot.className}
        startTime={formatTime(slot.startTime)}
        bookingCount={slot.bookingCount}
      />

      {/* CSV upload */}
      <CsvUploadDialog
        open={csvUploadOpen}
        onOpenChange={setCsvUploadOpen}
        scheduleId={slot.scheduleId}
        date={slot.date}
        className={slot.className}
        startTime={formatTime(slot.startTime)}
        capacity={slot.capacity}
        bookingCount={slot.bookingCount}
      />

      {/* Delete confirmation */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove slot"
        description={`Remove this ${slot.className} slot from the timetable permanently?`}
        onConfirm={handleDelete}
        loading={deleteLoading}
        actionLabel="Remove"
      />
    </>
  )
}
