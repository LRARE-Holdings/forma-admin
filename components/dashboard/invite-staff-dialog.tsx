"use client"

import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { inviteStaffMember } from "@/app/actions/team"
import { toast } from "sonner"

interface InviteStaffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ROLE_OPTIONS = [
  { value: "staff", label: "Instructor", description: "Can view own schedule and attendee lists" },
  { value: "reception", label: "Reception", description: "Can view bookings, members, and create manual bookings" },
  { value: "manager", label: "Manager", description: "Can manage schedule, bookings, and members" },
  { value: "admin", label: "Admin", description: "Full access to all dashboard features" },
]

export function InviteStaffDialog({ open, onOpenChange }: InviteStaffDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [role, setRole] = useState("staff")
  const [alsoInstructor, setAlsoInstructor] = useState(false)

  useEffect(() => {
    if (!open) {
      formRef.current?.reset()
      setRole("staff")
      setAlsoInstructor(false)
    }
  }, [open])

  async function handleSubmit(formData: FormData) {
    const result = await inviteStaffMember(formData)
    if (result.error) {
      toast.error(result.error)
      return
    }
    const selectedRole = ROLE_OPTIONS.find((r) => r.value === role)
    toast.success(`${selectedRole?.label ?? "Team member"} invited`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite team member</DialogTitle>
          <DialogDescription>
            They&apos;ll receive an email invitation to join your studio.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <input type="hidden" name="role" value={role} />
          {role !== "staff" && alsoInstructor && (
            <input type="hidden" name="alsoInstructor" value="true" />
          )}

          <div>
            <Label htmlFor="name">Full name</Label>
            <Input id="name" name="name" required placeholder="e.g. Amelia Bennett" />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              placeholder="amelia@example.com"
            />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v ?? "staff")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a role">
                  {ROLE_OPTIONS.find((r) => r.value === role)?.label ?? "Instructor"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[0.7rem] text-warm-grey">
              {ROLE_OPTIONS.find((r) => r.value === role)?.description}
            </p>
          </div>
          {role !== "staff" && (
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={alsoInstructor}
                onChange={(e) => setAlsoInstructor(e.target.checked)}
                className="h-4 w-4 rounded border-sand text-gold accent-gold"
              />
              <span className="text-[0.82rem] text-cocoa">Also an instructor</span>
            </label>
          )}
          <DialogFooter>
            <SubmitButton>Send invite</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
