"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { notifyInstructorScheduleChange } from "@/lib/email/schedule-notifications"
import { dateToDateStr, localDateStr } from "@/lib/utils"
import type { Recurrence } from "@/lib/types"

/** "15 Aug" — short enough for a toast, specific enough to find on the timetable. */
function shortDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00")
  d.setDate(d.getDate() + days)
  return dateToDateStr(d)
}

/**
 * Explain which rule is blocking and what to do about it.
 *
 * The blocker is usually invisible: it's the same class at the same time on the
 * same day, but taught by someone else and/or dated outside the week the admin
 * is looking at, so the slot they clicked looks empty. The message therefore has
 * to name the instructor and the date range — "there's already a rule" sends
 * them hunting through a timetable that isn't showing it.
 */
function describeRuleConflict(
  blocking: { starts_on: string; ends_on: string | null; instructors: unknown },
  startsOn: string
): string {
  const who = (blocking.instructors as { name: string } | null)?.name
  const subject = who ? `${who} already teaches this class` : "This class is already scheduled"
  const runs = blocking.ends_on
    ? `${shortDate(blocking.starts_on)} to ${shortDate(blocking.ends_on)}`
    : `${shortDate(blocking.starts_on)} onwards`
  const clash = `${subject} at this time, ${runs}.`

  // A blocker that starts *after* the requested start leaves a usable gap in
  // front of it. Offer that gap: telling someone to wait until the blocker ends
  // is wrong advice when the date they actually asked for is free.
  if (blocking.starts_on > startsOn) {
    return `${clash} Set this one to end on ${shortDate(shiftDate(blocking.starts_on, -1))} to run it up to then, or edit that rule if you meant to change its instructor.`
  }

  if (blocking.ends_on) {
    return `${clash} Start this one on ${shortDate(shiftDate(blocking.ends_on, 1))}, the day after it ends, or edit that rule.`
  }

  return `${clash} It has no end date, so edit or end-date that rule before adding another.`
}

/**
 * Create a schedule rule and materialise the first 4 weeks of slots.
 * Returns { error } on validation/conflict failures so the message
 * reaches the client in production (Next.js strips thrown errors).
 */
export async function createScheduleRule(formData: FormData): Promise<{ error: string } | undefined> {
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
    return { error: "All fields are required" }
  }

  // Pre-flight: check for overlapping active rules.
  // Two date ranges [S, E] and [S', E'] overlap iff S <= E'_eff AND S' <= E_eff
  // (where _eff means substitute '9999-12-31' for null).
  // Ordered by starts_on so the message describes the *earliest* blocker rather
  // than an arbitrary one when several overlap.
  const { data: conflicts } = await supabase
    .from("schedule_rules")
    .select("id, starts_on, ends_on, instructors:instructor_id(name)")
    .eq("studio_id", studioId)
    .eq("class_id", class_id)
    .eq("day_of_week", day_of_week)
    .eq("start_time", start_time)
    .eq("is_active", true)
    .lte("starts_on", ends_on ?? "9999-12-31")
    .or(`ends_on.gte.${starts_on},ends_on.is.null`)
    .order("starts_on")

  if (conflicts && conflicts.length > 0) {
    return { error: describeRuleConflict(conflicts[0], starts_on) }
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

  if (error) {
    if (error.message.includes("schedule_rules_no_overlap")) {
      return { error: "There's already an active recurring rule for this class at this time on this day. Edit the existing rule instead, or choose a different time slot." }
    }
    return { error: error.message }
  }

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
 * Fetch a schedule rule by ID so the edit dialog can be pre-populated. Lives
 * here so the timetable page can hand off a recurring-slot edit straight to
 * the ScheduleRuleDialog.
 */
export async function getScheduleRule(ruleId: string) {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("schedule_rules")
    .select("id, class_id, instructor_id, recurrence, day_of_week, start_time, end_time, starts_on, ends_on")
    .eq("id", ruleId)
    .eq("studio_id", studioId)
    .single()

  if (error || !data) return null
  return data as {
    id: string
    class_id: string
    instructor_id: string
    recurrence: Recurrence
    day_of_week: number
    start_time: string
    end_time: string
    starts_on: string
    ends_on: string | null
  }
}

/**
 * Split a recurring rule at `effectiveFrom`: end-date the existing rule on the
 * day before, then create a fresh rule starting on that date with the new
 * settings from the form. The result is that anything before effectiveFrom
 * keeps the old pattern and anything from effectiveFrom onwards uses the new
 * pattern — which is what admins want when they plan next month without
 * disturbing the current month's classes.
 */
export async function splitScheduleRule(
  ruleId: string,
  effectiveFrom: string,
  formData: FormData
): Promise<{ error: string } | undefined> {
  await requireManager()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Pull the old rule so we can validate the split date and notify
  const { data: oldRule } = await supabase
    .from("schedule_rules")
    .select("starts_on, ends_on, class_id, instructor_id, day_of_week, start_time, classes:class_id(name)")
    .eq("id", ruleId)
    .eq("studio_id", studioId)
    .single()

  if (!oldRule) return { error: "Rule not found" }
  if (effectiveFrom <= (oldRule.starts_on as string)) {
    return updateScheduleRule(ruleId, formData)
  }
  if (oldRule.ends_on && effectiveFrom > (oldRule.ends_on as string)) {
    return { error: "That date is after this rule already ends" }
  }

  // End the old rule one day before the split
  const dayBefore = (() => {
    const d = new Date(effectiveFrom + "T00:00:00")
    d.setDate(d.getDate() - 1)
    return dateToDateStr(d)
  })()

  const { error: updateOldError } = await supabase
    .from("schedule_rules")
    .update({ ends_on: dayBefore })
    .eq("id", ruleId)
    .eq("studio_id", studioId)

  if (updateOldError) return { error: updateOldError.message }

  // Build new rule from the form
  const class_id = formData.get("class_id") as string
  const instructor_id = formData.get("instructor_id") as string
  const day_of_week = parseInt(formData.get("day_of_week") as string)
  const start_time = formData.get("start_time") as string
  const end_time = formData.get("end_time") as string
  const recurrence = (formData.get("recurrence") as Recurrence) || "weekly"
  const ends_on = (formData.get("ends_on") as string) || null

  if (!class_id || !instructor_id || isNaN(day_of_week) || !start_time || !end_time) {
    return { error: "All fields are required" }
  }
  if (ends_on && ends_on < effectiveFrom) {
    return { error: "End date must be on or after the start of this change" }
  }

  const { data: newRule, error: insertError } = await supabase
    .from("schedule_rules")
    .insert({
      studio_id: studioId,
      class_id,
      instructor_id,
      recurrence,
      day_of_week,
      start_time,
      end_time,
      starts_on: effectiveFrom,
      ends_on,
    })
    .select("id")
    .single()

  if (insertError) {
    if (insertError.message.includes("schedule_rules_no_overlap")) {
      return { error: "There's already an active recurring rule for this class at this time on this day. Edit the existing rule instead, or choose a different time slot." }
    }
    return { error: insertError.message }
  }

  // Materialise the new rule's schedule slot for the next 4 weeks
  await materialiseSlots(newRule.id)

  // Notify affected instructors (fire-and-forget)
  const className = (oldRule.classes as unknown as { name: string } | null)?.name ?? "a class"
  if (oldRule.instructor_id !== instructor_id) {
    notifyInstructorScheduleChange(studioId, oldRule.instructor_id, "removed", {
      className,
      dayOfWeek: oldRule.day_of_week,
      startTime: oldRule.start_time,
    }).catch((err) => console.error("[schedule-rules] Notification failed:", err))

    const { data: newCls } = await supabase
      .from("classes")
      .select("name")
      .eq("id", class_id)
      .single()

    notifyInstructorScheduleChange(studioId, instructor_id, "assigned", {
      className: newCls?.name ?? className,
      dayOfWeek: day_of_week,
      startTime: start_time,
    }).catch((err) => console.error("[schedule-rules] Notification failed:", err))
  } else if (
    oldRule.day_of_week !== day_of_week ||
    oldRule.start_time !== start_time
  ) {
    notifyInstructorScheduleChange(studioId, instructor_id, "changed", {
      className,
      dayOfWeek: day_of_week,
      startTime: start_time,
    }).catch((err) => console.error("[schedule-rules] Notification failed:", err))
  }

  revalidatePath("/dashboard/timetable")
  revalidatePath("/dashboard")
}

/**
 * Update an existing schedule rule. Re-materialise future slots.
 */
export async function updateScheduleRule(ruleId: string, formData: FormData): Promise<{ error: string } | undefined> {
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

  if (error) {
    if (error.message.includes("schedule_rules_no_overlap")) {
      return { error: "There's already an active recurring rule for this class at this time on this day. Edit the existing rule instead, or choose a different time slot." }
    }
    return { error: error.message }
  }

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
    // Must not be swallowed: a rule with no live slot renders nothing yet still
    // holds its schedule_rules_no_overlap exclusion, so the class silently
    // vanishes from the timetable and can never be re-added at that time.
    throw new Error(`Failed to materialise slot: ${insertError.message}`)
  }
}

/**
 * Bring a rule's materialised slot back in line with the rule.
 *
 * Updates the live slot **in place**. It must never be retired and replaced:
 * bookings hold `schedule_id`, so a replacement row (new uuid) strands every
 * existing booking. The stranded rows stay referentially valid — nothing errors,
 * nothing logs — but the timetable and register both read `is_active = true` and
 * match attendees on `schedule_id`, so the class renders with zero attendees.
 * (Aug 2026: a Saturday rule edit hid 13 paid bookings until the day before.)
 *
 * Moving the slot moves its bookings with it, which is what editing a recurring
 * class means. To change the pattern from a date onwards while leaving existing
 * occurrences alone, use splitScheduleRule instead.
 */
async function rematerialiseSlots(ruleId: string) {
  const supabase = await createClient()

  // Scope writes by studio_id explicitly. RLS would normally protect this, but a
  // missing filter once burned us (Apr 2026: rule re-materialise produced
  // cross-period duplicates).
  const { data: rule } = await supabase
    .from("schedule_rules")
    .select("id, studio_id, class_id, instructor_id, day_of_week, start_time, end_time")
    .eq("id", ruleId)
    .single()

  if (!rule) return

  const { data: live } = await supabase
    .from("schedule")
    .select("id")
    .eq("rule_id", ruleId)
    .eq("studio_id", rule.studio_id)
    .eq("is_active", true)

  if (!live || live.length === 0) {
    // Nothing live to update (rule was paused, or its slot never materialised).
    await materialiseSlots(ruleId)
    return
  }

  const { error } = await supabase
    .from("schedule")
    .update({
      class_id: rule.class_id,
      instructor_id: rule.instructor_id,
      day_of_week: rule.day_of_week,
      start_time: rule.start_time,
      end_time: rule.end_time,
    })
    .in("id", live.map((s) => s.id as string))
    .eq("studio_id", rule.studio_id)

  // Must not be swallowed: a slot left out of sync with its rule shows the wrong
  // class, instructor or time to everyone booking it.
  if (error) throw new Error(`Failed to update slot: ${error.message}`)
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
  const today = new Date(localDateStr() + "T00:00:00")

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
      dates.push(dateToDateStr(cursor))
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

  // One bad rule must not abort the whole cron sweep
  for (const rule of rules) {
    try {
      await materialiseSlots(rule.id)
    } catch (err) {
      console.error(`[schedule-rules] Materialise failed for rule ${rule.id}:`, err)
    }
  }
}
