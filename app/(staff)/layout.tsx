import { redirect } from "next/navigation"
import { getUser, getUserRole } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { STUDIO_ID } from "@/lib/constants"
import { TopBar } from "@/components/staff/top-bar"
import type { Studio, Profile } from "@/lib/types"

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getUser()
  if (!user) redirect("/login")

  const role = await getUserRole()
  if (role !== "owner" && role !== "admin" && role !== "staff") redirect("/login")

  const supabase = await createClient()

  const { data: studio } = await supabase
    .from("studios")
    .select("*")
    .eq("id", STUDIO_ID)
    .single()

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()

  return (
    <div className="min-h-screen">
      <TopBar
        studio={studio as Studio}
        profile={profile as Profile}
      />
      <main className="mx-auto max-w-[900px] px-8 py-7">
        {children}
      </main>
    </div>
  )
}
