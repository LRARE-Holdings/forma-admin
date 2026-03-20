"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

const VALID_INVITE_ROLES = ["staff", "reception", "manager", "admin"]
const INSTRUCTOR_ROLES = ["staff"]

const ROLE_LABELS: Record<string, string> = {
  staff: "an instructor",
  reception: "a reception team member",
  manager: "a manager",
  admin: "an admin",
}

export async function inviteStaffMember(formData: FormData) {
  await requireAdmin()
  const studioId = await getStudioId()

  const name = formData.get("name") as string
  const email = formData.get("email") as string
  const role = (formData.get("role") as string) || "staff"

  if (!name || !email) {
    throw new Error("Name and email are required")
  }
  if (!VALID_INVITE_ROLES.includes(role)) {
    throw new Error("Invalid role")
  }

  const adminClient = createAdminClient()
  const supabase = await createClient()

  // Get studio info for email branding and admin domain
  const { data: studio } = await supabase
    .from("studios")
    .select("name, email_from, email_domain, admin_domain")
    .eq("id", studioId)
    .single()

  // Build redirect URL so the invite link routes to the admin portal
  const redirectTo = studio?.admin_domain
    ? `https://${studio.admin_domain}/auth/callback`
    : undefined

  // Create auth user with invite
  const { data: authUser, error: authError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: name },
      redirectTo,
    })

  if (authError) throw new Error(authError.message)
  if (!authUser.user) throw new Error("Failed to create user")

  const userId = authUser.user.id

  // Create profile
  await adminClient.from("profiles").upsert({
    id: userId,
    full_name: name,
    email,
  })

  // Create studio membership with selected role
  await adminClient.from("studio_memberships").insert({
    studio_id: studioId,
    profile_id: userId,
    role,
  })

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

  // Send welcome email
  if (studio?.email_from) {
    const roleLabel = ROLE_LABELS[role] ?? "a team member"
    try {
      await resend.emails.send({
        from: `${studio.name} <${studio.email_from}>`,
        to: email,
        subject: `Welcome to ${studio.name}!`,
        html: `
          <h2>Hi ${name},</h2>
          <p>You've been invited as ${roleLabel} at ${studio.name}.</p>
          <p>Check your email for a sign-in link to set up your account.</p>
        `,
      })
    } catch {
      // Email sending is best-effort
    }
  }

  revalidatePath("/dashboard/team")
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
