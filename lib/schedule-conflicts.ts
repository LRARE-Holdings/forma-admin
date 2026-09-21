import { createClient } from "@/lib/supabase/server"

/**
 * Schedule conflicts are advisory.
 *
 * They used to be enforced by a database EXCLUDE constraint keyed on
 * (studio_id, class_id, day_of_week, start_time, daterange). That key protected
 * the wrong thing in both directions: it rejected the same class taught at one
 * time by two instructors, while happily allowing two *different* classes into
 * the room at once, and it never saw a 09:00-10:00 slot overlapping 09:30-10:30
 * because it only compared start_time for equality.
 *
 * So the constraint is gone. Nothing here rejects a schedule — it reports what
 * overlaps so the admin can decide. A studio that genuinely runs two rooms is
 * not wrong, and the dashboard has no way to know that it does.
 */

export type ConflictKind = "instructor" | "room"

/**
 * What a schedule write reports back.
 *
 * `error` means the write did not happen (missing field, database failure).
 * `warnings` means it did happen, and here is what it now overlaps with. Lives
 * here rather than beside the actions because a "use server" module may only
 * export async functions.
 */
export interface ScheduleRuleResult {
  error?: string
  warnings?: string[]
}

export interface RuleConflict {
  ruleId: string
  kind: ConflictKind
  className: string
  instructorName: string
  dayOfWeek: number
  startTime: string
  endTime: string
  startsOn: string
  endsOn: string | null
}

export interface ConflictCandidate {
  id?: string
  class_id: string
  instructor_id: string
  day_of_week: number
  start_time: string
  end_time: string
  starts_on: string
  ends_on: string | null
}

/** "09:30:00" / "09:30" -> minutes since midnight. */
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + (m || 0)
}

/** Half-open overlap: a class ending at 10:00 does not clash with one starting at 10:00. */
function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd)
}

/** Inclusive date-range overlap, treating a null end as open-ended. */
function datesOverlap(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null
): boolean {
  return aStart <= (bEnd ?? "9999-12-31") && bStart <= (aEnd ?? "9999-12-31")
}

/**
 * Find active rules that would run at the same time as `candidate`.
 *
 * Compares real time ranges across every class in the studio, not just the same
 * class at an identical start time. `candidate.id` is excluded so editing a rule
 * never reports the rule against itself.
 */
export async function findRuleConflicts(
  studioId: string,
  candidate: ConflictCandidate
): Promise<RuleConflict[]> {
  const supabase = await createClient()

  const { data } = await supabase
    .from("schedule_rules")
    .select(
      "id, class_id, instructor_id, day_of_week, start_time, end_time, starts_on, ends_on, classes:class_id(name), instructors:instructor_id(name)"
    )
    .eq("studio_id", studioId)
    .eq("day_of_week", candidate.day_of_week)
    .eq("is_active", true)
    .order("start_time")

  if (!data) return []

  const conflicts: RuleConflict[] = []

  for (const rule of data) {
    if (candidate.id && rule.id === candidate.id) continue

    if (
      !timesOverlap(
        candidate.start_time,
        candidate.end_time,
        rule.start_time as string,
        rule.end_time as string
      )
    ) {
      continue
    }

    if (
      !datesOverlap(
        candidate.starts_on,
        candidate.ends_on,
        rule.starts_on as string,
        rule.ends_on as string | null
      )
    ) {
      continue
    }

    conflicts.push({
      ruleId: rule.id as string,
      kind: rule.instructor_id === candidate.instructor_id ? "instructor" : "room",
      className: (rule.classes as unknown as { name: string } | null)?.name ?? "A class",
      instructorName:
        (rule.instructors as unknown as { name: string } | null)?.name ?? "Someone",
      dayOfWeek: rule.day_of_week as number,
      startTime: rule.start_time as string,
      endTime: rule.end_time as string,
      startsOn: rule.starts_on as string,
      endsOn: (rule.ends_on as string) ?? null,
    })
  }

  return conflicts
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

function shortDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })
}

/**
 * One line an admin can act on: who, what, when, and over which dates. The old
 * message said only "there's already a rule", which sent people hunting through
 * a timetable that wasn't showing the blocker.
 */
export function describeConflict(c: RuleConflict): string {
  const when = `${DAY_NAMES[c.dayOfWeek]} ${c.startTime.slice(0, 5)}-${c.endTime.slice(0, 5)}`
  const runs = c.endsOn
    ? `${shortDate(c.startsOn)} to ${shortDate(c.endsOn)}`
    : `${shortDate(c.startsOn)} onwards`

  return c.kind === "instructor"
    ? `${c.instructorName} is already teaching ${c.className} at ${when} (${runs}).`
    : `${c.className} with ${c.instructorName} already runs at ${when} (${runs}).`
}
