"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"

export async function dismissOnboardingChecklist(): Promise<{ error?: string }> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { error } = await supabase
    .from("studios")
    .update({ onboarding_dismissed: true })
    .eq("id", studioId)

  if (error) return { error: error.message }

  revalidatePath("/dashboard")
  return {}
}
