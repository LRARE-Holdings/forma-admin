"use client"

import { useState } from "react"
import { removeFromWaitlist } from "@/app/actions/waitlist"
import { formatTime } from "@/lib/utils"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Clock, Loader2, X } from "lucide-react"

interface WaitlistItem {
  id: string
  date: string
  position: number
  status: string
  offered_at: string | null
  expires_at: string | null
  profiles: { full_name: string | null; email: string | null }
  schedule: { start_time: string; classes: { name: string } }
}

interface WaitlistSectionProps {
  entries: WaitlistItem[]
}

export function WaitlistSection({ entries }: WaitlistSectionProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function handleRemove(id: string) {
    setLoadingId(id)
    const result = await removeFromWaitlist(id)
    setLoadingId(null)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Removed from waitlist")
    }
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Clock className="mb-2 h-8 w-8 text-sand" />
        <p className="text-[0.82rem] font-medium text-warm-grey">No one on the waitlist</p>
        <p className="mt-0.5 text-[0.7rem] text-warm-grey/70">
          Members will appear here when classes are full.
        </p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-sand/40">
      {entries.map((entry) => {
        const profile = entry.profiles
        const schedule = entry.schedule
        const cls = schedule?.classes

        const formattedDate = new Date(entry.date + "T00:00:00").toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })

        return (
          <div
            key={entry.id}
            className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-cream/40"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-[0.82rem] font-medium text-cocoa">
                  {profile?.full_name ?? "Unknown"}
                </span>
                <Badge variant={entry.status === "offered" ? "default" : "secondary"}>
                  {entry.status === "offered" ? "Offered" : `#${entry.position}`}
                </Badge>
              </div>
              <div className="mt-0.5 text-[0.7rem] text-warm-grey">
                {cls?.name ?? "Class"} &middot; {formattedDate} at {formatTime(schedule?.start_time ?? "")}
              </div>
            </div>

            {entry.status === "offered" && entry.expires_at && (
              <div className="shrink-0 text-[0.68rem] text-ember">
                Expires {new Date(entry.expires_at).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            )}

            <button
              onClick={() => handleRemove(entry.id)}
              disabled={loadingId === entry.id}
              className="shrink-0 rounded p-1 text-warm-grey hover:bg-ember/10 hover:text-ember disabled:opacity-50"
              title="Remove from waitlist"
            >
              {loadingId === entry.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}
