import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { giftCardVoucherById } from "@/lib/gift-cards"

/**
 * GET /api/internal/gift-voucher?id=<gift card id>
 *
 * The voucher PDF, for burn-public to hand to the buyer after checking they
 * bought it. Rendering lives here, next to the emails that attach the same
 * file, so both always match.
 *
 * Authenticated with INTERNAL_EMAIL_SECRET, like the other internal routes.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.INTERNAL_EMAIL_SECRET
  if (!secret) {
    console.error("[internal/gift-voucher] INTERNAL_EMAIL_SECRET not set")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const id = z.string().uuid().safeParse(request.nextUrl.searchParams.get("id"))
  if (!id.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const result = await giftCardVoucherById(id.data)
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return new NextResponse(Buffer.from(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
    },
  })
}
