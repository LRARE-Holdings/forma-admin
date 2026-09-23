/**
 * Which of today's classes the door check-in should open on.
 *
 * A class counts as "now" from 45 minutes before it starts (people arrive
 * early) until 30 minutes after it ends (late arrivals, catching up the
 * register). When two overlap — one finishing, the next arriving — the one
 * whose start is closest to now wins, which hands over to the next class
 * around the time its first people turn up.
 */
export const OPENS_BEFORE_START_MINS = 45
export const STAYS_AFTER_END_MINS = 30

export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + (m || 0)
}

export function pickCurrentClass<T extends { startTime: string; endTime: string }>(
  classes: T[],
  nowMins: number,
): T | null {
  let best: T | null = null
  let bestDistance = Infinity
  for (const c of classes) {
    const start = minutesOfDay(c.startTime)
    const end = minutesOfDay(c.endTime)
    if (nowMins < start - OPENS_BEFORE_START_MINS || nowMins > end + STAYS_AFTER_END_MINS) continue
    const distance = Math.abs(start - nowMins)
    if (distance < bestDistance) {
      best = c
      bestDistance = distance
    }
  }
  return best
}
