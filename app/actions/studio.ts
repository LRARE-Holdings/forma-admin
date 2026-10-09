"use server"

import { runAction } from "@/lib/action-result"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"

export async function updateStudioSettings(formData: FormData) {
  return runAction(async () => {
    await requireAdmin()
    const studioId = await getStudioId()
    const supabase = await createClient()

    const name = formData.get("name") as string
    const domain = formData.get("domain") as string
    const email_from = formData.get("email_from") as string
    const email_domain = formData.get("email_domain") as string

    const { error } = await supabase
      .from("studios")
      .update({ name, domain, email_from, email_domain })
      .eq("id", studioId)

    if (error) throw new Error(error.message)
    revalidatePath("/dashboard/settings")
    revalidatePath("/dashboard")
  })
}

export async function updateFirstClassFree(enabled: boolean) {
  return runAction(async () => {
    await requireAdmin()
    const studioId = await getStudioId()
    const supabase = await createClient()

    const { error } = await supabase
      .from("studios")
      .update({ first_class_free_enabled: enabled })
      .eq("id", studioId)

    if (error) throw new Error(error.message)
    revalidatePath("/dashboard/settings")
  })
}

const ACCOUNTING_SOFTWARE = ["none", "xero", "quickbooks", "freeagent"] as const
export type AccountingSoftware = (typeof ACCOUNTING_SOFTWARE)[number]

/** Year end as MM-DD, plus which accounting package the Money page exports for. */
export async function updateAccountingSettings(yearEnd: string, software: string) {
  return runAction(async () => {
    await requireAdmin()
    const studioId = await getStudioId()

    // A date that exists every year: no 29 Feb, no 31 Apr.
    const valid =
      /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(yearEnd) &&
      yearEnd !== "02-29" &&
      new Date(`2001-${yearEnd}T12:00:00Z`).toISOString().slice(5, 10) === yearEnd
    if (!valid) throw new Error("Choose a year-end date that exists every year.")
    if (!(ACCOUNTING_SOFTWARE as readonly string[]).includes(software)) {
      throw new Error("Unknown accounting software.")
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("studios")
      .update({ accounting_year_end: yearEnd, accounting_software: software })
      .eq("id", studioId)

    if (error) throw new Error(error.message)
    revalidatePath("/dashboard/money")
  })
}
