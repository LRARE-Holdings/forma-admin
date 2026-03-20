"use client"

import { useState } from "react"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { CapacityBadge } from "@/components/shared/capacity-badge"
import { formatTime, formatPence, dayName } from "@/lib/utils"
import { EmptyState } from "@/components/shared/empty-state"
import { ScheduleFormDialog } from "./schedule-form-dialog"
import { ScheduleRuleDialog } from "./schedule-rule-dialog"
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog"
import { deleteScheduleSlot } from "@/app/actions/schedule"
import { deleteScheduleRule, pauseScheduleRule } from "@/app/actions/schedule-rules"
import { Button } from "@/components/ui/button"
import { Plus, Repeat, Pause, Trash2 } from "lucide-react"
import { toast } from "sonner"

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

interface SlotRow {
  id: string
  class_id: string
  instructor_id: string
  day_of_week: number
  start_time: string
  end_time: string
  rule_id: string | null
  classes: ClassOption
  instructors: InstructorOption
}

interface RuleRow {
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
}

interface TimetableTableProps {
  slots: SlotRow[]
  bookingsBySlot: Record<string, number>
  classes: ClassOption[]
  instructors: InstructorOption[]
  weekLabel: string
  rules?: RuleRow[]
}

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: "Weekly",
  fortnightly: "Every 2 weeks",
  monthly: "Monthly",
}

export function TimetableTable({
  slots,
  bookingsBySlot,
  classes,
  instructors,
  weekLabel,
  rules = [],
}: TimetableTableProps) {
  // Slot dialog state
  const [formOpen, setFormOpen] = useState(false)
  const [editingSlot, setEditingSlot] = useState<SlotRow | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletingSlot, setDeletingSlot] = useState<SlotRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Rule dialog state
  const [ruleFormOpen, setRuleFormOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RuleRow | null>(null)
  const [deleteRuleOpen, setDeleteRuleOpen] = useState(false)
  const [deletingRule, setDeletingRule] = useState<RuleRow | null>(null)
  const [deleteRuleLoading, setDeleteRuleLoading] = useState(false)

  function openCreateSlot() {
    setEditingSlot(null)
    setFormOpen(true)
  }

  function openEditSlot(slot: SlotRow) {
    setEditingSlot(slot)
    setFormOpen(true)
  }

  function openDeleteSlot(slot: SlotRow) {
    setDeletingSlot(slot)
    setDeleteOpen(true)
  }

  async function handleDeleteSlot() {
    if (!deletingSlot) return
    setDeleteLoading(true)
    try {
      await deleteScheduleSlot(deletingSlot.id)
      toast.success("Schedule slot removed")
      setDeleteOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove slot")
    } finally {
      setDeleteLoading(false)
    }
  }

  function openCreateRule() {
    setEditingRule(null)
    setRuleFormOpen(true)
  }

  function openEditRule(rule: RuleRow) {
    setEditingRule(rule)
    setRuleFormOpen(true)
  }

  function openDeleteRule(rule: RuleRow) {
    setDeletingRule(rule)
    setDeleteRuleOpen(true)
  }

  async function handleDeleteRule() {
    if (!deletingRule) return
    setDeleteRuleLoading(true)
    try {
      await deleteScheduleRule(deletingRule.id)
      toast.success("Schedule rule deleted")
      setDeleteRuleOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete rule")
    } finally {
      setDeleteRuleLoading(false)
    }
  }

  async function handlePauseRule(rule: RuleRow) {
    try {
      await pauseScheduleRule(rule.id)
      toast.success("Rule paused")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to pause rule")
    }
  }

  // Group slots by day
  const slotsByDay: Record<number, SlotRow[]> = {}
  for (const slot of slots) {
    if (!slotsByDay[slot.day_of_week]) slotsByDay[slot.day_of_week] = []
    slotsByDay[slot.day_of_week].push(slot)
  }
  const days = Object.keys(slotsByDay)
    .map(Number)
    .sort((a, b) => a - b)

  return (
    <>
      {/* Weekly timetable */}
      <div className="overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="flex items-center justify-between border-b border-sand px-5 py-4">
          <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
            {weekLabel}
          </h3>
          <div className="flex gap-2">
            {slots.length > 0 && (
              <Button onClick={openCreateSlot} size="sm" variant="outline">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                One-off slot
              </Button>
            )}
            <Button onClick={openCreateRule} size="sm">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add class
            </Button>
          </div>
        </div>
        {slots.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No schedule yet"
            description="Add recurring classes to build your weekly timetable."
            action={
              <Button onClick={openCreateRule} size="sm">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add class
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-sand">
            {days.map((day) => (
              <div key={day}>
                <div className="bg-cream/60 px-5 py-2">
                  <span className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-cocoa">
                    {dayName(day)}
                  </span>
                  <span className="ml-2 text-[0.65rem] text-warm-grey">
                    {slotsByDay[day].length} class{slotsByDay[day].length !== 1 ? "es" : ""}
                  </span>
                </div>
                <div>
                  {slotsByDay[day].map((slot) => {
                    const cls = slot.classes
                    const instructor = slot.instructors
                    const booked = bookingsBySlot[slot.id] ?? 0
                    const capacity = cls.capacity ?? 10

                    return (
                      <div
                        key={slot.id}
                        className="flex items-center gap-4 border-b border-sand/30 px-5 py-2.5 transition-colors last:border-b-0 hover:bg-cream/40"
                      >
                        {/* Time */}
                        <div className="w-[90px] shrink-0">
                          <div className="text-[0.82rem] font-semibold text-cocoa">
                            {formatTime(slot.start_time)}
                          </div>
                          <div className="text-[0.68rem] text-warm-grey">
                            {formatTime(slot.end_time)}
                          </div>
                        </div>

                        {/* Class + Instructor + recurring badge */}
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <ClassColorBar
                            classSlug={cls.slug}
                            className="w-[3px] h-8"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[0.82rem] font-medium text-cocoa">
                                {cls.name}
                              </span>
                              {slot.rule_id && (
                                <Repeat className="h-3 w-3 shrink-0 text-gold" />
                              )}
                            </div>
                            <div className="truncate text-[0.7rem] text-warm-grey">
                              {instructor.name}
                            </div>
                          </div>
                        </div>

                        {/* Price */}
                        <div className="hidden w-[70px] shrink-0 text-right text-[0.78rem] text-slate sm:block">
                          &pound;{formatPence(cls.price_pence)}
                        </div>

                        {/* Capacity */}
                        <div className="w-[80px] shrink-0 text-right">
                          <CapacityBadge booked={booked} capacity={capacity} />
                        </div>

                        {/* Actions */}
                        <div className="flex w-[100px] shrink-0 items-center justify-end gap-3">
                          <button
                            onClick={() => openEditSlot(slot)}
                            className="text-[0.75rem] font-semibold text-gold hover:text-ember"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => openDeleteSlot(slot)}
                            className="text-[0.75rem] font-semibold text-warm-grey hover:text-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Schedule rules section */}
      {rules.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-sand bg-white">
          <div className="flex items-center justify-between border-b border-sand px-5 py-4">
            <div>
              <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
                Recurring rules
              </h3>
              <p className="mt-0.5 text-[0.7rem] text-warm-grey">
                These rules automatically generate weekly schedule slots.
              </p>
            </div>
            <Button onClick={openCreateRule} size="sm">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add rule
            </Button>
          </div>
          <div className="divide-y divide-sand/40">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-cream/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.82rem] font-medium text-cocoa">
                      {rule.className}
                    </span>
                    <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[0.62rem] font-semibold text-gold">
                      {RECURRENCE_LABELS[rule.recurrence] ?? rule.recurrence}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[0.7rem] text-warm-grey">
                    {dayName(rule.day_of_week)} {formatTime(rule.start_time)}–{formatTime(rule.end_time)} &middot; {rule.instructorName}
                    {rule.ends_on && (
                      <> &middot; Until {new Date(rule.ends_on + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEditRule(rule)}
                    className="text-[0.75rem] font-semibold text-gold hover:text-ember"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handlePauseRule(rule)}
                    className="p-1 text-warm-grey hover:text-ember"
                    title="Pause rule"
                  >
                    <Pause className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => openDeleteRule(rule)}
                    className="p-1 text-warm-grey hover:text-red-600"
                    title="Delete rule"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Slot form dialog (one-off edits) */}
      <ScheduleFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        classes={classes.map((c) => ({ id: c.id, name: c.name, duration_mins: c.duration_mins }))}
        instructors={instructors}
        editingSlot={editingSlot}
      />

      {/* Rule form dialog (recurring) */}
      <ScheduleRuleDialog
        open={ruleFormOpen}
        onOpenChange={setRuleFormOpen}
        classes={classes.map((c) => ({ id: c.id, name: c.name, duration_mins: c.duration_mins }))}
        instructors={instructors}
        editingRule={editingRule}
      />

      {/* Delete slot confirmation */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove slot"
        description={`Remove this ${deletingSlot?.classes.name ?? ""} slot from the timetable?`}
        onConfirm={handleDeleteSlot}
        loading={deleteLoading}
        actionLabel="Remove"
      />

      {/* Delete rule confirmation */}
      <DeleteConfirmDialog
        open={deleteRuleOpen}
        onOpenChange={setDeleteRuleOpen}
        title="Delete rule"
        description={`Delete the recurring rule for ${deletingRule?.className ?? "this class"}? Already-generated slots will remain.`}
        onConfirm={handleDeleteRule}
        loading={deleteRuleLoading}
        actionLabel="Delete"
      />
    </>
  )
}
