"use client"

import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"

export function StaffSignOut() {
  const router = useRouter()

  async function handleSignOut() {
    await fetch("/auth/signout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      className="ml-1 text-warm-grey hover:text-wheat"
      title="Sign out"
    >
      <LogOut className="h-4 w-4" />
    </button>
  )
}
