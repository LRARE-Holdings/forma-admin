import type { SessionFill } from "@/lib/fill-rate"
import { fillBy } from "@/lib/fill-rate"
import { formatTime, dayShort } from "@/lib/utils"
import { FillGridView } from "./fill-grid-view"

// Fill rate by weekday × start time. One hue (studio gold) mixed into white in
// five steps, light → dark with the fill; the number is always printed so the
// colour is never the only cue. Cocoa text stays readable on every step.
const STEPS = [
  { min: 0, mix: 8 },
  { min: 0.2, mix: 25 },
  { min: 0.4, mix: 45 },
  { min: 0.6, mix: 70 },
  { min: 0.8, mix: 100 },
]

function cellColor(rate: number): string {
  const step = [...STEPS].reverse().find((s) => rate >= s.min) ?? STEPS[0]
  return `color-mix(in oklab, var(--color-gold) ${step.mix}%, white)`
}

export function FillGrid({ sessions }: { sessions: SessionFill[] }) {
  const cells = new Map(
    fillBy(sessions, (s) => `${s.dayOfWeek}|${s.startTime}`).map((c) => [c.key, c]),
  )
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => sessions.some((s) => s.dayOfWeek === d))
  const times = [...new Set(sessions.map((s) => s.startTime))].sort()

  if (sessions.length === 0) {
    return <p className="px-5 py-10 text-center text-[0.82rem] text-warm-grey">No classes in this period.</p>
  }

  return (
    <FillGridView
      days={days.map((d) => dayShort(d))}
      times={times.map((t) => formatTime(t))}
      cells={times.map((t) =>
        days.map((d) => {
          const c = cells.get(`${d}|${t}`)
          if (!c || c.rate === null) return { rate: null, label: "", color: "" }
          const pct = Math.round(c.rate * 100)
          return {
            rate: c.rate,
            label: `${dayShort(d)} ${formatTime(t)}: ${pct}% full, ${c.booked} of ${c.capacity} places over ${c.sessions} class${c.sessions === 1 ? "" : "es"}`,
            color: cellColor(c.rate),
          }
        }),
      )}
      legend={STEPS.map((s) => cellColor(s.min))}
    />
  )
}
