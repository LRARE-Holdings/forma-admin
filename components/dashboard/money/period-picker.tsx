"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

interface PeriodPickerProps {
  presets: Array<{ key: string; label: string; from: string; to: string }>
  from: string
  to: string
}

export function PeriodPicker({ presets, from, to }: PeriodPickerProps) {
  const router = useRouter()
  const active = presets.find((p) => p.from === from && p.to === to)
  const [customFrom, setCustomFrom] = useState(from)
  const [customTo, setCustomTo] = useState(to)

  function go(f: string, t: string) {
    router.push(`/dashboard/money?from=${f}&to=${t}`)
  }

  return (
    <div className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-sand bg-white px-5 py-4 print:hidden">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose a period">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={active?.key === p.key}
            onClick={() => go(p.from, p.to)}
            className={`rounded-lg border px-3 py-1.5 text-[0.75rem] font-semibold transition-colors ${
              active?.key === p.key
                ? "border-gold bg-cream text-cocoa"
                : "border-sand text-warm-grey hover:border-gold hover:text-cocoa"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <form
        className="ml-auto flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (customFrom && customTo && customFrom <= customTo) go(customFrom, customTo)
        }}
      >
        <label className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
          From
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="mt-1 block h-8 rounded-lg border border-sand bg-cream/50 px-2 text-[0.8rem] normal-case tracking-normal text-cocoa outline-none focus:border-gold"
          />
        </label>
        <label className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
          To
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="mt-1 block h-8 rounded-lg border border-sand bg-cream/50 px-2 text-[0.8rem] normal-case tracking-normal text-cocoa outline-none focus:border-gold"
          />
        </label>
        <button
          type="submit"
          disabled={!customFrom || !customTo || customFrom > customTo}
          className="h-8 rounded-lg border border-sand px-3 text-[0.75rem] font-semibold text-warm-grey transition-colors hover:border-gold hover:text-cocoa disabled:opacity-40"
        >
          Show
        </button>
      </form>
    </div>
  )
}
