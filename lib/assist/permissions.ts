import type { UserRole } from "@/lib/types"
import { ADMIN_ROLES, MANAGER_ROLES, RECEPTION_ROLES } from "@/lib/types"

/**
 * Maps roles to the set of Assist tools they can use.
 *
 * - owner/admin: full CRUD on everything
 * - manager: schedule, bookings, members CRUD; read-only classes/packs
 * - reception: read bookings/members, create manual bookings
 * - staff: read own schedule + attendees only
 */

/** All tools available in Forma Assist */
export type AssistToolName =
  // Read tools
  | "list_classes"
  | "list_schedule"
  | "list_bookings"
  | "list_members"
  | "get_member_packs"
  | "list_pack_tiers"
  | "list_instructors"
  | "get_studio_stats"
  | "list_at_risk_members"
  // Admin write tools
  | "create_class"
  | "update_class"
  | "delete_class"
  | "create_schedule_slot"
  | "update_schedule_slot"
  | "delete_schedule_slot"
  | "create_booking"
  | "cancel_booking"
  | "create_pack_tier"
  | "update_pack_tier"
  | "delete_pack_tier"
  | "invite_staff"
  // Staff-only scoped tools
  | "my_schedule"
  | "my_class_attendees"
  | "my_stats"

const ADMIN_TOOLS: AssistToolName[] = [
  "list_classes",
  "list_schedule",
  "list_bookings",
  "list_members",
  "get_member_packs",
  "list_pack_tiers",
  "list_instructors",
  "get_studio_stats",
  "list_at_risk_members",
  "create_class",
  "update_class",
  "delete_class",
  "create_schedule_slot",
  "update_schedule_slot",
  "delete_schedule_slot",
  "create_booking",
  "cancel_booking",
  "create_pack_tier",
  "update_pack_tier",
  "delete_pack_tier",
  "invite_staff",
]

const MANAGER_TOOLS: AssistToolName[] = [
  "list_classes",
  "list_schedule",
  "list_bookings",
  "list_members",
  "get_member_packs",
  "list_pack_tiers",
  "list_instructors",
  "get_studio_stats",
  "list_at_risk_members",
  "create_schedule_slot",
  "update_schedule_slot",
  "delete_schedule_slot",
  "create_booking",
  "cancel_booking",
]

const RECEPTION_TOOLS: AssistToolName[] = [
  "list_classes",
  "list_schedule",
  "list_bookings",
  "list_members",
  "get_member_packs",
  "list_pack_tiers",
  "list_instructors",
  "get_studio_stats",
  "list_at_risk_members",
  "create_booking",
  "cancel_booking",
]

const STAFF_TOOLS: AssistToolName[] = [
  "my_schedule",
  "my_class_attendees",
  "my_stats",
]

export function getToolsForRole(role: UserRole): AssistToolName[] {
  if (ADMIN_ROLES.includes(role)) return ADMIN_TOOLS
  if (MANAGER_ROLES.includes(role)) return MANAGER_TOOLS
  if (RECEPTION_ROLES.includes(role)) return RECEPTION_TOOLS
  if (role === "staff") return STAFF_TOOLS
  return []
}

/** Returns true if the given role is allowed to use the given tool */
export function isToolAllowed(role: UserRole, tool: AssistToolName): boolean {
  return getToolsForRole(role).includes(tool)
}

/** Tools that mutate data — these require user confirmation in the UI */
export const MUTATION_TOOLS: AssistToolName[] = [
  "create_class",
  "update_class",
  "delete_class",
  "create_schedule_slot",
  "update_schedule_slot",
  "delete_schedule_slot",
  "create_booking",
  "cancel_booking",
  "create_pack_tier",
  "update_pack_tier",
  "delete_pack_tier",
  "invite_staff",
]

export function isMutationTool(tool: AssistToolName): boolean {
  return MUTATION_TOOLS.includes(tool)
}
