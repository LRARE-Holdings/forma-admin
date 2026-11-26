"use server"

import { runAction } from "@/lib/action-result"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { localDateStr } from "@/lib/utils"

const VALID_INVITE_ROLES = ["staff", "reception", "manager", "admin"]
const INSTRUCTOR_ROLES = ["staff"]

type AnySupabaseClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createAdminClient>

/**
 * Create an instructor record, resolving slug collisions.
 *
 * `instructors` has UNIQUE (studio_id, slug) and the slug is derived from the
 * person's name, so a second "Sarah Smith" collides. Previously the insert
 * error was discarded, which left a staff member with a membership but no
 * instructor row — they could never be assigned to the timetable, and nothing
 * surfaced the failure.
 */
async function insertInstructorRecord(
  client: AnySupabaseClient,
  studioId: string,
  profileId: string,
  name: string
): Promise<{ error?: string }> {
  // Someone coming back keeps their old record (and its photo and bio)
  // rather than getting a second one.
  const { data: existing, error: lookupError } = await client
    .from("instructors")
    .select("id, archived_at")
    .eq("studio_id", studioId)
    .eq("profile_id", profileId)
    .maybeSingle()
  if (lookupError) return { error: lookupError.message }
  if (existing) {
    if (!existing.archived_at) return {}
    const { error } = await client
      .from("instructors")
      .update({ archived_at: null })
      .eq("id", existing.id)
    return error ? { error: error.message } : {}
  }

  const base =
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "instructor"

  for (let attempt = 1; attempt <= 10; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`
    const { error } = await client.from("instructors").insert({
      studio_id: studioId,
      profile_id: profileId,
      name,
      slug,
      bio: "",
    })

    if (!error) return {}
    // 23505 = unique violation → slug taken, try the next suffix
    if (error.code !== "23505") return { error: error.message }
  }

  return {
    error: `Could not create an instructor record for ${name} — too many similar names`,
  }
}

const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]

function formatShortDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}

/**
 * Classes an instructor is still down to teach from today on, as lines like
 * "Tuesdays 18:40 · Infrared Pilates (until 31 Dec)".
 *
 * Removing someone who still has classes would leave those classes on the
 * timetable with nobody to teach them, so removal is refused until they are
 * reassigned (the Sep 2026 "no instructor" incident).
 */
async function upcomingTeaching(
  client: AnySupabaseClient,
  studioId: string,
  instructorId: string
): Promise<string[]> {
  // Go by the timetable itself: active schedule slots with this instructor,
  // whose rule (if any) still runs from today on. Counting rules instead was
  // wrong: a rule that never got a slot shows nowhere, yet it blocked
  // removing Takkiya (Nov 2026) for a Tuesday class that didn't exist.
  const today = localDateStr()
  const { data, error } = await client
    .from("schedule")
    .select("day_of_week, start_time, rule_id, classes(name), schedule_rules(is_active, ends_on)")
    .eq("studio_id", studioId)
    .eq("instructor_id", instructorId)
    .eq("is_active", true)
    .order("day_of_week")
    .order("start_time")
  if (error) throw new Error(error.message)

  const lines: string[] = []
  for (const slot of data ?? []) {
    const rule = (Array.isArray(slot.schedule_rules) ? slot.schedule_rules[0] : slot.schedule_rules) as
      | { is_active: boolean; ends_on: string | null }
      | null
    if (slot.rule_id && (!rule || !rule.is_active || (rule.ends_on && rule.ends_on < today))) continue
    const cls = (Array.isArray(slot.classes) ? slot.classes[0] : slot.classes) as { name: string } | null
    const until = rule?.ends_on ? ` (until ${formatShortDate(rule.ends_on)})` : ""
    const line = `${WEEKDAYS[slot.day_of_week as number]} ${(slot.start_time as string).slice(0, 5)} · ${cls?.name ?? "Class"}${until}`
    if (!lines.includes(line)) lines.push(line)
  }
  return lines
}

/** What the Remove button needs to know before it asks to confirm. */
export async function getInstructorRemovalCheck(instructorId: string) {
  return runAction(async () => {
    await requireAdmin()
    const studioId = await getStudioId()
    const supabase = await createClient()
    return { upcoming: await upcomingTeaching(supabase, studioId, instructorId) }
  })
}

async function archiveInstructorRow(
  client: AnySupabaseClient,
  studioId: string,
  match: { id: string } | { profile_id: string }
) {
  const query = client
    .from("instructors")
    .update({ archived_at: new Date().toISOString() })
    .eq("studio_id", studioId)
    .is("archived_at", null)
  const { error } = "id" in match
    ? await query.eq("id", match.id)
    : await query.eq("profile_id", match.profile_id)
  if (error) throw new Error(error.message)
}

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

  // Get current user for invited_by tracking
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

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

  // Create instructor record for instructor roles, or if "also instructor" was checked
  const alsoInstructor = formData.get("alsoInstructor") === "true"
  if (INSTRUCTOR_ROLES.includes(role) || alsoInstructor) {
    const { error: instructorError } = await insertInstructorRecord(
      adminClient,
      studioId,
      userId,
      name
    )
    if (instructorError) return { error: instructorError }
  }

  // Track the invite so the admin can see pending/accepted status
  if (currentUser) {
    await adminClient.from("admin_invites").insert({
      studio_id: studioId,
      email,
      name,
      role,
      invited_by: currentUser.id,
    })
  }

  // The invite email is sent by the send-email edge function (Supabase Auth hook)
  // which reads studio_id and invite_role from user_metadata for branding + role label

  revalidatePath("/dashboard/team")
  return {}
}

export async function removeStaffMember(membershipId: string) {
  return runAction(async () => {
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

    // Their instructor record is archived, not deleted: past classes point at
    // it, so a delete fails (it used to, silently, leaving people on the site).
    const { data: instructor } = await supabase
      .from("instructors")
      .select("id, name")
      .eq("profile_id", membership.profile_id)
      .eq("studio_id", studioId)
      .is("archived_at", null)
      .maybeSingle()

    if (instructor) {
      const upcoming = await upcomingTeaching(supabase, studioId, instructor.id)
      if (upcoming.length > 0) {
        throw new Error(
          `${instructor.name} still teaches ${upcoming.length} class${upcoming.length === 1 ? "" : "es"} on the timetable. Reassign them first.`
        )
      }
      await archiveInstructorRow(supabase, studioId, { id: instructor.id })
    }

    // Remove membership
    const { error: membershipError } = await supabase
      .from("studio_memberships")
      .delete()
      .eq("id", membershipId)
      .eq("studio_id", studioId)
    if (membershipError) throw new Error(membershipError.message)

    revalidatePath("/dashboard/team")
    revalidatePath("/dashboard/timetable")
  })
}

export async function updateStaffRole(
  membershipId: string,
  newRole: string
): Promise<{ error: string } | undefined> {
  return runAction(async () => {
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
        .is("archived_at", null)
        .maybeSingle()

      if (!existing) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", membership.profile_id)
          .single()

        const name = profile?.full_name ?? "Instructor"

        const { error: instructorError } = await insertInstructorRecord(
          supabase,
          studioId,
          membership.profile_id,
          name
        )
        if (instructorError) return { error: instructorError }
      }
    }

    revalidatePath("/dashboard/team")
  })
}

export async function resendInvite(
  inviteId: string
): Promise<{ error?: string }> {
  await requireAdmin()
  const studioId = await getStudioId()

  const adminClient = createAdminClient()
  const supabase = await createClient()

  // Fetch the invite
  const { data: invite } = await supabase
    .from("admin_invites")
    .select("email, name, role, status")
    .eq("id", inviteId)
    .eq("studio_id", studioId)
    .single()

  if (!invite) return { error: "Invite not found" }
  if (invite.status !== "pending") return { error: "Invite is no longer pending" }

  // Get studio info for redirect
  const { data: studio } = await supabase
    .from("studios")
    .select("name, admin_domain")
    .eq("id", studioId)
    .single()

  const redirectTo = studio?.admin_domain
    ? `https://${studio.admin_domain}/auth/callback`
    : undefined

  // Re-send the invite via Supabase Auth
  const { error: authError } =
    await adminClient.auth.admin.inviteUserByEmail(invite.email, {
      data: {
        full_name: invite.name,
        studio_id: studioId,
        invite_role: invite.role,
      },
      redirectTo,
    })

  if (authError) return { error: authError.message }

  // Reset the expiry
  await adminClient
    .from("admin_invites")
    .update({ expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
    .eq("id", inviteId)
    .eq("studio_id", studioId)

  revalidatePath("/dashboard/team")
  return {}
}

export async function revokeInvite(
  inviteId: string
): Promise<{ error?: string }> {
  await requireAdmin()
  const studioId = await getStudioId()

  const adminClient = createAdminClient()
  const supabase = await createClient()

  // Fetch the invite
  const { data: invite } = await supabase
    .from("admin_invites")
    .select("email, status")
    .eq("id", inviteId)
    .eq("studio_id", studioId)
    .single()

  if (!invite) return { error: "Invite not found" }
  if (invite.status !== "pending") return { error: "Invite is no longer pending" }

  // Find the auth user by email via profiles (avoids listUsers pagination limits)
  const { data: profile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", invite.email)
    .maybeSingle()

  if (profile) {
    const { data: authUserData } = await adminClient.auth.admin.getUserById(profile.id)
    // A real customer, not just the account the invite created: they've
    // signed in, or they have bookings or packs (members carried over from the
    // old system may never have signed in).
    const [{ count: bookingCount }, { count: packCount }] = await Promise.all([
      adminClient.from("bookings").select("id", { count: "exact", head: true }).eq("profile_id", profile.id),
      adminClient.from("class_packs").select("id", { count: "exact", head: true }).eq("profile_id", profile.id),
    ])
    const hasSignedIn =
      !!authUserData?.user?.last_sign_in_at || (bookingCount ?? 0) > 0 || (packCount ?? 0) > 0

    // Their instructor record, if the invite made one. Same rules as removing
    // a team member: refuse while they're down to teach upcoming classes,
    // archive if past classes point at it, delete only if nothing does.
    // (Deleting used to cascade to their timetable rows, or fail silently
    // where those rows had bookings.)
    let instructorKept = false
    const { data: instructor } = await adminClient
      .from("instructors")
      .select("id, name")
      .eq("profile_id", profile.id)
      .eq("studio_id", studioId)
      .is("archived_at", null)
      .maybeSingle()
    if (instructor) {
      try {
        const upcoming = await upcomingTeaching(adminClient, studioId, instructor.id)
        if (upcoming.length > 0) {
          return {
            error: `${instructor.name} is already down to teach ${upcoming.length} class${upcoming.length === 1 ? "" : "es"}. Reassign them on the timetable before cancelling the invite.`,
          }
        }
        const [{ count: slots }, { count: rules }] = await Promise.all([
          adminClient.from("schedule").select("id", { count: "exact", head: true }).eq("instructor_id", instructor.id),
          adminClient.from("schedule_rules").select("id", { count: "exact", head: true }).eq("instructor_id", instructor.id),
        ])
        if ((slots ?? 0) + (rules ?? 0) > 0) {
          await archiveInstructorRow(adminClient, studioId, { id: instructor.id })
          instructorKept = true
        } else {
          const { error } = await adminClient.from("instructors").delete().eq("id", instructor.id)
          if (error) return { error: error.message }
        }
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Could not update the instructor record" }
      }
    }

    if (hasSignedIn) {
      // An existing customer (often a member who was invited onto the team):
      // take the staff role away but keep them at the studio as a member.
      // This used to delete their membership outright.
      const { error } = await adminClient
        .from("studio_memberships")
        .update({ role: "member" })
        .eq("profile_id", profile.id)
        .eq("studio_id", studioId)
      if (error) return { error: error.message }
    } else {
      const { error } = await adminClient
        .from("studio_memberships")
        .delete()
        .eq("profile_id", profile.id)
        .eq("studio_id", studioId)
      if (error) return { error: error.message }

      // Never signed in: remove the account the invite created, unless an
      // archived instructor record still needs the profile.
      if (!instructorKept && authUserData?.user) {
        await adminClient.auth.admin.deleteUser(profile.id)
        await adminClient.from("profiles").delete().eq("id", profile.id)
      }
    }
  }

  // Delete the invite record
  await adminClient
    .from("admin_invites")
    .delete()
    .eq("id", inviteId)
    .eq("studio_id", studioId)

  revalidatePath("/dashboard/team")
  return {}
}

export async function updateInstructor(instructorId: string, formData: FormData) {
  return runAction(async () => {
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
  })
}

/**
 * Self-edit: lets an instructor update their own bio and photo.
 * No admin check — validates the record belongs to the current user.
 * Name is admin-controlled, so it's not editable here.
 */
export async function updateOwnInstructorProfile(formData: FormData) {
  return runAction(async () => {
    const studioId = await getStudioId()
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) throw new Error("Not authenticated")

    // Verify the instructor record belongs to the current user
    const { data: instructor } = await supabase
      .from("instructors")
      .select("id")
      .eq("studio_id", studioId)
      .eq("profile_id", user.id)
      .single()

    if (!instructor) throw new Error("No instructor record found")

    const bio = (formData.get("bio") as string) ?? ""
    const photo_url = formData.get("photo_url") as string | null

    const updates: Record<string, unknown> = { bio }
    if (photo_url !== null) updates.photo_url = photo_url

    const { error } = await supabase
      .from("instructors")
      .update(updates)
      .eq("id", instructor.id)
      .eq("studio_id", studioId)

    if (error) throw new Error(error.message)
    revalidatePath("/staff")
    revalidatePath("/dashboard/team")
  })
}

/**
 * Toggle instructor record for a team member.
 * Admin-only. Creates or removes an instructor record for any role.
 * Staff members always have instructor records and cannot be toggled off.
 */
export async function toggleInstructorRecord(
  membershipId: string,
  shouldBeInstructor: boolean
): Promise<{ error?: string }> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("profile_id, role")
    .eq("id", membershipId)
    .eq("studio_id", studioId)
    .single()

  if (!membership) return { error: "Membership not found" }

  if (shouldBeInstructor) {
    // Check if a live instructor record already exists (an archived one is
    // brought back by insertInstructorRecord)
    const { data: existing } = await supabase
      .from("instructors")
      .select("id")
      .eq("profile_id", membership.profile_id)
      .eq("studio_id", studioId)
      .is("archived_at", null)
      .maybeSingle()

    if (!existing) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", membership.profile_id)
        .single()

      const name = profile?.full_name ?? "Instructor"

      const { error: instructorError } = await insertInstructorRecord(
        supabase,
        studioId,
        membership.profile_id,
        name
      )
      if (instructorError) return { error: instructorError }
    }
  } else {
    // Staff members are always instructors — don't allow removal
    if (membership.role === "staff") {
      return { error: "Staff members are always instructors" }
    }
    const { data: instructor } = await supabase
      .from("instructors")
      .select("id, name")
      .eq("profile_id", membership.profile_id)
      .eq("studio_id", studioId)
      .is("archived_at", null)
      .maybeSingle()
    if (instructor) {
      try {
        const upcoming = await upcomingTeaching(supabase, studioId, instructor.id)
        if (upcoming.length > 0) {
          return { error: `${instructor.name} still teaches ${upcoming.length} class${upcoming.length === 1 ? "" : "es"}. Reassign them on the timetable first.` }
        }
        await archiveInstructorRow(supabase, studioId, { id: instructor.id })
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Could not update the instructor record" }
      }
    }
  }

  revalidatePath("/dashboard/team")
  return {}
}

/**
 * Remove an instructor who has no team membership (someone whose login was
 * removed before instructor records were archived). Same rules as removing a
 * team member: refused while they still have classes.
 */
export async function archiveInstructor(instructorId: string) {
  return runAction(async () => {
    await requireAdmin()
    const studioId = await getStudioId()
    const supabase = await createClient()

    const { data: instructor } = await supabase
      .from("instructors")
      .select("id, name")
      .eq("id", instructorId)
      .eq("studio_id", studioId)
      .maybeSingle()
    if (!instructor) throw new Error("Instructor not found")

    const upcoming = await upcomingTeaching(supabase, studioId, instructor.id)
    if (upcoming.length > 0) {
      throw new Error(`${instructor.name} still teaches ${upcoming.length} class${upcoming.length === 1 ? "" : "es"}. Reassign them on the timetable first.`)
    }
    await archiveInstructorRow(supabase, studioId, { id: instructor.id })

    revalidatePath("/dashboard/team")
    revalidatePath("/dashboard/timetable")
  })
}

/** The "Show on website" switch: whether the public team section lists them. */
export async function setInstructorOnSite(instructorId: string, show: boolean) {
  return runAction(async () => {
    await requireAdmin()
    const studioId = await getStudioId()
    const supabase = await createClient()

    const { error } = await supabase
      .from("instructors")
      .update({ show_on_site: show })
      .eq("id", instructorId)
      .eq("studio_id", studioId)
    if (error) throw new Error(error.message)

    revalidatePath("/dashboard/team")
  })
}
