import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { createAdminClient } from "@/lib/supabase/admin"
import type Stripe from "stripe"

/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events from connected accounts.
 * Events include: checkout completions, subscription lifecycle.
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
 * Handle a completed checkout session.
 * Creates class_packs or bookings based on product metadata.
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
    // Customer bought a class pack
    const packTierId = metadata.pack_tier_id
    if (!packTierId) return

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
    // Customer bought a single class drop-in
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
    // Customer claimed a waitlist spot via Stripe payment
    const scheduleId = metadata.schedule_id
    const date = metadata.date
    const claimToken = metadata.waitlist_claim_token
    if (!scheduleId || !date) return

    // Create the booking (bypasses capacity check — spot was held for them)
    await supabase.from("bookings").insert({
      studio_id: studioId,
      profile_id: profileId,
      schedule_id: scheduleId,
      date,
      status: "confirmed",
      payment_method: "stripe",
      stripe_session_id: session.id,
    })

    // Mark the waitlist entry as claimed
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
 * Looks up the booking or class_pack by stripe_session_id from the charge's
 * payment intent and marks it as refunded/cancelled.
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

  // Retrieve the checkout session that created this payment intent
  const sessions = await stripe.checkout.sessions.list(
    { payment_intent: paymentIntentId, limit: 1 },
    { stripeAccount: connectedAccountId },
  )
  const session = sessions.data[0]
  if (!session) return

  const fullyRefunded = charge.refunded

  // Cancel the booking if this was a drop-in or waitlist claim
  await supabase
    .from("bookings")
    .update({ status: fullyRefunded ? "cancelled" : "confirmed" })
    .eq("stripe_session_id", session.id)
    .eq("studio_id", studioId)

  // Invalidate the class pack if this was a pack purchase
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
 * Marks the associated booking as disputed.
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

  // Get the charge to find the payment intent
  const charge = await stripe.charges.retrieve(
    chargeId,
    { expand: ["payment_intent"] },
    { stripeAccount: connectedAccountId },
  )

  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : (charge.payment_intent as Stripe.PaymentIntent)?.id

  if (!paymentIntentId) return

  const sessions = await stripe.checkout.sessions.list(
    { payment_intent: paymentIntentId, limit: 1 },
    { stripeAccount: connectedAccountId },
  )
  const session = sessions.data[0]
  if (!session) return

  // Mark the booking as disputed
  await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("stripe_session_id", session.id)
    .eq("studio_id", studioId)

  // Zero out credits if this was a pack purchase
  await supabase
    .from("class_packs")
    .update({ credits_remaining: 0 })
    .eq("stripe_session_id", session.id)
    .eq("studio_id", studioId)
}
