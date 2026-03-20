"use client"

import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { SubmitButton } from "@/components/shared/submit-button"
import { createScheduleRule, updateScheduleRule } from "@/app/actions/schedule-rules"
import { toast } from "sonner"

interface ClassOption {
  id: string
  name: string
  duration_mins: number
}

interface InstructorOption {
  id: string
  name: string
}

interface RuleData {
  id: string
  class_id: string
  instructor_id: string
  recurrence: string
  day_of_week: number
  start_time: string
  end_time: string
  starts_on: string
  ends_on: string | null
}

interface ScheduleRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: ClassOption[]
  instructors: InstructorOption[]
  editingRule?: RuleData | null
}

const DAY_OPTIONS = [
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
]

const RECURRENCE_OPTIONS = [
  { value: "weekly", label: "Every week" },
  { value: "fortnightly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
]

const DURATION_OPTIONS = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hr" },
  { value: "120", label: "2 hr" },
]

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number)
  const total = h * 60 + m + minutes
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0")
  const mm = String(total % 60).padStart(2, "0")
  return `${hh}:${mm}`
}

function getDuration(startTime: string, endTime: string): string {
  const [sh, sm] = startTime.split(":").map(Number)
  const [eh, em] = endTime.split(":").map(Number)
  const diff = (eh * 60 + em) - (sh * 60 + sm)
  return String(diff > 0 ? diff : 60)
}

type EndMode = "forever" | "until_date" | "after_weeks"

export function ScheduleRuleDialog({
  open,
  onOpenChange,
  classes,
  instructors,
  editingRule,
}: ScheduleRuleDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const isEditing = !!editingRule

  const [classId, setClassId] = useState("")
  const [instructorId, setInstructorId] = useState("")
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(null)
  const [recurrence, setRecurrence] = useState("weekly")
  const [duration, setDuration] = useState("60")
  const [endMode, setEndMode] = useState<EndMode>("forever")
  const [endsOn, setEndsOn] = useState("")
  const [afterWeeks, setAfterWeeks] = useState("12")

  // Calculate default start date (next occurrence of selected day)
  function getDefaultStartDate(dow: number): string {
    const today = new Date()
    const jsDow = today.getDay()
    const ourDow = jsDow === 0 ? 6 : jsDow - 1
    let daysAhead = dow - ourDow
    if (daysAhead <= 0) daysAhead += 7
    const next = new Date(today)
    next.setDate(next.getDate() + daysAhead)
    return next.toISOString().split("T")[0]
  }

  // Calculate end date from "after X weeks"
  function getEndDateFromWeeks(startDate: string, weeks: number): string {
    const d = new Date(startDate + "T00:00:00")
    d.setDate(d.getDate() + weeks * 7)
    return d.toISOString().split("T")[0]
  }

  useEffect(() => {
    if (open && editingRule) {
      setClassId(editingRule.class_id)
      setInstructorId(editingRule.instructor_id)
      setDayOfWeek(editingRule.day_of_week)
      setRecurrence(editingRule.recurrence)
      setDuration(getDuration(editingRule.start_time, editingRule.end_time))
      if (editingRule.ends_on) {
        setEndMode("until_date")
        setEndsOn(editingRule.ends_on)
      } else {
        setEndMode("forever")
        setEndsOn("")
      }
    } else if (!open) {
      setClassId("")
      setInstructorId("")
      setDayOfWeek(null)
      setRecurrence("weekly")
      setDuration("60")
      setEndMode("forever")
      setEndsOn("")
      setAfterWeeks("12")
      formRef.current?.reset()
    }
  }, [open, editingRule])

  async function handleSubmit(formData: FormData) {
    if (!classId || !instructorId || dayOfWeek === null) {
      toast.error("Please fill in all fields")
      return
    }

    // Calculate the actual ends_on value
    const startsOn = formData.get("starts_on") as string
    let finalEndsOn: string | null = null
    if (endMode === "until_date") {
      finalEndsOn = endsOn || null
    } else if (endMode === "after_weeks") {
      const weeks = parseInt(afterWeeks) || 12
      finalEndsOn = getEndDateFromWeeks(startsOn, weeks)
    }

    // Compute end_time from start_time + duration
    const startTime = formData.get("start_time") as string
    if (!startTime) {
      toast.error("Please set a start time")
      return
    }
    const endTime = addMinutes(startTime, parseInt(duration))

    // Build a new FormData with computed values
    const fd = new FormData()
    fd.set("class_id", classId)
    fd.set("instructor_id", instructorId)
    fd.set("day_of_week", String(dayOfWeek))
    fd.set("start_time", startTime)
    fd.set("end_time", endTime)
    fd.set("recurrence", recurrence)
    fd.set("starts_on", startsOn)
    if (finalEndsOn) fd.set("ends_on", finalEndsOn)

    try {
      if (isEditing) {
        await updateScheduleRule(editingRule!.id, fd)
        toast.success("Schedule rule updated")
      } else {
        await createScheduleRule(fd)
        toast.success("Recurring class added")
      }
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    }
  }

  const defaultStartDate = dayOfWeek !== null ? getDefaultStartDate(dayOfWeek) : ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit recurring class" : "Add recurring class"}</DialogTitle>
        </DialogHeader>
        <form ref={formRef} key={editingRule?.id ?? "new"} action={handleSubmit} className="space-y-5">
          {/* Class & Instructor */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Class</Label>
              <Select value={classId} onValueChange={(v) => {
                const id = v ?? ""
                setClassId(id)
                const cls = classes.find((c) => c.id === id)
                if (cls) setDuration(String(cls.duration_mins))
              }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a class">
                    {classId ? classes.find((c) => c.id === classId)?.name : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {classes.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Instructor</Label>
              <Select value={instructorId} onValueChange={(v) => setInstructorId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select">
                    {instructorId ? instructors.find((i) => i.id === instructorId)?.name : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {instructors.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Day pills */}
          <div>
            <Label>Day</Label>
            <div className="mt-1.5 flex gap-1.5">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDayOfWeek(d.value)}
                  className={`rounded-full border px-3.5 py-1.5 text-[0.78rem] font-semibold transition-all ${
                    dayOfWeek === d.value
                      ? "border-cocoa bg-cocoa text-wheat"
                      : "border-sand bg-white text-slate hover:border-gold"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="start_time">Start time</Label>
              <Input
                id="start_time"
                name="start_time"
                type="time"
                required
                defaultValue={editingRule?.start_time?.slice(0, 5) ?? ""}
              />
            </div>
            <div>
              <Label>Duration</Label>
              <Select value={duration} onValueChange={(v) => setDuration(v ?? "60")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Repeats pills */}
          <div>
            <Label>Repeats</Label>
            <div className="mt-1.5 flex gap-1.5">
              {RECURRENCE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRecurrence(r.value)}
                  className={`rounded-full border px-3.5 py-1.5 text-[0.78rem] font-semibold transition-all ${
                    recurrence === r.value
                      ? "border-cocoa bg-cocoa text-wheat"
                      : "border-sand bg-white text-slate hover:border-gold"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Starts on */}
          <div>
            <Label htmlFor="starts_on">Starts</Label>
            <Input
              id="starts_on"
              name="starts_on"
              type="date"
              required
              defaultValue={editingRule?.starts_on ?? defaultStartDate}
              key={`start-${dayOfWeek}-${editingRule?.id ?? "new"}`}
            />
          </div>

          {/* Ends */}
          <div>
            <Label>Ends</Label>
            <div className="mt-1.5 flex gap-1.5">
              {(
                [
                  { value: "forever", label: "Runs forever" },
                  { value: "until_date", label: "Until date" },
                  { value: "after_weeks", label: "After X weeks" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEndMode(opt.value)}
                  className={`rounded-full border px-3.5 py-1.5 text-[0.78rem] font-semibold transition-all ${
                    endMode === opt.value
                      ? "border-cocoa bg-cocoa text-wheat"
                      : "border-sand bg-white text-slate hover:border-gold"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {endMode === "until_date" && (
              <div className="mt-2">
                <Input
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                  placeholder="End date"
                />
              </div>
            )}
            {endMode === "after_weeks" && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  max="52"
                  value={afterWeeks}
                  onChange={(e) => setAfterWeeks(e.target.value)}
                  className="w-20"
                />
                <span className="text-[0.8rem] text-warm-grey">weeks</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <SubmitButton>{isEditing ? "Save changes" : "Add class"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
