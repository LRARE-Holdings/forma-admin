import { redirect } from "next/navigation"
import { getUser, getUserRole, getInstructorForUser, instructorNeedsSetup } from "@/lib/auth"
import { DASHBOARD_ROLES } from "@/lib/types"
import { SetupProfileForm } from "@/components/auth/setup-profile-form"

export default async function SetupProfilePage() {
  const user = await getUser()
  if (!user) redirect("/login")

  const instructor = await getInstructorForUser()

  // If no instructor record or profile is already set up, skip to dashboard/staff
  if (!instructor || !(await instructorNeedsSetup())) {
    const role = await getUserRole()
    if (role && DASHBOARD_ROLES.includes(role)) redirect("/dashboard")
    if (role === "staff") redirect("/staff")
    redirect("/login")
  }

  const role = await getUserRole()
  const redirectTo =
    role && DASHBOARD_ROLES.includes(role) ? "/dashboard" : role === "staff" ? "/staff" : "/login"

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-3xl font-semibold text-cocoa">
            Complete your profile
          </h1>
          <p className="mt-1 text-sm text-warm-grey">
            Add a photo and bio so members can get to know you
          </p>
        </div>
        <div className="rounded-2xl border border-sand bg-white p-8">
          <SetupProfileForm
            instructor={{
              id: instructor.id,
              name: instructor.name,
              bio: instructor.bio ?? "",
              photo_url: instructor.photo_url ?? null,
            }}
            redirectTo={redirectTo}
          />
        </div>
      </div>
    </div>
  )
}
