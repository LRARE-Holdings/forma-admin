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
