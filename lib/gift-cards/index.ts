import { createAdminClient } from "@/lib/supabase/admin"
import { sendStudioEmail } from "@/lib/email/send"
import { giftCardBuyerEmail, giftCardRecipientEmail } from "@/lib/email/gift-card-templates"
import { localDateStr } from "@/lib/utils"
import type { StudioBranding } from "@/lib/types"
import { renderVoucherPdf, formatVoucherDate } from "./voucher"

/**
 * Gift cards: paid for on the public site, confirmed here by the Stripe
 * webhook, emailed from here (this app owns studio email), claimed on the
 * public site through redeem_gift_card().
 */

type Admin = ReturnType<typeof createAdminClient>

export interface GiftCard {
  id: string
  studio_id: string
  code: string
  credits: number
  amount_pence: number
  pack_validity_days: number
  claim_months: number
  buyer_profile_id: string
  recipient_name: string
  sender_name: string
  recipient_email: string | null
  send_on: string | null
  status: "pending" | "paid" | "redeemed" | "refunded" | "abandoned"
  stripe_payment_intent_id: string | null
  paid_at: string | null
  expires_at: string | null
  buyer_emailed_at: string | null
  recipient_emailed_at: string | null
}

export function giftValue(credits: number): string {
  return credits === 1 ? "1 class" : `${credits} classes`
}

function packValidity(days: number): string {
  if (days % 7 === 0) return `${days / 7} week${days === 7 ? "" : "s"}`
  return `${days} days`
}

async function loadStudio(supabase: Admin, studioId: string) {
  const { data } = await supabase
    .from("studios")
    .select("name, domain, branding")
    .eq("id", studioId)
    .single()
  const domain = (data?.domain as string | null) ?? "burnmatstudio.co.uk"
  return {
    name: (data?.name as string) ?? "Your studio",
    domain,
    publicBaseUrl: `https://${domain}`,
    branding: (data?.branding as StudioBranding | null) ?? null,
  }
}

async function loadCard(supabase: Admin, id: string): Promise<GiftCard | null> {
  const { data } = await supabase.from("gift_cards").select("*").eq("id", id).maybeSingle()
  return (data as GiftCard | null) ?? null
}

/** The voucher PDF for a paid card. */
export async function giftCardVoucherPdf(card: GiftCard, domain?: string) {
  if (!card.expires_at) throw new Error("Gift card has not been paid for")
  const claimDomain = domain ?? (await loadStudio(createAdminClient(), card.studio_id)).domain
  return renderVoucherPdf({
    recipientName: card.recipient_name,
    senderName: card.sender_name,
    value: giftValue(card.credits),
    expiresAt: card.expires_at,
    code: card.code,
    claimUrl: `${claimDomain}/gift`,
  })
}

export async function giftCardVoucherById(id: string) {
  const card = await loadCard(createAdminClient(), id)
  if (!card || (card.status !== "paid" && card.status !== "redeemed")) return null
  return { card, pdf: await giftCardVoucherPdf(card) }
}

/**
 * The Stripe webhook's half: turn a held card into a paid one, then send the
 * emails that are due. Safe to run twice (Stripe retries): the update only
 * matches a pending card for this payment, and each email is claimed before
 * it is sent.
 */
export async function confirmGiftCardPayment(
  studioId: string,
  giftCardId: string,
  paymentIntentId: string,
) {
  const supabase = createAdminClient()
  const card = await loadCard(supabase, giftCardId)
  if (!card || card.studio_id !== studioId) return

  if (card.status === "pending") {
    const paidAt = new Date()
    const expiresAt = new Date(paidAt)
    expiresAt.setMonth(expiresAt.getMonth() + card.claim_months)

    const { error } = await supabase
      .from("gift_cards")
      .update({ status: "paid", paid_at: paidAt.toISOString(), expires_at: expiresAt.toISOString() })
      .eq("id", card.id)
      .eq("status", "pending")
      .eq("stripe_payment_intent_id", paymentIntentId)
    // Throwing makes Stripe retry, which is right for a transient DB error.
    if (error) throw new Error(`gift card confirm failed: ${error.message}`)
  }

  await deliverGiftCardEmails(card.id).catch((err) =>
    console.error("[gift-cards] Email delivery failed:", err),
  )
}

/** Mark a refunded card so it can no longer be claimed. */
export async function markGiftCardRefunded(paymentIntentId: string) {
  const supabase = createAdminClient()
  await supabase
    .from("gift_cards")
    .update({ status: "refunded" })
    .eq("stripe_payment_intent_id", paymentIntentId)
    .in("status", ["pending", "paid"])
}

/**
 * Claim one email slot (buyer or recipient) so two runs can't both send it.
 * Returns false when another run got there first.
 */
async function claimEmail(supabase: Admin, id: string, column: "buyer_emailed_at" | "recipient_emailed_at") {
  const { data } = await supabase
    .from("gift_cards")
    .update({ [column]: new Date().toISOString() })
    .eq("id", id)
    .is(column, null)
    .select("id")
  return (data ?? []).length > 0
}

async function releaseEmail(supabase: Admin, id: string, column: "buyer_emailed_at" | "recipient_emailed_at") {
  await supabase.from("gift_cards").update({ [column]: null }).eq("id", id)
}

/**
 * Send whatever is due for one card: the buyer's copy (straight after
 * payment) and the recipient's (from the morning of the date the buyer chose).
 */
export async function deliverGiftCardEmails(id: string) {
  const supabase = createAdminClient()
  const card = await loadCard(supabase, id)
  if (!card || card.status !== "paid" || !card.expires_at) return

  const today = localDateStr()
  const buyerDue = !card.buyer_emailed_at
  const recipientDue =
    !!card.recipient_email && !card.recipient_emailed_at && !!card.send_on && card.send_on <= today
  if (!buyerDue && !recipientDue) return

  const studio = await loadStudio(supabase, card.studio_id)
  const pdf = Buffer.from(await giftCardVoucherPdf(card, studio.domain))
  const attachment = {
    filename: `Burn gift voucher - ${card.recipient_name.replace(/[^\w\s-]/g, "").trim() || "gift"}.pdf`,
    content: pdf,
  }
  const base = {
    recipientName: card.recipient_name,
    senderName: card.sender_name,
    value: giftValue(card.credits),
    claimBy: formatVoucherDate(card.expires_at),
    packValidity: packValidity(card.pack_validity_days),
    code: card.code,
    claimUrl: `${studio.publicBaseUrl}/gift?code=${encodeURIComponent(card.code)}`,
    studioName: studio.name,
    branding: studio.branding,
  }

  if (buyerDue && (await claimEmail(supabase, card.id, "buyer_emailed_at"))) {
    const { data: buyer } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", card.buyer_profile_id)
      .single()
    const sendsOn =
      card.recipient_email && card.send_on && card.send_on > today
        ? new Date(card.send_on + "T12:00:00Z").toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            timeZone: "UTC",
          })
        : null
    const { subject, html } = giftCardBuyerEmail({
      ...base,
      buyerFirstName: ((buyer?.full_name as string | null) ?? "").split(" ")[0] || "there",
      sendsOn,
    })
    const result = buyer?.email
      ? await sendStudioEmail(card.studio_id, { to: buyer.email as string, subject, html, attachments: [attachment] })
      : { success: false }
    if (!result.success) await releaseEmail(supabase, card.id, "buyer_emailed_at")
  }

  if (recipientDue && (await claimEmail(supabase, card.id, "recipient_emailed_at"))) {
    const { subject, html } = giftCardRecipientEmail(base)
    const result = await sendStudioEmail(card.studio_id, {
      to: card.recipient_email!,
      subject,
      html,
      attachments: [attachment],
    })
    if (!result.success) await releaseEmail(supabase, card.id, "recipient_emailed_at")
  }
}

/** Daily: every card with an email still owed. */
export async function deliverDueGiftCards() {
  const supabase = createAdminClient()
  const today = localDateStr()
  const { data, error } = await supabase
    .from("gift_cards")
    .select("id")
    .eq("status", "paid")
    .or(
      `buyer_emailed_at.is.null,and(recipient_email.not.is.null,recipient_emailed_at.is.null,send_on.lte.${today})`,
    )
  if (error) throw new Error(error.message)

  let sent = 0
  for (const row of data ?? []) {
    try {
      await deliverGiftCardEmails(row.id as string)
      sent++
    } catch (err) {
      console.error("[gift-cards] delivery failed for", row.id, err)
    }
  }
  return { due: data?.length ?? 0, processed: sent }
}
