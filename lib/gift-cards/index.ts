import { createAdminClient } from "@/lib/supabase/admin"
import { sendStudioEmail } from "@/lib/email/send"
import { giftCardBuyerEmail, giftCardRecipientEmail } from "@/lib/email/gift-card-templates"
import { localDateStr } from "@/lib/utils"
import type { StudioBranding } from "@/lib/types"
import { renderVoucherPdf, formatVoucherDate } from "./voucher"
import { giftClaimDeadline } from "./dates"

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
  /** null for a guest buyer (no account): see buyer_email / buyer_name. */
  buyer_profile_id: string | null
  buyer_email: string | null
  buyer_name: string | null
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
  /** Single-class cards: the class it's for, and its name. */
  class_id: string | null
  className: string | null
}

/** "5 classes", or "1 Barre class" for a single-class card. */
export function giftValue(credits: number, className?: string | null): string {
  if (className) return credits === 1 ? `1 ${className} class` : `${credits} ${className} classes`
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
  const { data } = await supabase.from("gift_cards").select("*, classes(name)").eq("id", id).maybeSingle()
  if (!data) return null
  const cls = (Array.isArray(data.classes) ? data.classes[0] : data.classes) as { name: string } | null
  const { classes: _classes, ...card } = data
  void _classes
  return { ...(card as GiftCard), className: cls?.name ? cls.name.replace(/\s+/g, " ").trim() : null }
}

/** The voucher PDF for a paid card. */
export async function giftCardVoucherPdf(card: GiftCard, domain?: string) {
  if (!card.expires_at) throw new Error("Gift card has not been paid for")
  const claimDomain = domain ?? (await loadStudio(createAdminClient(), card.studio_id)).domain
  return renderVoucherPdf({
    recipientName: card.recipient_name,
    senderName: card.sender_name,
    value: giftValue(card.credits, card.className),
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
 * The Stripe webhook's half: turn a held card into a paid one. Emails are
 * sent separately (deliverGiftCardEmails), after the webhook has answered
 * Stripe, so a slow PDF render can't make Stripe time out and retry.
 *
 * Safe to run twice (Stripe retries): only a pending card is updated. The
 * card is matched by id; its stored payment intent must be this one or not
 * yet recorded (the public site saves it straight after creating the
 * payment, and that save could in theory fail).
 *
 * Returns the card id when the card is paid (now or already), else null.
 */
export async function confirmGiftCardPayment(
  studioId: string,
  giftCardId: string,
  payment: { id: string; amount_received: number },
): Promise<string | null> {
  const supabase = createAdminClient()
  const card = await loadCard(supabase, giftCardId)
  if (!card || card.studio_id !== studioId) {
    console.error(`[gift-cards] Payment ${payment.id} names gift card ${giftCardId}, which isn't at this studio`)
    return null
  }
  if (card.stripe_payment_intent_id && card.stripe_payment_intent_id !== payment.id) {
    console.error(`[gift-cards] Gift card ${card.id} belongs to ${card.stripe_payment_intent_id}, not ${payment.id}`)
    return null
  }
  if (payment.amount_received !== card.amount_pence) {
    // Can't happen through our checkout (the server sets the amount), so
    // flag it loudly, but still honour what the buyer paid for.
    console.error(`[gift-cards] Gift card ${card.id}: paid ${payment.amount_received}p, expected ${card.amount_pence}p`)
  }

  if (card.status === "pending") {
    const paidAt = new Date()
    const expiresAt = giftClaimDeadline(paidAt, card.claim_months)

    const { error } = await supabase
      .from("gift_cards")
      .update({
        status: "paid",
        paid_at: paidAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        stripe_payment_intent_id: payment.id,
      })
      .eq("id", card.id)
      .eq("status", "pending")
    // Throwing makes Stripe retry, which is right for a transient DB error.
    if (error) throw new Error(`gift card confirm failed: ${error.message}`)
    return card.id
  }

  return card.status === "paid" || card.status === "redeemed" ? card.id : null
}

/**
 * A full refund or a chargeback on a gift card's payment. Returns false when
 * the payment wasn't for a gift card, so the caller carries on with its own
 * handling.
 *
 * - Not yet claimed: the card is marked refunded and can no longer be claimed.
 * - Already claimed: its pack's unused credits are cleared (classes already
 *   booked stay booked). The recipient isn't emailed: they never paid, and a
 *   "your pack was refunded" email would only confuse them. The buyer gets
 *   Stripe's refund receipt.
 *
 * A partial refund changes nothing on the card, but still returns true so the
 * caller doesn't treat the payment as a class pack.
 */
export async function voidGiftCardPayment(
  studioId: string,
  paymentIntentId: string,
  { full }: { full: boolean },
): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("gift_cards")
    .select("id, status, class_pack_id")
    .eq("studio_id", studioId)
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle()
  if (!data) return false
  if (!full) return true

  if (data.status === "redeemed" && data.class_pack_id) {
    const { error } = await supabase
      .from("class_packs")
      .update({ credits_remaining: 0 })
      .eq("id", data.class_pack_id)
      .eq("studio_id", studioId)
    if (error) throw new Error(`gift pack void failed: ${error.message}`)
  }
  if (data.status !== "refunded") {
    const { error } = await supabase.from("gift_cards").update({ status: "refunded" }).eq("id", data.id)
    if (error) throw new Error(`gift card void failed: ${error.message}`)
  }
  return true
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

/** The voucher attachment and the fields both emails share. */
async function prepareEmail(supabase: Admin, card: GiftCard & { expires_at: string }) {
  const studio = await loadStudio(supabase, card.studio_id)
  const pdf = Buffer.from(await giftCardVoucherPdf(card, studio.domain))
  const attachment = {
    filename: `Burn gift voucher - ${card.recipient_name.replace(/[^\w\s-]/g, "").trim() || "gift"}.pdf`,
    content: pdf,
  }
  const base = {
    recipientName: card.recipient_name,
    senderName: card.sender_name,
    value: giftValue(card.credits, card.className),
    classOnly: !!card.className,
    claimBy: formatVoucherDate(card.expires_at),
    packValidity: packValidity(card.pack_validity_days),
    code: card.code,
    claimUrl: `${studio.publicBaseUrl}/gift?code=${encodeURIComponent(card.code)}`,
    studioName: studio.name,
    branding: studio.branding,
  }
  // The recipient email's header: the top of the voucher artwork, served by
  // the public site (burn-mat-studio public/gift/email-hero.jpg).
  const heroImageUrl = `${studio.publicBaseUrl}/gift/email-hero.jpg`
  return { attachment, base, heroImageUrl }
}

/** Who bought it: their account if they had one, else what a guest typed at checkout. */
async function buyerProfile(supabase: Admin, card: GiftCard) {
  let fullName = card.buyer_name
  let email = card.buyer_email
  if (card.buyer_profile_id) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", card.buyer_profile_id)
      .single()
    fullName = (data?.full_name as string | null) ?? fullName
    email = (data?.email as string | null) ?? email
  }
  return {
    firstName: (fullName ?? "").trim().split(/\s+/)[0] || "there",
    email: email ?? null,
  }
}

function buyerEmailContent(
  card: GiftCard,
  base: Awaited<ReturnType<typeof prepareEmail>>["base"],
  buyerFirstName: string,
) {
  const today = localDateStr()
  const sendsOn =
    card.recipient_email && card.send_on && card.send_on > today && !card.recipient_emailed_at
      ? new Date(card.send_on + "T12:00:00Z").toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        })
      : null
  const paid = card.paid_at
    ? `£${(card.amount_pence / 100).toFixed(2)} on ${new Date(card.paid_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/London",
      })}`
    : null
  return giftCardBuyerEmail({ ...base, buyerFirstName, sendsOn, paid })
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

  const { attachment, base, heroImageUrl } = await prepareEmail(supabase, { ...card, expires_at: card.expires_at })

  if (buyerDue && (await claimEmail(supabase, card.id, "buyer_emailed_at"))) {
    const buyer = await buyerProfile(supabase, card)
    const { subject, html } = buyerEmailContent(card, base, buyer.firstName)
    const result = buyer.email
      ? await sendStudioEmail(card.studio_id, { to: buyer.email, subject, html, attachments: [attachment] })
      : { success: false }
    if (!result.success) await releaseEmail(supabase, card.id, "buyer_emailed_at")
  }

  if (recipientDue && (await claimEmail(supabase, card.id, "recipient_emailed_at"))) {
    const { subject, html } = giftCardRecipientEmail({ ...base, heroImageUrl })
    const result = await sendStudioEmail(card.studio_id, {
      to: card.recipient_email!,
      subject,
      html,
      attachments: [attachment],
    })
    if (!result.success) await releaseEmail(supabase, card.id, "recipient_emailed_at")
  }
}

/**
 * The dashboard's "Send again": email the voucher now, to the buyer or the
 * recipient, at the address given. Sending to the recipient at a new address
 * also saves that address on the card (the buyer may have mistyped it), and
 * counts as the recipient's email, so the morning job won't send it twice.
 * Only for cards that are paid and not yet claimed.
 */
export async function resendGiftCardVoucher(
  studioId: string,
  id: string,
  who: "buyer" | "recipient",
  to: string,
) {
  const supabase = createAdminClient()
  const card = await loadCard(supabase, id)
  if (!card || card.studio_id !== studioId) throw new Error("Gift card not found")
  if (card.status !== "paid" || !card.expires_at) {
    throw new Error(
      card.status === "redeemed"
        ? "This gift card has already been claimed."
        : card.status === "refunded"
          ? "This gift card was refunded."
          : "This gift card hasn't been paid for.",
    )
  }

  const { attachment, base, heroImageUrl } = await prepareEmail(supabase, { ...card, expires_at: card.expires_at })
  const { subject, html } =
    who === "buyer"
      ? buyerEmailContent(card, base, (await buyerProfile(supabase, card)).firstName)
      : giftCardRecipientEmail({ ...base, heroImageUrl })

  const result = await sendStudioEmail(card.studio_id, { to, subject, html, attachments: [attachment] })
  if (!result.success) throw new Error(result.error ?? "The email didn't send. Please try again.")

  const now = new Date().toISOString()
  const update =
    who === "buyer"
      ? { buyer_emailed_at: now }
      : { recipient_email: to, send_on: card.send_on ?? localDateStr(), recipient_emailed_at: now }
  const { error } = await supabase.from("gift_cards").update(update).eq("id", card.id)
  if (error) console.error("[gift-cards] Sent, but couldn't record it on", card.id, error.message)
}

/**
 * Email the gift to the recipient on a later date instead of now: the 8am
 * daily job (deliverDueGiftCards) sends it that morning. Replaces any address
 * or date already on the card; scheduling again after a send sends it again
 * on the new date.
 */
export async function scheduleRecipientEmail(studioId: string, id: string, to: string, sendOn: string) {
  const supabase = createAdminClient()
  const card = await loadCard(supabase, id)
  if (!card || card.studio_id !== studioId) throw new Error("Gift card not found")
  if (card.status !== "paid" || !card.expires_at) {
    throw new Error(
      card.status === "redeemed"
        ? "This gift card has already been claimed."
        : card.status === "refunded"
          ? "This gift card was refunded."
          : "This gift card hasn't been paid for.",
    )
  }
  const today = localDateStr()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sendOn) || sendOn <= today) throw new Error("Pick a date after today, or send it now")
  const lastClaimDay = new Date(card.expires_at).toLocaleDateString("en-CA", { timeZone: "Europe/London" })
  if (sendOn > lastClaimDay) throw new Error("That's after the card's claim-by date")

  const { error } = await supabase
    .from("gift_cards")
    .update({ recipient_email: to, send_on: sendOn, recipient_emailed_at: null })
    .eq("id", card.id)
    .eq("status", "paid")
  if (error) throw new Error(error.message)
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
