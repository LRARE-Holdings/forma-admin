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
import {
  createMembershipTier,
  updateMembershipTier,
} from "@/app/actions/memberships"
import { toast } from "sonner"

interface TierData {
  id: string
  name: string
  description: string
  price_pence: number
  interval: string
  interval_count: number
}

interface MembershipTierFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingTier?: TierData | null
}

export function MembershipTierFormDialog({
  open,
  onOpenChange,
  editingTier,
}: MembershipTierFormDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const isEditing = !!editingTier

  useEffect(() => {
    if (!open) formRef.current?.reset()
  }, [open])

  async function handleSubmit(formData: FormData) {
    try {
      if (isEditing) {
        await updateMembershipTier(editingTier!.id, formData)
        toast.success("Membership tier updated")
      } else {
        await createMembershipTier(formData)
        toast.success("Membership tier created")
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
          <DialogTitle>
            {isEditing ? "Edit membership tier" : "New membership tier"}
          </DialogTitle>
        </DialogHeader>
        <form
          ref={formRef}
          key={editingTier?.id ?? "new"}
          action={handleSubmit}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={editingTier?.name ?? ""}
              placeholder="e.g. Unlimited Monthly"
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              name="description"
              defaultValue={editingTier?.description ?? ""}
              placeholder="Unlimited classes per month"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="price">Price (&pound;)</Label>
              <Input
                id="price"
                name="price"
                type="number"
                step="0.01"
                required
                min={0}
                defaultValue={
                  editingTier
                    ? (editingTier.price_pence / 100).toFixed(2)
                    : ""
                }
                placeholder="99.00"
              />
            </div>
            <div>
              <Label htmlFor="interval">Interval</Label>
              <select
                id="interval"
                name="interval"
                defaultValue={editingTier?.interval ?? "month"}
                className="flex h-9 w-full rounded-md border border-sand bg-white px-3 py-1 text-[0.85rem] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cocoa"
              >
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </div>
            <div>
              <Label htmlFor="interval_count">Every</Label>
              <Input
                id="interval_count"
                name="interval_count"
                type="number"
                required
                min={1}
                max={12}
                defaultValue={editingTier?.interval_count ?? 1}
                placeholder="1"
              />
            </div>
          </div>
          <DialogFooter>
            <SubmitButton>
              {isEditing ? "Save changes" : "Create tier"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
