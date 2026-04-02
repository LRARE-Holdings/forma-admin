import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { getAssistRateLimit } from "./constants"
import { localDateStr } from "@/lib/utils"
import type { UserRole } from "@/lib/types"

interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  used: number
}

/**
 * Check and increment the user's daily Assist usage.
 * Returns whether they're allowed to make the request + remaining count.
 */
export async function checkAndIncrementUsage(
  profileId: string,
  planTier: string,
  role: UserRole
): Promise<RateLimitResult> {
  const limit = getAssistRateLimit(planTier, role)

  if (limit === 0) {
    return { allowed: false, remaining: 0, limit: 0, used: 0 }
  }

  const studioId = await getStudioId()
  const supabase = await createClient()
  const today = localDateStr()

  // Try to get existing usage for today
  const { data: existing } = await supabase
    .from("assist_usage")
    .select("id, request_count")
    .eq("studio_id", studioId)
    .eq("profile_id", profileId)
    .eq("date", today)
    .single()

  if (existing) {
    if (existing.request_count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        limit,
        used: existing.request_count,
      }
    }

    // Increment
    const newCount = existing.request_count + 1
    await supabase
      .from("assist_usage")
      .update({ request_count: newCount })
      .eq("id", existing.id)

    return {
      allowed: true,
      remaining: limit - newCount,
      limit,
      used: newCount,
    }
  }

  // First request today — insert
  await supabase.from("assist_usage").insert({
    studio_id: studioId,
    profile_id: profileId,
    date: today,
    request_count: 1,
  })

  return { allowed: true, remaining: limit - 1, limit, used: 1 }
}

/**
 * Get current usage without incrementing (for UI display).
 */
export async function getUsage(
  profileId: string,
  planTier: string,
  role: UserRole
): Promise<{ used: number; limit: number; remaining: number }> {
  const limit = getAssistRateLimit(planTier, role)
  if (limit === 0) return { used: 0, limit: 0, remaining: 0 }

  const studioId = await getStudioId()
  const supabase = await createClient()
  const today = localDateStr()

  const { data } = await supabase
    .from("assist_usage")
    .select("request_count")
    .eq("studio_id", studioId)
    .eq("profile_id", profileId)
    .eq("date", today)
    .single()

  const used = data?.request_count ?? 0
  return { used, limit, remaining: Math.max(0, limit - used) }
}
