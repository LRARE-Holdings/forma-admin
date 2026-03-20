import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { STUDIO_ID } from "@/lib/constants"
import { DASHBOARD_ROLES } from "@/lib/types"
import type { UserRole } from "@/lib/types"

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get("code")

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: membership } = await supabase
          .from("studio_memberships")
          .select("role")
          .eq("studio_id", STUDIO_ID)
          .eq("profile_id", user.id)
          .single()

        const role = membership?.role as UserRole | undefined

        if (role && DASHBOARD_ROLES.includes(role)) {
          return NextResponse.redirect(`${origin}/dashboard`)
        }
        if (role === "staff") {
          return NextResponse.redirect(`${origin}/staff`)
        }
      }
    }
  }

  // Auth failed or no valid role — back to login
  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
