import { createClient } from "@/lib/supabase/server"
import { getUser } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { PageHeader } from "@/components/shared/page-header"
import { TeamGrid } from "@/components/dashboard/team-grid"

export default async function TeamPage() {
  const user = await getUser()
  const supabase = await createClient()
  const studioId = await getStudioId()

  // Fetch all non-member staff memberships (owner, admin, manager, reception, staff)
  const { data: staffMemberships } = await supabase
    .from("studio_memberships")
    .select("id, profile_id, role, profiles:profile_id(full_name, email)")
    .eq("studio_id", studioId)
    .neq("role", "member")

  // Fetch instructors
  const { data: instructors } = await supabase
    .from("instructors")
    .select("*")
    .eq("studio_id", studioId)
    .order("name")

  // Get schedule slots per instructor to show their classes
  const { data: scheduleSlots } = await supabase
    .from("schedule")
    .select("instructor_id, classes:class_id(name)")
    .eq("studio_id", studioId)
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

  // Build a reverse lookup: profileId → instructor record
  const instructorByProfileId: Record<string, typeof instructors extends (infer T)[] | null ? T : never> = {}
  for (const inst of instructors ?? []) {
    if (inst.profile_id) {
      instructorByProfileId[inst.profile_id as string] = inst
    }
  }

  // Build team from memberships (single source of truth for roles)
  const seenInstructorIds = new Set<string>()
  const team: {
    id: string
    name: string
    bio: string
    photo_url: string | null
    profile_id: string | null
    membershipId: string | null
    role: string
    classNames: string
    hasInstructorRecord: boolean
  }[] = []

  for (const sm of staffMemberships ?? []) {
    const profile = sm.profiles as unknown as { full_name: string | null; email: string | null } | null
    const inst = instructorByProfileId[sm.profile_id]

    if (inst) {
      seenInstructorIds.add(inst.id as string)
      const classes = classesByInstructor[inst.id as string]
      team.push({
        id: inst.id as string,
        name: (inst.name as string) || profile?.full_name || profile?.email || "Unknown",
        bio: (inst.bio as string) ?? "",
        photo_url: (inst.photo_url as string) ?? null,
        profile_id: sm.profile_id,
        membershipId: sm.id,
        role: sm.role,
        classNames: classes ? Array.from(classes).join(", ") : "No classes assigned",
        hasInstructorRecord: true,
      })
    } else {
      team.push({
        id: sm.id,
        name: profile?.full_name ?? profile?.email ?? "Unknown",
        bio: "",
        photo_url: null,
        profile_id: sm.profile_id,
        membershipId: sm.id,
        role: sm.role,
        classNames: "",
        hasInstructorRecord: false,
      })
    }
  }

  // Add orphaned instructor records (no linked profile/membership)
  for (const inst of instructors ?? []) {
    if (seenInstructorIds.has(inst.id as string)) continue
    const classes = classesByInstructor[inst.id as string]
    team.push({
      id: inst.id as string,
      name: inst.name as string,
      bio: (inst.bio as string) ?? "",
      photo_url: (inst.photo_url as string) ?? null,
      profile_id: (inst.profile_id as string) ?? null,
      membershipId: null,
      role: "staff",
      classNames: classes ? Array.from(classes).join(", ") : "No classes assigned",
      hasInstructorRecord: true,
    })
  }

  // Fetch pending invites
  const { data: pendingInvites } = await supabase
    .from("admin_invites")
    .select("id, email, name, role, created_at, expires_at")
    .eq("studio_id", studioId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })

  return (
    <>
      <PageHeader
        title="Team"
        description="Manage your studio team and their roles."
      />
      <TeamGrid
        team={team}
        currentProfileId={user?.id ?? null}
        pendingInvites={pendingInvites ?? []}
      />
    </>
  )
}
