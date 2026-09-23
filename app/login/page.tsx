import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getUser, getUserRole } from "@/lib/auth"
import { DASHBOARD_ROLES } from "@/lib/types"
import { LoginForm } from "@/components/auth/login-form"
import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"

const LOGIN_ERRORS: Record<string, string> = {
  auth_failed: "That sign-in link didn't work — it may have expired or already been used. Sign in below, or use \"Forgot password\" for a new link.",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const [user, { error: errorCode }, requestHeaders] = await Promise.all([getUser(), searchParams, headers()])
  // checkin.<studio domain>: the door check-in site, for instructors and the studio.
  const isCheckInSite = (requestHeaders.get("host") ?? "").startsWith("checkin.")

  // Signed in with a dashboard role: straight through. Signed in without one
  // (a member, or someone from another studio) used to be shown the form again
  // with no explanation — every sign-in looked like it silently failed.
  let noAccessEmail: string | null = null
  if (user) {
    const role = await getUserRole()
    if (isCheckInSite && role && (role === "staff" || DASHBOARD_ROLES.includes(role))) redirect("/check-in")
    if (role && DASHBOARD_ROLES.includes(role)) redirect("/dashboard")
    if (role === "staff") redirect("/staff")
    noAccessEmail = user.email ?? "this account"
  }

  // Fetch studio name for branding
  let studioName = "Studio"
  let studioDomain: string | null = null
  try {
    const studioId = await getStudioId()
    const supabase = await createClient()
    const { data: studio } = await supabase
      .from("studios")
      .select("name, domain")
      .eq("id", studioId)
      .single()
    if (studio?.name) studioName = studio.name
    studioDomain = (studio?.domain as string | null) ?? null
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
            {isCheckInSite ? "Sign in to check in your class" : "Sign in to your dashboard"}
          </p>
        </div>
        <div className="rounded-2xl border border-sand bg-white p-8">
          {noAccessEmail ? (
            <div className="space-y-4 text-sm text-cocoa">
              <p>
                You&apos;re signed in as <span className="font-medium">{noAccessEmail}</span>, which
                doesn&apos;t have access to the {studioName} dashboard.
              </p>
              {studioDomain && (
                <p className="text-warm-grey">
                  Booking classes? Head to{" "}
                  <a href={`https://${studioDomain}`} className="text-cocoa underline underline-offset-2">
                    {studioDomain}
                  </a>
                  .
                </p>
              )}
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="w-full rounded-lg border border-sand px-4 py-2 font-medium text-cocoa transition-colors hover:bg-cream"
                >
                  Sign in with a different account
                </button>
              </form>
            </div>
          ) : (
            <LoginForm initialError={errorCode ? LOGIN_ERRORS[errorCode] ?? null : null} />
          )}
        </div>
      </div>
    </div>
  )
}
