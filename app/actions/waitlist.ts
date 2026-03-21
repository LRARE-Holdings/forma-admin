"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"

export async function removeFromWaitlist(
  waitlistId: string
): Promise<{ error?: string }> {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { error } = await supabase
    .from("waitlist")
    .delete()
    .eq("id", waitlistId)
    .eq("studio_id", studioId)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/bookings")
  return {}
}
