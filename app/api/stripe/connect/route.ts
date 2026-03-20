import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAccountStatus } from "@/lib/stripe/connect"
import { getStudioId } from "@/lib/studio-context"
import {
  createStripeProduct,
  createStripePrice,
} from "@/lib/stripe/products"

/**
 * GET /api/stripe/connect
 *
 * Return URL after Stripe Connect onboarding.
 * Checks account status, updates DB, and syncs any existing products.
 */
export async function GET(request: NextRequest) {
  const studioId = await getStudioId()
  const accountId = request.nextUrl.searchParams.get("account_id")

  if (!accountId) {
    return NextResponse.redirect(new URL("/dashboard/settings", request.url))
  }

  try {
    const status = await getAccountStatus(accountId)
    const supabase = createAdminClient()

    if (status.isComplete) {
      // Mark onboarding as complete
      await supabase
        .from("studios")
        .update({ stripe_onboarding_complete: true })
        .eq("id", studioId)

      // Bulk-sync any existing products that don't have Stripe IDs yet
      await syncExistingProducts(supabase, accountId, studioId)
    }

    return NextResponse.redirect(new URL("/dashboard/settings", request.url))
  } catch {
    return NextResponse.redirect(new URL("/dashboard/settings", request.url))
  }
}

/**
 * When a studio first connects Stripe, sync all existing DB products
 * (pack tiers, classes, membership tiers) to their connected Stripe account.
 */
async function syncExistingProducts(
  supabase: ReturnType<typeof createAdminClient>,
  stripeAccountId: string,
  studioId: string,
) {
  // Sync pack tiers
  const { data: packTiers } = await supabase
    .from("pack_tiers")
    .select("*")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .is("stripe_product_id", null)

  for (const tier of packTiers ?? []) {
    try {
      const product = await createStripeProduct(
        tier.name as string,
        { type: "pack_tier", forma_id: tier.id as string },
        stripeAccountId,
      )
      const price = await createStripePrice(
        {
          productId: product.id,
          unitAmount: tier.price_pence as number,
          currency: "gbp",
        },
        stripeAccountId,
      )
      await supabase
        .from("pack_tiers")
        .update({ stripe_product_id: product.id, stripe_price_id: price.id })
        .eq("id", tier.id)
    } catch (e) {
      console.error(`Failed to sync pack tier ${tier.id}:`, e)
    }
  }

  // Sync classes
  const { data: classes } = await supabase
    .from("classes")
    .select("*")
    .eq("studio_id", studioId)
    .is("stripe_product_id", null)

  for (const cls of classes ?? []) {
    try {
      const product = await createStripeProduct(
        cls.name as string,
        { type: "drop_in_class", forma_id: cls.id as string },
        stripeAccountId,
      )
      const price = await createStripePrice(
        {
          productId: product.id,
          unitAmount: cls.price_pence as number,
          currency: "gbp",
        },
        stripeAccountId,
      )
      await supabase
        .from("classes")
        .update({ stripe_product_id: product.id, stripe_price_id: price.id })
        .eq("id", cls.id)
    } catch (e) {
      console.error(`Failed to sync class ${cls.id}:`, e)
    }
  }

  // Sync membership tiers
  const { data: membershipTiers } = await supabase
    .from("membership_tiers")
    .select("*")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .is("stripe_product_id", null)

  for (const tier of membershipTiers ?? []) {
    try {
      const product = await createStripeProduct(
        tier.name as string,
        { type: "membership", forma_id: tier.id as string },
        stripeAccountId,
      )
      const price = await createStripePrice(
        {
          productId: product.id,
          unitAmount: tier.price_pence as number,
          currency: "gbp",
          recurring: {
            interval: tier.interval as "month" | "year" | "week",
            interval_count: tier.interval_count as number,
          },
        },
        stripeAccountId,
      )
      await supabase
        .from("membership_tiers")
        .update({ stripe_product_id: product.id, stripe_price_id: price.id })
        .eq("id", tier.id)
    } catch (e) {
      console.error(`Failed to sync membership tier ${tier.id}:`, e)
    }
  }
}
