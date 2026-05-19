"use client"

import { useState, useMemo, useCallback, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CalendarSlotPopover } from "./calendar-slot-popover"
import { AddClassDialog } from "./add-class-dialog"
import { ScheduleFormDialog } from "./schedule-form-dialog"
import { ScheduleRuleDialog } from "./schedule-rule-dialog"
import { getScheduleRule } from "@/app/actions/schedule-rules"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { ChevronLeft, ChevronRight, Plus, Repeat, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { formatTime, dateToDateStr, localDateStr } from "@/lib/utils"
import { DAY_SHORT } from "@/lib/constants"
import type { WeekSlot, StudioHoliday } from "@/lib/types"

interface ClassOption {
  id: string
  name: string
  slug: string
  price_pence: number
  capacity: number
  duration_mins: number
}

interface InstructorOption {
  id: string
  name: string
}

interface MonthCalendarProps {
  slots: WeekSlot[]
  holidays: StudioHoliday[]
  monthStart: string
  monthEnd: string
  gridStart: string
  gridEnd: string
  classes: ClassOption[]
  instructors: InstructorOption[]
}

function ymOf(dateStr: string): string {
  return dateStr.slice(0, 7) // "YYYY-MM"
}

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split("-").map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  return `${yy}-${mm}`
}

function dayOfWeekMon(dateStr: string): number {
  const dow = new Date(dateStr + "T00:00:00").getDay()
  return dow === 0 ? 6 : dow - 1
}

export function MonthCalendar({
  slots,
  holidays,
  monthStart,
  monthEnd,
  gridStart,
  gridEnd,
  classes,
  instructors,
}: MonthCalendarProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => router.push(href))
    },
    [router]
  )

  // Build the list of date strings in the grid
  const gridDates = useMemo(() => {
    const dates: string[] = []
    const cursor = new Date(gridStart + "T00:00:00")
    const end = new Date(gridEnd + "T00:00:00")
    while (cursor <= end) {
      dates.push(dateToDateStr(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    return dates
  }, [gridStart, gridEnd])

  // Group slots by date
  const slotsByDate = useMemo(() => {
    const map = new Map<string, WeekSlot[]>()
    for (const slot of slots) {
      const list = map.get(slot.date) ?? []
      list.push(slot)
      map.set(slot.date, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime))
    }
    return map
  }, [slots])

  // Popover state — same shape as WeekCalendar uses
  const [popoverSlot, setPopoverSlot] = useState<WeekSlot | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)

  // Add dialog state
  const [addOpen, setAddOpen] = useState(false)
  const [addDefaults, setAddDefaults] = useState({
    dayOfWeek: 0,
    date: "",
    startTime: "",
  })

  // Edit one-off slot
  const [editFormOpen, setEditFormOpen] = useState(false)
  const [editingSlot, setEditingSlot] = useState<{
    id: string
    class_id: string
    instructor_id: string
    day_of_week: number
    start_time: string
    end_time: string
  } | null>(null)

  // Edit recurring rule
  const [editRuleOpen, setEditRuleOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<{
    id: string
    class_id: string
    instructor_id: string
    recurrence: string
    day_of_week: number
    start_time: string
    end_time: string
    starts_on: string
    ends_on: string | null
  } | null>(null)

  const monthStr = ymOf(monthStart)
  const monthLabel = new Date(monthStart + "T00:00:00").toLocaleDateString(
    "en-GB",
    { month: "long", year: "numeric" }
  )

  const prevHref = `/dashboard/timetable?view=month&month=${shiftMonth(monthStr, -1)}`
  const nextHref = `/dashboard/timetable?view=month&month=${shiftMonth(monthStr, 1)}`
  const thisMonthHref = `/dashboard/timetable?view=month`
  const switchToWeekHref = `/dashboard/timetable?view=week`
  const todayStr = localDateStr()
  const todayMonth = ymOf(todayStr)
  const isCurrentMonth = monthStr === todayMonth

  async function handleEditFromPopover(slot: WeekSlot) {
    if (slot.ruleId) {
      const rule = await getScheduleRule(slot.ruleId)
      if (!rule) {
        toast.error("Couldn't load this recurring class")
        return
      }
      setEditingRule({
        id: rule.id,
        class_id: rule.class_id,
        instructor_id: rule.instructor_id,
        recurrence: rule.recurrence,
        day_of_week: rule.day_of_week,
        start_time: rule.start_time,
        end_time: rule.end_time,
        starts_on: rule.starts_on,
        ends_on: rule.ends_on,
      })
      setEditRuleOpen(true)
    } else {
      setEditingSlot({
        id: slot.scheduleId,
        class_id: slot.classId,
        instructor_id: slot.instructorId,
        day_of_week: slot.dayOfWeek,
        start_time: slot.startTime,
        end_time: slot.endTime,
      })
      setEditFormOpen(true)
    }
  }

  function holidayBadgeForDate(dateStr: string): StudioHoliday | null {
    return (
      holidays.find(
        (h) =>
          dateStr >= h.start_date &&
          dateStr <= h.end_date &&
          !h.start_time &&
          !h.end_time
      ) ?? null
    )
  }

  function handleEmptyDayClick(dateStr: string) {
    if (dateStr < todayStr) return // can't add classes in the past
    setAddDefaults({
      dayOfWeek: dayOfWeekMon(dateStr),
      date: dateStr,
      startTime: "",
    })
    setAddOpen(true)
  }

  return (
    <>
      <div className="hidden lg:block overflow-hidden rounded-2xl border border-sand bg-white">
        {/* Header: month nav + view toggle */}
        <div className="flex items-center justify-between border-b border-sand px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(prevHref)}
              disabled={isPending}
              className="rounded-full p-1.5 text-warm-grey transition-colors hover:bg-cream hover:text-cocoa disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h3 className="font-heading text-[1.1rem] font-semibold text-cocoa">
              {monthLabel}
            </h3>
            <button
              onClick={() => navigate(nextHref)}
              disabled={isPending}
              className="rounded-full p-1.5 text-warm-grey transition-colors hover:bg-cream hover:text-cocoa disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {isPending && <Loader2 className="h-4 w-4 animate-spin text-gold" />}
          </div>
          <div className="flex items-center gap-2">
            {!isCurrentMonth && (
              <button
                onClick={() => navigate(thisMonthHref)}
                disabled={isPending}
                className="rounded-full border border-sand px-3 py-1 text-[0.72rem] font-semibold text-gold transition-colors hover:border-gold disabled:opacity-50"
              >
                This month
              </button>
            )}
            <div className="flex overflow-hidden rounded-full border border-sand">
              <button
                onClick={() => navigate(switchToWeekHref)}
                disabled={isPending}
                className="px-3 py-1 text-[0.72rem] font-semibold text-warm-grey transition-colors hover:bg-cream disabled:opacity-50"
              >
                Week
              </button>
              <button
                className="bg-cocoa px-3 py-1 text-[0.72rem] font-semibold text-wheat"
                disabled
              >
                Month
              </button>
            </div>
          </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-sand bg-cream/40">
          {DAY_SHORT.map((d) => (
            <div
              key={d}
              className="border-l border-sand px-2 py-2 text-center text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-warm-grey first:border-l-0"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7">
          {gridDates.map((dateStr) => {
            const inMonth =
              dateStr >= monthStart && dateStr <= monthEnd
            const isToday = dateStr === todayStr
            const isPast = dateStr < todayStr
            const daySlots = slotsByDate.get(dateStr) ?? []
            const allDayHoliday = holidayBadgeForDate(dateStr)

            return (
              <div
                key={dateStr}
                className={`group relative min-h-[110px] cursor-pointer border-b border-l border-sand p-1.5 first:border-l-0 ${
                  inMonth ? "bg-white" : "bg-cream/30"
                } ${isToday ? "bg-gold/8" : ""} hover:bg-cream/50`}
                onClick={(e) => {
                  // Only treat clicks on the empty area as "add"
                  if ((e.target as HTMLElement).closest("[data-slot-chip]")) return
                  handleEmptyDayClick(dateStr)
                }}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={`text-[0.72rem] font-semibold ${
                      isToday
                        ? "text-gold"
                        : inMonth
                          ? "text-cocoa"
                          : "text-warm-grey/50"
                    }`}
                  >
                    {dateStr.slice(8, 10).replace(/^0/, "")}
                  </span>
                  {!isPast && inMonth && !allDayHoliday && (
                    <Plus className="h-3 w-3 shrink-0 text-warm-grey/40 opacity-0 group-hover:opacity-100" />
                  )}
                </div>

                {/* Holiday badge */}
                {allDayHoliday && (
                  <div className="mb-1 rounded bg-ember/15 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase text-ember">
                    {allDayHoliday.name}
                  </div>
                )}

                {/* Slot chips */}
                <div className="flex flex-col gap-0.5">
                  {daySlots.slice(0, 4).map((slot) => (
                    <button
                      key={slot.scheduleId + ":" + slot.date}
                      data-slot-chip
                      onClick={(e) => {
                        e.stopPropagation()
                        setPopoverSlot(slot)
                        setPopoverOpen(true)
                      }}
                      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[0.62rem] transition-colors ${
                        slot.isSkipped || slot.isHoliday
                          ? "bg-sand/40 text-warm-grey line-through"
                          : slot.isPast
                            ? "bg-sand/30 text-warm-grey"
                            : "bg-cream hover:bg-gold/20"
                      }`}
                    >
                      <ClassColorBar
                        classSlug={slot.classSlug}
                        className="h-2.5 w-[2px] shrink-0"
                      />
                      <span className="shrink-0 font-semibold text-cocoa">
                        {formatTime(slot.startTime)}
                      </span>
                      <span className="truncate text-cocoa">{slot.className}</span>
                      {slot.ruleId && (
                        <Repeat className="h-2 w-2 shrink-0 text-gold" />
                      )}
                    </button>
                  ))}
                  {daySlots.length > 4 && (
                    <div className="px-1 text-[0.6rem] font-semibold text-warm-grey">
                      +{daySlots.length - 4} more
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Mobile fallback — month view is desktop-only; on mobile show a helpful pointer */}
      <div className="lg:hidden rounded-2xl border border-sand bg-white p-6 text-center">
        <p className="text-[0.85rem] text-cocoa">
          The month view is designed for desktop planning.
        </p>
        <a
          href={switchToWeekHref}
          className="mt-2 inline-block text-[0.78rem] font-semibold text-gold"
        >
          Switch to week view →
        </a>
      </div>

      {/* Slot popover */}
      <CalendarSlotPopover
        slot={popoverSlot}
        open={popoverOpen}
        onOpenChange={(open) => {
          setPopoverOpen(open)
          if (!open) setPopoverSlot(null)
        }}
        onEdit={handleEditFromPopover}
      />

      {/* Add class dialog */}
      <AddClassDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        classes={classes.map((c) => ({
          id: c.id,
          name: c.name,
          duration_mins: c.duration_mins,
        }))}
        instructors={instructors}
        defaultDayOfWeek={addDefaults.dayOfWeek}
        defaultDate={addDefaults.date}
        defaultStartTime={addDefaults.startTime}
      />

      {/* Edit one-off slot */}
      <ScheduleFormDialog
        open={editFormOpen}
        onOpenChange={setEditFormOpen}
        classes={classes.map((c) => ({
          id: c.id,
          name: c.name,
          duration_mins: c.duration_mins,
        }))}
        instructors={instructors}
        editingSlot={editingSlot}
      />

      {/* Edit recurring rule */}
      <ScheduleRuleDialog
        open={editRuleOpen}
        onOpenChange={setEditRuleOpen}
        classes={classes.map((c) => ({
          id: c.id,
          name: c.name,
          duration_mins: c.duration_mins,
        }))}
        instructors={instructors}
        editingRule={editingRule}
      />
    </>
  )
}
