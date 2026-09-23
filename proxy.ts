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

  // Look up studio by admin_domain using service role (no user session in middleware).
  // checkin.<studio domain> is the door check-in site, served by this same app.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const checkInDomain = checkInSiteDomain(host)
  const { data: studio } = await supabase
    .from("studios")
    .select("id")
    .eq(checkInDomain ? "domain" : "admin_domain", checkInDomain ?? host)
    .single()

  if (studio) {
    domainCache.set(host, { studioId: studio.id, expires: Date.now() + CACHE_TTL })
  }

  return studio?.id ?? null
}

/** "burnmatstudio.co.uk" for checkin.burnmatstudio.co.uk, otherwise null. */
function checkInSiteDomain(host: string): string | null {
  const domain = host.split(":")[0]
  return domain.startsWith("checkin.") ? domain.slice("checkin.".length) : null
}

// Matches the cookies @supabase/ssr writes: the base auth token, its numbered
// chunks (…-auth-token.0/.1), and the PKCE code verifier.
const AUTH_COOKIE_PATTERN = /^sb-.*-auth-token/
// The *base* session cookie only — excludes the .0/.1 chunks and the
// -code-verifier cookie (both have extra suffixes after "-auth-token").
const AUTH_BASE_COOKIE_PATTERN = /^sb-.*-auth-token$/

function rawCookieNames(request: NextRequest): string[] {
  const raw = request.headers.get("cookie")
  if (!raw) return []
  const names: string[] = []
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    names.push(part.slice(0, eq).trim())
  }
  return names
}

/**
 * Names of stale host-only auth cookies that should be purged from the browser.
 *
 * When NEXT_PUBLIC_AUTH_COOKIE_DOMAIN is set we write the session cookies
 * scoped to the shared parent domain (e.g. .burnmatstudio.co.uk). Browsers that
 * still hold a *host-only* copy from before that change keep sending it, which
 * corrupts @supabase/ssr's chunked-session reconstruction and bounces the user
 * to /login. Two shapes of leftover survive the migration:
 *
 *  1. Same name twice — a host-only and a domain-scoped copy of the same cookie
 *     name both arrive in the header (count > 1).
 *  2. Base + chunks — a host-only base `sb-…-auth-token` arrives alongside the
 *     new domain-scoped `…-auth-token.0/.1` chunks. @supabase/ssr writes EITHER
 *     a single base cookie OR chunks for a given session, never both, so when
 *     both are present the base is the stale host-only leftover and it shadows
 *     the valid chunks.
 *
 * Both are purged with a Domain-less deletion in finalize(), which targets only
 * the host-only copy and leaves the domain-scoped session intact.
 */
function staleAuthCookieNames(request: NextRequest): string[] {
  const names = rawCookieNames(request)
  const stale = new Set<string>()

  // Case 1: an auth cookie name appearing more than once in the header.
  const counts = new Map<string, number>()
  for (const name of names) {
    if (AUTH_COOKIE_PATTERN.test(name)) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  for (const [name, n] of counts) {
    if (n > 1) stale.add(name)
  }

  // Case 2: a base session cookie present alongside its own numbered chunks.
  for (const name of names) {
    if (
      AUTH_BASE_COOKIE_PATTERN.test(name) &&
      names.some((other) => other.startsWith(`${name}.`))
    ) {
      stale.add(name)
    }
  }

  return [...stale]
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
  const staleAuthCookies = cookieDomain ? staleAuthCookieNames(request) : []

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

  // Root page — the check-in site opens on the door check-in; everywhere else
  // on the dashboard (layouts handle the role check).
  if (pathname === "/") {
    const url = request.nextUrl.clone()
    url.pathname = checkInSiteDomain(host) ? "/check-in" : "/dashboard"
    return finalize(NextResponse.redirect(url))
  }

  return finalize(supabaseResponse)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
