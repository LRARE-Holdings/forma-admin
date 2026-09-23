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
import { ImageCropDialog } from "@/components/dashboard/image-crop-dialog"
import { createEvent, updateEvent } from "@/app/actions/events"
import { createClient } from "@/lib/supabase/client"
import { formatTime, localDateStr, type CropOutput } from "@/lib/utils"
import { isoToUkWallClock } from "@/lib/events"
import type { StudioEvent } from "@/lib/types"
import { ImagePlus, X } from "lucide-react"
import { toast } from "sonner"

/**
 * Event images appear full width on the event page and as the preview when
 * the link is shared (Facebook/WhatsApp want ~1200 × 630), so they are kept
 * far larger than instructor photos — as JPEG, which keeps that size small.
 */
const EVENT_IMAGE_OUTPUT: CropOutput = { maxWidth: 1600, maxHeight: 900, type: "image/jpeg", quality: 0.88 }
const EVENT_IMAGE_MIN_WIDTH = 1200
const EVENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024

interface EventFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingEvent?: StudioEvent | null
  /** Tickets need a connected Stripe account to take payment. */
  stripeConnected: boolean
  /** Places already sold on the event being edited. */
  placesSold?: number
}

export function EventFormDialog({
  open,
  onOpenChange,
  editingEvent,
  stripeConnected,
  placesSold = 0,
}: EventFormDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isEditing = !!editingEvent

  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [hasLink, setHasLink] = useState(false)
  const [ticketsEnabled, setTicketsEnabled] = useState(false)
  const [salesMode, setSalesMode] = useState<"now" | "scheduled">("now")

  const salesOpen = editingEvent?.sales_open_at ? isoToUkWallClock(editingEvent.sales_open_at) : null
  // Once tickets are sold, switching them off would strand the buyers.
  const ticketsLocked = placesSold > 0

  useEffect(() => {
    if (open) {
      setImageUrl(editingEvent?.image_url ?? null)
      setHasLink(!!editingEvent?.link_url)
      setTicketsEnabled(editingEvent?.tickets_enabled ?? false)
      setSalesMode(editingEvent?.sales_open_at ? "scheduled" : "now")
    } else {
      formRef.current?.reset()
    }
  }, [open, editingEvent])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const ALLOWED_TYPES = ["image/png", "image/jpeg"]

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Only PNG or JPG files are allowed")
      return
    }
    if (file.size > EVENT_IMAGE_MAX_BYTES) {
      toast.error("Image must be under 10 MB")
      return
    }

    setCropSrc(URL.createObjectURL(file))
    setCropOpen(true)

    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleCropComplete(blob: Blob) {
    setCropOpen(false)
    setUploading(true)
    try {
      const supabase = createClient()
      // A fresh path per upload: the event may not exist yet, and a new URL
      // means no stale cached copy on the public site.
      const path = `events/${crypto.randomUUID()}.jpg`

      const { error } = await supabase.storage
        .from("photos")
        .upload(path, blob, { contentType: "image/jpeg" })

      if (error) throw error

      const { data: urlData } = supabase.storage.from("photos").getPublicUrl(path)
      setImageUrl(urlData.publicUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload image")
    } finally {
      setUploading(false)
      if (cropSrc) {
        URL.revokeObjectURL(cropSrc)
        setCropSrc(null)
      }
    }
  }

  async function handleSubmit(formData: FormData) {
    try {
      const result = isEditing
        ? await updateEvent(editingEvent!.id, formData)
        : await createEvent(formData)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success(isEditing ? "Event updated" : "Event created")
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit event" : "New event"}</DialogTitle>
          </DialogHeader>
          <form
            ref={formRef}
            key={editingEvent?.id ?? "new"}
            action={handleSubmit}
            className="space-y-4"
          >
            {/* Image */}
            <input type="hidden" name="image_url" value={imageUrl ?? ""} />
            {imageUrl ? (
              <div className="relative overflow-hidden rounded-xl border border-sand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="" className="aspect-[370/208] w-full object-cover" />
                <div className="absolute right-2 top-2 flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="bg-white/90"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? "Uploading…" : "Replace"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="bg-white/90"
                    onClick={() => setImageUrl(null)}
                    aria-label="Remove image"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex aspect-[370/208] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-sand bg-cream/50 text-[0.78rem] text-warm-grey transition-colors hover:bg-cream"
              >
                <ImagePlus className="h-5 w-5" />
                {uploading ? "Uploading…" : "Add an image (optional)"}
                <span className="text-[0.7rem] text-warm-grey/80">
                  Landscape 16:9, at least 1600 × 900 px · JPG or PNG, up to 10 MB
                </span>
              </button>
            )}
            {imageUrl && (
              <p className="-mt-2 text-[0.7rem] text-warm-grey">
                Recommended: landscape 16:9, at least 1600 × 900 px. Used on the event page and when the link is shared.
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={handleFileSelect}
            />

            <div>
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                name="title"
                required
                maxLength={120}
                defaultValue={editingEvent?.title ?? ""}
                placeholder="e.g. Sunset Yoga & Sound Bath"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="event_date">Date</Label>
                <Input
                  id="event_date"
                  name="event_date"
                  type="date"
                  required
                  min={isEditing ? undefined : localDateStr()}
                  defaultValue={editingEvent?.event_date ?? ""}
                />
              </div>
              <div>
                <Label htmlFor="start_time">Starts</Label>
                <Input
                  id="start_time"
                  name="start_time"
                  type="time"
                  defaultValue={editingEvent?.start_time ? formatTime(editingEvent.start_time) : ""}
                />
              </div>
              <div>
                <Label htmlFor="end_time">Ends</Label>
                <Input
                  id="end_time"
                  name="end_time"
                  type="time"
                  defaultValue={editingEvent?.end_time ? formatTime(editingEvent.end_time) : ""}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                name="location"
                defaultValue={editingEvent?.location ?? ""}
                placeholder="Leave blank if it's at the studio"
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                rows={5}
                defaultValue={editingEvent?.description ?? ""}
                placeholder="What's happening, who it's for, what to bring, price…"
              />
            </div>

            {/* Tickets */}
            <div className="space-y-3 rounded-xl border border-sand p-3">
              <label className="flex cursor-pointer items-start gap-2.5 text-[0.82rem] text-cocoa">
                <input
                  type="checkbox"
                  name="tickets_enabled"
                  checked={ticketsEnabled}
                  disabled={ticketsLocked || (!stripeConnected && !ticketsEnabled)}
                  onChange={(e) => setTicketsEnabled(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-sand accent-gold"
                />
                <span>
                  Sell tickets on the website
                  <span className="block text-[0.72rem] text-warm-grey">
                    {!stripeConnected && !ticketsEnabled
                      ? "Connect Stripe in Settings to sell tickets."
                      : ticketsLocked
                        ? `${placesSold} place${placesSold === 1 ? "" : "s"} sold. To stop sales, cancel the event.`
                        : "Members buy with a card when they're logged in. When it sells out, they can join a waitlist."}
                  </span>
                </span>
              </label>
              {/* A disabled checkbox is not submitted; keep the value when locked. */}
              {ticketsLocked && <input type="hidden" name="tickets_enabled" value="on" />}

              {ticketsEnabled && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <Label htmlFor="price">Price per ticket (&pound;)</Label>
                      <Input
                        id="price"
                        name="price"
                        type="number"
                        step="0.01"
                        min={0.3}
                        required
                        defaultValue={
                          editingEvent?.tickets_enabled ? (editingEvent.price_pence / 100).toFixed(2) : ""
                        }
                        placeholder="25.00"
                      />
                    </div>
                    <div>
                      <Label htmlFor="capacity">Places</Label>
                      <Input
                        id="capacity"
                        name="capacity"
                        type="number"
                        min={Math.max(1, placesSold)}
                        max={1000}
                        required
                        defaultValue={editingEvent?.capacity ?? ""}
                        placeholder="12"
                      />
                    </div>
                    <div>
                      <Label htmlFor="max_tickets_per_member">Max per person</Label>
                      <Input
                        id="max_tickets_per_member"
                        name="max_tickets_per_member"
                        type="number"
                        min={1}
                        max={20}
                        required
                        defaultValue={editingEvent?.max_tickets_per_member ?? 1}
                      />
                    </div>
                  </div>

                  <fieldset className="space-y-2">
                    <legend className="mb-1 text-[0.78rem] font-medium text-cocoa">Tickets go on sale</legend>
                    <label className="flex cursor-pointer items-center gap-2.5 text-[0.82rem] text-cocoa">
                      <input
                        type="radio"
                        name="sales_mode"
                        value="now"
                        checked={salesMode === "now"}
                        onChange={() => setSalesMode("now")}
                        className="h-4 w-4 accent-gold"
                      />
                      As soon as the event is published
                    </label>
                    <label className="flex cursor-pointer items-center gap-2.5 text-[0.82rem] text-cocoa">
                      <input
                        type="radio"
                        name="sales_mode"
                        value="scheduled"
                        checked={salesMode === "scheduled"}
                        onChange={() => setSalesMode("scheduled")}
                        className="h-4 w-4 accent-gold"
                      />
                      At a set date and time
                    </label>
                    {salesMode === "scheduled" && (
                      <div className="grid grid-cols-2 gap-3 pl-6">
                        <div>
                          <Label htmlFor="sales_open_date">Date</Label>
                          <Input
                            id="sales_open_date"
                            name="sales_open_date"
                            type="date"
                            required
                            defaultValue={salesOpen?.date ?? ""}
                          />
                        </div>
                        <div>
                          <Label htmlFor="sales_open_time">Time (UK)</Label>
                          <Input
                            id="sales_open_time"
                            name="sales_open_time"
                            type="time"
                            required
                            defaultValue={salesOpen?.time ?? "19:00"}
                          />
                        </div>
                        <p className="col-span-2 text-[0.72rem] text-warm-grey">
                          Until then the event shows a &ldquo;Notify me&rdquo; button, and everyone who taps it is emailed the moment tickets go live.
                        </p>
                      </div>
                    )}
                  </fieldset>
                </>
              )}
            </div>

            {!ticketsEnabled && (
            <div className="space-y-3 rounded-xl border border-sand p-3">
              <label className="flex cursor-pointer items-center gap-2.5 text-[0.82rem] text-cocoa">
                <input
                  type="checkbox"
                  checked={hasLink}
                  onChange={(e) => setHasLink(e.target.checked)}
                  className="h-4 w-4 rounded border-sand accent-gold"
                />
                Add a button linking elsewhere (e.g. tickets sold on another site)
              </label>
              {hasLink && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
                  <div>
                    <Label htmlFor="link_url">Link</Label>
                    <Input
                      id="link_url"
                      name="link_url"
                      type="url"
                      required
                      defaultValue={editingEvent?.link_url ?? ""}
                      placeholder="https://"
                    />
                  </div>
                  <div>
                    <Label htmlFor="link_label">Button text</Label>
                    <Input
                      id="link_label"
                      name="link_label"
                      maxLength={30}
                      defaultValue={editingEvent?.link_label ?? ""}
                      placeholder="Get tickets"
                    />
                  </div>
                </div>
              )}
            </div>
            )}

            <label className="flex cursor-pointer items-start gap-2.5 text-[0.82rem] text-cocoa">
              <input
                type="checkbox"
                name="is_published"
                defaultChecked={editingEvent?.is_published ?? true}
                className="mt-0.5 h-4 w-4 rounded border-sand accent-gold"
              />
              <span>
                Show on the website
                <span className="block text-[0.72rem] text-warm-grey">
                  Untick to save it as a draft. Published events appear on the home page until the day has passed.
                </span>
              </span>
            </label>

            <DialogFooter>
              <SubmitButton>{isEditing ? "Save changes" : "Create event"}</SubmitButton>
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
        output={EVENT_IMAGE_OUTPUT}
        recommendedWidth={EVENT_IMAGE_MIN_WIDTH}
      />
    </>
  )
}
