"use server"

import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import {
  createConnectedAccount,
  createAccountLink,
  getAccountStatus,
} from "@/lib/stripe/connect"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

/**
 * Start Stripe Connect onboarding for the current studio.
 * Creates a Standard connected account (if needed) and returns the onboarding URL.
 */
export async function startStripeOnboarding() {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Fetch current studio
  const { data: studio, error: studioError } = await supabase
    .from("studios")
    .select("id, name, stripe_account_id, stripe_onboarding_complete")
    .eq("id", studioId)
    .single()

  if (studioError || !studio) throw new Error("Studio not found")

  let accountId = studio.stripe_account_id as string | null

  // Create connected account if one doesn't exist yet
  if (!accountId) {
    // Get the admin's email for the account
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) throw new Error("No email found for current user")

    const account = await createConnectedAccount(
      studio.name as string,
      user.email,
    )
    accountId = account.id

    // Store the account ID
    const { error: updateError } = await supabase
      .from("studios")
      .update({ stripe_account_id: accountId })
      .eq("id", studioId)

    if (updateError) throw new Error(updateError.message)
  }

  // Generate the onboarding link
  const headersList = await headers()
  const origin = headersList.get("origin") || headersList.get("x-forwarded-host") || "http://localhost:3000"
  const baseUrl = origin.startsWith("http") ? origin : `https://${origin}`

  const link = await createAccountLink(
    accountId,
    `${baseUrl}/api/stripe/connect?account_id=${accountId}`,
    `${baseUrl}/dashboard/settings`,
  )

  return { url: link.url }
}

/**
 * Check the current Stripe Connect status and update the DB if complete.
 */
export async function checkStripeStatus() {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { data: studio } = await supabase
    .from("studios")
    .select("stripe_account_id, stripe_onboarding_complete")
    .eq("id", studioId)
    .single()

  if (!studio?.stripe_account_id) {
    return { connected: false, onboardingComplete: false }
  }

  const status = await getAccountStatus(studio.stripe_account_id as string)

  // Update DB if status changed
  if (status.isComplete && !studio.stripe_onboarding_complete) {
    await supabase
      .from("studios")
      .update({ stripe_onboarding_complete: true })
      .eq("id", studioId)

    revalidatePath("/dashboard/settings")
  }

  return {
    connected: true,
    onboardingComplete: status.isComplete,
    chargesEnabled: status.chargesEnabled,
    payoutsEnabled: status.payoutsEnabled,
  }
}
