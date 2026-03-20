interface CapacityBadgeProps {
  booked: number
  capacity: number
}

export function CapacityBadge({ booked, capacity }: CapacityBadgeProps) {
  if (booked >= capacity) {
    return (
      <span className="inline-block rounded-full bg-warm-grey/10 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.03em] text-warm-grey">
        Full
      </span>
    )
  }

  if (booked >= capacity * 0.7) {
    return (
      <span className="inline-block rounded-full bg-ember/12 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.03em] text-ember">
        Almost full
      </span>
    )
  }

  return (
    <span className="inline-block rounded-full bg-success-bg px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.03em] text-success">
      Open
    </span>
  )
}
