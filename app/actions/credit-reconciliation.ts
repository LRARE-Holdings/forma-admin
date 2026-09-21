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
 * Counted by `credit_shortfalls()` in the database rather than here. Tallying it
 * in application code meant fetching every pack-credit booking, and there are
 * 1490 of them against PostgREST's 1000-row ceiling: 490 spent credits went
 * uncounted and the screen read 270 owed across 47 members instead of 29 across
 * 18. It returned a plausible number rather than an error, which is the worst
 * way for this to be wrong.
 *
 * The function also excludes members holding packs from the March 2026 import.
 * Those arrived part-used, with credits spent on the studio's previous system
 * and no booking here to match, so they read as a shortfall that was never real.
 */
export async function getCreditShortfalls(): Promise<{
  rows: ShortfallRow[]
  skippedLegacyMembers: number
}> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const [shortfallRes, legacyRes] = await Promise.all([
    supabase.rpc("credit_shortfalls", { p_studio_id: studioId }),
    supabase.rpc("credit_shortfall_legacy_count", { p_studio_id: studioId }),
  ])

  if (shortfallRes.error) throw new Error(shortfallRes.error.message)

  const rows: ShortfallRow[] = (shortfallRes.data ?? []).map(
    (r: Record<string, unknown>) => ({
      profileId: r.profile_id as string,
      name: (r.full_name as string) ?? null,
      email: (r.email as string) ?? null,
      bought: r.bought as number,
      used: r.used as number,
      cancelled: r.cancelled as number,
      remaining: r.remaining as number,
      missing: r.missing as number,
    })
  )

  return {
    rows,
    skippedLegacyMembers: (legacyRes.data as number) ?? 0,
  }
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
