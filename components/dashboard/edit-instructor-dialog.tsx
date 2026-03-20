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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { ImageCropDialog } from "@/components/dashboard/image-crop-dialog"
import { updateInstructor, updateStaffRole, removeStaffMember } from "@/app/actions/team"
import { createClient } from "@/lib/supabase/client"
import { getInitial } from "@/lib/utils"
import { toast } from "sonner"

const ROLE_OPTIONS = [
  { value: "staff", label: "Instructor", description: "Can view own schedule and attendee lists" },
  { value: "reception", label: "Reception", description: "Can view bookings, members, and create manual bookings" },
  { value: "manager", label: "Manager", description: "Can manage schedule, bookings, and members" },
  { value: "admin", label: "Admin", description: "Full access to all dashboard features" },
]

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
  isSelf?: boolean
}

export function EditInstructorDialog({
  open,
  onOpenChange,
  instructor,
  isSelf = false,
}: EditInstructorDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [role, setRole] = useState("")
  const [roleLoading, setRoleLoading] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    if (open && instructor) {
      setPhotoUrl(instructor.photo_url)
      setRole(instructor.role)
    } else if (!open) {
      setPhotoUrl(null)
      setRole("")
      setCropSrc(null)
      setCropOpen(false)
      formRef.current?.reset()
    }
  }, [open, instructor])

  const isOwner = instructor?.role === "owner"
  const canChangeRole = !isOwner && !isSelf && !!instructor?.membershipId

  async function handleRoleChange(newRole: string | null) {
    if (!newRole || !instructor?.membershipId || newRole === role) return
    setRoleLoading(true)
    try {
      await updateStaffRole(instructor.membershipId, newRole)
      setRole(newRole)
      const label = ROLE_OPTIONS.find((r) => r.value === newRole)?.label ?? newRole
      toast.success(`Role changed to ${label}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to change role")
    } finally {
      setRoleLoading(false)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !instructor) return

    const ALLOWED_TYPES = ["image/png", "image/jpeg"]
    const MAX_SIZE = 3 * 1024 * 1024 // 3 MB

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Only PNG or JPG files are allowed")
      return
    }
    if (file.size > MAX_SIZE) {
      toast.error("Photo must be under 3 MB")
      return
    }

    // Show the image in the crop dialog
    const objectUrl = URL.createObjectURL(file)
    setCropSrc(objectUrl)
    setCropOpen(true)

    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleCropComplete(blob: Blob) {
    if (!instructor) return
    setCropOpen(false)
    setUploading(true)
    try {
      const supabase = createClient()
      const path = `instructors/${instructor.id}.png`

      const { error } = await supabase.storage
        .from("photos")
        .upload(path, blob, { upsert: true, contentType: "image/png" })

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
      if (cropSrc) {
        URL.revokeObjectURL(cropSrc)
        setCropSrc(null)
      }
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
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={handleFileSelect}
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

            {/* Role selector */}
            {instructor.membershipId && (
              <div>
                <Label>Role</Label>
                {canChangeRole ? (
                  <>
                    <Select
                      value={role}
                      onValueChange={handleRoleChange}
                      disabled={roleLoading}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role}
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
                  </>
                ) : (
                  <p className="mt-1 text-[0.78rem] text-warm-grey">
                    {isOwner
                      ? "Owner — this role cannot be changed"
                      : isSelf
                        ? `${ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role} — you cannot change your own role`
                        : (ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role)}
                  </p>
                )}
              </div>
            )}

            <DialogFooter>
              <SubmitButton>Save changes</SubmitButton>
              {instructor.membershipId && !isOwner && !isSelf && (
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

      <ImageCropDialog
        open={cropOpen}
        onOpenChange={(v) => {
          setCropOpen(v)
          if (!v && cropSrc) {
            URL.revokeObjectURL(cropSrc)
            setCropSrc(null)
          }
        }}
        imageSrc={cropSrc}
        onCrop={handleCropComplete}
      />

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
