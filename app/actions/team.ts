"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"

const VALID_INVITE_ROLES = ["staff", "reception", "manager", "admin"]
const INSTRUCTOR_ROLES = ["staff"]

export async function inviteStaffMember(
  formData: FormData
): Promise<{ error?: string }> {
  await requireAdmin()
  const studioId = await getStudioId()

  const name = formData.get("name") as string
  const email = formData.get("email") as string
  const role = (formData.get("role") as string) || "staff"

  if (!name || !email) {
    return { error: "Name and email are required" }
  }
  if (!VALID_INVITE_ROLES.includes(role)) {
    return { error: "Invalid role" }
  }

  const adminClient = createAdminClient()
  const supabase = await createClient()

  // Get studio info for admin domain redirect
  const { data: studio } = await supabase
    .from("studios")
    .select("name, admin_domain")
    .eq("id", studioId)
    .single()

  // Build redirect URL so the invite link routes to the admin portal
  const redirectTo = studio?.admin_domain
    ? `https://${studio.admin_domain}/auth/callback`
    : undefined

  // Create auth user with invite — pass studio_id and role in metadata
  // so the send-email edge function can brand the email and show the role
  const { data: authUser, error: authError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: name, studio_id: studioId, role, invite_role: role },
      redirectTo,
    })

  if (authError) return { error: authError.message }
  if (!authUser.user) return { error: "Failed to create user" }

  const userId = authUser.user.id

  // Create profile
  await adminClient.from("profiles").upsert({
    id: userId,
    full_name: name,
    email,
  })

  // Create studio membership with selected role
  // Use upsert because the handle_new_user() trigger may have already
  // inserted a row with role='member' — we need to overwrite it
  await adminClient.from("studio_memberships").upsert(
    { studio_id: studioId, profile_id: userId, role },
    { onConflict: "studio_id,profile_id" }
  )

  // Only create instructor record for instructor roles
  if (INSTRUCTOR_ROLES.includes(role)) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    await adminClient.from("instructors").insert({
      studio_id: studioId,
      profile_id: userId,
      name,
      slug,
      bio: "",
    })
  }

  // The invite email is sent by the send-email edge function (Supabase Auth hook)
  // which reads studio_id and invite_role from user_metadata for branding + role label

  revalidatePath("/dashboard/team")
  return {}
}

export async function removeStaffMember(membershipId: string) {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Get the membership to find the profile_id and role
  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("profile_id, role")
    .eq("id", membershipId)
    .eq("studio_id", studioId)
    .single()

  if (!membership) throw new Error("Membership not found")

  // Prevent removing the owner
  if (membership.role === "owner") {
    throw new Error("Cannot remove the studio owner")
  }

  // Delete instructor record if they have one
  await supabase
    .from("instructors")
    .delete()
    .eq("profile_id", membership.profile_id)
    .eq("studio_id", studioId)

  // Remove membership
  await supabase
    .from("studio_memberships")
    .delete()
    .eq("id", membershipId)
    .eq("studio_id", studioId)

  revalidatePath("/dashboard/team")
}

export async function updateStaffRole(membershipId: string, newRole: string) {
  await requireAdmin()
  const studioId = await getStudioId()

  if (!VALID_INVITE_ROLES.includes(newRole)) {
    throw new Error("Invalid role")
  }

  const supabase = await createClient()

  // Fetch current membership
  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("id, profile_id, role")
    .eq("id", membershipId)
    .eq("studio_id", studioId)
    .single()

  if (!membership) throw new Error("Membership not found")
  if (membership.role === "owner") throw new Error("Cannot change the owner's role")
  if (membership.role === newRole) return

  // Update the role
  const { error } = await supabase
    .from("studio_memberships")
    .update({ role: newRole })
    .eq("id", membershipId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)

  // If changing to "staff", ensure an instructor record exists
  if (newRole === "staff") {
    const { data: existing } = await supabase
      .from("instructors")
      .select("id")
      .eq("profile_id", membership.profile_id)
      .eq("studio_id", studioId)
      .maybeSingle()

    if (!existing) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", membership.profile_id)
        .single()

      const name = profile?.full_name ?? "Instructor"
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

      await supabase.from("instructors").insert({
        studio_id: studioId,
        profile_id: membership.profile_id,
        name,
        slug,
        bio: "",
      })
    }
  }

  revalidatePath("/dashboard/team")
}

export async function updateInstructor(instructorId: string, formData: FormData) {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const name = formData.get("name") as string
  const bio = (formData.get("bio") as string) ?? ""
  const photo_url = formData.get("photo_url") as string | null

  const updates: Record<string, unknown> = { name, bio }
  if (photo_url !== null) updates.photo_url = photo_url

  const { error } = await supabase
    .from("instructors")
    .update(updates)
    .eq("id", instructorId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)
  revalidatePath("/dashboard/team")
}
