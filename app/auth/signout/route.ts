import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const url = new URL("/login", request.url)
  // 303 so a plain form post lands on /login as a GET (the default 307 would re-POST).
  return NextResponse.redirect(url, 303)
}
