import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getStudioId } from "@/lib/studio-context"
import { DASHBOARD_ROLES } from "@/lib/types"
import type { UserRole } from "@/lib/types"

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type")

  const studioId = await getStudioId()
  const supabase = await createClient()

  let authError: Error | null = null

  if (code) {
    // PKCE flow (standard Supabase redirect)
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    authError = error
  } else if (tokenHash && type) {
    // Token hash flow (magic link via send-email edge function)
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "magiclink" | "signup" | "recovery" | "invite" | "email",
    })
    authError = error
  }

  if (!authError) {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      // Mark any pending invite as accepted (use admin client to bypass RLS)
      const adminClient = createAdminClient()
      await adminClient
        .from("admin_invites")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("email", user.email!)
        .eq("studio_id", studioId)
        .eq("status", "pending")

      // If this is an invite or recovery flow, send them to set their password
      // before they land on the dashboard
      const isInvite = type === "invite" || type === "signup"
      const isRecovery = type === "recovery"

      if (isInvite || isRecovery) {
        return NextResponse.redirect(`${origin}/auth/set-password`)
      }

      // For other flows (e.g. magic link from older sessions), redirect by role
      const { data: membership } = await supabase
        .from("studio_memberships")
        .select("role")
        .eq("studio_id", studioId)
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

  // Auth failed or no valid role — back to login
  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
