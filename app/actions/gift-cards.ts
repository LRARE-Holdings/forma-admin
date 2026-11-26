"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { runAction } from "@/lib/action-result"
import { getUser, requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { resendGiftCardVoucher } from "@/lib/gift-cards"
import {
  cancelGiftCardRequest,
  createGiftCardRequest,
  emailPaymentLink,
  paymentLinkFor,
} from "@/lib/gift-cards/requests"

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

const requestInput = z
  .object({
    tierId: z.string().uuid("Pick a gift card"),
    classId: z.string().uuid().nullable(),
    buyerName: z.string().trim().min(1, "Add the buyer's name").max(80),
    buyerEmail: z.string().trim().email("Enter the buyer's email address").max(254),
    recipientName: z.string().trim().min(1, "Add who it's for").max(40, "Keep the name under 40 characters"),
    senderName: z.string().trim().min(1, "Add who it's from").max(40, "Keep the name under 40 characters"),
    recipientEmail: z.string().trim().email("Enter a valid email for the recipient").max(254).nullable(),
    sendOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })

/**
 * Set up a gift card for a customer and email them the link to pay. Nothing
 * reaches the recipient until the payment goes through.
 */
export async function createGiftCardRequestAction(raw: z.input<typeof requestInput>) {
  return runAction(async () => {
    await requireAdmin()
    const user = await getUser()
    const parsed = requestInput.safeParse(raw)
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the details")
    const studioId = await getStudioId()
    const { id } = await createGiftCardRequest(studioId, user!.id, parsed.data)
    let emailed = true
    try {
      await emailPaymentLink(studioId, id)
    } catch {
      emailed = false
    }
    revalidatePath("/dashboard/gift-cards")
    return { id, emailed, link: await paymentLinkFor(studioId, id) }
  })
}

export async function emailGiftCardRequestAgain(id: string, to: string) {
  return runAction(async () => {
    await requireAdmin()
    const address = z.string().trim().email("Enter a valid email address").safeParse(to)
    if (!address.success) throw new Error(address.error.issues[0]?.message)
    await emailPaymentLink(await getStudioId(), z.string().uuid().parse(id), address.data)
    revalidatePath("/dashboard/gift-cards")
  })
}

export async function cancelGiftCardRequestAction(id: string) {
  return runAction(async () => {
    await requireAdmin()
    await cancelGiftCardRequest(await getStudioId(), z.string().uuid().parse(id))
    revalidatePath("/dashboard/gift-cards")
  })
}

export async function giftCardRequestLink(id: string) {
  return runAction(async () => {
    await requireAdmin()
    return { link: await paymentLinkFor(await getStudioId(), z.string().uuid().parse(id)) }
  })
}
