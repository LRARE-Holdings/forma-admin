import { stripe } from "./index"
import type Stripe from "stripe"

/**
 * Create a Stripe Product on a connected account.
 */
export async function createStripeProduct(
  name: string,
  metadata: Record<string, string>,
  stripeAccountId: string,
) {
  return stripe.products.create(
    { name, metadata },
    { stripeAccount: stripeAccountId },
  )
}

/**
 * Update a Stripe Product on a connected account.
 */
export async function updateStripeProduct(
  productId: string,
  updates: Stripe.ProductUpdateParams,
  stripeAccountId: string,
) {
  return stripe.products.update(productId, updates, {
    stripeAccount: stripeAccountId,
  })
}

/**
 * Archive (deactivate) a Stripe Product on a connected account.
 */
export async function archiveStripeProduct(
  productId: string,
  stripeAccountId: string,
) {
  return stripe.products.update(
    productId,
    { active: false },
    { stripeAccount: stripeAccountId },
  )
}

/**
 * Create a Stripe Price on a connected account.
 * For one-time products (packs, drop-ins), omit `recurring`.
 * For memberships, pass `recurring: { interval, interval_count }`.
 */
export async function createStripePrice(
  params: {
    productId: string
    unitAmount: number
    currency: string
    recurring?: { interval: Stripe.PriceCreateParams.Recurring.Interval; interval_count?: number }
  },
  stripeAccountId: string,
) {
  return stripe.prices.create(
    {
      product: params.productId,
      unit_amount: params.unitAmount,
      currency: params.currency,
      ...(params.recurring ? { recurring: params.recurring } : {}),
    },
    { stripeAccount: stripeAccountId },
  )
}

/**
 * Archive (deactivate) a Stripe Price on a connected account.
 * Stripe prices are immutable — you can only deactivate them.
 */
export async function archiveStripePrice(
  priceId: string,
  stripeAccountId: string,
) {
  return stripe.prices.update(
    priceId,
    { active: false },
    { stripeAccount: stripeAccountId },
  )
}
