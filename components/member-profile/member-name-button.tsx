"use client"

import type { ReactNode } from "react"
import { useMemberProfile } from "./member-profile-context"

export function MemberNameButton({
  profileId,
  className = "",
  children,
}: {
  profileId: string
  className?: string
  children: ReactNode
}) {
  const { open } = useMemberProfile()
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        open(profileId)
      }}
      className={`text-left transition-colors hover:text-gold ${className}`}
    >
      {children}
    </button>
  )
}
