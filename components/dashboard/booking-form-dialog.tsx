"use client"

import { useEffect, useRef, useState, useTransition } from "react"
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { ChevronsUpDown, Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatTime } from "@/lib/utils"
import { SubmitButton } from "@/components/shared/submit-button"
import {
  createManualBooking,
  getSessionsForDate,
  type SessionOption,
} from "@/app/actions/bookings"
import { toast } from "sonner"

export interface MemberOption {
  id: string
  name: string
  credits: number
  hasMembership: boolean
}

interface BookingFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  members: MemberOption[]
}

export function BookingFormDialog({
  open,
  onOpenChange,
  members,
}: BookingFormDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [profileId, setProfileId] = useState("")
  const [date, setDate] = useState("")
  const [scheduleId, setScheduleId] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("")
  const [memberOpen, setMemberOpen] = useState(false)

  const [sessions, setSessions] = useState<SessionOption[]>([])
  const [loadingSessions, startLoadingSessions] = useTransition()

  const selectedMember = members.find((m) => m.id === profileId)

  // Reset on close
  useEffect(() => {
    if (!open) {
      setProfileId("")
      setDate("")
      setScheduleId("")
      setPaymentMethod("")
      setSessions([])
      formRef.current?.reset()
    }
  }, [open])

  // When date changes, look up timetable sessions
  useEffect(() => {
    if (!date) {
      setSessions([])
      setScheduleId("")
      return
    }

    setScheduleId("")
    setPaymentMethod("")

    startLoadingSessions(async () => {
      try {
        const result = await getSessionsForDate(date)
        setSessions(result)
      } catch {
        setSessions([])
        toast.error("Failed to load sessions for this date")
      }
    })
  }, [date])

  const selectedSession = sessions.find((s) => s.scheduleId === scheduleId)

  async function handleSubmit(formData: FormData) {
    if (!profileId || !scheduleId || !paymentMethod || !date) {
      toast.error("Please fill in all fields")
      return
    }
    try {
      await createManualBooking(formData)
      toast.success("Booking created")
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create booking")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add booking</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <input type="hidden" name="profile_id" value={profileId} />
          <input type="hidden" name="schedule_id" value={scheduleId} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="payment_method" value={paymentMethod} />

          {/* 1. Customer */}
          <div>
            <Label>Customer</Label>
            <Popover open={memberOpen} onOpenChange={setMemberOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={memberOpen}
                    className="w-full justify-between font-normal"
                  />
                }
              >
                {selectedMember
                  ? selectedMember.name
                  : "Search customers..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </PopoverTrigger>
              <PopoverContent className="w-[var(--anchor-width)] p-0">
                <Command>
                  <CommandInput placeholder="Search by name..." />
                  <CommandList>
                    <CommandEmpty>No customer found.</CommandEmpty>
                    <CommandGroup>
                      {members.map((m) => (
                        <CommandItem
                          key={m.id}
                          value={m.name}
                          onSelect={() => {
                            setProfileId(m.id)
                            setMemberOpen(false)
                          }}
                          data-checked={profileId === m.id}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              profileId === m.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {m.name}
                          <span className="ml-auto flex gap-2 text-xs text-muted-foreground">
                            {m.credits > 0 && (
                              <span>{m.credits} credits</span>
                            )}
                            {m.hasMembership && (
                              <span className="text-success">member</span>
                            )}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* 2. Date */}
          <div>
            <Label htmlFor="booking-date">Date</Label>
            <Input
              id="booking-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* 3. Session (populated from timetable lookup) */}
          <div>
            <Label>Session</Label>
            {loadingSessions ? (
              <div className="flex items-center gap-2 rounded-md border border-sand px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading sessions...
              </div>
            ) : !date ? (
              <p className="text-sm text-muted-foreground">
                Select a date to see available sessions.
              </p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sessions scheduled for this date.
              </p>
            ) : (
              <Select
                value={scheduleId}
                onValueChange={(v) => setScheduleId(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a session">
                    {selectedSession
                      ? `${formatTime(selectedSession.startTime)} — ${selectedSession.className}`
                      : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => (
                    <SelectItem
                      key={s.scheduleId}
                      value={s.scheduleId}
                      disabled={s.isFull}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span>
                          {formatTime(s.startTime)} — {s.className}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {s.instructorName} ({s.bookingCount}/{s.capacity})
                          {s.isFull && " · Full"}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* 4. Payment method */}
          <div>
            <Label>Payment method</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v ?? "")}
              disabled={!scheduleId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select payment method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stripe">Stripe</SelectItem>
                <SelectItem
                  value="pack_credit"
                  disabled={!selectedMember || selectedMember.credits <= 0}
                >
                  Pack credit
                  {selectedMember ? ` (${selectedMember.credits} remaining)` : ""}
                </SelectItem>
                <SelectItem
                  value="membership"
                  disabled={!selectedMember?.hasMembership}
                >
                  Membership
                  {selectedMember?.hasMembership ? "" : " (none active)"}
                </SelectItem>
                <SelectItem value="complimentary">Complimentary</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <SubmitButton>Create booking</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
