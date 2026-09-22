"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { getStudioStripeAccount } from "@/lib/stripe/account"
import { createStripePrice, archiveStripePrice } from "@/lib/stripe/products"
import { effectivePricePence } from "@/lib/pricing"

/**
 * Time-boxed percentage discounts on individual (drop-in) classes.
 *
 * Class packs are deliberately out of scope — the October promotion is drop-in
 * only, and pack_tiers has no discount column at all, so a pack cannot pick this
 * up by accident.
 *
 * The list price in `price_pence` is never touched. A discount adds a second,
 * cheaper Stripe Price alongside the full-price one; when the window closes the
 * discounted Price is archived and the original is still the one on file.
 */

export interface DiscountResult {
  error?: string
  updated?: number
  stripeWarning?: string
}

/**
 * Apply a discount to the given classes. Passing an empty `classIds` applies it
 * to every class in the studio, which is what a studio-wide promotion means.
 */
export async function setClassDiscount(
  classIds: string[],
  percent: number,
  startsOn: string,
  endsOn: string | null
): Promise<DiscountResult> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  if (!Number.isInteger(percent) || percent <= 0 || percent >= 100) {
    return { error: "The discount must be a whole number between 1 and 99." }
  }
  if (!startsOn) {
    return { error: "Pick a start date for the discount." }
  }
  if (endsOn && endsOn < startsOn) {
    return { error: "The end date must be on or after the start date." }
  }

  let q = supabase
    .from("classes")
    .select("id, name, price_pence, stripe_product_id, discount_stripe_price_id")
    .eq("studio_id", studioId)

  if (classIds.length > 0) q = q.in("id", classIds)

  const { data: classes, error: readError } = await q
  if (readError) return { error: readError.message }
  if (!classes || classes.length === 0) return { error: "No classes to discount." }

  const { error } = await supabase
    .from("classes")
    .update({
      discount_percent: percent,
      discount_starts_on: startsOn,
      discount_ends_on: endsOn,
    })
    .eq("studio_id", studioId)
    .in("id", classes.map((c) => c.id as string))

  if (error) return { error: error.message }

  // Stripe is best-effort, as everywhere else in this codebase: the discount is
  // already recorded, and a failed sync must not roll it back. It is reported
  // rather than swallowed, because a class whose discounted Price is missing
  // would advertise one price and charge another.
  const stripeAccountId = await getStudioStripeAccount()
  const stripeFailures: string[] = []

  if (stripeAccountId) {
    for (const cls of classes) {
      if (!cls.stripe_product_id) continue
      try {
        // Prices are immutable in Stripe, so a changed discount means a new one.
        if (cls.discount_stripe_price_id) {
          await archiveStripePrice(cls.discount_stripe_price_id as string, stripeAccountId)
        }

        const discounted = effectivePricePence(
          {
            price_pence: cls.price_pence as number,
            discount_percent: percent,
            discount_starts_on: null,
            discount_ends_on: null,
          },
          // Unbounded window above, so any date prices the discount itself.
          "2000-01-01"
        )

        const price = await createStripePrice(
          {
            productId: cls.stripe_product_id as string,
            unitAmount: discounted,
            currency: "gbp",
          },
          stripeAccountId
        )

        await supabase
          .from("classes")
          .update({ discount_stripe_price_id: price.id })
          .eq("id", cls.id)
          .eq("studio_id", studioId)
      } catch (e) {
        console.error("[class-discounts] Stripe sync failed for", cls.id, e)
        stripeFailures.push(cls.name as string)
      }
    }
  }

  revalidatePath("/dashboard/classes")

  return {
    updated: classes.length,
    stripeWarning: stripeFailures.length
      ? `Saved, but Stripe did not take the new price for: ${stripeFailures.join(", ")}. Those classes will still charge full price.`
      : undefined,
  }
}

/** Remove the discount and archive the discounted Stripe Prices. */
export async function clearClassDiscount(classIds: string[]): Promise<DiscountResult> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  let q = supabase
    .from("classes")
    .select("id, discount_stripe_price_id")
    .eq("studio_id", studioId)
    .not("discount_percent", "is", null)

  if (classIds.length > 0) q = q.in("id", classIds)

  const { data: classes, error: readError } = await q
  if (readError) return { error: readError.message }
  if (!classes || classes.length === 0) return { updated: 0 }

  const { error } = await supabase
    .from("classes")
    .update({
      discount_percent: null,
      discount_starts_on: null,
      discount_ends_on: null,
      discount_stripe_price_id: null,
    })
    .eq("studio_id", studioId)
    .in("id", classes.map((c) => c.id as string))

  if (error) return { error: error.message }

  const stripeAccountId = await getStudioStripeAccount()
  if (stripeAccountId) {
    for (const cls of classes) {
      if (!cls.discount_stripe_price_id) continue
      try {
        await archiveStripePrice(cls.discount_stripe_price_id as string, stripeAccountId)
      } catch (e) {
        console.error("[class-discounts] Failed to archive discounted price", cls.id, e)
      }
    }
  }

  revalidatePath("/dashboard/classes")
  return { updated: classes.length }
}
