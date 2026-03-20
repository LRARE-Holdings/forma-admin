"use client"

import { CLASS_STROKE_COLORS } from "@/lib/constants"

interface CapacityRingProps {
  booked: number
  capacity: number
  classSlug: string
  size?: number
}

export function CapacityRing({
  booked,
  capacity,
  classSlug,
  size = 40,
}: CapacityRingProps) {
  const radius = 15.5
  const circumference = 2 * Math.PI * radius
  const progress = capacity > 0 ? booked / capacity : 0
  const offset = circumference * (1 - progress)
  const strokeColor = CLASS_STROKE_COLORS[classSlug] ?? "#8A8070"

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 36 36"
        width={size}
        height={size}
        className="-rotate-90"
      >
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="#E8DCC8"
          strokeWidth="3"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[0.7rem] font-bold text-cocoa">
        {booked}
      </div>
    </div>
  )
}
