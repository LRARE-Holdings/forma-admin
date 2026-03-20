"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth"
import { STUDIO_ID } from "@/lib/constants"
import { getStudioStripeAccount } from "@/lib/stripe/account"
import {
  createStripeProduct,
  createStripePrice,
  updateStripeProduct,
  archiveStripePrice,
  archiveStripeProduct,
} from "@/lib/stripe/products"
import type { BillingInterval } from "@/lib/types"

export async function createMembershipTier(formData: FormData) {
  await requireAdmin()
  const supabase = await createClient()

  const name = formData.get("name") as string
  const description = (formData.get("description") as string) ?? ""
  const price_pence = Math.round(parseFloat(formData.get("price") as string) * 100)
  const interval = (formData.get("interval") as BillingInterval) || "month"
  const interval_count = parseInt(formData.get("interval_count") as string) || 1

  if (!name || !price_pence) {
    throw new Error("Name and price are required")
  }

  const { data: tier, error } = await supabase
    .from("membership_tiers")
    .insert({
      studio_id: STUDIO_ID,
      name,
      description,
      price_pence,
      interval,
      interval_count,
      is_active: true,
    })
    .select("id")
    .single()

  if (error || !tier) throw new Error(error?.message ?? "Failed to create membership tier")

  // Sync to Stripe if connected
  const stripeAccountId = await getStudioStripeAccount()
  if (stripeAccountId) {
    try {
      const product = await createStripeProduct(
        name,
        { type: "membership", forma_id: tier.id },
        stripeAccountId,
      )
      const price = await createStripePrice(
        {
          productId: product.id,
          unitAmount: price_pence,
          currency: "gbp",
          recurring: { interval, interval_count },
        },
        stripeAccountId,
      )
      await supabase
        .from("membership_tiers")
        .update({ stripe_product_id: product.id, stripe_price_id: price.id })
        .eq("id", tier.id)
    } catch (e) {
      console.error("Failed to sync membership tier to Stripe:", e)
    }
  }

  revalidatePath("/dashboard/memberships")
}

export async function updateMembershipTier(tierId: string, formData: FormData) {
  await requireAdmin()
  const supabase = await createClient()

  const name = formData.get("name") as string
  const description = (formData.get("description") as string) ?? ""
  const price_pence = Math.round(parseFloat(formData.get("price") as string) * 100)
  const interval = (formData.get("interval") as BillingInterval) || "month"
  const interval_count = parseInt(formData.get("interval_count") as string) || 1

  // Fetch current tier for Stripe sync
  const { data: current } = await supabase
    .from("membership_tiers")
    .select("price_pence, interval, interval_count, stripe_product_id, stripe_price_id")
    .eq("id", tierId)
    .eq("studio_id", STUDIO_ID)
    .single()

  const { error } = await supabase
    .from("membership_tiers")
    .update({ name, description, price_pence, interval, interval_count })
    .eq("id", tierId)
    .eq("studio_id", STUDIO_ID)

  if (error) throw new Error(error.message)

  // Sync to Stripe
  const stripeAccountId = await getStudioStripeAccount()
  if (stripeAccountId && current?.stripe_product_id) {
    try {
      await updateStripeProduct(
        current.stripe_product_id as string,
        { name, description },
        stripeAccountId,
      )

      // If price or interval changed, archive old price and create new one
      const priceChanged = current.price_pence !== price_pence
      const intervalChanged =
        current.interval !== interval || current.interval_count !== interval_count

      if ((priceChanged || intervalChanged) && current.stripe_price_id) {
        await archiveStripePrice(current.stripe_price_id as string, stripeAccountId)
        const newPrice = await createStripePrice(
          {
            productId: current.stripe_product_id as string,
            unitAmount: price_pence,
            currency: "gbp",
            recurring: { interval, interval_count },
          },
          stripeAccountId,
        )
        await supabase
          .from("membership_tiers")
          .update({ stripe_price_id: newPrice.id })
          .eq("id", tierId)
      }
    } catch (e) {
      console.error("Failed to sync membership tier update to Stripe:", e)
    }
  }

  revalidatePath("/dashboard/memberships")
}

export async function deleteMembershipTier(tierId: string) {
  await requireAdmin()
  const supabase = await createClient()

  // Fetch Stripe IDs before archiving
  const { data: tier } = await supabase
    .from("membership_tiers")
    .select("stripe_product_id, stripe_price_id")
    .eq("id", tierId)
    .eq("studio_id", STUDIO_ID)
    .single()

  const { error } = await supabase
    .from("membership_tiers")
    .update({ is_active: false })
    .eq("id", tierId)
    .eq("studio_id", STUDIO_ID)

  if (error) throw new Error(error.message)

  // Archive in Stripe
  const stripeAccountId = await getStudioStripeAccount()
  if (stripeAccountId && tier?.stripe_product_id) {
    try {
      if (tier.stripe_price_id) {
        await archiveStripePrice(tier.stripe_price_id as string, stripeAccountId)
      }
      await archiveStripeProduct(tier.stripe_product_id as string, stripeAccountId)
    } catch (e) {
      console.error("Failed to archive membership tier in Stripe:", e)
    }
  }

  revalidatePath("/dashboard/memberships")
}
