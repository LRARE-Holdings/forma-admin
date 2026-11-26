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
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button, buttonVariants } from "@/components/ui/button"
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
import {
  updateInstructor,
  updateStaffRole,
  removeStaffMember,
  toggleInstructorRecord,
  archiveInstructor,
  getInstructorRemovalCheck,
  setInstructorOnSite,
} from "@/app/actions/team"
import { createClient } from "@/lib/supabase/client"
import { getInitial } from "@/lib/utils"
import { toast } from "sonner"
import { unwrap } from "@/lib/action-result"

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
  hasInstructorRecord: boolean
  instructorId: string | null
  showOnSite: boolean
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
  const [isInstructor, setIsInstructor] = useState(false)
  const [instructorToggleLoading, setInstructorToggleLoading] = useState(false)
  const [onSite, setOnSite] = useState(true)
  const [onSiteLoading, setOnSiteLoading] = useState(false)
  const [checkingRemoval, setCheckingRemoval] = useState(false)
  const [blockedBy, setBlockedBy] = useState<string[] | null>(null)

  useEffect(() => {
    if (open && instructor) {
      setPhotoUrl(instructor.photo_url)
      setRole(instructor.role)
      setIsInstructor(instructor.hasInstructorRecord)
      setOnSite(instructor.showOnSite)
    } else if (!open) {
      setPhotoUrl(null)
      setRole("")
      setIsInstructor(false)
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
      const result = await updateStaffRole(instructor.membershipId, newRole)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      setRole(newRole)
      const label = ROLE_OPTIONS.find((r) => r.value === newRole)?.label ?? newRole
      toast.success(`Role changed to ${label}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to change role")
    } finally {
      setRoleLoading(false)
    }
  }

  async function handleToggleInstructor(checked: boolean) {
    if (!instructor?.membershipId) return
    setInstructorToggleLoading(true)
    try {
      const result = await toggleInstructorRecord(instructor.membershipId, checked)
      if (result.error) {
        toast.error(result.error)
      } else {
        setIsInstructor(checked)
        toast.success(checked ? "Marked as instructor" : "Instructor record removed")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update")
    } finally {
      setInstructorToggleLoading(false)
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
      unwrap(await updateInstructor(instructor.id, formData))
      toast.success("Profile updated")
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update profile")
    }
  }

  async function handleOnSiteChange(checked: boolean) {
    if (!instructor?.instructorId) return
    setOnSiteLoading(true)
    try {
      unwrap(await setInstructorOnSite(instructor.instructorId, checked))
      setOnSite(checked)
      toast.success(checked ? "Shown on the website" : "Hidden from the website")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update")
    } finally {
      setOnSiteLoading(false)
    }
  }

  // Someone still on the timetable can't be removed: their classes would be
  // left with nobody to teach them. Check before asking to confirm.
  async function startRemove() {
    if (!instructor) return
    if (!instructor.instructorId || !isInstructor) {
      setDeleteOpen(true)
      return
    }
    setCheckingRemoval(true)
    try {
      const { upcoming } = unwrap(await getInstructorRemovalCheck(instructor.instructorId))
      if (upcoming.length > 0) setBlockedBy(upcoming)
      else setDeleteOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't check their classes")
    } finally {
      setCheckingRemoval(false)
    }
  }

  async function handleRemove() {
    if (!instructor) return
    setDeleteLoading(true)
    try {
      if (instructor.membershipId) {
        unwrap(await removeStaffMember(instructor.membershipId))
      } else if (instructor.instructorId) {
        unwrap(await archiveInstructor(instructor.instructorId))
      } else {
        return
      }
      toast.success(`${instructor.name} removed`)
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
          <form ref={formRef} key={instructor.id} action={isInstructor ? handleSubmit : undefined} className="space-y-4">
            {/* Instructor profile fields — only shown if they have an instructor record */}
            {isInstructor && (
              <>
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
              </>
            )}

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

            {/* Public team section */}
            {isInstructor && instructor.instructorId && (
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={onSite}
                  onChange={(e) => handleOnSiteChange(e.target.checked)}
                  disabled={onSiteLoading}
                  className="h-4 w-4 rounded border-sand text-gold accent-gold"
                />
                <span className="text-[0.82rem] text-cocoa">
                  {onSiteLoading ? "Updating…" : "Show on the website"}
                </span>
              </label>
            )}

            {/* "Also an instructor" toggle — only for non-staff roles */}
            {instructor.membershipId && !isSelf && role !== "staff" && (
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={isInstructor}
                  onChange={(e) => handleToggleInstructor(e.target.checked)}
                  disabled={instructorToggleLoading}
                  className="h-4 w-4 rounded border-sand text-gold accent-gold"
                />
                <span className="text-[0.82rem] text-cocoa">
                  {instructorToggleLoading ? "Updating…" : "Also an instructor"}
                </span>
              </label>
            )}

            <DialogFooter>
              {isInstructor && <SubmitButton>Save changes</SubmitButton>}
              {((instructor.membershipId && !isOwner && !isSelf) ||
                (!instructor.membershipId && instructor.instructorId)) && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={startRemove}
                  disabled={checkingRemoval}
                >
                  {checkingRemoval ? "Checking…" : "Remove from team"}
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
        title={`Remove ${instructor.name}?`}
        description={
          instructor.membershipId
            ? `${instructor.name} will come off the website and the timetable pickers, and will lose access to the dashboard. Their past classes and bookings stay in your records.`
            : `${instructor.name} will come off the website and the timetable pickers. Their past classes and bookings stay in your records.`
        }
        onConfirm={handleRemove}
        loading={deleteLoading}
        actionLabel="Remove"
      />

      <Dialog open={blockedBy !== null} onOpenChange={(v) => !v && setBlockedBy(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{instructor.name.split(" ")[0]} still has classes</DialogTitle>
            <DialogDescription>
              Give these classes to someone else on the timetable, then come back and remove{" "}
              {instructor.name.split(" ")[0]}. Members booked into them won&apos;t notice a thing.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 rounded-xl border border-sand bg-cream/40 px-4 py-3 text-[0.8rem] text-cocoa">
            {(blockedBy ?? []).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockedBy(null)}>
              Close
            </Button>
            <Link href="/dashboard/timetable" className={buttonVariants()}>
              Open timetable
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
