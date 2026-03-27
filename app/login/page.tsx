import { redirect } from "next/navigation"
import { getUser, getUserRole } from "@/lib/auth"
import { DASHBOARD_ROLES } from "@/lib/types"
import { LoginForm } from "@/components/auth/login-form"
import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"

export default async function LoginPage() {
  const user = await getUser()

  if (user) {
    const role = await getUserRole()
    if (role && DASHBOARD_ROLES.includes(role)) redirect("/dashboard")
    if (role === "staff") redirect("/staff")
  }

  // Fetch studio name for branding
  let studioName = "Studio"
  try {
    const studioId = await getStudioId()
    const supabase = await createClient()
    const { data: studio } = await supabase
      .from("studios")
      .select("name")
      .eq("id", studioId)
      .single()
    if (studio?.name) studioName = studio.name
  } catch {
    // Fall back to generic name
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-3xl font-semibold text-cocoa">
            {studioName}
          </h1>
          <p className="mt-1 text-sm text-warm-grey">
            Sign in to your dashboard
          </p>
        </div>
        <div className="rounded-2xl border border-sand bg-white p-8">
          <LoginForm />
        </div>
      </div>
    </div>
  )
}
