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
 * Output is always 370×208 to match the public site's instructor photo slots.
 */
export async function getCroppedImage(
  imageSrc: string,
  cropArea: CropArea
): Promise<Blob> {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement("canvas")
  canvas.width = 370
  canvas.height = 208

  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas context not available")

  ctx.drawImage(
    image,
    cropArea.x,
    cropArea.y,
    cropArea.width,
    cropArea.height,
    0,
    0,
    370,
    208
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to create blob"))),
      "image/jpeg",
      0.9
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
