"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { notifyInstructorScheduleChange } from "@/lib/email/schedule-notifications"
import type { Recurrence } from "@/lib/types"

/**
 * Create a schedule rule and materialise the first 4 weeks of slots.
 */
export async function createScheduleRule(formData: FormData) {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const class_id = formData.get("class_id") as string
  const instructor_id = formData.get("instructor_id") as string
  const day_of_week = parseInt(formData.get("day_of_week") as string)
  const start_time = formData.get("start_time") as string
  const end_time = formData.get("end_time") as string
  const recurrence = (formData.get("recurrence") as Recurrence) || "weekly"
  const starts_on = formData.get("starts_on") as string
  const ends_on = (formData.get("ends_on") as string) || null

  if (!class_id || !instructor_id || isNaN(day_of_week) || !start_time || !end_time || !starts_on) {
    throw new Error("All fields are required")
  }

  const { data: rule, error } = await supabase
    .from("schedule_rules")
    .insert({
      studio_id: studioId,
      class_id,
      instructor_id,
      recurrence,
      day_of_week,
      start_time,
      end_time,
      starts_on,
      ends_on,
    })
    .select("id")
    .single()

  if (error) throw new Error(error.message)

  // Materialise slots for the next 4 weeks
  await materialiseSlots(rule.id)

  // Notify instructor (fire-and-forget)
  const { data: cls } = await supabase
    .from("classes")
    .select("name")
    .eq("id", class_id)
    .single()

  notifyInstructorScheduleChange(studioId, instructor_id, "assigned", {
    className: cls?.name ?? "a class",
    dayOfWeek: day_of_week,
    startTime: start_time,
  }).catch((err) => console.error("[schedule-rules] Notification failed:", err))

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}

/**
 * Update an existing schedule rule. Re-materialise future slots.
 */
export async function updateScheduleRule(ruleId: string, formData: FormData) {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Fetch old rule for notification comparison
  const { data: oldRule } = await supabase
    .from("schedule_rules")
    .select("instructor_id, day_of_week, start_time, class_id, classes:class_id(name)")
    .eq("id", ruleId)
    .eq("studio_id", studioId)
    .single()

  const class_id = formData.get("class_id") as string
  const instructor_id = formData.get("instructor_id") as string
  const day_of_week = parseInt(formData.get("day_of_week") as string)
  const start_time = formData.get("start_time") as string
  const end_time = formData.get("end_time") as string
  const recurrence = (formData.get("recurrence") as Recurrence) || "weekly"
  const starts_on = formData.get("starts_on") as string
  const ends_on = (formData.get("ends_on") as string) || null

  const { error } = await supabase
    .from("schedule_rules")
    .update({
      class_id,
      instructor_id,
      recurrence,
      day_of_week,
      start_time,
      end_time,
      starts_on,
      ends_on,
    })
    .eq("id", ruleId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)

  // Re-materialise: remove future unmutated slots and regenerate
  await rematerialiseSlots(ruleId)

  // Notify instructor about changes (fire-and-forget)
  const { data: cls } = await supabase
    .from("classes")
    .select("name")
    .eq("id", class_id)
    .single()

  const className = cls?.name ?? "a class"

  if (oldRule) {
    if (oldRule.instructor_id !== instructor_id) {
      const oldClassName = (oldRule.classes as unknown as { name: string })?.name ?? className
      notifyInstructorScheduleChange(studioId, oldRule.instructor_id, "removed", {
        className: oldClassName,
        dayOfWeek: oldRule.day_of_week,
        startTime: oldRule.start_time,
      }).catch((err) => console.error("[schedule-rules] Notification failed:", err))

      notifyInstructorScheduleChange(studioId, instructor_id, "assigned", {
        className,
        dayOfWeek: day_of_week,
        startTime: start_time,
      }).catch((err) => console.error("[schedule-rules] Notification failed:", err))
    } else if (oldRule.day_of_week !== day_of_week || oldRule.start_time !== start_time) {
      notifyInstructorScheduleChange(studioId, instructor_id, "changed", {
        className,
        dayOfWeek: day_of_week,
        startTime: start_time,
      }).catch((err) => console.error("[schedule-rules] Notification failed:", err))
    }
  }

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}

/**
 * Pause/deactivate a schedule rule. Does NOT remove already-materialised slots.
 */
export async function pauseScheduleRule(ruleId: string) {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { error } = await supabase
    .from("schedule_rules")
    .update({ is_active: false })
    .eq("id", ruleId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)
  revalidatePath("/dashboard/timetable")
}

/**
 * Resume a paused schedule rule and materialise upcoming slots.
 */
export async function resumeScheduleRule(ruleId: string) {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { error } = await supabase
    .from("schedule_rules")
    .update({ is_active: true })
    .eq("id", ruleId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)

  await materialiseSlots(ruleId)
  revalidatePath("/dashboard/timetable")
}

/**
 * Delete a schedule rule. Materialised slots stay (rule_id becomes null via ON DELETE SET NULL).
 */
export async function deleteScheduleRule(ruleId: string) {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Fetch rule data before deletion for notification
  const { data: rule } = await supabase
    .from("schedule_rules")
    .select("instructor_id, day_of_week, start_time, classes:class_id(name)")
    .eq("id", ruleId)
    .eq("studio_id", studioId)
    .single()

  const { error } = await supabase
    .from("schedule_rules")
    .delete()
    .eq("id", ruleId)
    .eq("studio_id", studioId)

  if (error) throw new Error(error.message)

  // Notify instructor (fire-and-forget)
  if (rule) {
    const cls = rule.classes as unknown as { name: string } | null
    notifyInstructorScheduleChange(studioId, rule.instructor_id, "removed", {
      className: cls?.name ?? "a class",
      dayOfWeek: rule.day_of_week,
      startTime: rule.start_time,
    }).catch((err) => console.error("[schedule-rules] Notification failed:", err))
  }

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}

/**
 * Materialise schedule slots for a rule for the next 4 weeks.
 * Skips dates where a slot with this rule_id + day already exists.
 */
async function materialiseSlots(ruleId: string) {
  const supabase = await createClient()

  const { data: rule, error } = await supabase
    .from("schedule_rules")
    .select("*")
    .eq("id", ruleId)
    .single()

  if (error || !rule) return

  const dates = calculateDates(
    rule.recurrence as Recurrence,
    rule.day_of_week,
    rule.starts_on,
    rule.ends_on,
    28 // 4 weeks window
  )

  if (dates.length === 0) return

  // Check which dates already have slots for this rule
  const { data: existing } = await supabase
    .from("schedule")
    .select("day_of_week")
    .eq("rule_id", ruleId)
    .eq("is_active", true)

  const existingCount = existing?.length ?? 0

  // Generate slots for missing dates (simple: if we already have enough, skip)
  // For initial materialisation, we just need the weekly schedule rows
  // The schedule table is a weekly pattern, not date-specific
  // So we only need one row per rule (the schedule entry for that day)

  // Actually, looking at the existing model: schedule table rows represent
  // the weekly pattern (day_of_week + time), not specific dates.
  // Bookings reference schedule_id + a date column.
  // So we just need ONE schedule row per rule.

  if (existingCount > 0) return // Already has a materialised slot

  const { error: insertError } = await supabase.from("schedule").insert({
    studio_id: rule.studio_id,
    class_id: rule.class_id,
    instructor_id: rule.instructor_id,
    day_of_week: rule.day_of_week,
    start_time: rule.start_time,
    end_time: rule.end_time,
    rule_id: ruleId,
    is_active: true,
  })

  if (insertError) {
    console.error("Failed to materialise slot:", insertError.message)
  }
}

/**
 * Remove and re-create materialised slots for a rule.
 */
async function rematerialiseSlots(ruleId: string) {
  const supabase = await createClient()

  // Deactivate existing slots from this rule
  await supabase
    .from("schedule")
    .update({ is_active: false })
    .eq("rule_id", ruleId)

  // Re-materialise
  await materialiseSlots(ruleId)
}

/**
 * Calculate dates for a recurrence pattern within a window.
 */
function calculateDates(
  recurrence: Recurrence,
  dayOfWeek: number,
  startsOn: string,
  endsOn: string | null,
  windowDays: number
): string[] {
  const dates: string[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const start = new Date(startsOn + "T00:00:00")
  const windowEnd = new Date(today)
  windowEnd.setDate(windowEnd.getDate() + windowDays)

  const end = endsOn ? new Date(endsOn + "T00:00:00") : windowEnd
  const effectiveEnd = end < windowEnd ? end : windowEnd

  // Find the first occurrence on or after start
  const cursor = new Date(start)
  const cursorDow = cursor.getDay()
  // Convert JS day (0=Sun) to our convention (0=Mon)
  const cursorOurDow = cursorDow === 0 ? 6 : cursorDow - 1
  let daysToAdd = dayOfWeek - cursorOurDow
  if (daysToAdd < 0) daysToAdd += 7
  cursor.setDate(cursor.getDate() + daysToAdd)

  const interval =
    recurrence === "weekly" ? 7 :
    recurrence === "fortnightly" ? 14 :
    0 // monthly handled separately

  while (cursor <= effectiveEnd) {
    if (cursor >= today) {
      dates.push(cursor.toISOString().split("T")[0])
    }

    if (recurrence === "monthly") {
      cursor.setMonth(cursor.getMonth() + 1)
    } else {
      cursor.setDate(cursor.getDate() + interval)
    }
  }

  return dates
}

/**
 * Materialise all active rules for all studios (called by cron).
 */
export async function materialiseAllRules() {
  const supabase = await createClient()

  const { data: rules } = await supabase
    .from("schedule_rules")
    .select("id")
    .eq("is_active", true)

  if (!rules) return

  for (const rule of rules) {
    await materialiseSlots(rule.id)
  }
}
