import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import {
  DASHBOARD_ROLES,
  ADMIN_ROLES,
  MANAGER_ROLES,
  RECEPTION_ROLES,
} from "@/lib/types"
import type { UserRole } from "@/lib/types"

// React cache() deduplicates within a single server render pass.
// Layout + page both call getUser() but only 1 actual auth round-trip fires.
export const getUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

export async function getUserRole(
  studioId?: string
): Promise<UserRole | null> {
  const resolvedStudioId = studioId ?? (await getStudioId())
  const user = await getUser()

  if (!user) return null

  const supabase = await createClient()
  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("role")
    .eq("studio_id", resolvedStudioId)
    .eq("profile_id", user.id)
    .single()

  return (membership?.role as UserRole) ?? null
}

/**
 * Require owner or admin role. Used for team management, settings, classes, packs.
 */
export async function requireAdmin(studioId?: string) {
  const role = await getUserRole(studioId)
  if (!role || !ADMIN_ROLES.includes(role)) {
    redirect("/login")
  }
  return role
}

/**
 * Require at least manager role. Used for schedule CRUD, bookings CRUD, members CRUD.
 */
export async function requireManager(studioId?: string) {
  const role = await getUserRole(studioId)
  if (!role || !MANAGER_ROLES.includes(role)) {
    redirect("/login")
  }
  return role
}

/**
 * Require at least reception role. Used for viewing bookings/members and creating manual bookings.
 */
export async function requireReception(studioId?: string) {
  const role = await getUserRole(studioId)
  if (!role || !RECEPTION_ROLES.includes(role)) {
    redirect("/login")
  }
  return role
}

/**
 * Require any dashboard role (owner, admin, manager, reception).
 */
export async function requireDashboard(studioId?: string) {
  const role = await getUserRole(studioId)
  if (!role || !DASHBOARD_ROLES.includes(role)) {
    redirect("/login")
  }
  return role
}

/**
 * Require staff or higher — used for the staff (instructor) layout.
 */
export async function requireStaff(studioId?: string) {
  const role = await getUserRole(studioId)
  if (role !== "owner" && role !== "admin" && role !== "staff") {
    redirect("/login")
  }
  return role
}

/**
 * Check if the current user has an instructor record that needs initial setup
 * (empty bio AND no photo). Used to redirect to the profile setup page after invite.
 */
export async function instructorNeedsSetup(studioId?: string): Promise<boolean> {
  const instructor = await getInstructorForUser(studioId)
  if (!instructor) return false
  return (!instructor.bio || instructor.bio.trim() === "") && !instructor.photo_url
}

export async function getInstructorForUser(studioId?: string) {
  const resolvedStudioId = studioId ?? (await getStudioId())
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: instructor } = await supabase
    .from("instructors")
    .select("*")
    .eq("studio_id", resolvedStudioId)
    .eq("profile_id", user.id)
    .single()

  return instructor
}
