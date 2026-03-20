import { redirect } from "next/navigation"
import { getUser, getUserRole } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { DASHBOARD_ROLES } from "@/lib/types"
import { LoginForm } from "@/components/auth/login-form"

export default async function LoginPage() {
  const user = await getUser()

  if (user) {
    const role = await getUserRole()
    if (role && DASHBOARD_ROLES.includes(role)) redirect("/dashboard")
    if (role === "staff") redirect("/staff")
  }

  const studioId = await getStudioId()

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-3xl font-semibold text-cocoa">
            Burn Studio
          </h1>
          <p className="mt-1 text-sm text-warm-grey">
            Sign in to your dashboard
          </p>
        </div>
        <div className="rounded-2xl border border-sand bg-white p-8">
          <LoginForm studioId={studioId} />
        </div>
      </div>
    </div>
  )
}
