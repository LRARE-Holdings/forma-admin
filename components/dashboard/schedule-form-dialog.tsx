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
import { createScheduleSlot, updateScheduleSlot } from "@/app/actions/schedule"
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

interface SlotData {
  id: string
  class_id: string
  instructor_id: string
  day_of_week: number
  start_time: string
  end_time: string
}

interface ScheduleFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: ClassOption[]
  instructors: InstructorOption[]
  editingSlot?: SlotData | null
}

const DAY_OPTIONS = [
  { value: "0", label: "Monday" },
  { value: "1", label: "Tuesday" },
  { value: "2", label: "Wednesday" },
  { value: "3", label: "Thursday" },
  { value: "4", label: "Friday" },
  { value: "5", label: "Saturday" },
  { value: "6", label: "Sunday" },
]

export function ScheduleFormDialog({
  open,
  onOpenChange,
  classes,
  instructors,
  editingSlot,
}: ScheduleFormDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const isEditing = !!editingSlot

  const [classId, setClassId] = useState("")
  const [instructorId, setInstructorId] = useState("")
  const [dayOfWeek, setDayOfWeek] = useState("")
  const [duration, setDuration] = useState("60")

  useEffect(() => {
    if (open && editingSlot) {
      setClassId(editingSlot.class_id)
      setInstructorId(editingSlot.instructor_id)
      setDayOfWeek(String(editingSlot.day_of_week))
      setDuration(getDuration(editingSlot.start_time, editingSlot.end_time))
    } else if (!open) {
      setClassId("")
      setInstructorId("")
      setDayOfWeek("")
      setDuration("60")
      formRef.current?.reset()
    }
  }, [open, editingSlot])

  async function handleSubmit(formData: FormData) {
    if (!classId || !instructorId || !dayOfWeek) {
      toast.error("Please fill in all fields")
      return
    }
    const startTime = formData.get("start_time") as string
    if (!startTime) {
      toast.error("Please set a start time")
      return
    }
    // Compute end_time from start_time + duration
    formData.set("end_time", addMinutes(startTime, parseInt(duration)))
    try {
      if (isEditing) {
        await updateScheduleSlot(editingSlot!.id, formData)
        toast.success("Schedule slot updated")
      } else {
        await createScheduleSlot(formData)
        toast.success("Schedule slot added")
      }
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit slot" : "Add slot"}</DialogTitle>
        </DialogHeader>
        <form ref={formRef} key={editingSlot?.id ?? "new"} action={handleSubmit} className="space-y-4">
          {/* Hidden inputs for select values */}
          <input type="hidden" name="class_id" value={classId} />
          <input type="hidden" name="instructor_id" value={instructorId} />
          <input type="hidden" name="day_of_week" value={dayOfWeek} />

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
                <SelectValue placeholder="Select an instructor">
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

          <div>
            <Label>Day</Label>
            <Select value={dayOfWeek} onValueChange={(v) => setDayOfWeek(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a day">
                  {dayOfWeek ? DAY_OPTIONS.find((d) => d.value === dayOfWeek)?.label : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="start_time">Start time</Label>
              <Input
                id="start_time"
                name="start_time"
                type="time"
                required
                defaultValue={editingSlot?.start_time?.slice(0, 5) ?? ""}
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

          <DialogFooter>
            <SubmitButton>{isEditing ? "Save changes" : "Add slot"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
