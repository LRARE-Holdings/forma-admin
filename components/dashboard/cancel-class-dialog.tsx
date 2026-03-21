"use client"

import { useState } from "react"
import { cancelClassInstance } from "@/app/actions/class-cancellation"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, AlertTriangle } from "lucide-react"

interface CancelClassDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scheduleId: string
  date: string
  className: string
  startTime: string
  bookingCount: number
}

export function CancelClassDialog({
  open,
  onOpenChange,
  scheduleId,
  date,
  className,
  startTime,
  bookingCount,
}: CancelClassDialogProps) {
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(false)

  const formattedDate = new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  async function handleCancel() {
    setLoading(true)
    try {
      const result = await cancelClassInstance(scheduleId, date, reason || undefined)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(
          result.cancelledCount > 0
            ? `Class cancelled \u2014 ${result.cancelledCount} booking${result.cancelledCount !== 1 ? "s" : ""} cancelled and members notified`
            : "Class cancelled \u2014 no bookings to cancel"
        )
      }
      onOpenChange(false)
      setReason("")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel class")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-ember" />
            Cancel class
          </DialogTitle>
          <DialogDescription>
            This will cancel <strong>{className}</strong> ({startTime}) on{" "}
            <strong>{formattedDate}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {bookingCount > 0 && (
            <div className="rounded-lg bg-ember/10 px-4 py-3 text-[0.82rem] text-cocoa">
              <strong>{bookingCount}</strong> booking{bookingCount !== 1 ? "s" : ""} will
              be cancelled and members will be notified by email. Pack credits will be
              automatically restored.
            </div>
          )}

          <div>
            <label
              htmlFor="cancel-reason"
              className="mb-1.5 block text-[0.78rem] font-medium text-cocoa"
            >
              Reason (optional)
            </label>
            <textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Instructor unwell"
              className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[0.82rem] text-cocoa placeholder:text-warm-grey/60 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              rows={2}
            />
            <p className="mt-1 text-[0.68rem] text-warm-grey">
              This will be included in the cancellation email to members.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Keep class
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Cancel class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
