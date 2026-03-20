import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { STUDIO_ID } from "@/lib/constants"
import {
  DASHBOARD_ROLES,
  ADMIN_ROLES,
  MANAGER_ROLES,
  RECEPTION_ROLES,
} from "@/lib/types"
import type { UserRole } from "@/lib/types"

export async function getUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function getUserRole(
  studioId: string = STUDIO_ID
): Promise<UserRole | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("role")
    .eq("studio_id", studioId)
    .eq("profile_id", user.id)
    .single()

  return (membership?.role as UserRole) ?? null
}

/**
 * Require owner or admin role. Used for team management, settings, classes, packs.
 */
export async function requireAdmin(studioId: string = STUDIO_ID) {
  const role = await getUserRole(studioId)
  if (!role || !ADMIN_ROLES.includes(role)) {
    redirect("/login")
  }
  return role
}

/**
 * Require at least manager role. Used for schedule CRUD, bookings CRUD, members CRUD.
 */
export async function requireManager(studioId: string = STUDIO_ID) {
  const role = await getUserRole(studioId)
  if (!role || !MANAGER_ROLES.includes(role)) {
    redirect("/login")
  }
  return role
}

/**
 * Require at least reception role. Used for viewing bookings/members and creating manual bookings.
 */
export async function requireReception(studioId: string = STUDIO_ID) {
  const role = await getUserRole(studioId)
  if (!role || !RECEPTION_ROLES.includes(role)) {
    redirect("/login")
  }
  return role
}

/**
 * Require any dashboard role (owner, admin, manager, reception).
 */
export async function requireDashboard(studioId: string = STUDIO_ID) {
  const role = await getUserRole(studioId)
  if (!role || !DASHBOARD_ROLES.includes(role)) {
    redirect("/login")
  }
  return role
}

/**
 * Require staff or higher — used for the staff (instructor) layout.
 */
export async function requireStaff(studioId: string = STUDIO_ID) {
  const role = await getUserRole(studioId)
  if (role !== "owner" && role !== "admin" && role !== "staff") {
    redirect("/login")
  }
  return role
}

export async function getInstructorForUser(studioId: string = STUDIO_ID) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: instructor } = await supabase
    .from("instructors")
    .select("*")
    .eq("studio_id", studioId)
    .eq("profile_id", user.id)
    .single()

  return instructor
}
