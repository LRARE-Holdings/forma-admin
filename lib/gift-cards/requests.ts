import { randomInt } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { stripe } from "@/lib/stripe"
import { sendStudioEmail } from "@/lib/email/send"
import { giftCardPaymentRequestEmail } from "@/lib/email/gift-card-templates"
import { localDateStr } from "@/lib/utils"
import type { StudioBranding } from "@/lib/types"
import { giftValue } from "./index"

/**
 * Gift cards the studio sets up for a customer who isn't buying online
 * themselves (rang up, asked at the desk). The admin fills the card in, the
 * customer gets a link to pay for it on the website, and from payment on it
 * is an ordinary gift card: the Stripe webhook marks it paid, emails the
 * buyer the voucher with a receipt, and emails the recipient on their date.
 *
 * Prices come from the same place as the website's: the tier, or for a
 * one-class card the class's drop-in price. Never from the form.
 */

// Same alphabet and shape as the public site's checkout (no 0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
function newCode(): string {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  const block = () => Array.from({ length: 4 }, pick).join("")
  return `BURN-${block()}-${block()}`
}

export interface GiftRequestInput {
  tierId: string
  classId: string | null
  buyerName: string
  buyerEmail: string
  recipientName: string
  senderName: string
  recipientEmail: string | null
  /** YYYY-MM-DD; today means "as soon as it's paid". */
  sendOn: string | null
}

export function paymentLink(domain: string, card: { id: string; access_token: string }) {
  return `https://${domain}/gift/pay/${card.id}?t=${card.access_token}`
}

export async function createGiftCardRequest(
  studioId: string,
  requestedBy: string,
  input: GiftRequestInput,
): Promise<{ id: string }> {
  const supabase = createAdminClient()

  const { data: tier } = await supabase
    .from("gift_card_tiers")
    .select("id, credits, price_pence, priced_by_class, pack_validity_days, claim_months")
    .eq("id", input.tierId)
    .eq("studio_id", studioId)
    .maybeSingle()
  if (!tier) throw new Error("Pick a gift card")

  let amountPence = tier.price_pence as number | null
  let classId: string | null = null
  if (tier.priced_by_class) {
    if (!input.classId) throw new Error("Pick which class the gift is for")
    const { data: cls } = await supabase
      .from("classes")
      .select("id, price_pence")
      .eq("id", input.classId)
      .eq("studio_id", studioId)
      .maybeSingle()
    if (!cls?.price_pence) throw new Error("That class has no price, so it can't be a gift card")
    amountPence = cls.price_pence
    classId = cls.id
  }
  if (!amountPence) throw new Error("That gift card has no price yet")

  const today = localDateStr()
  const sendOn = input.recipientEmail ? (input.sendOn && input.sendOn > today ? input.sendOn : today) : null

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from("gift_cards")
      .insert({
        studio_id: studioId,
        tier_id: tier.id,
        code: newCode(),
        credits: tier.credits,
        amount_pence: amountPence,
        class_id: classId,
        pack_validity_days: tier.pack_validity_days,
        claim_months: tier.claim_months,
        buyer_email: input.buyerEmail,
        buyer_name: input.buyerName,
        recipient_name: input.recipientName,
        sender_name: input.senderName,
        recipient_email: input.recipientEmail,
        send_on: sendOn,
        requested_at: new Date().toISOString(),
        requested_by: requestedBy,
      })
      .select("id")
      .single()
    if (!error) return { id: data.id }
    if (error.code !== "23505") throw new Error(error.message)
  }
  throw new Error("Couldn't create the gift card. Please try again.")
}

/** A studio-requested card that's still waiting for payment, or an error. */
async function loadOpenRequest(studioId: string, id: string) {
  const supabase = createAdminClient()
  const { data: card } = await supabase
    .from("gift_cards")
    .select("id, studio_id, status, access_token, requested_at, credits, amount_pence, buyer_name, buyer_email, recipient_name, sender_name, recipient_email, send_on, classes(name)")
    .eq("id", id)
    .eq("studio_id", studioId)
    .maybeSingle()
  if (!card || !card.requested_at) throw new Error("Gift card request not found")
  if (card.status === "paid" || card.status === "redeemed") throw new Error("This gift card has already been paid for")
  if (card.status !== "pending") throw new Error("This request was cancelled")
  return card
}

export async function emailPaymentLink(studioId: string, id: string, to?: string): Promise<void> {
  const supabase = createAdminClient()
  const card = await loadOpenRequest(studioId, id)
  const address = (to ?? card.buyer_email ?? "").trim()
  if (!address) throw new Error("There's no email address for the buyer")

  const { data: studio } = await supabase.from("studios").select("name, domain, branding").eq("id", studioId).single()
  const domain = (studio?.domain as string | null) ?? "burnmatstudio.co.uk"
  const cls = (Array.isArray(card.classes) ? card.classes[0] : card.classes) as { name: string } | null
  const className = cls?.name ? cls.name.replace(/\s+/g, " ").trim() : null
  const today = localDateStr()

  const email = giftCardPaymentRequestEmail({
    buyerFirstName: (card.buyer_name ?? "").trim().split(/\s+/)[0] || "there",
    recipientName: card.recipient_name,
    senderName: card.sender_name,
    gift: className ? giftValue(1, className) : `${giftValue(card.credits)} · any class`,
    price: `£${(card.amount_pence / 100).toFixed(2)}`,
    recipientEmail: card.recipient_email,
    recipientSends: card.recipient_email && card.send_on
      ? card.send_on <= today
        ? "as soon as you've paid"
        : new Date(card.send_on + "T12:00:00Z").toLocaleDateString("en-GB", {
            weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
          })
      : null,
    payUrl: paymentLink(domain, card),
    studioName: (studio?.name as string) ?? "Burn Mat Studio",
    branding: (studio?.branding as StudioBranding | null) ?? null,
  })

  const result = await sendStudioEmail(studioId, { to: address, subject: email.subject, html: email.html })
  if (!result.success) throw new Error("The email didn't send. Copy the link and send it another way.")

  await supabase
    .from("gift_cards")
    .update({ request_emailed_at: new Date().toISOString(), ...(to ? { buyer_email: address } : {}) })
    .eq("id", card.id)
}

/**
 * Cancel a request nobody has paid. The link then says it's no longer
 * available. If the customer has opened the payment form, their Stripe
 * payment is cancelled first, so they can't pay for a card that's gone; if
 * that payment has already gone through (or is going through), the card
 * stays and the webhook completes it as normal.
 */
export async function cancelGiftCardRequest(studioId: string, id: string): Promise<void> {
  await loadOpenRequest(studioId, id)
  const supabase = createAdminClient()
  const { data: row } = await supabase.from("gift_cards").select("stripe_payment_intent_id").eq("id", id).single()
  if (row?.stripe_payment_intent_id) {
    const { data: studio } = await supabase.from("studios").select("stripe_account_id").eq("id", studioId).single()
    const opts = studio?.stripe_account_id ? { stripeAccount: studio.stripe_account_id as string } : undefined
    const pi = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id, opts)
    if (pi.status === "succeeded" || pi.status === "processing") {
      throw new Error("They've just paid, so this gift card can't be cancelled. Refund it in Stripe if needed.")
    }
    if (pi.status !== "canceled") await stripe.paymentIntents.cancel(pi.id, opts)
  }
  const { error } = await supabase
    .from("gift_cards")
    .update({ status: "abandoned" })
    .eq("id", id)
    .eq("status", "pending")
  if (error) throw new Error(error.message)
}

export async function paymentLinkFor(studioId: string, id: string): Promise<string> {
  const card = await loadOpenRequest(studioId, id)
  const { data: studio } = await createAdminClient().from("studios").select("domain").eq("id", studioId).single()
  return paymentLink((studio?.domain as string | null) ?? "burnmatstudio.co.uk", card)
}
