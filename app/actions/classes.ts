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

export async function createClass(formData: FormData) {
  await requireAdmin()
  const supabase = await createClient()

  const name = formData.get("name") as string
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const description = (formData.get("description") as string) ?? ""
  const duration_mins = parseInt(formData.get("duration_mins") as string)
  const price_pence = Math.round(parseFloat(formData.get("price") as string) * 100)
  const capacity = parseInt(formData.get("capacity") as string) || 10

  const { data: cls, error } = await supabase
    .from("classes")
    .insert({
      studio_id: STUDIO_ID,
      name,
      slug,
      description,
      duration_mins,
      price_pence,
      capacity,
    })
    .select("id")
    .single()

  if (error || !cls) throw new Error(error?.message ?? "Failed to create class")

  // Sync to Stripe if connected
  const stripeAccountId = await getStudioStripeAccount()
  if (stripeAccountId) {
    try {
      const product = await createStripeProduct(
        name,
        { type: "drop_in_class", forma_id: cls.id },
        stripeAccountId,
      )
      const price = await createStripePrice(
        { productId: product.id, unitAmount: price_pence, currency: "gbp" },
        stripeAccountId,
      )
      await supabase
        .from("classes")
        .update({ stripe_product_id: product.id, stripe_price_id: price.id })
        .eq("id", cls.id)
    } catch (e) {
      console.error("Failed to sync class to Stripe:", e)
    }
  }

  revalidatePath("/dashboard/classes")
}

export async function updateClass(classId: string, formData: FormData) {
  await requireAdmin()
  const supabase = await createClient()

  const name = formData.get("name") as string
  const description = (formData.get("description") as string) ?? ""
  const duration_mins = parseInt(formData.get("duration_mins") as string)
  const price_pence = Math.round(parseFloat(formData.get("price") as string) * 100)
  const capacity = parseInt(formData.get("capacity") as string) || 10

  // Fetch current class for Stripe sync
  const { data: current } = await supabase
    .from("classes")
    .select("price_pence, stripe_product_id, stripe_price_id")
    .eq("id", classId)
    .eq("studio_id", STUDIO_ID)
    .single()

  const { error } = await supabase
    .from("classes")
    .update({ name, description, duration_mins, price_pence, capacity })
    .eq("id", classId)
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
          .from("classes")
          .update({ stripe_price_id: newPrice.id })
          .eq("id", classId)
      }
    } catch (e) {
      console.error("Failed to sync class update to Stripe:", e)
    }
  }

  revalidatePath("/dashboard/classes")
}

export async function deleteClass(classId: string) {
  await requireAdmin()
  const supabase = await createClient()

  // Check for active schedule slots
  const { data: slots } = await supabase
    .from("schedule")
    .select("id")
    .eq("class_id", classId)
    .eq("is_active", true)
    .limit(1)

  if (slots && slots.length > 0) {
    throw new Error("Cannot delete a class with active schedule slots. Remove the slots first.")
  }

  // Fetch Stripe IDs before deleting
  const { data: cls } = await supabase
    .from("classes")
    .select("stripe_product_id, stripe_price_id")
    .eq("id", classId)
    .eq("studio_id", STUDIO_ID)
    .single()

  const { error } = await supabase
    .from("classes")
    .delete()
    .eq("id", classId)
    .eq("studio_id", STUDIO_ID)

  if (error) throw new Error(error.message)

  // Archive in Stripe
  const stripeAccountId = await getStudioStripeAccount()
  if (stripeAccountId && cls?.stripe_product_id) {
    try {
      if (cls.stripe_price_id) {
        await archiveStripePrice(cls.stripe_price_id as string, stripeAccountId)
      }
      await archiveStripeProduct(cls.stripe_product_id as string, stripeAccountId)
    } catch (e) {
      console.error("Failed to archive class in Stripe:", e)
    }
  }

  revalidatePath("/dashboard/classes")
}
