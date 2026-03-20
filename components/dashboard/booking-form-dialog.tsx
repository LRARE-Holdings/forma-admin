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
            <Select value={profileId} onValueChange={(v) => setProfileId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a member">
                  {selectedMember ? `${selectedMember.name} (${selectedMember.credits} credits)` : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} ({m.credits} credits)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
