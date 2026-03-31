"use client"

import { useState } from "react"
import { createStudioHoliday, deleteStudioHoliday } from "@/app/actions/studio-holidays"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/shared/submit-button"
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog"
import { Palmtree, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { StudioHoliday } from "@/lib/types"
import { localDateStr } from "@/lib/utils"

interface HolidayBannerProps {
  holidays: StudioHoliday[]
}

export function HolidayBanner({ holidays }: HolidayBannerProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletingHoliday, setDeletingHoliday] = useState<StudioHoliday | null>(
    null
  )
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Only show upcoming or current holidays (not past ones)
  const today = localDateStr()
  const relevantHolidays = holidays.filter((h) => h.end_date >= today)

  async function handleAddHoliday(formData: FormData) {
    try {
      const result = await createStudioHoliday(formData)
      toast.success(
        result.totalCancelled > 0
          ? `Holiday created — ${result.totalCancelled} booking${result.totalCancelled !== 1 ? "s" : ""} cancelled and members notified`
          : "Holiday created"
      )
      setAddOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create holiday")
    }
  }

  async function handleDelete() {
    if (!deletingHoliday) return
    setDeleteLoading(true)
    try {
      await deleteStudioHoliday(deletingHoliday.id)
      toast.success("Holiday removed")
      setDeleteOpen(false)
      setDeletingHoliday(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove holiday")
    } finally {
      setDeleteLoading(false)
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    })
  }

  return (
    <>
      {/* Holiday banner — only shows if there are relevant holidays, or always show the add button */}
      <div className="mb-5 overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="flex items-center justify-between border-b border-sand px-5 py-3">
          <div className="flex items-center gap-2">
            <Palmtree className="h-4 w-4 text-gold" />
            <h3 className="text-[0.85rem] font-semibold text-cocoa">
              Holidays
            </h3>
            {relevantHolidays.length === 0 && (
              <span className="text-[0.72rem] text-warm-grey">
                — No upcoming closures
              </span>
            )}
          </div>
          <Button onClick={() => setAddOpen(true)} size="sm" variant="outline">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add holiday
          </Button>
        </div>

        {relevantHolidays.length > 0 && (
          <div className="divide-y divide-sand/40">
            {relevantHolidays.map((h) => {
              const isCurrent = h.start_date <= today && h.end_date >= today
              return (
                <div
                  key={h.id}
                  className="flex items-center justify-between px-5 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    {isCurrent && (
                      <span className="inline-block h-2 w-2 rounded-full bg-ember" />
                    )}
                    <div>
                      <span className="text-[0.82rem] font-medium text-cocoa">
                        {h.name}
                      </span>
                      <span className="ml-2 text-[0.72rem] text-warm-grey">
                        {formatDate(h.start_date)}–{formatDate(h.end_date)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setDeletingHoliday(h)
                      setDeleteOpen(true)
                    }}
                    className="p-1 text-warm-grey hover:text-red-600"
                    title="Remove holiday"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add holiday dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Palmtree className="h-5 w-5 text-gold" />
              Add holiday
            </DialogTitle>
            <DialogDescription>
              All classes during this period will be cancelled. Members will be
              notified and pack credits restored.
            </DialogDescription>
          </DialogHeader>
          <form action={handleAddHoliday} className="space-y-4">
            <div>
              <Label htmlFor="holiday-name">Name</Label>
              <Input
                id="holiday-name"
                name="name"
                placeholder="e.g. Christmas break"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="holiday-start">Start date</Label>
                <Input id="holiday-start" name="start_date" type="date" required />
              </div>
              <div>
                <Label htmlFor="holiday-end">End date</Label>
                <Input id="holiday-end" name="end_date" type="date" required />
              </div>
            </div>
            <div className="rounded-lg bg-ember/10 px-4 py-3 text-[0.78rem] text-cocoa">
              All confirmed bookings in this date range will be automatically
              cancelled. Members will receive a cancellation email and any pack
              credits will be restored.
            </div>
            <DialogFooter>
              <SubmitButton>Create holiday</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove holiday"
        description={`Remove "${deletingHoliday?.name ?? ""}"? Already-cancelled bookings will not be restored.`}
        onConfirm={handleDelete}
        loading={deleteLoading}
        actionLabel="Remove"
      />
    </>
  )
}
