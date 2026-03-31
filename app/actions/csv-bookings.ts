"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireReception } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"

export interface MatchResult {
  email: string
  firstName: string
  lastName: string
  profileId: string | null
  fullName: string | null
  alreadyBooked: boolean
}

/**
 * Preview step: match CSV emails against profiles and check for existing bookings.
 */
export async function matchCsvEmails(
  members: { email: string; firstName: string; lastName: string }[],
  scheduleId: string,
  date: string
): Promise<MatchResult[]> {
  await requireReception()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const emails = members.map((m) => m.email.toLowerCase())

  // Look up profiles by email
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("email", emails)

  const profileMap = new Map(
    (profiles ?? []).map((p) => [
      (p.email as string).toLowerCase(),
      { id: p.id as string, fullName: p.full_name as string },
    ])
  )

  // Filter to only profiles that are members of this studio
  const profileIds = [...profileMap.values()].map((p) => p.id)
  const { data: studioMembers } = await supabase
    .from("studio_memberships")
    .select("profile_id")
    .eq("studio_id", studioId)
    .in("profile_id", profileIds)

  const studioMemberIds = new Set(
    (studioMembers ?? []).map((m) => m.profile_id as string)
  )

  // Check existing bookings for this slot+date
  const { data: existingBookings } = await supabase
    .from("bookings")
    .select("profile_id")
    .eq("schedule_id", scheduleId)
    .eq("date", date)
    .eq("status", "confirmed")

  const bookedIds = new Set(
    (existingBookings ?? []).map((b) => b.profile_id as string)
  )

  return members.map((m) => {
    const email = m.email.toLowerCase()
    const profile = profileMap.get(email)
    const isStudioMember = profile ? studioMemberIds.has(profile.id) : false

    return {
      email,
      firstName: m.firstName,
      lastName: m.lastName,
      profileId: isStudioMember ? profile!.id : null,
      fullName: isStudioMember ? profile!.fullName : null,
      alreadyBooked: isStudioMember ? bookedIds.has(profile!.id) : false,
    }
  })
}

/**
 * Confirm step: create complimentary bookings for matched members.
 * Re-runs matching server-side for safety.
 */
export async function importCsvBookings(
  emails: string[],
  scheduleId: string,
  date: string
): Promise<{ created: number; skippedAlreadyBooked: number; skippedNotFound: number }> {
  await requireReception()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const lowerEmails = emails.map((e) => e.toLowerCase())

  // Look up profiles
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email")
    .in("email", lowerEmails)

  const profileMap = new Map(
    (profiles ?? []).map((p) => [
      (p.email as string).toLowerCase(),
      p.id as string,
    ])
  )

  // Filter to studio members
  const profileIds = [...profileMap.values()]
  const { data: studioMembers } = await supabase
    .from("studio_memberships")
    .select("profile_id")
    .eq("studio_id", studioId)
    .in("profile_id", profileIds)

  const studioMemberIds = new Set(
    (studioMembers ?? []).map((m) => m.profile_id as string)
  )

  // Check existing bookings
  const { data: existingBookings } = await supabase
    .from("bookings")
    .select("profile_id")
    .eq("schedule_id", scheduleId)
    .eq("date", date)
    .eq("status", "confirmed")

  const bookedIds = new Set(
    (existingBookings ?? []).map((b) => b.profile_id as string)
  )

  // Build insert batch
  const toCreate: { studio_id: string; schedule_id: string; profile_id: string; date: string; status: string; payment_method: string }[] = []
  let skippedAlreadyBooked = 0
  let skippedNotFound = 0

  for (const email of lowerEmails) {
    const profileId = profileMap.get(email)
    if (!profileId || !studioMemberIds.has(profileId)) {
      skippedNotFound++
      continue
    }
    if (bookedIds.has(profileId)) {
      skippedAlreadyBooked++
      continue
    }
    toCreate.push({
      studio_id: studioId,
      schedule_id: scheduleId,
      profile_id: profileId,
      date,
      status: "confirmed",
      payment_method: "complimentary",
    })
  }

  if (toCreate.length > 0) {
    const { error } = await supabase.from("bookings").insert(toCreate)
    if (error) throw new Error(error.message)
  }

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard/bookings")
  revalidatePath("/dashboard")

  return {
    created: toCreate.length,
    skippedAlreadyBooked,
    skippedNotFound,
  }
}
