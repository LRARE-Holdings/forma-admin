"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getUser, getUserRole } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { ADMIN_ROLES, RECEPTION_ROLES } from "@/lib/types"

/**
 * Check-in at the door, for classes and events.
 *
 * Class codes are a member's personal "forma-member:<checkin_token>" (one per
 * studio membership, shown in their account); event codes are the ticket's
 * "forma-ticket:<id>" from its wallet pass. Neither carries a profile id.
 *
 * Who may check in: an instructor for their own classes; any dashboard role
 * for any class; admins for events. Checked on the server for every call —
 * the dashboard pages are not the security boundary.
 *
 * Every function returns a result rather than throwing: Next.js hides thrown
 * messages in production, and the person at the door needs to see what
 * happened.
 */

type Admin = ReturnType<typeof createAdminClient>

export type WalkInOption = "membership" | "pack_credit" | "complimentary"

export type ClassCheckInResult =
  | { status: "checked_in" | "already_checked_in"; bookingId: string; profileId: string; name: string }
  | {
      status: "not_booked"
      profileId: string
      name: string
      /** What this member could be booked in with, best first */
      options: WalkInOption[]
      classFull: boolean
    }
  | { status: "error"; message: string }

function parseCode(raw: string): { kind: "member" | "ticket"; value: string } | null {
  const text = raw.trim()
  const m = /^forma-(member|ticket):([0-9a-f-]{36})$/i.exec(text)
  if (!m) return null
  return { kind: m[1].toLowerCase() as "member" | "ticket", value: m[2].toLowerCase() }
}

/**
 * May the signed-in user take the register for this class? Returns the slot's
 * class id and capacity when they may.
 */
async function authoriseClass(
  admin: Admin,
  scheduleId: string,
): Promise<
  | { ok: true; studioId: string; classId: string; capacity: number; role: string; canComp: boolean }
  | { ok: false; message: string }
> {
  const [user, studioId, role] = await Promise.all([getUser(), getStudioId(), getUserRole()])
  if (!user || !role) return { ok: false, message: "Please sign in again." }

  const { data: slot } = await admin
    .from("schedule")
    .select("id, class_id, is_active, classes:class_id(capacity), instructors:instructor_id(profile_id)")
    .eq("id", scheduleId)
    .eq("studio_id", studioId)
    .maybeSingle()
  if (!slot) return { ok: false, message: "That class isn't on the timetable." }

  const instructorProfile = (slot.instructors as unknown as { profile_id: string | null } | null)?.profile_id
  const isDashboard = RECEPTION_ROLES.includes(role)
  const isTheirClass = role === "staff" && instructorProfile === user.id
  if (!isDashboard && !isTheirClass) {
    return { ok: false, message: "You can only take the register for your own classes." }
  }

  const capacity = (slot.classes as unknown as { capacity: number | null } | null)?.capacity ?? 10
  return {
    ok: true,
    studioId,
    classId: slot.class_id as string,
    capacity,
    role,
    // A free place is the studio's call, not the instructor's.
    canComp: ADMIN_ROLES.includes(role),
  }
}

async function walkInOptions(
  admin: Admin,
  studioId: string,
  classId: string,
  profileId: string,
  date: string,
  canComp: boolean,
): Promise<WalkInOption[]> {
  const options: WalkInOption[] = []

  // Same rule as the member site: active, and paid up past the class date.
  const { data: membership } = await admin
    .from("memberships")
    .select("id")
    .eq("studio_id", studioId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .gt("current_period_end", `${date}T23:59:59Z`)
    .limit(1)
    .maybeSingle()
  if (membership) options.push("membership")

  if (await findEligiblePack(admin, studioId, classId, profileId)) options.push("pack_credit")
  if (canComp) options.push("complimentary")
  return options
}

/** Oldest valid pack whose tier isn't excluded from this class — the member site's rule. */
async function findEligiblePack(
  admin: Admin,
  studioId: string,
  classId: string,
  profileId: string,
): Promise<string | null> {
  const [{ data: excluded }, { data: packs }] = await Promise.all([
    admin.from("pack_tier_excluded_classes").select("pack_tier_id").eq("class_id", classId),
    admin
      .from("class_packs")
      .select("id, pack_tier_id")
      .eq("studio_id", studioId)
      .eq("profile_id", profileId)
      .gt("credits_remaining", 0)
      .gt("expires_at", new Date().toISOString())
      .order("purchased_at", { ascending: true }),
  ])
  const excludedTiers = new Set((excluded ?? []).map((e) => e.pack_tier_id as string))
  const pack = (packs ?? []).find((p) => !p.pack_tier_id || !excludedTiers.has(p.pack_tier_id as string))
  return (pack?.id as string | undefined) ?? null
}

async function confirmedCount(admin: Admin, scheduleId: string, date: string): Promise<number> {
  const { count } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("schedule_id", scheduleId)
    .eq("date", date)
    .eq("status", "confirmed")
  return count ?? 0
}

function revalidateRegisters(scheduleId: string, date: string) {
  revalidatePath("/dashboard/registration", "layout")
  revalidatePath(`/staff/register/${scheduleId}/${date}`)
  revalidatePath("/staff")
}

// ─── Classes ────────────────────────────────────────────────────────────────

/** A scanned code on a class register. */
export async function checkInClassByCode(
  scheduleId: string,
  date: string,
  code: string,
): Promise<ClassCheckInResult> {
  const admin = createAdminClient()
  const auth = await authoriseClass(admin, scheduleId)
  if (!auth.ok) return { status: "error", message: auth.message }

  const parsed = parseCode(code)
  if (!parsed) return { status: "error", message: "That isn't a Forma check-in code." }
  if (parsed.kind === "ticket") {
    return { status: "error", message: "That's an event ticket — check it in on the event's page." }
  }

  const { data: membership } = await admin
    .from("studio_memberships")
    .select("profile_id, profiles:profile_id(full_name)")
    .eq("checkin_token", parsed.value)
    .eq("studio_id", auth.studioId)
    .maybeSingle()
  if (!membership) return { status: "error", message: "That code isn't recognised at this studio." }

  const profileId = membership.profile_id as string
  const name =
    (membership.profiles as unknown as { full_name: string | null } | null)?.full_name || "Member"

  const { data: booking } = await admin
    .from("bookings")
    .select("id, attendance_status")
    .eq("schedule_id", scheduleId)
    .eq("date", date)
    .eq("profile_id", profileId)
    .eq("status", "confirmed")
    .maybeSingle()

  if (!booking) {
    const [options, count] = await Promise.all([
      walkInOptions(admin, auth.studioId, auth.classId, profileId, date, auth.canComp),
      confirmedCount(admin, scheduleId, date),
    ])
    return { status: "not_booked", profileId, name, options, classFull: count >= auth.capacity }
  }

  if (booking.attendance_status === "attended") {
    return { status: "already_checked_in", bookingId: booking.id as string, profileId, name }
  }

  const user = await getUser()
  const { error } = await admin
    .from("bookings")
    .update({
      attendance_status: "attended",
      attendance_marked_at: new Date().toISOString(),
      attendance_marked_by: user?.id ?? null,
    })
    .eq("id", booking.id)
  if (error) return { status: "error", message: "Couldn't check them in. Please try again." }

  revalidateRegisters(scheduleId, date)
  return { status: "checked_in", bookingId: booking.id as string, profileId, name }
}

/**
 * Book someone in at the door and check them in, with the payment the
 * scanner offered. Refuses a full class.
 */
export async function bookWalkIn(
  scheduleId: string,
  date: string,
  profileId: string,
  method: WalkInOption,
): Promise<{ ok: true; bookingId: string } | { ok: false; message: string }> {
  const admin = createAdminClient()
  const auth = await authoriseClass(admin, scheduleId)
  if (!auth.ok) return { ok: false, message: auth.message }

  if (method === "complimentary" && !auth.canComp) {
    return { ok: false, message: "Only the studio can add a free place." }
  }

  // The member must belong to this studio.
  const { data: member } = await admin
    .from("studio_memberships")
    .select("id")
    .eq("studio_id", auth.studioId)
    .eq("profile_id", profileId)
    .maybeSingle()
  if (!member) return { ok: false, message: "They aren't a member of this studio." }

  if ((await confirmedCount(admin, scheduleId, date)) >= auth.capacity) {
    return { ok: false, message: "This class is full." }
  }

  // Re-check what they can pay with now, rather than trusting the scan result.
  const options = await walkInOptions(admin, auth.studioId, auth.classId, profileId, date, auth.canComp)
  if (!options.includes(method)) {
    return { ok: false, message: "That way of paying isn't available for them any more." }
  }

  const packId =
    method === "pack_credit" ? await findEligiblePack(admin, auth.studioId, auth.classId, profileId) : null
  const user = await getUser()

  const { data: booking, error } = await admin
    .from("bookings")
    .insert({
      studio_id: auth.studioId,
      schedule_id: scheduleId,
      profile_id: profileId,
      date,
      status: "confirmed",
      payment_method: method,
      class_pack_id: packId,
      attendance_status: "attended",
      attendance_marked_at: new Date().toISOString(),
      attendance_marked_by: user?.id ?? null,
    })
    .select("id")
    .single()

  if (error || !booking) {
    if (error?.code === "23505") return { ok: false, message: "They're already booked into this class." }
    // The pack's weekly limit (e.g. Beginner's Course) explains itself.
    if (error?.code === "23514") return { ok: false, message: error.message }
    return { ok: false, message: "Couldn't book them in. Please try again." }
  }

  if (packId) {
    const { error: creditError } = await admin.rpc("spend_pack_credit", {
      p_pack_id: packId,
      p_booking_id: booking.id,
    })
    if (creditError) {
      // Undo rather than leave a booking nobody paid for.
      await admin.from("bookings").delete().eq("id", booking.id)
      return { ok: false, message: "Their pack credit couldn't be used. Please try again." }
    }
  }

  revalidateRegisters(scheduleId, date)
  return { ok: true, bookingId: booking.id as string }
}

// ─── Events ─────────────────────────────────────────────────────────────────

export type EventCheckInResult =
  | {
      status: "checked_in" | "all_checked_in"
      ticketId: string
      name: string
      checkedIn: number
      quantity: number
    }
  | { status: "error"; message: string }

async function authoriseEvent(admin: Admin, eventId: string) {
  const [studioId, role] = await Promise.all([getStudioId(), getUserRole()])
  if (!role || !ADMIN_ROLES.includes(role)) return { ok: false as const, message: "Only the studio can check in event tickets." }
  const { data: event } = await admin
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("studio_id", studioId)
    .maybeSingle()
  if (!event) return { ok: false as const, message: "Event not found." }
  return { ok: true as const, studioId }
}

/** A scanned ticket: checks in the next person on it. */
export async function checkInEventByCode(eventId: string, code: string): Promise<EventCheckInResult> {
  const admin = createAdminClient()
  const auth = await authoriseEvent(admin, eventId)
  if (!auth.ok) return { status: "error", message: auth.message }

  const parsed = parseCode(code)
  if (!parsed) return { status: "error", message: "That isn't a Forma ticket." }
  if (parsed.kind === "member") {
    return { status: "error", message: "That's a member's class code — scan their event ticket instead." }
  }
  return adjust(admin, auth.studioId, eventId, parsed.value, +1)
}

/** Manual check-in (+1) or undo (−1) for one ticket. */
export async function adjustEventCheckIn(
  eventId: string,
  ticketId: string,
  delta: 1 | -1,
): Promise<EventCheckInResult> {
  const admin = createAdminClient()
  const auth = await authoriseEvent(admin, eventId)
  if (!auth.ok) return { status: "error", message: auth.message }
  return adjust(admin, auth.studioId, eventId, ticketId, delta)
}

async function adjust(
  admin: Admin,
  studioId: string,
  eventId: string,
  ticketId: string,
  delta: 1 | -1,
): Promise<EventCheckInResult> {
  const { data: ticket } = await admin
    .from("event_tickets")
    .select("id, event_id, status, quantity, checked_in_count, profiles:profile_id(full_name)")
    .eq("id", ticketId)
    .eq("studio_id", studioId)
    .maybeSingle()

  if (!ticket) return { status: "error", message: "That ticket isn't recognised." }
  if (ticket.event_id !== eventId) return { status: "error", message: "That ticket is for a different event." }
  if (ticket.status !== "confirmed") return { status: "error", message: "That ticket has been cancelled." }

  const name = (ticket.profiles as unknown as { full_name: string | null } | null)?.full_name || "Ticket holder"
  const quantity = ticket.quantity as number
  const current = ticket.checked_in_count as number

  if (delta === 1 && current >= quantity) {
    return { status: "all_checked_in", ticketId, name, checkedIn: current, quantity }
  }
  const next = Math.min(Math.max(current + delta, 0), quantity)

  // Conditional on the count we read, so two scanners at the door can't both
  // let the last person on a ticket in.
  const { data: updated, error } = await admin
    .from("event_tickets")
    .update({ checked_in_count: next, checked_in_at: next > 0 ? new Date().toISOString() : null })
    .eq("id", ticketId)
    .eq("checked_in_count", current)
    .select("id")
  if (error) return { status: "error", message: "Couldn't update the ticket. Please try again." }
  if (!updated || updated.length === 0) {
    return { status: "error", message: "Someone else just updated this ticket — scan it again." }
  }

  revalidatePath(`/dashboard/events/${eventId}`)
  return { status: "checked_in", ticketId, name, checkedIn: next, quantity }
}
