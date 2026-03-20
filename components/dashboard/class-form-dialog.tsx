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
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { SubmitButton } from "@/components/shared/submit-button"
import { createClass, updateClass } from "@/app/actions/classes"
import { toast } from "sonner"

interface ClassData {
  id: string
  name: string
  description: string
  duration_mins: number
  price_pence: number
  capacity: number
}

interface ClassFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingClass?: ClassData | null
}

export function ClassFormDialog({
  open,
  onOpenChange,
  editingClass,
}: ClassFormDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const isEditing = !!editingClass

  useEffect(() => {
    if (!open) formRef.current?.reset()
  }, [open])

  async function handleSubmit(formData: FormData) {
    try {
      if (isEditing) {
        await updateClass(editingClass!.id, formData)
        toast.success("Class updated")
      } else {
        await createClass(formData)
        toast.success("Class created")
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
          <DialogTitle>{isEditing ? "Edit class" : "New class"}</DialogTitle>
        </DialogHeader>
        <form ref={formRef} key={editingClass?.id ?? "new"} action={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={editingClass?.name ?? ""}
              placeholder="e.g. Hot Pilates"
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={editingClass?.description ?? ""}
              placeholder="A short description of the class"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="duration_mins">Duration (min)</Label>
              <Input
                id="duration_mins"
                name="duration_mins"
                type="number"
                required
                min={1}
                defaultValue={editingClass?.duration_mins ?? 60}
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
                  editingClass ? (editingClass.price_pence / 100).toFixed(2) : ""
                }
                placeholder="7.50"
              />
            </div>
            <div>
              <Label htmlFor="capacity">Capacity</Label>
              <Input
                id="capacity"
                name="capacity"
                type="number"
                required
                min={1}
                defaultValue={editingClass?.capacity ?? 10}
              />
            </div>
          </div>
          <DialogFooter>
            <SubmitButton>{isEditing ? "Save changes" : "Create class"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
