import { createBrowserClient } from "@supabase/ssr"

export function createClient() {
  const domain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    domain ? { cookieOptions: { domain } } : undefined
  )
}
