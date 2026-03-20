import { CLASS_COLORS } from "@/lib/constants"

interface ClassColorBarProps {
  classSlug: string
  className?: string
}

export function ClassColorBar({ classSlug, className = "w-[3px] h-8" }: ClassColorBarProps) {
  const colorClass = CLASS_COLORS[classSlug] ?? "bg-warm-grey"
  return <div className={`${colorClass} rounded-sm flex-shrink-0 ${className}`} />
}
