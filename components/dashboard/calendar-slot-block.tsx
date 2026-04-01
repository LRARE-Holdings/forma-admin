"use client"

import { ClassColorBar } from "@/components/shared/class-color-bar"
import { formatTime } from "@/lib/utils"
import { Repeat } from "lucide-react"
import type { WeekSlot } from "@/lib/types"

interface CalendarSlotBlockProps {
  slot: WeekSlot
  position: { top: number; height: number }
  onClick: (e: React.MouseEvent) => void
}

export function CalendarSlotBlock({
  slot,
  position,
  onClick,
}: CalendarSlotBlockProps) {
  const isCompact = position.height < 60

  return (
    <div
      data-slot-block
      onClick={onClick}
      className={`absolute left-1 right-1 z-20 cursor-pointer overflow-hidden rounded-lg border transition-shadow hover:shadow-md ${
        slot.isSkipped
          ? "border-sand/60 bg-sand/30 opacity-60"
          : slot.isHoliday
            ? "border-ember/20 bg-ember/5 opacity-60"
            : slot.isPast
              ? "border-sand bg-white/80 opacity-70"
              : "border-sand bg-white hover:border-gold"
      }`}
      style={{
        top: `${position.top + 2}px`,
        height: `${position.height - 4}px`,
      }}
    >
      <div className="flex h-full gap-1.5 px-2 py-1">
        <ClassColorBar
          classSlug={slot.classSlug}
          className="w-[3px] flex-shrink-0 self-stretch"
        />
        <div className="min-w-0 flex-1">
          <div
            className={`flex items-center gap-1 ${slot.isSkipped ? "line-through" : ""}`}
          >
            <span className="truncate text-[0.72rem] font-semibold text-cocoa">
              {slot.className}
            </span>
            {slot.ruleId && (
              <Repeat className="h-2.5 w-2.5 shrink-0 text-gold" />
            )}
          </div>
          {!isCompact && (
            <>
              <div className="truncate text-[0.62rem] text-warm-grey">
                {slot.instructorName}
              </div>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="text-[0.6rem] text-warm-grey">
                  {formatTime(slot.startTime)}–{formatTime(slot.endTime)}
                </span>
                <span
                  className={`text-[0.58rem] font-semibold ${
                    slot.bookingCount >= slot.capacity
                      ? "text-warm-grey"
                      : slot.bookingCount >= slot.capacity * 0.7
                        ? "text-ember"
                        : "text-success"
                  }`}
                >
                  {slot.bookingCount}/{slot.capacity}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
