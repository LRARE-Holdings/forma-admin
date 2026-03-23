import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { createAdminClient } from "@/lib/supabase/admin"
import type Stripe from "stripe"

/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events from connected accounts.
 * Events include: payment completions, subscription lifecycle, refunds, disputes.
 *
 * The public site (burn-public) uses PaymentIntents + Elements for checkout,
 * so the primary payment event is `payment_intent.succeeded`.
 * `checkout.session.completed` is kept for backwards compatibility.
 */
export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or secret" }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    )
  } catch (err) {
    console.error("Webhook signature verification failed:", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  const supabase = createAdminClient()

  // The connected account ID that generated this event
  const connectedAccountId = event.account

  // Look up which studio this connected account belongs to
  let studioId: string | null = null
  if (connectedAccountId) {
    const { data: studio } = await supabase
      .from("studios")
      .select("id")
      .eq("stripe_account_id", connectedAccountId)
      .single()

    studioId = studio?.id as string | null
  }

  if (!studioId) {
    console.warn(`No studio found for Stripe account ${connectedAccountId}`)
    return NextResponse.json({ received: true })
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(supabase, studioId, event.data.object as Stripe.PaymentIntent)
        break

      case "checkout.session.completed":
        await handleCheckoutCompleted(supabase, studioId, event.data.object as Stripe.Checkout.Session)
        break

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdate(supabase, studioId, event.data.object as Stripe.Subscription)
        break

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(supabase, studioId, event.data.object as Stripe.Subscription)
        break

      case "charge.refunded":
        await handleChargeRefunded(supabase, studioId, connectedAccountId!, event.data.object as Stripe.Charge)
        break

      case "charge.dispute.created":
        await handleDisputeCreated(supabase, studioId, connectedAccountId!, event.data.object as Stripe.Dispute)
        break

      default:
        // Unhandled event type — acknowledge but ignore
        break
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err)
    return NextResponse.json({ error: "Handler failed" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

/**
 * Handle a successful PaymentIntent (the primary payment flow).
 *
 * The public site creates PaymentIntents via Stripe Elements with metadata
 * describing the purchase type. This handler reads that metadata and creates
 * the corresponding DB records (class_packs for pack purchases, bookings
 * for drop-in classes and waitlist claims).
 */
async function handlePaymentIntentSucceeded(
  supabase: ReturnType<typeof createAdminClient>,
  studioId: string,
  paymentIntent: Stripe.PaymentIntent,
) {
  const metadata = paymentIntent.metadata ?? {}
  const profileId = metadata.profile_id
  if (!profileId) return

  // Guard against duplicate processing — check if we already handled this PI
  const piId = paymentIntent.id

  if (metadata.type === "pack_tier") {
    const packTierId = metadata.pack_tier_id
    if (!packTierId) return

    // Idempotency: check if pack already created for this payment
    const { data: existingPack } = await supabase
      .from("class_packs")
      .select("id")
      .eq("stripe_session_id", piId)
      .eq("studio_id", studioId)
      .maybeSingle()

    if (existingPack) return

    const { data: tier } = await supabase
      .from("pack_tiers")
      .select("credits, validity_days")
      .eq("id", packTierId)
      .single()

    if (!tier) return

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (tier.validity_days as number))

    await supabase.from("class_packs").insert({
      studio_id: studioId,
      profile_id: profileId,
      pack_type: String(tier.credits),
      credits_total: tier.credits,
      credits_remaining: tier.credits,
      purchased_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      stripe_session_id: piId,
    })
  }

  if (metadata.type === "drop_in_class") {
    const scheduleId = metadata.schedule_id
    const date = metadata.date
    if (!scheduleId || !date) return

    // Idempotency: check if booking already exists for this payment
    const { data: existingBooking } = await supabase
      .from("bookings")
      .select("id")
      .eq("stripe_session_id", piId)
      .eq("studio_id", studioId)
      .maybeSingle()

    if (existingBooking) return

    await supabase.from("bookings").insert({
      studio_id: studioId,
      profile_id: profileId,
      schedule_id: scheduleId,
      date,
      status: "confirmed",
      payment_method: "stripe",
      stripe_session_id: piId,
    })
  }

  if (metadata.type === "waitlist_claim") {
    const scheduleId = metadata.schedule_id
    const date = metadata.date
    const claimToken = metadata.waitlist_claim_token
    if (!scheduleId || !date) return

    // Idempotency check
    const { data: existingBooking } = await supabase
      .from("bookings")
      .select("id")
      .eq("stripe_session_id", piId)
      .eq("studio_id", studioId)
      .maybeSingle()

    if (existingBooking) return

    await supabase.from("bookings").insert({
      studio_id: studioId,
      profile_id: profileId,
      schedule_id: scheduleId,
      date,
      status: "confirmed",
      payment_method: "stripe",
      stripe_session_id: piId,
    })

    if (claimToken) {
      await supabase
        .from("waitlist")
        .update({ status: "claimed" })
        .eq("claim_token", claimToken)
        .eq("studio_id", studioId)
    }
  }
}

/**
 * Handle a completed checkout session (legacy / backwards compatibility).
 * Kept in case any older integrations still use Checkout Sessions.
 */
async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  studioId: string,
  session: Stripe.Checkout.Session,
) {
  const metadata = session.metadata ?? {}
  const profileId = metadata.profile_id
  if (!profileId) return

  if (metadata.type === "pack_tier") {
    const packTierId = metadata.pack_tier_id
    if (!packTierId) return

    // Idempotency check
    const { data: existingPack } = await supabase
      .from("class_packs")
      .select("id")
      .eq("stripe_session_id", session.id)
      .eq("studio_id", studioId)
      .maybeSingle()

    if (existingPack) return

    const { data: tier } = await supabase
      .from("pack_tiers")
      .select("credits, validity_days")
      .eq("id", packTierId)
      .single()

    if (!tier) return

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (tier.validity_days as number))

    await supabase.from("class_packs").insert({
      studio_id: studioId,
      profile_id: profileId,
      pack_type: String(tier.credits),
      credits_total: tier.credits,
      credits_remaining: tier.credits,
      purchased_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      stripe_session_id: session.id,
    })
  }

  if (metadata.type === "drop_in_class") {
    const scheduleId = metadata.schedule_id
    const date = metadata.date
    if (!scheduleId || !date) return

    await supabase.from("bookings").insert({
      studio_id: studioId,
      profile_id: profileId,
      schedule_id: scheduleId,
      date,
      status: "confirmed",
      payment_method: "stripe",
      stripe_session_id: session.id,
    })
  }

  if (metadata.type === "waitlist_claim") {
    const scheduleId = metadata.schedule_id
    const date = metadata.date
    const claimToken = metadata.waitlist_claim_token
    if (!scheduleId || !date) return

    await supabase.from("bookings").insert({
      studio_id: studioId,
      profile_id: profileId,
      schedule_id: scheduleId,
      date,
      status: "confirmed",
      payment_method: "stripe",
      stripe_session_id: session.id,
    })

    if (claimToken) {
      await supabase
        .from("waitlist")
        .update({ status: "claimed" })
        .eq("claim_token", claimToken)
        .eq("studio_id", studioId)
    }
  }
}

/**
 * Handle subscription created or updated.
 * Upserts the memberships record.
 */
async function handleSubscriptionUpdate(
  supabase: ReturnType<typeof createAdminClient>,
  studioId: string,
  subscription: Stripe.Subscription,
) {
  const metadata = subscription.metadata ?? {}
  const profileId = metadata.profile_id
  const membershipTierId = metadata.membership_tier_id
  if (!profileId || !membershipTierId) return

  const { data: existing } = await supabase
    .from("memberships")
    .select("id")
    .eq("stripe_subscription_id", subscription.id)
    .single()

  // Access period fields safely — newer Stripe SDK versions moved these
  const sub = subscription as Stripe.Subscription & {
    current_period_start?: number
    current_period_end?: number
  }

  const periodStart = sub.current_period_start
    ? new Date(sub.current_period_start * 1000).toISOString()
    : null
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null

  const membershipData = {
    studio_id: studioId,
    profile_id: profileId,
    membership_tier_id: membershipTierId,
    stripe_subscription_id: subscription.id,
    status: subscription.status === "active" ? "active"
      : subscription.status === "past_due" ? "past_due"
      : subscription.status === "trialing" ? "trialing"
      : subscription.status === "canceled" ? "cancelled"
      : "active",
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancelled_at: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : null,
  }

  if (existing) {
    await supabase
      .from("memberships")
      .update(membershipData)
      .eq("id", existing.id)
  } else {
    await supabase.from("memberships").insert(membershipData)
  }
}

/**
 * Handle subscription deleted (cancelled and expired).
 */
async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof createAdminClient>,
  studioId: string,
  subscription: Stripe.Subscription,
) {
  await supabase
    .from("memberships")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id)
    .eq("studio_id", studioId)
}

/**
 * Handle a charge refund.
 * Looks up the booking or class_pack by the payment intent ID stored in
 * stripe_session_id, then marks it as refunded/cancelled.
 */
async function handleChargeRefunded(
  supabase: ReturnType<typeof createAdminClient>,
  studioId: string,
  connectedAccountId: string,
  charge: Stripe.Charge,
) {
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id

  if (!paymentIntentId) return

  const fullyRefunded = charge.refunded

  // Look up directly by payment intent ID (primary path — Elements flow)
  const { data: packByPi } = await supabase
    .from("class_packs")
    .select("id")
    .eq("stripe_session_id", paymentIntentId)
    .eq("studio_id", studioId)
    .maybeSingle()

  const { data: bookingByPi } = await supabase
    .from("bookings")
    .select("id")
    .eq("stripe_session_id", paymentIntentId)
    .eq("studio_id", studioId)
    .maybeSingle()

  if (packByPi || bookingByPi) {
    // Found via payment intent ID
    if (bookingByPi) {
      await supabase
        .from("bookings")
        .update({ status: fullyRefunded ? "cancelled" : "confirmed" })
        .eq("stripe_session_id", paymentIntentId)
        .eq("studio_id", studioId)
    }

    if (fullyRefunded && packByPi) {
      await supabase
        .from("class_packs")
        .update({ credits_remaining: 0 })
        .eq("stripe_session_id", paymentIntentId)
        .eq("studio_id", studioId)
    }

    return
  }

  // Fallback: look up via checkout session (legacy Checkout Sessions flow)
  const sessions = await stripe.checkout.sessions.list(
    { payment_intent: paymentIntentId, limit: 1 },
    { stripeAccount: connectedAccountId },
  )
  const session = sessions.data[0]
  if (!session) return

  await supabase
    .from("bookings")
    .update({ status: fullyRefunded ? "cancelled" : "confirmed" })
    .eq("stripe_session_id", session.id)
    .eq("studio_id", studioId)

  if (fullyRefunded) {
    await supabase
      .from("class_packs")
      .update({ credits_remaining: 0 })
      .eq("stripe_session_id", session.id)
      .eq("studio_id", studioId)
  }
}

/**
 * Handle a dispute (chargeback) created.
 * Marks the associated booking as disputed and zeroes out pack credits.
 */
async function handleDisputeCreated(
  supabase: ReturnType<typeof createAdminClient>,
  studioId: string,
  connectedAccountId: string,
  dispute: Stripe.Dispute,
) {
  const chargeId = typeof dispute.charge === "string"
    ? dispute.charge
    : dispute.charge?.id

  if (!chargeId) return

  const charge = await stripe.charges.retrieve(
    chargeId,
    { expand: ["payment_intent"] },
    { stripeAccount: connectedAccountId },
  )

  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : (charge.payment_intent as Stripe.PaymentIntent)?.id

  if (!paymentIntentId) return

  // Try direct lookup by payment intent ID first (Elements flow)
  const { data: packByPi } = await supabase
    .from("class_packs")
    .select("id")
    .eq("stripe_session_id", paymentIntentId)
    .eq("studio_id", studioId)
    .maybeSingle()

  const { data: bookingByPi } = await supabase
    .from("bookings")
    .select("id")
    .eq("stripe_session_id", paymentIntentId)
    .eq("studio_id", studioId)
    .maybeSingle()

  if (packByPi || bookingByPi) {
    if (bookingByPi) {
      await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("stripe_session_id", paymentIntentId)
        .eq("studio_id", studioId)
    }

    if (packByPi) {
      await supabase
        .from("class_packs")
        .update({ credits_remaining: 0 })
        .eq("stripe_session_id", paymentIntentId)
        .eq("studio_id", studioId)
    }

    return
  }

  // Fallback: checkout session lookup (legacy flow)
  const sessions = await stripe.checkout.sessions.list(
    { payment_intent: paymentIntentId, limit: 1 },
    { stripeAccount: connectedAccountId },
  )
  const session = sessions.data[0]
  if (!session) return

  await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("stripe_session_id", session.id)
    .eq("studio_id", studioId)

  await supabase
    .from("class_packs")
    .update({ credits_remaining: 0 })
    .eq("stripe_session_id", session.id)
    .eq("studio_id", studioId)
}
