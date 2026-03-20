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

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") || ""

  // --- Resolve studio from domain ---
  const studioId = await resolveStudioId(host)

  if (!studioId) {
    // Unknown domain — redirect to Forma landing
    return NextResponse.redirect("https://useforma.co.uk")
  }

  // Inject studio ID as a request header for downstream server components/actions
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-studio-id", studioId)

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })

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
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the session — important for server components
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public routes — always accessible
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api")
  ) {
    return supabaseResponse
  }

  // Not logged in — redirect to login
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  // Root page — redirect to dashboard (layout will handle role check)
  if (pathname === "/") {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
