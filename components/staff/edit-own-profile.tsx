"use client"

import { useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/shared/submit-button"
import { ImageCropDialog } from "@/components/dashboard/image-crop-dialog"
import { updateOwnInstructorProfile } from "@/app/actions/team"
import { createClient } from "@/lib/supabase/client"
import { getInitial } from "@/lib/utils"
import { toast } from "sonner"
import { Pencil } from "lucide-react"

interface EditOwnProfileProps {
  instructor: {
    id: string
    name: string
    bio: string
    photo_url: string | null
  }
}

export function EditOwnProfile({ instructor }: EditOwnProfileProps) {
  const [open, setOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(instructor.photo_url)
  const [uploading, setUploading] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [cropOpen, setCropOpen] = useState(false)

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const ALLOWED_TYPES = ["image/png", "image/jpeg"]
    const MAX_SIZE = 3 * 1024 * 1024

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Only PNG or JPG files are allowed")
      return
    }
    if (file.size > MAX_SIZE) {
      toast.error("Photo must be under 3 MB")
      return
    }

    const objectUrl = URL.createObjectURL(file)
    setCropSrc(objectUrl)
    setCropOpen(true)

    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleCropComplete(blob: Blob) {
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
    if (photoUrl) formData.set("photo_url", photoUrl)
    try {
      await updateOwnInstructorProfile(formData)
      toast.success("Profile updated")
      setOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update profile")
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-1.5 text-[0.78rem] font-semibold text-gold hover:text-ember"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit my profile
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit your profile</DialogTitle>
          </DialogHeader>
          <form action={handleSubmit} className="space-y-4">
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

            {/* Name (read-only) */}
            <div>
              <Label>Name</Label>
              <p className="mt-1 text-[0.88rem] text-cocoa">{instructor.name}</p>
              <p className="text-[0.7rem] text-warm-grey">Contact your admin to change your name</p>
            </div>

            {/* Bio */}
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
    </>
  )
}
