// CSV cells for files people open in Excel or Sheets.
//
// Member-entered text (names, emails) can start with = + - @, which a
// spreadsheet runs as a formula: "=HYPERLINK(...)" as a name would execute on
// the owner's machine. Such cells get a leading apostrophe, which spreadsheets
// show as plain text. Plain numbers ("-0.80") are left alone so amounts stay
// numeric.

const NUMBER = /^-?\d+(\.\d+)?$/
const FORMULA_START = /^[=+\-@\t\r]/

/** Make text safe to open in a spreadsheet, before any CSV quoting. */
export function neutraliseFormula(v: string): string {
  return FORMULA_START.test(v) && !NUMBER.test(v) ? `'${v}` : v
}

/** One CSV cell: formula-safe, quoted when it holds a comma, quote or newline. */
export function csvCell(v: string | number | null | undefined): string {
  const s = neutraliseFormula(v === null || v === undefined ? "" : String(v))
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
