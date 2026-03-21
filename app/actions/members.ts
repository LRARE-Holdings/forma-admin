"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"

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
