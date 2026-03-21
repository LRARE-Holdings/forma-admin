import { NextResponse } from "next/server"
import { expireUnclaimedOffers } from "@/lib/waitlist"

export async function GET(request: Request) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    await expireUnclaimedOffers()
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[cron/waitlist] Error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
