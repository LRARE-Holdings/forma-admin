/**
 * What a class costs on the day it runs.
 *
 * A discount covers a range of CLASS DATES, not a window in which you have to
 * book. The timetable opens weeks ahead, so someone booking in September for a
 * class on 5 October pays October's price today. Keying this off the current
 * date would quote full price right up to the 1st and then change under people
 * who had already booked.
 *
 * `price_pence` stays the list price. The discount is a dated overlay, so it
 * lapses on its own and the original price survives.
 *
 * These rules match burn-mat-studio's `lib/pricing.ts` and the
 * `class_prices_on(studio_id, date)` function. All three have to agree, or the
 * dashboard and the public site will quote different prices.
 */

export interface DiscountableClass {
  price_pence: number
  discount_percent: number | null
  discount_starts_on: string | null
  discount_ends_on: string | null
}

/**
 * Does the discount cover a class running on `classDate` (YYYY-MM-DD)?
 *
 * The date is required on purpose. An optional one defaulting to today is the
 * bug this replaced, and it would return silently at the first call site that
 * forgot to pass a date.
 */
export function isDiscountActiveOn(
  cls: DiscountableClass,
  classDate: string
): boolean {
  if (!cls.discount_percent) return false
  if (cls.discount_starts_on && classDate < cls.discount_starts_on) return false
  if (cls.discount_ends_on && classDate > cls.discount_ends_on) return false
  return true
}

/** The amount to charge for a class running on `classDate`. */
export function effectivePricePence(
  cls: DiscountableClass,
  classDate: string
): number {
  if (!isDiscountActiveOn(cls, classDate)) return cls.price_pence
  return Math.round((cls.price_pence * (100 - cls.discount_percent!)) / 100)
}

/** Whether a discount is set at all, whatever dates it covers. */
export function hasDiscount(cls: DiscountableClass): boolean {
  return Boolean(cls.discount_percent)
}

/**
 * For listings with no particular date, like the Classes table. Describes which
 * classes the offer covers rather than pricing a session nobody has chosen.
 */
export function describeDiscountCoverage(cls: DiscountableClass): string | null {
  if (!cls.discount_percent) return null

  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    })

  if (cls.discount_starts_on && cls.discount_ends_on) {
    const start = new Date(cls.discount_starts_on + "T00:00:00")
    const end = new Date(cls.discount_ends_on + "T00:00:00")
    const lastOfMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()
    const wholeMonth =
      start.getDate() === 1 &&
      end.getMonth() === start.getMonth() &&
      end.getDate() === lastOfMonth

    if (wholeMonth) {
      return `${cls.discount_percent}% off ${start.toLocaleDateString("en-GB", { month: "long" })} classes`
    }
    return `${cls.discount_percent}% off classes ${fmt(cls.discount_starts_on)} to ${fmt(cls.discount_ends_on)}`
  }

  if (cls.discount_starts_on) {
    return `${cls.discount_percent}% off classes from ${fmt(cls.discount_starts_on)}`
  }
  if (cls.discount_ends_on) {
    return `${cls.discount_percent}% off classes until ${fmt(cls.discount_ends_on)}`
  }
  return `${cls.discount_percent}% off all classes`
}

/** "£10" for round pounds, "£11.60" otherwise. */
export function formatPrice(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`
}
