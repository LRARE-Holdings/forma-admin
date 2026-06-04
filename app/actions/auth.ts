"use server"

import { createClient } from "@/lib/supabase/server"

/**
 * Set the signed-in user's password.
 *
 * Used by the invite / password-recovery flow. The recovery session is
 * established server-side in /auth/callback and lives in the domain-scoped
 * auth cookies, so we update the password from a server action that reads
 * that same session — rather than the browser client, which can't reliably
 * reconstruct the session from document.cookie while stale host-only cookies
 * from the domain-scoping migration are still in play (that mix is what
 * produced "Auth session missing!" on /auth/set-password).
 */
export async function setPassword(
  password: string
): Promise<{ error?: string }> {
  if (!password || password.length < 8) {
    return { error: "Password must be at least 8 characters" }
  }

  const supabase = await createClient()

  // Confirm there's a live (recovery/invite) session before mutating it.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: "Your link has expired. Request a new one and try again." }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: error.message }

  return {}
}
