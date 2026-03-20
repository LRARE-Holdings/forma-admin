"use client"

import type { Studio, Profile } from "@/lib/types"
import { getInitial } from "@/lib/utils"
import { StaffSignOut } from "./staff-sign-out"
import { AssistTrigger } from "@/components/assist/assist-trigger"

interface TopBarProps {
  studio: Studio
  profile: Profile
}

export function TopBar({ studio, profile }: TopBarProps) {
  return (
    <div className="sticky top-0 z-50 flex h-14 items-center justify-between bg-cocoa px-8">
      <div className="flex items-center gap-3">
        <h1 className="font-heading text-[1.2rem] font-semibold text-wheat">
          {studio.name?.replace(" Studio", "") ?? "Studio"}
        </h1>
        <span className="rounded-full bg-gold px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-cocoa">
          Instructor
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <AssistTrigger
          studioName={studio.name ?? "Studio"}
          planTier={studio.plan_tier}
          userName={profile.full_name ?? "Instructor"}
          variant="topbar"
        />
        <span className="text-[0.8rem] font-medium text-wheat">
          {profile.full_name ?? "Instructor"}
        </span>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gold font-heading text-[0.85rem] font-semibold text-cocoa">
          {getInitial(profile.full_name)}
        </div>
        <StaffSignOut />
      </div>
    </div>
  )
}
