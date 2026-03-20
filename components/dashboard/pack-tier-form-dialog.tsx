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
import { createPackTier, updatePackTier } from "@/app/actions/packs"
import { toast } from "sonner"

interface TierData {
  id: string
  name: string
  credits: number
  price_pence: number
  validity_days: number
}

interface PackTierFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingTier?: TierData | null
}

export function PackTierFormDialog({
  open,
  onOpenChange,
  editingTier,
}: PackTierFormDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const isEditing = !!editingTier

  useEffect(() => {
    if (!open) formRef.current?.reset()
  }, [open])

  async function handleSubmit(formData: FormData) {
    try {
      if (isEditing) {
        await updatePackTier(editingTier!.id, formData)
        toast.success("Pack tier updated")
      } else {
        await createPackTier(formData)
        toast.success("Pack tier created")
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
          <DialogTitle>{isEditing ? "Edit pack tier" : "New pack tier"}</DialogTitle>
        </DialogHeader>
        <form ref={formRef} key={editingTier?.id ?? "new"} action={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={editingTier?.name ?? ""}
              placeholder="e.g. 10-class pack"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="credits">Credits</Label>
              <Input
                id="credits"
                name="credits"
                type="number"
                required
                min={1}
                defaultValue={editingTier?.credits ?? ""}
                placeholder="10"
              />
            </div>
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
                  editingTier ? (editingTier.price_pence / 100).toFixed(2) : ""
                }
                placeholder="75.00"
              />
            </div>
            <div>
              <Label htmlFor="validity_days">Validity (days)</Label>
              <Input
                id="validity_days"
                name="validity_days"
                type="number"
                required
                min={1}
                defaultValue={editingTier?.validity_days ?? 42}
                placeholder="42"
              />
            </div>
          </div>
          <DialogFooter>
            <SubmitButton>{isEditing ? "Save changes" : "Create tier"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
