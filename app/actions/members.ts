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

  // Verify this member belongs to the current studio
  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("id")
    .eq("profile_id", profileId)
    .eq("studio_id", studioId)
    .single()

  if (!membership) throw new Error("Member not found in this studio")

  const adminClient = createAdminClient()

  // Update the auth user's email (skip confirmation — admin is authoritative)
  const { error: authError } = await adminClient.auth.admin.updateUserById(
    profileId,
    { email, email_confirm: true }
  )

  if (authError) throw new Error(authError.message)

  // Keep profiles table in sync
  const { error: profileError } = await adminClient
    .from("profiles")
    .update({ email })
    .eq("id", profileId)

  if (profileError) throw new Error(profileError.message)

  revalidatePath("/dashboard/members")
}
