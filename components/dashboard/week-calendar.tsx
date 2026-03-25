"use client"

import { useState, useMemo } from "react"
import { CalendarSlotBlock } from "./calendar-slot-block"
import { CalendarSlotPopover } from "./calendar-slot-popover"
import { AddClassDialog } from "./add-class-dialog"
import { ScheduleFormDialog } from "./schedule-form-dialog"
import { EmptyState } from "@/components/shared/empty-state"
import { DAY_SHORT } from "@/lib/constants"
import { formatTime } from "@/lib/utils"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { ChevronLeft, ChevronRight, Plus, Repeat } from "lucide-react"
import type { WeekSlot, StudioHoliday } from "@/lib/types"

// --- Constants ---
const START_HOUR = 6
const END_HOUR = 21
const ROW_HEIGHT = 40
const TOTAL_ROWS = (END_HOUR - START_HOUR) * 2

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

interface WeekCalendarProps {
  slots: WeekSlot[]
  holidays: StudioHoliday[]
  weekStart: string
  weekEnd: string
  classes: ClassOption[]
  instructors: InstructorOption[]
  isCurrentWeek: boolean
}

// --- Helpers ---
function getSlotPosition(startTime: string, endTime: string) {
  const [sh, sm] = startTime.split(":").map(Number)
  const [eh, em] = endTime.split(":").map(Number)
  const startMinutes = sh * 60 + sm - START_HOUR * 60
  const endMinutes = eh * 60 + em - START_HOUR * 60
  return {
    top: (startMinutes / 30) * ROW_HEIGHT,
    height: Math.max(((endMinutes - startMinutes) / 30) * ROW_HEIGHT, ROW_HEIGHT),
  }
}

function buildDayHeaders(weekStart: string) {
  const monday = new Date(weekStart + "T00:00:00")
  const todayStr = new Date().toISOString().split("T")[0]
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const dateStr = d.toISOString().split("T")[0]
    return {
      dayOfWeek: i,
      label: DAY_SHORT[i],
      dateNum: d.getDate(),
      dateStr,
      isToday: dateStr === todayStr,
    }
  })
}

const timeLabels = Array.from({ length: TOTAL_ROWS }, (_, i) => {
  const hour = START_HOUR + Math.floor(i / 2)
  const min = i % 2 === 0 ? "00" : "30"
  return `${String(hour).padStart(2, "0")}:${min}`
})

export function WeekCalendar({
  slots,
  holidays,
  weekStart,
  weekEnd,
  classes,
  instructors,
  isCurrentWeek,
}: WeekCalendarProps) {
  const dayHeaders = buildDayHeaders(weekStart)
  const todayDow = (() => {
    const d = new Date()
    const dow = d.getDay()
    return dow === 0 ? 6 : dow - 1
  })()

  // --- State ---
  const [popoverSlot, setPopoverSlot] = useState<WeekSlot | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addDefaults, setAddDefaults] = useState({
    dayOfWeek: 0,
    date: "",
    startTime: "",
  })

  // Edit existing slot/rule
  const [editFormOpen, setEditFormOpen] = useState(false)
  const [editingSlot, setEditingSlot] = useState<{
    id: string
    class_id: string
    instructor_id: string
    day_of_week: number
    start_time: string
    end_time: string
  } | null>(null)

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
    is_active: boolean
    className: string
    instructorName: string
  } | null>(null)

  // Mobile
  const [mobileDay, setMobileDay] = useState(
    isCurrentWeek ? Math.min(todayDow, 6) : 0
  )

  // --- Navigation (plain <a> tags to force full page load with new searchParams) ---
  const prevWeekHref = useMemo(() => {
    const prev = new Date(weekStart + "T00:00:00")
    prev.setDate(prev.getDate() - 7)
    return `/dashboard/timetable?week=${prev.toISOString().split("T")[0]}`
  }, [weekStart])

  const nextWeekHref = useMemo(() => {
    const next = new Date(weekStart + "T00:00:00")
    next.setDate(next.getDate() + 7)
    return `/dashboard/timetable?week=${next.toISOString().split("T")[0]}`
  }, [weekStart])

  const currentWeekHref = "/dashboard/timetable"

  // --- Interactions ---
  function handleEmptyCellClick(dayOfWeek: number, e: React.MouseEvent<HTMLDivElement>) {
    // Don't open if clicking on a slot block (they stopPropagation, but just in case)
    if ((e.target as HTMLElement).closest("[data-slot-block]")) return

    const dayDate = dayHeaders[dayOfWeek].dateStr
    const today = new Date().toISOString().split("T")[0]
    if (dayDate < today) return // Don't add to past days

    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top + e.currentTarget.scrollTop
    const slotIndex = Math.floor(y / ROW_HEIGHT)
    const hour = START_HOUR + Math.floor(slotIndex / 2)
    const min = slotIndex % 2 === 0 ? "00" : "30"
    const clickedTime = `${String(hour).padStart(2, "0")}:${min}`

    setAddDefaults({
      dayOfWeek,
      date: dayDate,
      startTime: clickedTime,
    })
    setAddOpen(true)
  }

  function handleEditSlot(slot: WeekSlot) {
    if (slot.ruleId) {
      // For recurring slots, open the rule editor
      // We don't have full rule data from WeekSlot, so open the form editor instead
      setEditingSlot({
        id: slot.scheduleId,
        class_id: slot.classId,
        instructor_id: slot.instructorId,
        day_of_week: slot.dayOfWeek,
        start_time: slot.startTime,
        end_time: slot.endTime,
      })
      setEditFormOpen(true)
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

  function isHolidayDate(dateStr: string): boolean {
    return holidays.some(
      (h) => dateStr >= h.start_date && dateStr <= h.end_date
    )
  }

  const weekLabel = new Date(weekStart + "T00:00:00").toLocaleDateString(
    "en-GB",
    { day: "numeric", month: "long", year: "numeric" }
  )

  // --- Mobile data ---
  const mobileDaySlots = slots
    .filter((s) => s.dayOfWeek === mobileDay)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const mobileDayDate = dayHeaders[mobileDay]?.dateStr ?? ""
  const mobileDayIsPast =
    mobileDayDate < new Date().toISOString().split("T")[0]

  return (
    <>
      {/* ========== DESKTOP CALENDAR ========== */}
      <div className="hidden lg:block overflow-hidden rounded-2xl border border-sand bg-white">
        {/* Header: week navigation */}
        <div className="flex items-center justify-between border-b border-sand px-5 py-3">
          <div className="flex items-center gap-3">
            <a
              href={prevWeekHref}
              className="rounded-full p-1.5 text-warm-grey transition-colors hover:bg-cream hover:text-cocoa"
            >
              <ChevronLeft className="h-4 w-4" />
            </a>
            <h3 className="font-heading text-[1.1rem] font-semibold text-cocoa">
              Week of {weekLabel}
            </h3>
            <a
              href={nextWeekHref}
              className="rounded-full p-1.5 text-warm-grey transition-colors hover:bg-cream hover:text-cocoa"
            >
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>
          <div className="flex items-center gap-2">
            {!isCurrentWeek && (
              <a
                href={currentWeekHref}
                className="rounded-full border border-sand px-3 py-1 text-[0.72rem] font-semibold text-gold transition-colors hover:border-gold"
              >
                Today
              </a>
            )}
          </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-sand">
          <div />
          {dayHeaders.map(({ dayOfWeek, label, dateNum, isToday }) => (
            <div
              key={dayOfWeek}
              className={`border-l border-sand px-2 py-2 text-center ${
                isToday ? "bg-gold/8" : ""
              }`}
            >
              <div className="text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
                {label}
              </div>
              <div
                className={`text-[0.95rem] font-semibold ${
                  isToday ? "text-gold" : "text-cocoa"
                }`}
              >
                {dateNum}
              </div>
            </div>
          ))}
        </div>

        {/* Grid body */}
        <div
          className="grid grid-cols-[60px_repeat(7,1fr)] overflow-y-auto"
          style={{ height: `${Math.min(TOTAL_ROWS * ROW_HEIGHT, 600)}px` }}
        >
          {/* Time labels */}
          <div className="relative border-r border-sand">
            {timeLabels.map((time, i) =>
              i % 2 === 0 ? (
                <div
                  key={time}
                  className="absolute right-2 text-[0.62rem] text-warm-grey"
                  style={{ top: `${i * ROW_HEIGHT + 2}px` }}
                >
                  {time}
                </div>
              ) : null
            )}
          </div>

          {/* 7 day columns */}
          {dayHeaders.map(({ dayOfWeek, dateStr, isToday }) => {
            const daySlots = slots
              .filter((s) => s.dayOfWeek === dayOfWeek)
              .sort((a, b) => a.startTime.localeCompare(b.startTime))

            const holidayForDay = holidays.find(
              (h) => dateStr >= h.start_date && dateStr <= h.end_date
            )

            return (
              <div
                key={dayOfWeek}
                className={`relative border-l border-sand cursor-pointer ${
                  isToday ? "bg-gold/4" : ""
                }`}
                style={{ height: `${TOTAL_ROWS * ROW_HEIGHT}px` }}
                onClick={(e) => handleEmptyCellClick(dayOfWeek, e)}
              >
                {/* Gridlines */}
                {timeLabels.map((_, i) => (
                  <div
                    key={i}
                    className={`absolute left-0 right-0 border-t ${
                      i % 2 === 0 ? "border-sand/60" : "border-sand/30"
                    }`}
                    style={{ top: `${i * ROW_HEIGHT}px` }}
                  />
                ))}

                {/* Holiday overlay */}
                {holidayForDay && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-ember/6 pt-3">
                    <span className="rounded-full bg-ember/15 px-2.5 py-0.5 text-[0.62rem] font-semibold text-ember">
                      {holidayForDay.name}
                    </span>
                  </div>
                )}

                {/* Slot blocks */}
                {daySlots.map((slot) => (
                  <CalendarSlotBlock
                    key={slot.scheduleId}
                    slot={slot}
                    position={getSlotPosition(slot.startTime, slot.endTime)}
                    onClick={(e) => {
                      e.stopPropagation()
                      setPopoverSlot(slot)
                      setPopoverOpen(true)
                    }}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* ========== MOBILE CALENDAR ========== */}
      <div className="lg:hidden">
        {/* Week navigation */}
        <div className="mb-4 flex items-center justify-between">
          <a
            href={prevWeekHref}
            className="rounded-full p-2 text-warm-grey hover:text-cocoa"
          >
            <ChevronLeft className="h-4 w-4" />
          </a>
          <div className="text-center">
            <h3 className="font-heading text-[1rem] font-semibold text-cocoa">
              Week of {weekLabel}
            </h3>
            {!isCurrentWeek && (
              <a
                href={currentWeekHref}
                className="mt-0.5 text-[0.72rem] font-semibold text-gold hover:text-ember"
              >
                Go to today
              </a>
            )}
          </div>
          <a
            href={nextWeekHref}
            className="rounded-full p-2 text-warm-grey hover:text-cocoa"
          >
            <ChevronRight className="h-4 w-4" />
          </a>
        </div>

        {/* Day pills */}
        <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
          {dayHeaders.map(({ dayOfWeek, label, dateNum, isToday }) => (
            <button
              key={dayOfWeek}
              onClick={() => setMobileDay(dayOfWeek)}
              className={`flex flex-col items-center rounded-full border px-4 py-2 text-[0.75rem] font-semibold transition-all ${
                mobileDay === dayOfWeek
                  ? "border-cocoa bg-cocoa text-wheat"
                  : isToday
                    ? "border-gold bg-white text-cocoa"
                    : "border-sand bg-white text-slate hover:border-gold"
              }`}
            >
              <span
                className={`text-[0.62rem] font-medium ${
                  mobileDay === dayOfWeek ? "text-gold" : "text-warm-grey"
                }`}
              >
                {label}
              </span>
              {dateNum}
            </button>
          ))}
        </div>

        {/* Holiday indicator */}
        {isHolidayDate(mobileDayDate) && (
          <div className="mb-3 rounded-xl bg-ember/10 px-4 py-2.5 text-center text-[0.82rem] font-medium text-cocoa">
            🏖️ Studio holiday
          </div>
        )}

        {/* Day slots */}
        <div className="space-y-2">
          {mobileDaySlots.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="No classes"
              description="No classes scheduled for this day."
            />
          ) : (
            mobileDaySlots.map((slot) => (
              <button
                key={slot.scheduleId}
                onClick={() => {
                  setPopoverSlot(slot)
                  setPopoverOpen(true)
                }}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                  slot.isSkipped
                    ? "border-sand/60 bg-sand/20 opacity-60"
                    : slot.isHoliday
                      ? "border-ember/20 bg-ember/5 opacity-60"
                      : slot.isPast
                        ? "border-sand bg-white/80 opacity-70"
                        : "border-sand bg-white hover:border-gold"
                }`}
              >
                <ClassColorBar
                  classSlug={slot.classSlug}
                  className="w-[3px] h-10"
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={`flex items-center gap-1.5 ${slot.isSkipped ? "line-through" : ""}`}
                  >
                    <span className="truncate text-[0.85rem] font-semibold text-cocoa">
                      {slot.className}
                    </span>
                    {slot.ruleId && (
                      <Repeat className="h-3 w-3 shrink-0 text-gold" />
                    )}
                  </div>
                  <div className="text-[0.72rem] text-warm-grey">
                    {formatTime(slot.startTime)}–{formatTime(slot.endTime)}{" "}
                    &middot; {slot.instructorName}
                  </div>
                </div>
                <span
                  className={`text-[0.7rem] font-semibold ${
                    slot.bookingCount >= slot.capacity
                      ? "text-warm-grey"
                      : slot.bookingCount >= slot.capacity * 0.7
                        ? "text-ember"
                        : "text-success"
                  }`}
                >
                  {slot.bookingCount}/{slot.capacity}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Add button */}
        {!mobileDayIsPast && !isHolidayDate(mobileDayDate) && (
          <button
            onClick={() => {
              setAddDefaults({
                dayOfWeek: mobileDay,
                date: mobileDayDate,
                startTime: "",
              })
              setAddOpen(true)
            }}
            className="mt-3 w-full rounded-xl border border-dashed border-sand py-3 text-[0.78rem] font-semibold text-gold transition-colors hover:border-gold"
          >
            <Plus className="mr-1.5 inline h-3.5 w-3.5" />
            Add class
          </button>
        )}
      </div>

      {/* ========== DIALOGS ========== */}

      {/* Slot popover */}
      <CalendarSlotPopover
        slot={popoverSlot}
        open={popoverOpen}
        onOpenChange={(open) => {
          setPopoverOpen(open)
          if (!open) setPopoverSlot(null)
        }}
        onEdit={handleEditSlot}
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

      {/* Edit slot dialog */}
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
    </>
  )
}
