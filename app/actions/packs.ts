"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { getStudioStripeAccount } from "@/lib/stripe/account"
import {
  createStripeProduct,
  createStripePrice,
  updateStripeProduct,
  archiveStripePrice,
  archiveStripeProduct,
} from "@/lib/stripe/products"

// --- Pack Tier CRUD ---

export async function createPackTier(formData: FormData) {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const name = formData.get("name") as string
  const credits = parseInt(formData.get("credits") as string)
  const price_pence = Math.round(parseFloat(formData.get("price") as string) * 100)
  const validity_days = parseInt(formData.get("validity_days") as string)

  if (!name || !credits || !price_pence || !validity_days) {
    throw new Error("All fields are required")
  }

  // Insert into DB first
  const { data: tier, error } = await supabase
    .from("pack_tiers")
    .insert({
      studio_id: studioId,
      name,
      credits,
      price_pence,
      validity_days,
      is_active: true,
    })
    .select("id")
    .single()

  if (error || !tier) throw new Error(error?.message ?? "Failed to create pack tier")

  // Sync to Stripe if connected
  const stripeAccountId = await getStudioStripeAccount()
  if (stripeAccountId) {
    try {
      const product = await createStripeProduct(
        name,
        { type: "pack_tier", forma_id: tier.id, credits: String(credits) },
        stripeAccountId,
      )
      const price = await createStripePrice(
        { productId: product.id, unitAmount: price_pence, currency: "gbp" },
        stripeAccountId,
      )
      await supabase
        .from("pack_tiers")
        .update({ stripe_product_id: product.id, stripe_price_id: price.id })
        .eq("id", tier.id)
    } catch (e) {
      console.error("Failed to sync pack tier to Stripe:", e)
      // Don't throw — the tier exists in DB, Stripe sync can be retried
    }
  }

  revalidatePath("/dashboard/packages")
}

export async function updatePackTier(tierId: string, formData: FormData) {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const name = formData.get("name") as string
  const credits = parseInt(formData.get("credits") as string)
  const price_pence = Math.round(parseFloat(formData.get("price") as string) * 100)
  const validity_days = parseInt(formData.get("validity_days") as string)

  // Fetch current tier to detect price changes
  const { data: current } = await supabase
    .from("pack_tiers")
    .select("price_pence, stripe_product_id, stripe_price_id")
    .eq("id", tierId)
    .eq("studio_id", studioId)
    .single()

  // Update DB
  const { error } = await supabase
    .from("pack_tiers")
    .update({ name, credits, price_pence, validity_days })
    .eq("id", tierId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)

  // Sync to Stripe if connected and has Stripe IDs
  const stripeAccountId = await getStudioStripeAccount()
  if (stripeAccountId && current?.stripe_product_id) {
    try {
      // Always update product name
      await updateStripeProduct(
        current.stripe_product_id as string,
        { name },
        stripeAccountId,
      )

      // If price changed, archive old price and create new one
      if (current.price_pence !== price_pence && current.stripe_price_id) {
        await archiveStripePrice(current.stripe_price_id as string, stripeAccountId)
        const newPrice = await createStripePrice(
          {
            productId: current.stripe_product_id as string,
            unitAmount: price_pence,
            currency: "gbp",
          },
          stripeAccountId,
        )
        await supabase
          .from("pack_tiers")
          .update({ stripe_price_id: newPrice.id })
          .eq("id", tierId)
      }
    } catch (e) {
      console.error("Failed to sync pack tier update to Stripe:", e)
    }
  }

  revalidatePath("/dashboard/packages")
}

export async function deletePackTier(tierId: string) {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Fetch Stripe IDs before archiving
  const { data: tier } = await supabase
    .from("pack_tiers")
    .select("stripe_product_id, stripe_price_id")
    .eq("id", tierId)
    .eq("studio_id", studioId)
    .single()

  // Soft-delete in DB
  const { error } = await supabase
    .from("pack_tiers")
    .update({ is_active: false })
    .eq("id", tierId)
    .eq("studio_id", studioId)

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
      console.error("Failed to archive pack tier in Stripe:", e)
    }
  }

  revalidatePath("/dashboard/packages")
}

// --- Member Credits ---

export async function addMemberCredits(formData: FormData) {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const profile_id = formData.get("profile_id") as string
  const credits = parseInt(formData.get("credits") as string)
  const validity_days = parseInt(formData.get("validity_days") as string) || 42

  if (!profile_id || !credits) {
    throw new Error("Member and credits are required")
  }

  const expires_at = new Date()
  expires_at.setDate(expires_at.getDate() + validity_days)

  const { error } = await supabase.from("class_packs").insert({
    studio_id: studioId,
    profile_id,
    pack_type: "manual",
    credits_total: credits,
    credits_remaining: credits,
    purchased_at: new Date().toISOString(),
    expires_at: expires_at.toISOString(),
    stripe_session_id: null,
  })

  if (error) throw new Error(error.message)
  revalidatePath("/dashboard/members")
  revalidatePath("/dashboard/bookings")
}

export async function adjustMemberCredits(packId: string, formData: FormData) {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const credits_remaining = parseInt(formData.get("credits_remaining") as string)

  if (isNaN(credits_remaining) || credits_remaining < 0) {
    throw new Error("Invalid credits value")
  }

  const { error } = await supabase
    .from("class_packs")
    .update({ credits_remaining })
    .eq("id", packId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)
  revalidatePath("/dashboard/members")
  revalidatePath("/dashboard/bookings")
}
