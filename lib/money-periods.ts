// Accounting periods for the Money page. All dates are YYYY-MM-DD calendar
// dates in UK time, inclusive at both ends; stripe_ledger_summary converts
// them to Europe/London instants, so BST never shifts a sale between months.

export interface Period {
  from: string
  to: string
  label: string
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const pad = (n: number) => String(n).padStart(2, "0")
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function lastDayOfMonth(y: number, m: number): string {
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}

export function monthPeriod(y: number, m: number): Period {
  return { from: `${y}-${pad(m)}-01`, to: lastDayOfMonth(y, m), label: `${MONTHS[m - 1]} ${y}` }
}

/** Calendar quarters: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec. */
export function quarterPeriod(y: number, q: number): Period {
  const m0 = (q - 1) * 3 + 1
  return {
    from: `${y}-${pad(m0)}-01`,
    to: lastDayOfMonth(y, m0 + 2),
    label: `${MONTHS[m0 - 1]}–${MONTHS[m0 + 1]} ${y}`,
  }
}

/** UK tax year starting 6 April of `startYear`. */
export function taxYearPeriod(startYear: number): Period {
  return {
    from: `${startYear}-04-06`,
    to: `${startYear + 1}-04-05`,
    label: `Tax year ${startYear}/${String(startYear + 1).slice(2)}`,
  }
}

export function taxYearStartFor(dateStr: string): number {
  const y = Number(dateStr.slice(0, 4))
  return dateStr.slice(5) >= "04-06" ? y : y - 1
}

/** The default accounting year end: 5 April, the UK tax year. */
export const TAX_YEAR_END = "04-05"

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The accounting year ending on `yearEnd` (MM-DD) in `endYear`. */
export function financialYearPeriod(yearEnd: string, endYear: number): Period {
  const to = `${endYear}-${yearEnd}`
  return { from: addDays(`${endYear - 1}-${yearEnd}`, 1), to, label: `Year to ${formatUkDate(to)}` }
}

/** End year of the financial year containing `dateStr`. */
export function financialYearEndFor(yearEnd: string, dateStr: string): number {
  const y = Number(dateStr.slice(0, 4))
  return dateStr.slice(5) <= yearEnd ? y : y + 1
}

/**
 * The quick-pick list, relative to today. A studio whose year doesn't end on
 * 5 April also gets its own financial years, after the tax years.
 */
export function presetPeriods(today: string, yearEnd: string = TAX_YEAR_END): Array<Period & { key: string }> {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const q = Math.ceil(m / 3)
  const prevMonth = m === 1 ? monthPeriod(y - 1, 12) : monthPeriod(y, m - 1)
  const prevQuarter = q === 1 ? quarterPeriod(y - 1, 4) : quarterPeriod(y, q - 1)
  const ty = taxYearStartFor(today)
  const fy = financialYearEndFor(yearEnd, today)
  return [
    { key: "this-month", ...monthPeriod(y, m) },
    { key: "last-month", ...prevMonth },
    { key: "this-quarter", ...quarterPeriod(y, q) },
    { key: "last-quarter", ...prevQuarter },
    { key: "this-tax-year", ...taxYearPeriod(ty) },
    { key: "last-tax-year", ...taxYearPeriod(ty - 1) },
    ...(yearEnd === TAX_YEAR_END
      ? []
      : [
          { key: "this-financial-year", ...financialYearPeriod(yearEnd, fy) },
          { key: "last-financial-year", ...financialYearPeriod(yearEnd, fy - 1) },
        ]),
  ]
}

/** Read ?from=&to= from the URL; fall back to this month. */
export function resolvePeriod(
  params: { from?: string; to?: string },
  today: string,
  yearEnd: string = TAX_YEAR_END,
): Period {
  const presets = presetPeriods(today, yearEnd)
  const { from, to } = params
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to) {
    const preset = presets.find((p) => p.from === from && p.to === to)
    return { from, to, label: preset?.label ?? `${formatUkDate(from)} – ${formatUkDate(to)}` }
  }
  return presets[0]
}

/** "6 Apr 2026" */
export function formatUkDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** The last day the figures can cover: the period end, or today if sooner. */
export function effectiveEnd(period: Period, today: string): string {
  return period.to < today ? period.to : today
}
