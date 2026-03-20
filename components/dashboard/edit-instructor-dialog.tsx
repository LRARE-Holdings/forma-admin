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
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/shared/submit-button"
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog"
import { updateInstructor, removeStaffMember } from "@/app/actions/team"
import { createClient } from "@/lib/supabase/client"
import { getInitial } from "@/lib/utils"
import { toast } from "sonner"

interface InstructorData {
  id: string
  name: string
  bio: string
  photo_url: string | null
  profile_id: string | null
  membershipId: string | null
  role: string
}

interface EditInstructorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instructor: InstructorData | null
}

export function EditInstructorDialog({
  open,
  onOpenChange,
  instructor,
}: EditInstructorDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    if (open && instructor) {
      setPhotoUrl(instructor.photo_url)
    } else if (!open) {
      setPhotoUrl(null)
      formRef.current?.reset()
    }
  }, [open, instructor])

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !instructor) return

    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split(".").pop()
      const path = `instructors/${instructor.id}.${ext}`

      const { error } = await supabase.storage
        .from("photos")
        .upload(path, file, { upsert: true })

      if (error) throw error

      const { data: urlData } = supabase.storage
        .from("photos")
        .getPublicUrl(path)

      setPhotoUrl(`${urlData.publicUrl}?t=${Date.now()}`)
      toast.success("Photo uploaded")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload photo")
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(formData: FormData) {
    if (!instructor) return
    if (photoUrl) formData.set("photo_url", photoUrl)
    try {
      await updateInstructor(instructor.id, formData)
      toast.success("Profile updated")
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update profile")
    }
  }

  async function handleRemove() {
    if (!instructor?.membershipId) return
    setDeleteLoading(true)
    try {
      await removeStaffMember(instructor.membershipId)
      toast.success("Staff member removed")
      setDeleteOpen(false)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove staff member")
    } finally {
      setDeleteLoading(false)
    }
  }

  if (!instructor) return null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
          </DialogHeader>
          <form ref={formRef} key={instructor.id} action={handleSubmit} className="space-y-4">
            {/* Photo */}
            <div className="flex items-center gap-4">
              <div className="relative">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt={instructor.name}
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gold font-heading text-[1.5rem] font-semibold text-cocoa">
                    {getInitial(instructor.name)}
                  </div>
                )}
              </div>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? "Uploading…" : "Change photo"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={instructor.name}
              />
            </div>
            <div>
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                name="bio"
                rows={3}
                defaultValue={instructor.bio}
                placeholder="A short bio…"
              />
            </div>

            <DialogFooter>
              <SubmitButton>Save changes</SubmitButton>
              {instructor.membershipId && instructor.role !== "admin" && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  Remove from team
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove staff member"
        description={`Remove ${instructor.name} from the team? This will revoke their access to the dashboard.`}
        onConfirm={handleRemove}
        loading={deleteLoading}
        actionLabel="Remove"
      />
    </>
  )
}
