"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { stripe } from "@/lib/stripe"

export async function updateMemberEmail(profileId: string, formData: FormData) {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const email = (formData.get("email") as string)?.trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid email address is required")
  }

  // Verify this member belongs to the current studio and get current email
  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("id, profiles:profile_id(email)")
    .eq("profile_id", profileId)
    .eq("studio_id", studioId)
    .single()

  if (!membership) throw new Error("Member not found in this studio")

  const currentEmail = (membership.profiles as unknown as { email: string | null })?.email
  if (currentEmail?.toLowerCase() === email) {
    throw new Error("New email is the same as the current one")
  }

  const adminClient = createAdminClient()

  // Update the auth user's email (skip confirmation — admin is authoritative)
  const { error: authError } = await adminClient.auth.admin.updateUserById(
    profileId,
    { email, email_confirm: true }
  )

  if (authError) {
    if (authError.message.toLowerCase().includes("already been registered")) {
      throw new Error("Another account is already using this email address")
    }
    throw new Error(authError.message)
  }

  // Keep profiles table in sync — if this fails, roll back the auth change
  const { error: profileError } = await adminClient
    .from("profiles")
    .update({ email })
    .eq("id", profileId)

  if (profileError) {
    // Roll back auth email to keep things consistent
    await adminClient.auth.admin.updateUserById(
      profileId,
      { email: currentEmail ?? "", email_confirm: true }
    )
    throw new Error("Failed to update profile — email has been reverted")
  }

  revalidatePath("/dashboard/members")
}

/**
 * Remove a member from this studio.
 * Cancels active Stripe subscriptions, cancels waitlist entries,
 * and deletes the studio_memberships row. Booking history is preserved.
 */
export async function deleteMember(
  profileId: string
): Promise<{ error?: string }> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()
  const adminClient = createAdminClient()

  // Verify member belongs to this studio
  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("id")
    .eq("profile_id", profileId)
    .eq("studio_id", studioId)
    .eq("role", "member")
    .single()

  if (!membership) return { error: "Member not found in this studio" }

  // Cancel any active Stripe subscriptions for this member at this studio
  const { data: activeMemberships } = await adminClient
    .from("memberships")
    .select("id, stripe_subscription_id")
    .eq("studio_id", studioId)
    .eq("profile_id", profileId)
    .eq("status", "active")

  if (activeMemberships && activeMemberships.length > 0) {
    // Get the studio's connected Stripe account
    const { data: studio } = await adminClient
      .from("studios")
      .select("stripe_account_id")
      .eq("id", studioId)
      .single()

    for (const sub of activeMemberships) {
      if (sub.stripe_subscription_id && studio?.stripe_account_id) {
        try {
          await stripe.subscriptions.cancel(sub.stripe_subscription_id, {
            stripeAccount: studio.stripe_account_id as string,
          })
        } catch (err) {
          console.error("[deleteMember] Stripe cancel failed:", err)
        }
      }

      await adminClient
        .from("memberships")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", sub.id)
    }
  }

  // Cancel any active waitlist entries
  await adminClient
    .from("waitlist")
    .update({ status: "cancelled" })
    .eq("profile_id", profileId)
    .eq("studio_id", studioId)
    .in("status", ["waiting", "offered"])

  // Delete the studio membership (removes them from this studio)
  const { error } = await adminClient
    .from("studio_memberships")
    .delete()
    .eq("id", membership.id)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/members")
  return {}
}
