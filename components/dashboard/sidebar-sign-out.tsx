"use client"

import { useRouter } from "next/navigation"

export function SidebarSignOut() {
  const router = useRouter()

  async function handleSignOut() {
    await fetch("/auth/signout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-[0.65rem] text-warm-grey hover:text-wheat"
    >
      Sign out
    </button>
  )
}
