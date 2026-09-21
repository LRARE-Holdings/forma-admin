import { localDateStr } from "@/lib/utils"

/**
 * What a drop-in class costs today.
 *
 * `price_pence` is always the list price. A discount is a dated overlay on top
 * of it, so the promotion lapses by itself and the original price is still there
 * on the other side — which is why this is not simply stored as a reduced
 * price_pence.
 *
 * These rules are mirrored by the `classes_with_pricing` view in
 * `supabase/migrations/20260921_06_class_discounts.sql`. Change one and the
 * other has to change with it, or the dashboard and the public site will quote
 * different prices for the same class.
 */

export interface DiscountableClass {
  price_pence: number
  discount_percent: number | null
  discount_starts_on: string | null
  discount_ends_on: string | null
}

export function isDiscountActive(
  cls: DiscountableClass,
  today: string = localDateStr()
): boolean {
  if (!cls.discount_percent) return false
  if (cls.discount_starts_on && cls.discount_starts_on > today) return false
  if (cls.discount_ends_on && cls.discount_ends_on < today) return false
  return true
}

/** True once a discount is set but its window has not opened yet. */
export function isDiscountScheduled(
  cls: DiscountableClass,
  today: string = localDateStr()
): boolean {
  return Boolean(
    cls.discount_percent && cls.discount_starts_on && cls.discount_starts_on > today
  )
}

export function effectivePricePence(
  cls: DiscountableClass,
  today: string = localDateStr()
): number {
  if (!isDiscountActive(cls, today)) return cls.price_pence
  // Rounded to the penny, matching round() in the SQL view. £12.50 less 20%
  // is £10.00; £14.50 less 20% is £11.60.
  return Math.round((cls.price_pence * (100 - cls.discount_percent!)) / 100)
}

/** "£10" for round pounds, "£11.60" otherwise — the public site's convention. */
export function formatPrice(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`
}

/** "1–31 Oct" / "from 1 Oct" / "until 31 Oct" */
export function describeDiscountWindow(cls: DiscountableClass): string | null {
  if (!cls.discount_percent) return null

  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    })

  if (cls.discount_starts_on && cls.discount_ends_on) {
    return `${fmt(cls.discount_starts_on)} – ${fmt(cls.discount_ends_on)}`
  }
  if (cls.discount_starts_on) return `from ${fmt(cls.discount_starts_on)}`
  if (cls.discount_ends_on) return `until ${fmt(cls.discount_ends_on)}`
  return "ongoing"
}
