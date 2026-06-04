import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

// In-memory cache for domain → studio ID lookups (cleared on redeploy)
const domainCache = new Map<string, { studioId: string; expires: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function resolveStudioId(host: string): Promise<string | null> {
  // Local dev fallback
  if (process.env.NEXT_PUBLIC_STUDIO_ID) {
    return process.env.NEXT_PUBLIC_STUDIO_ID
  }

  // Check cache
  const cached = domainCache.get(host)
  if (cached && cached.expires > Date.now()) {
    return cached.studioId
  }

  // Look up studio by admin_domain using service role (no user session in middleware)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: studio } = await supabase
    .from("studios")
    .select("id")
    .eq("admin_domain", host)
    .single()

  if (studio) {
    domainCache.set(host, { studioId: studio.id, expires: Date.now() + CACHE_TTL })
  }

  return studio?.id ?? null
}

// Matches the cookies @supabase/ssr writes: the base auth token, its numbered
// chunks (…-auth-token.0/.1), and the PKCE code verifier.
const AUTH_COOKIE_PATTERN = /^sb-.*-auth-token/

/**
 * Names of auth cookies that arrive duplicated in the raw Cookie header.
 *
 * When NEXT_PUBLIC_AUTH_COOKIE_DOMAIN is set we write the session cookies
 * scoped to the shared parent domain (e.g. .burnmatstudio.co.uk). Browsers
 * that still hold a *host-only* copy from before that change send BOTH copies
 * under the same name, which corrupts @supabase/ssr's chunked-session
 * reconstruction and bounces the user to /login. A name appearing more than
 * once in the header is the tell-tale of that stale duplicate.
 */
function duplicateAuthCookieNames(request: NextRequest): string[] {
  const raw = request.headers.get("cookie")
  if (!raw) return []
  const counts = new Map<string, number>()
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (AUTH_COOKIE_PATTERN.test(name)) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name)
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") || ""
  const { pathname } = request.nextUrl

  // --- Resolve studio from domain ---
  const studioId = await resolveStudioId(host)

  if (!studioId) {
    // Allow cron/webhook API routes through even without a studio domain match
    // (Vercel cron and Stripe webhooks hit the deployment URL, not the custom domain)
    if (pathname.startsWith("/api")) {
      return NextResponse.next()
    }
    // Unknown domain — redirect to Forma landing
    return NextResponse.redirect("https://useforma.co.uk")
  }

  // Inject studio ID as a request header for downstream server components/actions
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-studio-id", studioId)

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })

  const cookieDomain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
  const staleAuthCookies = cookieDomain ? duplicateAuthCookieNames(request) : []

  // Whatever response we ultimately return must carry the cookies Supabase
  // wrote during getUser() (a rotated or cleared session) AND purge any stale
  // host-only duplicates. The Supabase SSR docs are explicit: if you return a
  // response other than the one the client wrote cookies to, you must copy
  // those cookies over — otherwise the refreshed session is silently dropped,
  // which is the classic login-loop footgun on the redirect branches below.
  const finalize = (res: NextResponse): NextResponse => {
    if (res !== supabaseResponse) {
      supabaseResponse.cookies
        .getAll()
        .forEach((cookie) => res.cookies.set(cookie))
    }
    for (const name of staleAuthCookies) {
      // A deletion with no Domain attribute targets only the host-only copy
      // and leaves the domain-scoped session cookie intact. Append the raw
      // header so it can't clobber a same-named domain cookie in the map.
      res.headers.append("set-cookie", `${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax`)
    }
    return res
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, cookieDomain ? { ...options, domain: cookieDomain } : options)
          )
        },
      },
    }
  )

  // Refresh the session — important for server components
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Public routes — always accessible
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api")
  ) {
    return finalize(supabaseResponse)
  }

  // Not logged in — redirect to login
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return finalize(NextResponse.redirect(url))
  }

  // Root page — redirect to dashboard (layout will handle role check)
  if (pathname === "/") {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    return finalize(NextResponse.redirect(url))
  }

  return finalize(supabaseResponse)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
