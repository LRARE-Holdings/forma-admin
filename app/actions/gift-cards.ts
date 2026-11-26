"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { runAction } from "@/lib/action-result"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { resendGiftCardVoucher } from "@/lib/gift-cards"

const input = z.object({
  id: z.string().uuid(),
  who: z.enum(["buyer", "recipient"]),
  to: z.string().trim().email("Enter a valid email address").max(254),
})

/** Email a gift card's voucher again, now, to the buyer or the recipient. */
export async function resendGiftCard(id: string, who: "buyer" | "recipient", to: string) {
  return runAction(async () => {
    await requireAdmin()
    const parsed = input.safeParse({ id, who, to })
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the email address")
    const studioId = await getStudioId()
    await resendGiftCardVoucher(studioId, parsed.data.id, parsed.data.who, parsed.data.to)
    revalidatePath("/dashboard/gift-cards")
  })
}
