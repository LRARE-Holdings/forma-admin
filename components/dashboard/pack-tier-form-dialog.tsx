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
import { SubmitButton } from "@/components/shared/submit-button"
import { createPackTier, updatePackTier } from "@/app/actions/packs"
import { toast } from "sonner"

interface ClassOption {
  id: string
  name: string
  slug: string
}

interface TierData {
  id: string
  name: string
  credits: number
  price_pence: number
  validity_days: number
  excluded_class_ids: string[]
}

interface PackTierFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingTier?: TierData | null
  classes: ClassOption[]
}

export function PackTierFormDialog({
  open,
  onOpenChange,
  editingTier,
  classes,
}: PackTierFormDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const isEditing = !!editingTier

  // Re-sync the excluded-class set when the caller switches which tier the
  // dialog is editing. Uses the "derive state during render" pattern so we
  // don't trigger a cascading render from an effect.
  const tierKey = editingTier?.id ?? "new"
  const [lastTierKey, setLastTierKey] = useState(tierKey)
  const [excludedIds, setExcludedIds] = useState<Set<string>>(
    () => new Set(editingTier?.excluded_class_ids ?? []),
  )
  if (tierKey !== lastTierKey) {
    setLastTierKey(tierKey)
    setExcludedIds(new Set(editingTier?.excluded_class_ids ?? []))
  }

  useEffect(() => {
    if (!open) formRef.current?.reset()
  }, [open])

  function toggleClass(classId: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev)
      if (next.has(classId)) next.delete(classId)
      else next.add(classId)
      return next
    })
  }

  async function handleSubmit(formData: FormData) {
    formData.delete("excluded_class_ids")
    for (const id of excludedIds) {
      formData.append("excluded_class_ids", id)
    }
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

          <div className="space-y-2">
            <Label>Excluded classes</Label>
            <p className="text-[0.72rem] text-warm-grey">
              Tick any classes that cannot be booked with credits from this pack.
            </p>
            {classes.length === 0 ? (
              <p className="rounded-md border border-dashed border-sand px-3 py-2 text-[0.78rem] text-warm-grey">
                No classes yet.
              </p>
            ) : (
              <div className="max-h-44 overflow-y-auto rounded-md border border-sand">
                {classes.map((cls) => {
                  const checked = excludedIds.has(cls.id)
                  return (
                    <label
                      key={cls.id}
                      className="flex cursor-pointer items-center gap-2.5 border-b border-sand/50 px-3 py-2 text-[0.82rem] text-cocoa last:border-b-0 hover:bg-cream/60"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleClass(cls.id)}
                        className="h-4 w-4 rounded border-sand accent-gold"
                      />
                      <span>{cls.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <SubmitButton>{isEditing ? "Save changes" : "Create tier"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
