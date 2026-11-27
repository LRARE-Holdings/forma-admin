import { redirect } from "next/navigation"
import { getUser, requireDashboard } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { Sidebar } from "@/components/dashboard/sidebar"
import { MobileSidebar } from "@/components/dashboard/mobile-sidebar"
import type { Studio, Profile, UserRole } from "@/lib/types"
import { isPlatformOwner, overallStatus } from "@/lib/monitor/owner"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getUser()
  if (!user) redirect("/login")

  const studioId = await getStudioId()
  const supabase = await createClient()

  // Run role check, studio fetch, and profile fetch in parallel
  const [role, { data: studio }, { data: profile }, owner] = await Promise.all([
    requireDashboard(studioId),
    supabase.from("studios").select("*").eq("id", studioId).single(),
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    isPlatformOwner(),
  ])
  // Forma's own accounts get the Status page link, with its current state.
  const platformStatus = owner ? await overallStatus() : null

  return (
    <div className="min-h-screen">
      {/* Mobile: top bar + drawer sidebar */}
      <div className="print:hidden">
        <MobileSidebar
          studio={studio as Studio}
          profile={profile as Profile}
          role={role as UserRole}
          platformStatus={platformStatus}
        />
      </div>

      {/* Desktop: fixed sidebar */}
      <div className="hidden md:block print:hidden">
        <Sidebar
          studio={studio as Studio}
          profile={profile as Profile}
          role={role as UserRole}
          platformStatus={platformStatus}
        />
      </div>

      {/* Main content */}
      {/* Phones: the top bar is fixed and 3.5rem tall, so start content a gap below it. */}
      <main className="p-4 pt-[4.75rem] md:ml-[240px] md:p-7 md:pt-7 print:m-0 print:p-0">
        {children}
      </main>
    </div>
  )
}
