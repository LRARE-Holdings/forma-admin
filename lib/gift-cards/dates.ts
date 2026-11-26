import { localDateStr } from "@/lib/utils"
import { ukWallClockToIso } from "@/lib/events"

/**
 * The one rule for a gift card's claim-by date, so the voucher, both emails,
 * the dashboard, the claim check and the website preview always agree.
 *
 * - Counted in UK calendar days from the day it was bought (not from the
 *   moment in UTC, which put late-night summer purchases a day early).
 * - Adding months stops at the end of a short month: 31 Aug + 6 months is
 *   28 Feb (29 in a leap year), not 3 Mar.
 * - The card works until the very end of that day, UK time, so the printed
 *   date is the last day you can claim, whatever time it was bought.
 *
 * burn-mat-studio lib/gift-dates.ts has the same date arithmetic for the
 * preview. Keep them equal.
 */
export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number)
  const index = y * 12 + (m - 1) + months
  const ty = Math.floor(index / 12)
  const tm = index % 12
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`
}

/** The instant a card bought at `paidAt` stops working: end of its claim-by day in the UK. */
export function giftClaimDeadline(paidAt: Date, months: number): Date {
  const lastDay = addMonthsToDate(localDateStr(paidAt), months)
  const [y, m, d] = lastDay.split("-").map(Number)
  const following = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return new Date(new Date(ukWallClockToIso(following, "00:00")).getTime() - 1)
}
