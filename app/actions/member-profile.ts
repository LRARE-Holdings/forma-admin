"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getUserRole } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { DASHBOARD_ROLES } from "@/lib/types"

export interface MemberProfileDetail {
  profile: {
    id: string
    full_name: string | null
    email: string | null
    phone: string | null
    date_of_birth: string | null
    role: string
    joined_at: string
  }
  stats: {
    total: number
    last30: number
    favourite_class: string | null
  }
  recent_bookings: {
    id: string
    date: string
    status: string
    payment_method: string
    class_name: string
    instructor_name: string
    start_time: string | null
  }[]
}

export async function getMemberProfile(
  profileId: string,
): Promise<{ data?: MemberProfileDetail; error?: string }> {
  const role = await getUserRole()
  // Dashboard roles (owner/admin/manager/reception) or staff (instructors) can view
  const allowed =
    role && (DASHBOARD_ROLES.includes(role) || role === "staff")
  if (!allowed) {
    return { error: "Forbidden" }
  }

  const studioId = await getStudioId()
  const supabase = await createClient()
  const admin = createAdminClient()

  // Confirm the target profile is a member of this studio
  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("role, created_at")
    .eq("studio_id", studioId)
    .eq("profile_id", profileId)
    .single()

  if (!membership) {
    return { error: "Member not found in this studio" }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, email, phone, date_of_birth")
    .eq("id", profileId)
    .single()

  if (!profile) {
    return { error: "Profile not found" }
  }

  // Stats: total confirmed bookings, last 30 days, favourite class
  const today = new Date()
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10)

  const [
    { count: totalCount },
    { count: last30Count },
    { data: bookingsForFavourite },
    { data: recent },
  ] = await Promise.all([
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studioId)
      .eq("profile_id", profileId)
      .eq("status", "confirmed"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studioId)
      .eq("profile_id", profileId)
      .eq("status", "confirmed")
      .gte("date", thirtyDaysAgoStr),
    supabase
      .from("bookings")
      .select("schedule:schedule_id(classes(name))")
      .eq("studio_id", studioId)
      .eq("profile_id", profileId)
      .eq("status", "confirmed"),
    supabase
      .from("bookings")
      .select(
        "id, date, status, payment_method, schedule:schedule_id(start_time, classes(name), instructors(name))",
      )
      .eq("studio_id", studioId)
      .eq("profile_id", profileId)
      .order("date", { ascending: false })
      .limit(10),
  ])

  const classCounts: Record<string, number> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(bookingsForFavourite || []).forEach((b: any) => {
    const sched = Array.isArray(b.schedule) ? b.schedule[0] : b.schedule
    const cls = sched
      ? Array.isArray(sched.classes)
        ? sched.classes[0]
        : sched.classes
      : null
    const name = cls?.name
    if (name) classCounts[name] = (classCounts[name] || 0) + 1
  })
  let favouriteClass: string | null = null
  let favouriteCount = 0
  for (const [name, count] of Object.entries(classCounts)) {
    if (count > favouriteCount) {
      favouriteClass = name
      favouriteCount = count
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentBookings = (recent || []).map((b: any) => {
    const sched = Array.isArray(b.schedule) ? b.schedule[0] : b.schedule
    const cls = sched
      ? Array.isArray(sched.classes)
        ? sched.classes[0]
        : sched.classes
      : null
    const inst = sched
      ? Array.isArray(sched.instructors)
        ? sched.instructors[0]
        : sched.instructors
      : null
    return {
      id: b.id as string,
      date: b.date as string,
      status: b.status as string,
      payment_method: b.payment_method as string,
      class_name: (cls?.name as string) ?? "—",
      instructor_name: (inst?.name as string) ?? "—",
      start_time: (sched?.start_time as string | null) ?? null,
    }
  })

  return {
    data: {
      profile: {
        id: profileId,
        full_name: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        date_of_birth: profile.date_of_birth,
        role: membership.role as string,
        joined_at: membership.created_at as string,
      },
      stats: {
        total: totalCount ?? 0,
        last30: last30Count ?? 0,
        favourite_class: favouriteClass,
      },
      recent_bookings: recentBookings,
    },
  }
}
