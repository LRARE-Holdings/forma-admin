"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { ImageCropDialog } from "@/components/dashboard/image-crop-dialog"
import { updateOwnInstructorProfile } from "@/app/actions/team"
import { createClient } from "@/lib/supabase/client"
import { getInitial } from "@/lib/utils"
import { toast } from "sonner"
import { Camera, Loader2 } from "lucide-react"

interface SetupProfileFormProps {
  instructor: {
    id: string
    name: string
    bio: string
    photo_url: string | null
  }
  redirectTo: string
}

export function SetupProfileForm({ instructor, redirectTo }: SetupProfileFormProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(instructor.photo_url)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    const formData = new FormData(e.currentTarget)
    if (photoUrl) formData.set("photo_url", photoUrl)
    try {
      await updateOwnInstructorProfile(formData)
      toast.success("Profile saved")
      router.push(redirectTo)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
      setSaving(false)
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Photo */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={instructor.name}
                className="h-24 w-24 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gold font-heading text-[2rem] font-semibold text-cocoa">
                {getInitial(instructor.name)}
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-1.5"
          >
            <Camera className="h-3.5 w-3.5" />
            {uploading ? "Uploading…" : photoUrl ? "Change photo" : "Add photo"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* Name (read-only) */}
        <div>
          <Label className="text-xs font-semibold uppercase tracking-wider text-warm-grey">
            Name
          </Label>
          <p className="mt-1 text-[0.92rem] font-medium text-cocoa">{instructor.name}</p>
          <p className="text-[0.7rem] text-warm-grey">Contact your studio admin to change your name</p>
        </div>

        {/* Bio */}
        <div>
          <Label htmlFor="bio" className="text-xs font-semibold uppercase tracking-wider text-warm-grey">
            Bio
          </Label>
          <Textarea
            id="bio"
            name="bio"
            rows={4}
            defaultValue={instructor.bio}
            placeholder="Tell members a bit about yourself…"
            className="mt-1"
          />
        </div>

        <Button
          type="submit"
          disabled={saving}
          className="w-full rounded-full bg-gold text-cocoa font-semibold uppercase tracking-wider text-xs hover:bg-cocoa hover:text-wheat"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Save & continue"
          )}
        </Button>

        <div className="text-center">
          <button
            type="button"
            onClick={() => router.push(redirectTo)}
            className="text-[0.78rem] text-warm-grey hover:text-cocoa underline"
          >
            I&apos;ll do this later
          </button>
        </div>
      </form>

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
