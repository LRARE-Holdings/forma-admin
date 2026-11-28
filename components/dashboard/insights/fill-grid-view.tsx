"use client"

import { useEffect, useState } from "react"

export interface FillCell {
  /** 0–1, or null when nothing ran in that slot. */
  rate: number | null
  label: string
  color: string
}

/**
 * The fill-rate grid itself. Tapping a cell (or hovering, with a mouse) shows
 * its detail underneath: phones have no hover, so a tooltip alone would hide
 * it from anyone on an iPhone.
 */
export function FillGridView({
  days,
  times,
  cells,
  legend,
}: {
  days: string[]
  times: string[]
  /** cells[timeIndex][dayIndex] */
  cells: FillCell[][]
  legend: string[]
}) {
  const [picked, setPicked] = useState<string | null>(null)
  // Phones: the grid is taller than the screen, so the detail also pops up
  // pinned to the bottom for a few seconds after a tap.
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])
  return (
    <div className="overflow-x-auto p-3 sm:p-4">
      <table className="w-full border-separate border-spacing-[3px]">
        <thead>
          <tr>
            <th className="w-12 sm:w-16" />
            {days.map((d) => (
              <th key={d} className="pb-1 text-center text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((t, ti) => (
            <tr key={t}>
              <th scope="row" className="pr-1.5 text-right text-[0.7rem] font-semibold text-warm-grey sm:pr-2 sm:text-[0.72rem]">
                {t}
              </th>
              {cells[ti].map((c, di) =>
                c.rate === null ? (
                  <td key={di} className="h-10 rounded-md bg-cream/40" />
                ) : (
                  <td key={di} className="p-0">
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(c.label)
                        setToast(c.label)
                      }}
                      onMouseEnter={() => setPicked(c.label)}
                      aria-label={c.label}
                      className={`h-10 w-full min-w-[40px] rounded-md text-center text-[0.72rem] font-semibold tabular-nums text-cocoa transition-shadow hover:shadow-[0_0_0_2px_var(--color-cocoa)] sm:min-w-[52px] sm:text-[0.75rem] ${
                        picked === c.label ? "shadow-[0_0_0_2px_var(--color-cocoa)]" : ""
                      }`}
                      style={{ backgroundColor: c.color }}
                    >
                      {Math.round(c.rate * 100)}%
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {toast && (
        <div className="fixed inset-x-4 bottom-4 z-40 rounded-xl bg-cocoa px-4 py-3 text-[0.84rem] text-cream shadow-lg md:hidden" role="status">
          {toast}
        </div>
      )}
      <p className="mt-3 min-h-5 text-[0.78rem] text-cocoa" aria-live="polite">
        {picked ?? <span className="text-warm-grey">Tap a cell for the detail.</span>}
      </p>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[0.65rem] text-warm-grey" aria-hidden>
        <span>Emptier</span>
        {legend.map((color) => (
          <span key={color} className="h-3 w-6 rounded-sm" style={{ backgroundColor: color }} />
        ))}
        <span>Fuller</span>
      </div>
    </div>
  )
}
