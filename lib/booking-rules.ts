import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Booking rules shared by every way the dashboard books someone in (manual
 * bookings, walk-ins at check-in). They mirror the member site's
 * lib/booking-helpers.ts, so a member can't be booked here onto a pack the
 * website would refuse, or into a class the website shows as full.
 */

export type EligiblePack =
  | { ok: true; packId: string }
  | { ok: false; reason: "no_credits" | "class_excluded" }

/** Oldest valid pack whose tier isn't excluded from this class. */
export async function findEligiblePack(
  db: SupabaseClient,
  studioId: string,
  classId: string,
  profileId: string,
): Promise<EligiblePack> {
  const [{ data: excluded }, { data: packs }] = await Promise.all([
    db.from("pack_tier_excluded_classes").select("pack_tier_id").eq("class_id", classId),
    db
      .from("class_packs")
      .select("id, pack_tier_id")
      .eq("studio_id", studioId)
      .eq("profile_id", profileId)
      .gt("credits_remaining", 0)
      .gt("expires_at", new Date().toISOString())
      .order("purchased_at", { ascending: true }),
  ])
  if (!packs || packs.length === 0) return { ok: false, reason: "no_credits" }
  const excludedTiers = new Set((excluded ?? []).map((e) => e.pack_tier_id as string))
  const pack = packs.find((p) => !p.pack_tier_id || !excludedTiers.has(p.pack_tier_id as string))
  return pack ? { ok: true, packId: pack.id as string } : { ok: false, reason: "class_excluded" }
}

export const PACK_REFUSAL: Record<"no_credits" | "class_excluded", string> = {
  no_credits: "This member has no pack credits left.",
  class_excluded: "None of this member's packs cover this class.",
}

/** Confirmed bookings for one class on one date. */
export async function confirmedCount(db: SupabaseClient, scheduleId: string, date: string): Promise<number> {
  const { count } = await db
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("schedule_id", scheduleId)
    .eq("date", date)
    .eq("status", "confirmed")
  return count ?? 0
}
