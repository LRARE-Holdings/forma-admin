import { createClient } from "@/lib/supabase/server"
import { STUDIO_ID } from "@/lib/constants"

/**
 * Get the connected Stripe account ID for the current studio.
 * Returns null if the studio hasn't connected Stripe yet.
 */
export async function getStudioStripeAccount(): Promise<string | null> {
  const supabase = await createClient()

  const { data: studio } = await supabase
    .from("studios")
    .select("stripe_account_id, stripe_onboarding_complete")
    .eq("id", STUDIO_ID)
    .single()

  if (!studio?.stripe_account_id || !studio.stripe_onboarding_complete) {
    return null
  }

  return studio.stripe_account_id as string
}
