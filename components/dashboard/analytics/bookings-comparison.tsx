"use client"

import { ArrowUp, ArrowDown, Minus } from "lucide-react"

interface BookingsComparisonProps {
  thisWeek: number
  lastWeek: number
}

export function BookingsComparison({ thisWeek, lastWeek }: BookingsComparisonProps) {
  const diff = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : 0
  const isUp = diff > 0
  const isDown = diff < 0
  const isFlat = diff === 0

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-xl border border-sand bg-white p-4">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-warm-grey">
          This week
        </p>
        <p className="mt-1 font-heading text-[1.8rem] font-semibold text-cocoa">
          {thisWeek}
        </p>
        <p className="text-[0.7rem] text-warm-grey">bookings</p>
      </div>
      <div className="rounded-xl border border-sand bg-white p-4">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-warm-grey">
          Last week
        </p>
        <p className="mt-1 font-heading text-[1.8rem] font-semibold text-cocoa">
          {lastWeek}
        </p>
        <div className="flex items-center gap-1 text-[0.72rem] font-medium">
          {isFlat && (
            <>
              <Minus className="h-3 w-3 text-warm-grey" />
              <span className="text-warm-grey">No change</span>
            </>
          )}
          {isUp && (
            <>
              <ArrowUp className="h-3 w-3 text-success" />
              <span className="text-success">+{Math.round(diff)}%</span>
            </>
          )}
          {isDown && (
            <>
              <ArrowDown className="h-3 w-3 text-ember" />
              <span className="text-ember">{Math.round(diff)}%</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
