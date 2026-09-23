"use server"

import { runAction, unwrap } from "@/lib/action-result"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { notifyInstructorScheduleChange } from "@/lib/email/schedule-notifications"
import { dateToDateStr, localDateStr } from "@/lib/utils"
import { findRuleConflicts, describeConflict } from "@/lib/schedule-conflicts"
import { deleteScheduleSlot } from "./schedule"
import type { ScheduleRuleResult } from "@/lib/schedule-conflicts"
import type { Recurrence } from "@/lib/types"

/**
 * Create a schedule rule and materialise the first 4 weeks of slots.
 * Returns { error } on validation/database failures so the message reaches the
 * client in production (Next.js strips thrown errors).
 */
export async function createScheduleRule(formData: FormData): Promise<ScheduleRuleResult | undefined> {
  return runAction(async () => {
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

    // Advisory only — reported back after the rule is saved, never used to reject it.
    const conflicts = await findRuleConflicts(studioId, {
      class_id,
      instructor_id,
      day_of_week,
      start_time,
      end_time,
      starts_on,
      ends_on,
    })

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

    if (error) return { error: error.message }

    // Materialise slots for the next 4 weeks
    await materialiseSlots(rule.id)

    // Notify instructor
    const { data: cls } = await supabase
      .from("classes")
      .select("name")
      .eq("id", class_id)
      .single()

    await notifyInstructorScheduleChange(studioId, instructor_id, "assigned", {
      className: cls?.name ?? "a class",
      dayOfWeek: day_of_week,
      startTime: start_time,
    }).catch((err) => console.error("[schedule-rules] Notification failed:", err))

    revalidatePath("/dashboard/timetable")
    revalidatePath("/dashboard")

    if (conflicts.length > 0) return { warnings: conflicts.map(describeConflict) }
  })
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
): Promise<ScheduleRuleResult | undefined> {
  return runAction(async () => {
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

    const conflicts = await findRuleConflicts(studioId, {
      class_id,
      instructor_id,
      day_of_week,
      start_time,
      end_time,
      starts_on: effectiveFrom,
      ends_on,
    })

    // Create the replacement FIRST.
    //
    // This used to end-date the old rule and only then insert. When the insert
    // failed, the old rule stayed truncated with nothing succeeding it, so the
    // class disappeared from the split date onwards — and the obvious retry hit
    // "That date is after this rule already ends", which left no way back from
    // the UI at all. Inserting first means a failure here changes nothing.
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

    if (insertError) return { error: insertError.message }

    // Only now close the old rule, the day before the split.
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

    if (updateOldError) {
      // These two writes share no transaction, so undo the replacement by hand
      // rather than leave the timetable running both patterns at once.
      await supabase
        .from("schedule_rules")
        .delete()
        .eq("id", newRule.id)
        .eq("studio_id", studioId)
      return { error: updateOldError.message }
    }

    // Materialise the new rule's schedule slot for the next 4 weeks
    await materialiseSlots(newRule.id)

    // Notify affected instructors
    const className = (oldRule.classes as unknown as { name: string } | null)?.name ?? "a class"
    if (oldRule.instructor_id !== instructor_id) {
      await notifyInstructorScheduleChange(studioId, oldRule.instructor_id, "removed", {
        className,
        dayOfWeek: oldRule.day_of_week,
        startTime: oldRule.start_time,
      }).catch((err) => console.error("[schedule-rules] Notification failed:", err))

      const { data: newCls } = await supabase
        .from("classes")
        .select("name")
        .eq("id", class_id)
        .single()

      await notifyInstructorScheduleChange(studioId, instructor_id, "assigned", {
        className: newCls?.name ?? className,
        dayOfWeek: day_of_week,
        startTime: start_time,
      }).catch((err) => console.error("[schedule-rules] Notification failed:", err))
    } else if (
      oldRule.day_of_week !== day_of_week ||
      oldRule.start_time !== start_time
    ) {
      await notifyInstructorScheduleChange(studioId, instructor_id, "changed", {
        className,
        dayOfWeek: day_of_week,
        startTime: start_time,
      }).catch((err) => console.error("[schedule-rules] Notification failed:", err))
    }

    revalidatePath("/dashboard/timetable")
    revalidatePath("/dashboard")

    if (conflicts.length > 0) return { warnings: conflicts.map(describeConflict) }
  })
}

/**
 * Update an existing schedule rule. Re-materialise future slots.
 */
export async function updateScheduleRule(ruleId: string, formData: FormData): Promise<ScheduleRuleResult | undefined> {
  return runAction(async () => {
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

    // Excludes this rule from its own results, so editing a rule in place never
    // reports it against itself.
    const conflicts = await findRuleConflicts(studioId, {
      id: ruleId,
      class_id,
      instructor_id,
      day_of_week,
      start_time,
      end_time,
      starts_on,
      ends_on,
    })

    const warnings = conflicts.map(describeConflict)

    // Moving the rule to a different day leaves existing bookings on the old day:
    // they keep the date they were booked for, while the slot now renders on the
    // new one. The edit still goes through — it just must not do so silently.
    if (oldRule && (oldRule.day_of_week as number) !== day_of_week) {
      const { count } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("studio_id", studioId)
        .eq("status", "confirmed")
        .gte("date", localDateStr())
        .in(
          "schedule_id",
          ((
            await supabase.from("schedule").select("id").eq("rule_id", ruleId).eq("is_active", true)
          ).data ?? []).map((s) => s.id as string)
        )

      if (count && count > 0) {
        warnings.push(
          `${count} upcoming booking${count === 1 ? " is" : "s are"} still held against the old day. ` +
            `Move them by hand, or undo this and use "a future date" instead so existing classes keep their day.`
        )
      }
    }

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

    if (error) return { error: error.message }

    // Re-materialise: remove future unmutated slots and regenerate
    await rematerialiseSlots(ruleId)

    // Notify instructor about changes
    const { data: cls } = await supabase
      .from("classes")
      .select("name")
      .eq("id", class_id)
      .single()

    const className = cls?.name ?? "a class"

    if (oldRule) {
      if (oldRule.instructor_id !== instructor_id) {
        const oldClassName = (oldRule.classes as unknown as { name: string })?.name ?? className
        await notifyInstructorScheduleChange(studioId, oldRule.instructor_id, "removed", {
          className: oldClassName,
          dayOfWeek: oldRule.day_of_week,
          startTime: oldRule.start_time,
        }).catch((err) => console.error("[schedule-rules] Notification failed:", err))

        await notifyInstructorScheduleChange(studioId, instructor_id, "assigned", {
          className,
          dayOfWeek: day_of_week,
          startTime: start_time,
        }).catch((err) => console.error("[schedule-rules] Notification failed:", err))
      } else if (oldRule.day_of_week !== day_of_week || oldRule.start_time !== start_time) {
        await notifyInstructorScheduleChange(studioId, instructor_id, "changed", {
          className,
          dayOfWeek: day_of_week,
          startTime: start_time,
        }).catch((err) => console.error("[schedule-rules] Notification failed:", err))
      }
    }

    revalidatePath("/dashboard/timetable")
    revalidatePath("/dashboard")

    if (warnings.length > 0) return { warnings }
  })
}

/**
 * Pause/deactivate a schedule rule. Does NOT remove already-materialised slots.
 */
export async function pauseScheduleRule(ruleId: string) {
  return runAction(async () => {
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
  })
}

/**
 * Resume a paused schedule rule and materialise upcoming slots.
 */
export async function resumeScheduleRule(ruleId: string) {
  return runAction(async () => {
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
  })
}

/**
 * Delete a schedule rule, and retire the slot it materialised.
 *
 * The rule's FK is ON DELETE SET NULL, so dropping the rule on its own leaves
 * the slot live with `rule_id = NULL`. A slot with no rule has no window and no
 * recurrence, and `getRangeData` reads that as "runs on this weekday forever" —
 * which is right for a standing slot somebody added by hand, and quietly wrong
 * for one whose rule was just deleted. The class carries on rendering and
 * taking bookings for a recurrence that no longer exists.
 *
 * Retiring the slot goes through `deleteScheduleSlot`, so any future bookings
 * on it are cancelled, refunded and emailed rather than stranded.
 */
export async function deleteScheduleRule(ruleId: string) {
  return runAction(async () => {
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

    // Retire the slots first, while they can still be found by rule_id — once the
    // rule row goes, the link back to them is gone.
    const { data: slots } = await supabase
      .from("schedule")
      .select("id")
      .eq("rule_id", ruleId)
      .eq("studio_id", studioId)
      .eq("is_active", true)

    for (const slot of slots ?? []) {
      unwrap(await deleteScheduleSlot(slot.id as string))
    }

    const { error } = await supabase
      .from("schedule_rules")
      .delete()
      .eq("id", ruleId)
      .eq("studio_id", studioId)

    if (error) throw new Error(error.message)

    // Notify instructor. Only when the rule had no live slot —
    // retiring one through deleteScheduleSlot already sent this same email, and
    // two "you've been taken off Hot Pilates" messages read like two changes.
    if (rule && (slots ?? []).length === 0) {
      const cls = rule.classes as unknown as { name: string } | null
      await notifyInstructorScheduleChange(studioId, rule.instructor_id, "removed", {
        className: cls?.name ?? "a class",
        dayOfWeek: rule.day_of_week,
        startTime: rule.start_time,
      }).catch((err) => console.error("[schedule-rules] Notification failed:", err))
    }

    revalidatePath("/dashboard/timetable")
    revalidatePath("/dashboard")
  })
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
    // Must not be swallowed: a rule with no live slot renders nothing, so the
    // class silently vanishes from the timetable while the rule still exists.
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
