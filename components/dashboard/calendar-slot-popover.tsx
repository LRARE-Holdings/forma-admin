"use client"

import { useState } from "react"
import { formatTime, formatPence } from "@/lib/utils"
import { unskipClassInstance } from "@/app/actions/schedule-exceptions"
import { deleteScheduleSlot } from "@/app/actions/schedule"
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
import { Repeat, Pencil, SkipForward, Undo2, Ban, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import type { WeekSlot } from "@/lib/types"

interface CalendarSlotPopoverProps {
  slot: WeekSlot | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (slot: WeekSlot) => void
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
