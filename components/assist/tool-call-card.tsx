"use client"

import { cn } from "@/lib/utils"
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Calendar,
  Users,
  Star,
  Package,
  CheckSquare,
  BarChart3,
  UserPlus,
  Pencil,
  Trash2,
} from "lucide-react"
import type { ToolCall } from "@/lib/assist/hooks"

interface ToolCallCardProps {
  toolCall: ToolCall
}

const TOOL_META: Record<
  string,
  { label: string; icon: typeof Star; color: string }
> = {
  list_classes: { label: "Looking up classes", icon: Star, color: "text-gold" },
  list_schedule: { label: "Checking timetable", icon: Calendar, color: "text-gold" },
  list_bookings: { label: "Fetching bookings", icon: CheckSquare, color: "text-gold" },
  list_members: { label: "Loading members", icon: Users, color: "text-gold" },
  get_member_packs: { label: "Checking pack balance", icon: Package, color: "text-gold" },
  list_pack_tiers: { label: "Loading pack tiers", icon: Package, color: "text-gold" },
  list_instructors: { label: "Loading instructors", icon: Users, color: "text-gold" },
  get_studio_stats: { label: "Crunching stats", icon: BarChart3, color: "text-gold" },

  create_class: { label: "Creating class", icon: Star, color: "text-success" },
  update_class: { label: "Updating class", icon: Pencil, color: "text-ember" },
  delete_class: { label: "Removing class", icon: Trash2, color: "text-ember" },
  create_schedule_slot: { label: "Adding timetable slot", icon: Calendar, color: "text-success" },
  update_schedule_slot: { label: "Updating slot", icon: Pencil, color: "text-ember" },
  delete_schedule_slot: { label: "Removing slot", icon: Trash2, color: "text-ember" },
  create_booking: { label: "Creating booking", icon: CheckSquare, color: "text-success" },
  cancel_booking: { label: "Cancelling booking", icon: XCircle, color: "text-ember" },
  create_pack_tier: { label: "Creating pack tier", icon: Package, color: "text-success" },
  update_pack_tier: { label: "Updating pack tier", icon: Pencil, color: "text-ember" },
  delete_pack_tier: { label: "Deactivating pack tier", icon: Trash2, color: "text-ember" },
  invite_staff: { label: "Inviting team member", icon: UserPlus, color: "text-success" },

  my_schedule: { label: "Loading your schedule", icon: Calendar, color: "text-gold" },
  my_class_attendees: { label: "Fetching attendees", icon: Users, color: "text-gold" },
  my_stats: { label: "Loading your stats", icon: BarChart3, color: "text-gold" },
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const meta = TOOL_META[toolCall.tool] ?? {
    label: toolCall.tool,
    icon: Star,
    color: "text-warm-grey",
  }
  const Icon = meta.icon

  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-xl bg-sand/40 px-3.5 py-2.5">
      <Icon
        className={cn("h-4 w-4 flex-shrink-0", meta.color)}
        strokeWidth={1.8}
      />
      <span className="flex-1 text-[0.75rem] font-medium text-cocoa/80">
        {meta.label}
      </span>
      {toolCall.status === "running" && (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-warm-grey" />
      )}
      {toolCall.status === "done" && (
        <CheckCircle2 className="h-3.5 w-3.5 text-success" strokeWidth={2} />
      )}
      {toolCall.status === "denied" && (
        <XCircle className="h-3.5 w-3.5 text-ember" strokeWidth={2} />
      )}
    </div>
  )
}
