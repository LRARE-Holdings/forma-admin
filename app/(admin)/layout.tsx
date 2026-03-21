import { redirect } from "next/navigation"
import { getUser, requireDashboard } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { Sidebar } from "@/components/dashboard/sidebar"
import { MobileSidebar } from "@/components/dashboard/mobile-sidebar"
import type { Studio, Profile, UserRole } from "@/lib/types"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getUser()
  if (!user) redirect("/login")

  const role = await requireDashboard()
  const studioId = await getStudioId()

  const supabase = await createClient()

  const { data: studio } = await supabase
    .from("studios")
    .select("*")
    .eq("id", studioId)
    .single()

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()

  return (
    <div className="min-h-screen">
      {/* Mobile: top bar + drawer sidebar */}
      <MobileSidebar
        studio={studio as Studio}
        profile={profile as Profile}
        role={role as UserRole}
      />

      {/* Desktop: fixed sidebar */}
      <div className="hidden md:block">
        <Sidebar
          studio={studio as Studio}
          profile={profile as Profile}
          role={role as UserRole}
        />
      </div>

      {/* Main content */}
      <main className="pt-14 p-4 md:ml-[240px] md:p-7 md:pt-7">
        {children}
      </main>
    </div>
  )
}
