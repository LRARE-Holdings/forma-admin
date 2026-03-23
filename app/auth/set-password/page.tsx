import { redirect } from "next/navigation"
import { getUser, getUserRole, instructorNeedsSetup } from "@/lib/auth"
import { DASHBOARD_ROLES } from "@/lib/types"
import { SetPasswordForm } from "@/components/auth/set-password-form"

export default async function SetPasswordPage() {
  const user = await getUser()

  // Must be logged in (they just clicked an invite link)
  if (!user) redirect("/login")

  const role = await getUserRole()

  // If instructor profile needs setup, go there after password is set.
  // Otherwise go straight to the appropriate dashboard.
  const needsSetup = await instructorNeedsSetup()
  const defaultRedirect =
    role && DASHBOARD_ROLES.includes(role) ? "/dashboard" : role === "staff" ? "/staff" : "/login"
  const redirectTo = needsSetup ? "/auth/setup-profile" : defaultRedirect

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-3xl font-semibold text-cocoa">
            Set your password
          </h1>
          <p className="mt-1 text-sm text-warm-grey">
            Create a password so you can sign in next time
          </p>
        </div>
        <div className="rounded-2xl border border-sand bg-white p-8">
          <SetPasswordForm redirectTo={redirectTo} />
        </div>
      </div>
    </div>
  )
}
