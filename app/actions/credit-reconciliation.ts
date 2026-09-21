"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import type { ShortfallRow } from "@/lib/audit-types"

/**
 * Find members who are missing credits.
 *
 * For every pack a member has bought, each credit should now be one of two
 * things: still on the balance, or spent on a confirmed booking. A credit that
 * is neither was taken by a cancellation that failed to give it back.
 *
 * Members holding any pack created before the March 2026 import are skipped.
 * Those packs arrived part-used, with credits already spent on the studio's
 * previous system and no booking here to account for them, so they read as a
 * shortfall that was never real. Counting them inflated the first estimate of
 * this from 29 credits to 296.
 */
const IMPORT_CUTOFF = "2026-04-01"

export async function getCreditShortfalls(): Promise<{
  rows: ShortfallRow[]
  skippedLegacyMembers: number
}> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const [packsRes, bookingsRes, profilesRes] = await Promise.all([
    supabase
      .from("class_packs")
      .select("profile_id, credits_total, credits_remaining, purchased_at")
      .eq("studio_id", studioId),
    supabase
      .from("bookings")
      .select("profile_id, status")
      .eq("studio_id", studioId)
      .eq("payment_method", "pack_credit"),
    supabase
      .from("profiles")
      .select("id, full_name, email"),
  ])

  const profiles = new Map(
    (profilesRes.data ?? []).map((p) => [
      p.id as string,
      { name: (p.full_name as string) ?? null, email: (p.email as string) ?? null },
    ])
  )

  interface Tally {
    bought: number
    remaining: number
    used: number
    cancelled: number
    legacy: boolean
  }

  const byMember = new Map<string, Tally>()

  function tally(profileId: string): Tally {
    let t = byMember.get(profileId)
    if (!t) {
      t = { bought: 0, remaining: 0, used: 0, cancelled: 0, legacy: false }
      byMember.set(profileId, t)
    }
    return t
  }

  for (const pack of packsRes.data ?? []) {
    const t = tally(pack.profile_id as string)
    t.bought += pack.credits_total as number
    t.remaining += pack.credits_remaining as number
    if ((pack.purchased_at as string) < IMPORT_CUTOFF) t.legacy = true
  }

  for (const b of bookingsRes.data ?? []) {
    const t = tally(b.profile_id as string)
    if (b.status === "confirmed") t.used++
    else if (b.status === "cancelled") t.cancelled++
  }

  const rows: ShortfallRow[] = []
  let skippedLegacyMembers = 0

  for (const [profileId, t] of byMember) {
    if (t.legacy) {
      skippedLegacyMembers++
      continue
    }
    const missing = t.bought - t.used - t.remaining
    if (missing <= 0) continue

    const profile = profiles.get(profileId)
    rows.push({
      profileId,
      name: profile?.name ?? null,
      email: profile?.email ?? null,
      bought: t.bought,
      used: t.used,
      cancelled: t.cancelled,
      remaining: t.remaining,
      missing,
    })
  }

  rows.sort((a, b) => b.missing - a.missing || (a.name ?? "").localeCompare(b.name ?? ""))

  return { rows, skippedLegacyMembers }
}

/**
 * Give a member back the credits they are owed. Tops up a live pack where there
 * is room, otherwise issues a small manual pack, and records either as a
 * manual_adjustment in the ledger against the admin who approved it.
 */
export async function restoreMissingCredits(
  profileId: string,
  credits: number
): Promise<{ error?: string; applied?: number }> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  if (!Number.isInteger(credits) || credits < 1) {
    return { error: "Credits to restore must be a whole number, 1 or more." }
  }
  // A cap, so a bad number in the UI cannot mint a large balance in one click.
  if (credits > 50) {
    return { error: "That is more than 50 credits. Restore these in smaller amounts." }
  }

  const { error } = await supabase.rpc("grant_correction_credit", {
    p_profile_id: profileId,
    p_studio_id: studioId,
    p_credits: credits,
    p_reason: "Correction: credits from cancelled bookings that were never returned",
  })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/audit")
  revalidatePath("/dashboard/members")
  return { applied: credits }
}
