// One definition of "active" and "lapsed", shared by the dashboard and the
// Members page so the two can never disagree.
//
// "At risk" (no booking in 30 days) used to sit on the dashboard. It counted
// everyone who had signed up and never booked — 637 of its 829 on 8 Oct 2026 —
// so it only ever grew and hid the ~27 regulars who had actually stopped coming.

export const ACTIVE_WINDOW_DAYS = 30
/** Confirmed classes, up to today, before someone counts as a regular. */
export const LAPSED_MIN_CLASSES = 3

/** YYYY-MM-DD plus n days (n may be negative). Calendar maths, no timezone. */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export interface MemberActivity {
  /** Confirmed classes dated today or earlier. */
  pastClasses: number
  /** Most recent confirmed class dated today or earlier. */
  lastClassDate: string | null
  /** Most recent confirmed booking of any date, including upcoming ones. */
  lastBookingDate: string | null
}

/** Booked a class dated within the last 30 days, today included. */
export function isActive(a: MemberActivity, today: string): boolean {
  return a.lastClassDate !== null && a.lastClassDate >= addDays(today, -ACTIVE_WINDOW_DAYS)
}

/**
 * A regular (3+ classes) with nothing in the last 30 days and nothing booked
 * ahead. People who never booked are not lapsed — they never started.
 */
export function isLapsed(a: MemberActivity, today: string): boolean {
  return (
    a.pastClasses >= LAPSED_MIN_CLASSES &&
    a.lastBookingDate !== null &&
    a.lastBookingDate < addDays(today, -ACTIVE_WINDOW_DAYS)
  )
}

/** Fold confirmed bookings into per-member activity. */
export function activityByProfile(
  bookings: Array<{ profile_id: string; date: string }>,
  today: string,
): Map<string, MemberActivity> {
  const out = new Map<string, MemberActivity>()
  for (const b of bookings) {
    let a = out.get(b.profile_id)
    if (!a) {
      a = { pastClasses: 0, lastClassDate: null, lastBookingDate: null }
      out.set(b.profile_id, a)
    }
    if (!a.lastBookingDate || b.date > a.lastBookingDate) a.lastBookingDate = b.date
    if (b.date <= today) {
      a.pastClasses++
      if (!a.lastClassDate || b.date > a.lastClassDate) a.lastClassDate = b.date
    }
  }
  return out
}
