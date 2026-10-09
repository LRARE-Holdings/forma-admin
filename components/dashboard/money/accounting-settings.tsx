"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { updateAccountingSettings } from "@/app/actions/studio"
import { isActionFailure } from "@/lib/action-result"

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // no 29 Feb: it isn't there every year

const SOFTWARE = [
  { value: "none", label: "None, or not sure" },
  { value: "xero", label: "Xero" },
  { value: "quickbooks", label: "QuickBooks" },
  { value: "freeagent", label: "FreeAgent" },
]

const fieldClass =
  "mt-1 block h-8 rounded-lg border border-sand bg-cream/50 px-2 text-[0.8rem] normal-case tracking-normal text-cocoa outline-none focus:border-gold"
const labelClass = "text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey"

export function AccountingSettings({ yearEnd, software }: { yearEnd: string; software: string }) {
  const [month, setMonth] = useState(Number(yearEnd.slice(0, 2)))
  const [day, setDay] = useState(Number(yearEnd.slice(3, 5)))
  const [pkg, setPkg] = useState(software)
  const [pending, startTransition] = useTransition()

  const maxDay = DAYS_IN_MONTH[month - 1]
  const safeDay = Math.min(day, maxDay)
  const value = `${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`
  const dirty = value !== yearEnd || pkg !== software

  function save() {
    startTransition(async () => {
      const res = await updateAccountingSettings(value, pkg)
      if (isActionFailure(res)) toast.error(res.error)
      else toast.success("Accounting settings saved")
    })
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t border-sand px-5 py-4 print:hidden"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <fieldset className="flex items-end gap-2">
        <legend className={labelClass}>Year end</legend>
        <label className="sr-only" htmlFor="ye-day">Day</label>
        <select id="ye-day" value={safeDay} onChange={(e) => setDay(Number(e.target.value))} className={fieldClass}>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="ye-month">Month</label>
        <select id="ye-month" value={month} onChange={(e) => setMonth(Number(e.target.value))} className={fieldClass}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
      </fieldset>
      <label className={labelClass}>
        Accounting software
        <select value={pkg} onChange={(e) => setPkg(e.target.value)} className={fieldClass}>
          {SOFTWARE.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={!dirty || pending}
        className="h-8 rounded-lg border border-sand px-3 text-[0.75rem] font-semibold text-warm-grey transition-colors hover:border-gold hover:text-cocoa disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <p className="basis-full text-[0.7rem] text-warm-grey">
        A sole trader&apos;s year normally ends on 5 April, the tax year. Change it if your accountant uses a different date.
      </p>
    </form>
  )
}
