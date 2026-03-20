"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/auth"
import { STUDIO_ID } from "@/lib/constants"

export async function createScheduleSlot(formData: FormData) {
  await requireManager()
  const supabase = await createClient()

  const class_id = formData.get("class_id") as string
  const instructor_id = formData.get("instructor_id") as string
  const day_of_week = parseInt(formData.get("day_of_week") as string)
  const start_time = formData.get("start_time") as string
  const end_time = formData.get("end_time") as string

  const { error } = await supabase.from("schedule").insert({
    studio_id: STUDIO_ID,
    class_id,
    instructor_id,
    day_of_week,
    start_time,
    end_time,
  })

  if (error) throw new Error(error.message)
  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}

export async function updateScheduleSlot(slotId: string, formData: FormData) {
  await requireManager()
  const supabase = await createClient()

  const class_id = formData.get("class_id") as string
  const instructor_id = formData.get("instructor_id") as string
  const day_of_week = parseInt(formData.get("day_of_week") as string)
  const start_time = formData.get("start_time") as string
  const end_time = formData.get("end_time") as string

  const { error } = await supabase
    .from("schedule")
    .update({ class_id, instructor_id, day_of_week, start_time, end_time })
    .eq("id", slotId)
    .eq("studio_id", STUDIO_ID)

  if (error) throw new Error(error.message)
  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}

export async function deleteScheduleSlot(slotId: string) {
  await requireManager()
  const supabase = await createClient()

  const { error } = await supabase
    .from("schedule")
    .update({ is_active: false })
    .eq("id", slotId)
    .eq("studio_id", STUDIO_ID)

  if (error) throw new Error(error.message)
  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}
