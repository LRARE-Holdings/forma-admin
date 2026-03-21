"use client"

import { useState, useEffect, useCallback } from "react"
import { Menu, X } from "lucide-react"
import { Sidebar } from "./sidebar"
import { getInitial } from "@/lib/utils"
import type { Studio, Profile, UserRole } from "@/lib/types"

interface MobileSidebarProps {
  studio: Studio
  profile: Profile
  role: UserRole
}

export function MobileSidebar({ studio, profile, role }: MobileSidebarProps) {
  const [isOpen, setIsOpen] = useState(false)
  // Close on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setIsOpen(false)
  }, [])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown)
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = ""
    }
  }, [isOpen, handleKeyDown])

  return (
    <>
      {/* Top bar (mobile only) */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between bg-cocoa px-4 md:hidden">
        <button
          onClick={() => setIsOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-wheat hover:bg-white/10"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <span className="font-heading text-[1rem] font-semibold text-wheat">
          {studio.name?.replace(" Studio", "") ?? "Studio"}
        </span>

        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gold font-heading text-[0.8rem] font-semibold text-cocoa">
          {getInitial(profile.full_name)}
        </div>
      </header>

      {/* Overlay + sidebar drawer */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Sidebar in overlay — reuse the same Sidebar component */}
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">
            <div className="relative">
              <Sidebar
                studio={studio}
                profile={profile}
                role={role}
                onNavigate={() => setIsOpen(false)}
              />
              <button
                onClick={() => setIsOpen(false)}
                className="absolute right-3 top-6 flex h-7 w-7 items-center justify-center rounded-md text-warm-grey hover:text-wheat"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
