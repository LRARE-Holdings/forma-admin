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
import { ChevronsUpDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { SubmitButton } from "@/components/shared/submit-button"
import { createManualBooking } from "@/app/actions/bookings"
import { toast } from "sonner"

interface MemberOption {
  id: string
  name: string
  credits: number
}

interface SlotOption {
  id: string
  label: string
}

interface BookingFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  members: MemberOption[]
  slots: SlotOption[]
}

export function BookingFormDialog({
  open,
  onOpenChange,
  members,
  slots,
}: BookingFormDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [profileId, setProfileId] = useState("")
  const [scheduleId, setScheduleId] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("")
  const [memberOpen, setMemberOpen] = useState(false)

  const selectedMember = members.find((m) => m.id === profileId)

  const PAYMENT_LABELS: Record<string, string> = {
    stripe: "Stripe",
    pack_credit: `Pack credit${selectedMember ? ` (${selectedMember.credits} remaining)` : ""}`,
    complimentary: "Complimentary",
  }

  useEffect(() => {
    if (!open) {
      setProfileId("")
      setScheduleId("")
      setPaymentMethod("")
      formRef.current?.reset()
    }
  }, [open])

  async function handleSubmit(formData: FormData) {
    if (!profileId || !scheduleId || !paymentMethod) {
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
          <input type="hidden" name="payment_method" value={paymentMethod} />

          <div>
            <Label>Member</Label>
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
                  ? `${selectedMember.name} (${selectedMember.credits} credits)`
                  : "Search members..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </PopoverTrigger>
              <PopoverContent className="w-[var(--anchor-width)] p-0">
                <Command>
                  <CommandInput placeholder="Search by name..." />
                  <CommandList>
                    <CommandEmpty>No member found.</CommandEmpty>
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
                          <span className="ml-auto text-xs text-muted-foreground">
                            {m.credits} credits
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <Label>Class slot</Label>
            <Select value={scheduleId} onValueChange={(v) => setScheduleId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a class slot">
                  {scheduleId ? slots.find((s) => s.id === scheduleId)?.label : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {slots.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="date">Date</Label>
            <Input id="date" name="date" type="date" required />
          </div>

          <div>
            <Label>Payment method</Label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select payment method">
                  {paymentMethod ? PAYMENT_LABELS[paymentMethod] ?? paymentMethod : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stripe">Stripe</SelectItem>
                <SelectItem
                  value="pack_credit"
                  disabled={!selectedMember || selectedMember.credits <= 0}
                >
                  Pack credit{selectedMember ? ` (${selectedMember.credits} remaining)` : ""}
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
