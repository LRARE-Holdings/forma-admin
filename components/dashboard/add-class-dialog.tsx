"use client"

import { useEffect, useRef, useState } from "react"
import { dateToDateStr } from "@/lib/utils"
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
import { createScheduleSlot } from "@/app/actions/schedule"
import { createScheduleRule } from "@/app/actions/schedule-rules"
import { toast } from "sonner"
import { DAY_SHORT } from "@/lib/constants"

interface ClassOption {
  id: string
  name: string
  duration_mins: number
}

interface InstructorOption {
  id: string
  name: string
}

interface AddClassDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: ClassOption[]
  instructors: InstructorOption[]
  defaultDayOfWeek: number
  defaultDate: string
  defaultStartTime: string
}

const DURATION_OPTIONS = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hr" },
  { value: "90", label: "1.5 hr" },
  { value: "120", label: "2 hr" },
]

const RECURRENCE_OPTIONS = [
  { value: "weekly", label: "Every week" },
  { value: "fortnightly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
]

type EndMode = "forever" | "until_date" | "after_weeks"

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number)
  const total = h * 60 + m + minutes
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0")
  const mm = String(total % 60).padStart(2, "0")
  return `${hh}:${mm}`
}

function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + "T00:00:00")
  d.setDate(d.getDate() + weeks * 7)
  return dateToDateStr(d)
}

export function AddClassDialog({
  open,
  onOpenChange,
  classes,
  instructors,
  defaultDayOfWeek,
  defaultDate,
  defaultStartTime,
}: AddClassDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)

  const [mode, setMode] = useState<"one-off" | "regular">("regular")
  const [classId, setClassId] = useState("")
  const [instructorId, setInstructorId] = useState("")
  const [duration, setDuration] = useState("60")
  const [recurrence, setRecurrence] = useState("weekly")
  const [endMode, setEndMode] = useState<EndMode>("forever")
  const [endsOn, setEndsOn] = useState("")
  const [afterWeeks, setAfterWeeks] = useState(12)

  useEffect(() => {
    if (!open) {
      setMode("regular")
      setClassId("")
      setInstructorId("")
      setDuration("60")
      setRecurrence("weekly")
      setEndMode("forever")
      setEndsOn("")
      setAfterWeeks(12)
      formRef.current?.reset()
    }
  }, [open])

  async function handleSubmit(formData: FormData) {
    if (!classId || !instructorId) {
      toast.error("Please select a class and instructor")
      return
    }

    const startTime = formData.get("start_time") as string
    if (!startTime) {
      toast.error("Please set a start time")
      return
    }

    const endTime = addMinutes(startTime, parseInt(duration))

    try {
      if (mode === "one-off") {
        formData.set("class_id", classId)
        formData.set("instructor_id", instructorId)
        formData.set("day_of_week", String(defaultDayOfWeek))
        formData.set("end_time", endTime)
        await createScheduleSlot(formData)
        toast.success("Class added to timetable")
      } else {
        formData.set("class_id", classId)
        formData.set("instructor_id", instructorId)
        formData.set("day_of_week", String(defaultDayOfWeek))
        formData.set("end_time", endTime)
        formData.set("recurrence", recurrence)
        formData.set("starts_on", defaultDate)

        if (endMode === "until_date" && endsOn) {
          formData.set("ends_on", endsOn)
        } else if (endMode === "after_weeks" && afterWeeks > 0) {
          formData.set("ends_on", addWeeks(defaultDate, afterWeeks))
        }
        // "forever" → no ends_on

        await createScheduleRule(formData)
        toast.success("Recurring class added")
      }
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    }
  }

  const formattedDate = defaultDate
    ? new Date(defaultDate + "T00:00:00").toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add class</DialogTitle>
        </DialogHeader>

        <form ref={formRef} action={handleSubmit} className="space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            {(["one-off", "regular"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-full border px-3.5 py-1.5 text-[0.78rem] font-semibold transition-all ${
                  mode === m
                    ? "border-cocoa bg-cocoa text-wheat"
                    : "border-sand bg-white text-slate hover:border-gold"
                }`}
              >
                {m === "one-off" ? "One-off" : "Regular"}
              </button>
            ))}
          </div>

          {/* Date context */}
          <div className="rounded-lg bg-cream/60 px-3 py-2 text-[0.78rem] text-cocoa">
            {DAY_SHORT[defaultDayOfWeek]}, {formattedDate}
          </div>

          {/* Class select */}
          <div>
            <Label>Class</Label>
            <Select
              value={classId}
              onValueChange={(v) => {
                const id = v ?? ""
                setClassId(id)
                const cls = classes.find((c) => c.id === id)
                if (cls) setDuration(String(cls.duration_mins))
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a class">
                  {classId
                    ? classes.find((c) => c.id === classId)?.name
                    : null}
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

          {/* Instructor select */}
          <div>
            <Label>Instructor</Label>
            <Select
              value={instructorId}
              onValueChange={(v) => setInstructorId(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select an instructor">
                  {instructorId
                    ? instructors.find((i) => i.id === instructorId)?.name
                    : null}
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

          {/* Time + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="start_time">Start time</Label>
              <Input
                id="start_time"
                name="start_time"
                type="time"
                required
                defaultValue={defaultStartTime?.slice(0, 5) ?? ""}
              />
            </div>
            <div>
              <Label>Duration</Label>
              <Select
                value={duration}
                onValueChange={(v) => setDuration(v ?? "60")}
              >
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

          {/* Recurring options */}
          {mode === "regular" && (
            <>
              {/* Recurrence */}
              <div>
                <Label>Repeats</Label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {RECURRENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRecurrence(opt.value)}
                      className={`rounded-full border px-3 py-1.5 text-[0.75rem] font-semibold transition-all ${
                        recurrence === opt.value
                          ? "border-cocoa bg-cocoa text-wheat"
                          : "border-sand bg-white text-slate hover:border-gold"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* End mode */}
              <div>
                <Label>Ends</Label>
                <div className="mt-1.5 flex flex-wrap gap-2">
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
                      className={`rounded-full border px-3 py-1.5 text-[0.75rem] font-semibold transition-all ${
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
                      min={defaultDate}
                    />
                  </div>
                )}
                {endMode === "after_weeks" && (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={52}
                      value={afterWeeks}
                      onChange={(e) =>
                        setAfterWeeks(parseInt(e.target.value) || 12)
                      }
                      className="w-20"
                    />
                    <span className="text-[0.82rem] text-warm-grey">weeks</span>
                  </div>
                )}
              </div>
            </>
          )}

          <DialogFooter>
            <SubmitButton>
              {mode === "one-off" ? "Add one-off class" : "Add recurring class"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
