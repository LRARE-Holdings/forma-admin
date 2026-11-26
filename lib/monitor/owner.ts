import { cache } from "react"
import { redirect } from "next/navigation"
import { getUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import type { CheckStatus } from "./types"

/**
 * The status page belongs to Forma, not the studio: only accounts listed in
 * platform_owners can open it. Studio admins (Lucy) never see it.
 */
export const isPlatformOwner = cache(async (): Promise<boolean> => {
  const user = await getUser()
  if (!user) return false
  const { data } = await createAdminClient()
    .from("platform_owners")
    .select("profile_id")
    .eq("profile_id", user.id)
    .maybeSingle()
  return !!data
})

export async function requirePlatformOwner(): Promise<void> {
  if (!(await isPlatformOwner())) redirect("/dashboard")
}

/** Worst current status, for the dot beside "Status" in the sidebar. */
export async function overallStatus(): Promise<CheckStatus> {
  const { data } = await createAdminClient().from("monitor_checks").select("status, detail")
  const loud = (data ?? []).filter((c) => !(c.detail as { quiet?: boolean } | null)?.quiet)
  if (loud.some((c) => c.status === "down")) return "down"
  if (loud.some((c) => c.status === "warn")) return "warn"
  return "ok"
}
