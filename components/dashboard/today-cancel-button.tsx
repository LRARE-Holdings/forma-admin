"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { CancelClassDialog } from "./cancel-class-dialog"

interface TodayCancelButtonProps {
  scheduleId: string
  date: string
  className: string
  startTime: string
  bookingCount: number
}

export function TodayCancelButton({
  scheduleId,
  date,
  className,
  startTime,
  bookingCount,
}: TodayCancelButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="ml-1 flex-shrink-0 rounded p-1 text-warm-grey/60 hover:bg-ember/10 hover:text-ember"
        title="Cancel this class"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <CancelClassDialog
        open={open}
        onOpenChange={setOpen}
        scheduleId={scheduleId}
        date={date}
        className={className}
        startTime={startTime}
        bookingCount={bookingCount}
      />
    </>
  )
}
