"use client"

import { createContext, useContext } from "react"

interface MemberProfileContextValue {
  open: (profileId: string) => void
  close: () => void
}

export const MemberProfileContext =
  createContext<MemberProfileContextValue | null>(null)

export function useMemberProfile() {
  const ctx = useContext(MemberProfileContext)
  if (!ctx) {
    throw new Error(
      "useMemberProfile must be used inside MemberProfileProvider",
    )
  }
  return ctx
}
