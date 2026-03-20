import type { UserRole } from "@/lib/types"

/** Plans that include Forma Assist */
export const ASSIST_PLANS = ["pro", "partner"] as const

/** Daily request limits by (plan, role) */
export const ASSIST_RATE_LIMITS: Record<string, Record<string, number>> = {
  pro: {
    owner: 100,
    admin: 100,
    manager: 60,
    reception: 40,
    staff: 25,
  },
  partner: {
    owner: 500,
    admin: 500,
    manager: 200,
    reception: 100,
    staff: 75,
  },
}

/** Get the daily rate limit for a plan + role combo. Returns 0 if ineligible. */
export function getAssistRateLimit(
  planTier: string,
  role: UserRole
): number {
  return ASSIST_RATE_LIMITS[planTier]?.[role] ?? 0
}

/** Check if a plan tier includes Forma Assist */
export function isPlanEligible(planTier: string): boolean {
  return (ASSIST_PLANS as readonly string[]).includes(planTier)
}
