"use client"

import { useEffect, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SubmitButton } from "@/components/shared/submit-button"
import { updateMemberEmail } from "@/app/actions/members"
import { toast } from "sonner"

interface EditMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: { id: string; name: string; email: string } | null
}

export function EditMemberDialog({
  open,
  onOpenChange,
  member,
}: EditMemberDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!open) {
      formRef.current?.reset()
    }
  }, [open])

  if (!member) return null

  async function handleSubmit(formData: FormData) {
    try {
      await updateMemberEmail(member!.id, formData)
      toast.success("Email updated")
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update email")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit member — {member.name}</DialogTitle>
        </DialogHeader>
        <form ref={formRef} key={member.id} action={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              defaultValue={member.email}
              placeholder="member@example.com"
            />
            <p className="mt-1 text-[0.7rem] text-warm-grey">
              This will update their login email immediately.
            </p>
          </div>
          <DialogFooter>
            <SubmitButton>Save changes</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
