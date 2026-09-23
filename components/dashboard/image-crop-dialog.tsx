"use client"

import { useCallback, useState } from "react"
import Cropper, { type Area } from "react-easy-crop"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { getCroppedImage, type CropOutput } from "@/lib/utils"

interface ImageCropDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageSrc: string | null
  onCrop: (blob: Blob) => void
  /** Output size and format; defaults to instructor-photo settings */
  output?: CropOutput
  /** Warn when the cropped area is narrower than this many source pixels */
  recommendedWidth?: number
}

const ASPECT = 370 / 208

export function ImageCropDialog({
  open,
  onOpenChange,
  imageSrc,
  onCrop,
  output,
  recommendedWidth,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedArea(croppedAreaPixels)
  }, [])

  async function handleSave() {
    if (!croppedArea || !imageSrc) return
    setSaving(true)
    try {
      const blob = await getCroppedImage(imageSrc, croppedArea, output)
      onCrop(blob)
    } catch {
      // Parent handles errors via toast
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    onOpenChange(false)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedArea(null)
  }

  if (!imageSrc) return null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Crop photo</DialogTitle>
        </DialogHeader>

        {/* Crop area */}
        <div className="relative h-64 w-full overflow-hidden rounded-lg bg-charcoal">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={ASPECT}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        {recommendedWidth && croppedArea && croppedArea.width < recommendedWidth && (
          <p className="rounded-lg bg-ember/10 px-3 py-2 text-[0.75rem] text-cocoa">
            This crop is only {Math.round(croppedArea.width)} pixels wide, so it may look blurry on the event page and in
            link previews. Zoom out, or use a larger image (at least {recommendedWidth} pixels wide).
          </p>
        )}

        {/* Zoom control */}
        <div className="flex items-center gap-3 px-1">
          <span className="text-xs text-warm-grey">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-sand accent-cocoa"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !croppedArea}>
            {saving ? "Cropping…" : "Crop & upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
