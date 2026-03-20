import { createClient } from "@/lib/supabase/server"
import { STUDIO_ID } from "@/lib/constants"
import { PageHeader } from "@/components/shared/page-header"
import { TeamGrid } from "@/components/dashboard/team-grid"

export default async function TeamPage() {
  const supabase = await createClient()

  // Fetch all non-member staff memberships (owner, admin, manager, reception, staff)
  const { data: staffMemberships } = await supabase
    .from("studio_memberships")
    .select("id, profile_id, role, profiles:profile_id(full_name, email)")
    .eq("studio_id", STUDIO_ID)
    .neq("role", "member")

  // Fetch instructors
  const { data: instructors } = await supabase
    .from("instructors")
    .select("*")
    .eq("studio_id", STUDIO_ID)
    .order("name")

  // Get schedule slots per instructor to show their classes
  const { data: scheduleSlots } = await supabase
    .from("schedule")
    .select("instructor_id, classes:class_id(name)")
    .eq("studio_id", STUDIO_ID)
    .eq("is_active", true)

  const classesByInstructor: Record<string, Set<string>> = {}
  for (const slot of scheduleSlots ?? []) {
    const cls = slot.classes as unknown as { name: string } | null
    if (cls) {
      if (!classesByInstructor[slot.instructor_id]) {
        classesByInstructor[slot.instructor_id] = new Set()
      }
      classesByInstructor[slot.instructor_id].add(cls.name)
    }
  }

  // Build lookup maps
  const membershipByProfileId: Record<string, { id: string; role: string }> = {}
  for (const sm of staffMemberships ?? []) {
    membershipByProfileId[sm.profile_id] = { id: sm.id, role: sm.role }
  }

  // Build team list: start with instructor records, then add non-instructor memberships
  const seenProfileIds = new Set<string>()
  const team: {
    id: string
    name: string
    bio: string
    photo_url: string | null
    profile_id: string | null
    membershipId: string | null
    role: string
    classNames: string
  }[] = []

  // Add instructors first
  for (const instructor of instructors ?? []) {
    const profileId = instructor.profile_id as string | null
    if (profileId) seenProfileIds.add(profileId)

    const classes = classesByInstructor[instructor.id as string]
    const classNames = classes ? Array.from(classes).join(", ") : "No classes assigned"
    const membership = profileId ? membershipByProfileId[profileId] : null

    team.push({
      id: instructor.id as string,
      name: instructor.name as string,
      bio: (instructor.bio as string) ?? "",
      photo_url: (instructor.photo_url as string) ?? null,
      profile_id: profileId,
      membershipId: membership?.id ?? null,
      role: membership?.role ?? "staff",
      classNames,
    })
  }

  // Add non-instructor staff (manager, reception, admins without instructor records)
  for (const sm of staffMemberships ?? []) {
    if (seenProfileIds.has(sm.profile_id)) continue
    seenProfileIds.add(sm.profile_id)

    const profile = sm.profiles as unknown as { full_name: string | null; email: string | null } | null

    team.push({
      id: sm.id,
      name: profile?.full_name ?? profile?.email ?? "Unknown",
      bio: "",
      photo_url: null,
      profile_id: sm.profile_id,
      membershipId: sm.id,
      role: sm.role,
      classNames: "",
    })
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="Manage your studio team and their roles."
      />
      <TeamGrid team={team} />
    </>
  )
}
