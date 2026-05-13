"use client"

import { useCallback, useState, type ReactNode } from "react"
import { MemberProfileDialog } from "./member-profile-dialog"
import { MemberProfileContext } from "./member-profile-context"
import { CLOSE_DIALOGS_EVENT } from "@/components/ui/dialog"

export function MemberProfileProvider({ children }: { children: ReactNode }) {
  const [profileId, setProfileId] = useState<string | null>(null)

  const open = useCallback((id: string) => {
    // Tell every non-dominant dialog to close first.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(CLOSE_DIALOGS_EVENT))
    }
    setProfileId(id)
  }, [])

  const close = useCallback(() => {
    setProfileId(null)
  }, [])

  return (
    <MemberProfileContext value={{ open, close }}>
      {children}
      {profileId && (
        <MemberProfileDialog
          key={profileId}
          profileId={profileId}
          onOpenChange={(o) => {
            if (!o) close()
          }}
        />
      )}
    </MemberProfileContext>
  )
}
