"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth"
import { STUDIO_ID } from "@/lib/constants"

export async function updateStudioSettings(formData: FormData) {
  await requireAdmin()
  const supabase = await createClient()

  const name = formData.get("name") as string
  const domain = formData.get("domain") as string
  const email_from = formData.get("email_from") as string
  const email_domain = formData.get("email_domain") as string

  const { error } = await supabase
    .from("studios")
    .update({ name, domain, email_from, email_domain })
    .eq("id", STUDIO_ID)

  if (error) throw new Error(error.message)
  revalidatePath("/dashboard/settings")
  revalidatePath("/dashboard")
}
