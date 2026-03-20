import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPence(pence: number): string {
  return (pence / 100).toFixed(2)
}

export function formatTime(time: string): string {
  // "06:30:00" -> "06:30"
  return time.slice(0, 5)
}

export function dayName(dayOfWeek: number): string {
  const names = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]
  return names[dayOfWeek] ?? ""
}

export function dayShort(dayOfWeek: number): string {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  return names[dayOfWeek] ?? ""
}

export function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

export function getInitial(name: string | null): string {
  return name?.charAt(0)?.toUpperCase() ?? "?"
}

/** Crop area returned by react-easy-crop */
export interface CropArea {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Draw the cropped region of an image onto a canvas and return it as a JPEG blob.
 *
 * Outputs at the native cropped resolution, capped at 2× the display size
 * (740×416) so images stay sharp on retina screens without being oversized.
 */
export async function getCroppedImage(
  imageSrc: string,
  cropArea: CropArea
): Promise<Blob> {
  const image = await loadImage(imageSrc)

  // Use the native crop dimensions, but cap at 2× display size (740×416)
  const MAX_W = 740
  const MAX_H = 416
  let outW = Math.round(cropArea.width)
  let outH = Math.round(cropArea.height)

  if (outW > MAX_W || outH > MAX_H) {
    const scale = Math.min(MAX_W / outW, MAX_H / outH)
    outW = Math.round(outW * scale)
    outH = Math.round(outH * scale)
  }

  const canvas = document.createElement("canvas")
  canvas.width = outW
  canvas.height = outH

  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas context not available")

  // Enable high-quality downscaling
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"

  ctx.drawImage(
    image,
    cropArea.x,
    cropArea.y,
    cropArea.width,
    cropArea.height,
    0,
    0,
    outW,
    outH
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to create blob"))),
      "image/jpeg",
      0.92
    )
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
