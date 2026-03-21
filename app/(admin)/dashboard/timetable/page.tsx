import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { PageHeader } from "@/components/shared/page-header"
import { TimetableTable } from "@/components/dashboard/timetable-table"
import { RealtimeBookingListener } from "@/components/dashboard/realtime-booking-listener"

export default async function TimetablePage() {
  const supabase = await createClient()
  const studioId = await getStudioId()

  const [scheduleRes, classesRes, instructorsRes, rulesRes] = await Promise.all([
    supabase
      .from("schedule")
      .select("*, classes(*), instructors(*)")
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .order("day_of_week")
      .order("start_time"),
    supabase
      .from("classes")
      .select("id, name, slug, price_pence, capacity, duration_mins")
      .eq("studio_id", studioId)
      .order("name"),
    supabase
      .from("instructors")
      .select("id, name")
      .eq("studio_id", studioId)
      .order("name"),
    supabase
      .from("schedule_rules")
      .select("*, classes:class_id(name), instructors:instructor_id(name)")
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .order("day_of_week")
      .order("start_time"),
  ])

  // Get booking counts for this week
  const now = new Date()
  const jsDow = now.getDay()
  const mondayOffset = jsDow === 0 ? -6 : 1 - jsDow
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const mondayStr = monday.toISOString().split("T")[0]
  const sundayStr = sunday.toISOString().split("T")[0]

  const { data: weekBookings } = await supabase
    .from("bookings")
    .select("schedule_id, date")
    .eq("studio_id", studioId)
    .eq("status", "confirmed")
    .gte("date", mondayStr)
    .lte("date", sundayStr)

  const bookingsBySlot: Record<string, number> = {}
  for (const b of weekBookings ?? []) {
    bookingsBySlot[b.schedule_id] = (bookingsBySlot[b.schedule_id] ?? 0) + 1
  }

  // Build weekDates map: day_of_week (0=Mon) → YYYY-MM-DD
  const weekDates: Record<number, string> = {}
  for (let d = 0; d < 7; d++) {
    const dateObj = new Date(monday)
    dateObj.setDate(monday.getDate() + d)
    weekDates[d] = dateObj.toISOString().split("T")[0]
  }

  const weekLabel = `Week of ${monday.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}`

  // Serialize slots
  const slots = (scheduleRes.data ?? []).map((slot) => ({
    id: slot.id as string,
    class_id: slot.class_id as string,
    instructor_id: slot.instructor_id as string,
    day_of_week: slot.day_of_week as number,
    start_time: slot.start_time as string,
    end_time: slot.end_time as string,
    rule_id: (slot.rule_id as string) ?? null,
    classes: {
      id: (slot.classes as Record<string, unknown>).id as string,
      name: (slot.classes as Record<string, unknown>).name as string,
      slug: (slot.classes as Record<string, unknown>).slug as string,
      price_pence: (slot.classes as Record<string, unknown>).price_pence as number,
      capacity: ((slot.classes as Record<string, unknown>).capacity as number) ?? 10,
      duration_mins: ((slot.classes as Record<string, unknown>).duration_mins as number) ?? 60,
    },
    instructors: {
      id: (slot.instructors as Record<string, unknown>).id as string,
      name: (slot.instructors as Record<string, unknown>).name as string,
    },
  }))

  const classes = (classesRes.data ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    slug: c.slug as string,
    price_pence: c.price_pence as number,
    capacity: (c.capacity as number) ?? 10,
    duration_mins: (c.duration_mins as number) ?? 60,
  }))

  const instructors = (instructorsRes.data ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
  }))

  // Serialize rules
  const rules = (rulesRes.data ?? []).map((rule) => ({
    id: rule.id as string,
    class_id: rule.class_id as string,
    instructor_id: rule.instructor_id as string,
    recurrence: rule.recurrence as string,
    day_of_week: rule.day_of_week as number,
    start_time: rule.start_time as string,
    end_time: rule.end_time as string,
    starts_on: rule.starts_on as string,
    ends_on: (rule.ends_on as string) ?? null,
    is_active: rule.is_active as boolean,
    className: (rule.classes as Record<string, unknown>)?.name as string ?? "",
    instructorName: (rule.instructors as Record<string, unknown>)?.name as string ?? "",
  }))

  return (
    <>
      <PageHeader
        title="Timetable"
        description="Your weekly class schedule and recurring rules."
      />
      <TimetableTable
        slots={slots}
        bookingsBySlot={bookingsBySlot}
        classes={classes}
        instructors={instructors}
        weekLabel={weekLabel}
        rules={rules}
        weekDates={weekDates}
      />
      <RealtimeBookingListener studioId={studioId} />
    </>
  )
}
