import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { PageHeader } from "@/components/shared/page-header"
import { WeekCalendar } from "@/components/dashboard/week-calendar"
import { HolidayBanner } from "@/components/dashboard/holiday-banner"
import { RealtimeBookingListener } from "@/components/dashboard/realtime-booking-listener"
import { getWeekData } from "@/lib/schedule-utils"

// Bypass client-side router cache so ?week= changes always re-fetch server data
export const dynamic = "force-dynamic"

interface TimetablePageProps {
  searchParams: Promise<{ week?: string }>
}

export default async function TimetablePage({
  searchParams,
}: TimetablePageProps) {
  const params = await searchParams
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Resolve week start (always a Monday)
  function getMondayStr(date: Date): string {
    const dow = date.getDay()
    const offset = dow === 0 ? -6 : 1 - dow
    const monday = new Date(date)
    monday.setDate(date.getDate() + offset)
    return monday.toISOString().split("T")[0]
  }

  let weekStart: string
  if (params.week) {
    weekStart = getMondayStr(new Date(params.week + "T00:00:00"))
  } else {
    weekStart = getMondayStr(new Date())
  }

  // Fetch week data and class/instructor options in parallel
  const [weekData, classesRes, instructorsRes] = await Promise.all([
    getWeekData(studioId, weekStart),
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
  ])

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

  const isCurrentWeek = weekStart === getMondayStr(new Date())

  return (
    <>
      <PageHeader
        title="Timetable"
        description="Your weekly class schedule."
      />
      <HolidayBanner holidays={weekData.holidays} />
      <WeekCalendar
        slots={weekData.slots}
        holidays={weekData.holidays}
        weekStart={weekData.weekStart}
        weekEnd={weekData.weekEnd}
        classes={classes}
        instructors={instructors}
        isCurrentWeek={isCurrentWeek}
      />
      <RealtimeBookingListener studioId={studioId} />
    </>
  )
}
