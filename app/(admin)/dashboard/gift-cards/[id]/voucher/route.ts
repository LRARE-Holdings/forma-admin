import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { giftCardVoucherById } from "@/lib/gift-cards"

/** GET — the voucher PDF for one gift card, for the studio's admins. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const studioId = await getStudioId()

  const result = await giftCardVoucherById(id).catch(() => null)
  if (!result || result.card.studio_id !== studioId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const name = result.card.recipient_name.replace(/[^\w\s-]/g, "").trim() || "gift"
  return new NextResponse(Buffer.from(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Burn gift voucher - ${name}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  })
}
