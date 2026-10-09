import type { SessionFill } from "@/lib/fill-rate"
import { fillBy } from "@/lib/fill-rate"
import { formatTime, dayShort } from "@/lib/utils"

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
    <div className="overflow-x-auto p-4">
      <table className="w-full border-separate border-spacing-[3px]">
        <thead>
          <tr>
            <th className="w-16" />
            {days.map((d) => (
              <th key={d} className="pb-1 text-center text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
                {dayShort(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((t) => (
            <tr key={t}>
              <th scope="row" className="pr-2 text-right text-[0.72rem] font-semibold text-warm-grey">
                {formatTime(t)}
              </th>
              {days.map((d) => {
                const c = cells.get(`${d}|${t}`)
                if (!c || c.rate === null) return <td key={d} className="h-10 rounded-md bg-cream/40" />
                const pct = Math.round(c.rate * 100)
                return (
                  <td
                    key={d}
                    title={`${dayShort(d)} ${formatTime(t)}: ${pct}% full — ${c.booked} of ${c.capacity} places over ${c.sessions} class${c.sessions === 1 ? "" : "es"}`}
                    className="h-10 min-w-[52px] rounded-md text-center text-[0.75rem] font-semibold tabular-nums text-cocoa transition-shadow hover:shadow-[0_0_0_2px_var(--color-cocoa)]"
                    style={{ backgroundColor: cellColor(c.rate) }}
                  >
                    {pct}%
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[0.65rem] text-warm-grey" aria-hidden>
        <span>Emptier</span>
        {STEPS.map((s) => (
          <span key={s.mix} className="h-3 w-6 rounded-sm" style={{ backgroundColor: cellColor(s.min) }} />
        ))}
        <span>Fuller</span>
      </div>
    </div>
  )
}
