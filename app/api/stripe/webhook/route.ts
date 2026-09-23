import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { createAdminClient } from "@/lib/supabase/admin"
import { sendBookingConfirmation } from "@/lib/email/booking-confirmation"
import { sendBookingNotification } from "@/lib/email/booking-notification"
import { sendStudioEmail } from "@/lib/email/send"
import { refundEmail } from "@/lib/email/templates"
import { formatTime } from "@/lib/utils"
import { issueAdminRefund } from "@/lib/stripe/refunds"
import type Stripe from "stripe"
import type { StudioBranding } from "@/lib/types"

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
    console.error(`[webhook] No studio found for Stripe account ${connectedAccountId}`)
    return NextResponse.json({ error: "Studio not found" }, { status: 500 })
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(supabase, studioId, connectedAccountId ?? null, event.data.object as Stripe.PaymentIntent)
        break

      case "checkout.session.completed":
        await handleCheckoutCompleted(supabase, studioId, connectedAccountId ?? null, event.data.object as Stripe.Checkout.Session)
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
  connectedAccountId: string | null,
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
      pack_tier_id: packTierId,
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

    // Last gate before the booking exists: cancelled, closed, or full.
    const blocked = await bookingBlockedReason(supabase, studioId, scheduleId, date, {
      checkCapacity: true,
    })
    if (blocked) {
      await refundUnbookablePayment(supabase, {
        studioId,
        connectedAccountId,
        profileId,
        stripeId: piId,
        scheduleId,
        date,
        reason: blocked,
      })
      return
    }

    await supabase.from("bookings").insert({
      studio_id: studioId,
      profile_id: profileId,
      schedule_id: scheduleId,
      date,
      status: "confirmed",
      payment_method: "stripe",
      stripe_session_id: piId,
    })

    // Send booking emails — awaited to prevent serverless early termination
    await Promise.allSettled([
      sendBookingConfirmation(studioId, profileId, scheduleId, date),
      sendBookingNotification(studioId, profileId, scheduleId, date, "stripe"),
    ]).then((results) => {
      for (const r of results) {
        if (r.status === "rejected") console.error("[webhook] Email failed:", r.reason)
      }
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

    // The claimant's spot is held for them, so capacity is not re-checked here.
    const blocked = await bookingBlockedReason(supabase, studioId, scheduleId, date, {
      checkCapacity: false,
    })
    if (blocked) {
      await refundUnbookablePayment(supabase, {
        studioId,
        connectedAccountId,
        profileId,
        stripeId: piId,
        scheduleId,
        date,
        reason: blocked,
      })
      return
    }

    await supabase.from("bookings").insert({
      studio_id: studioId,
      profile_id: profileId,
      schedule_id: scheduleId,
      date,
      status: "confirmed",
      payment_method: "stripe",
      stripe_session_id: piId,
    })

    // Send booking emails — awaited to prevent serverless early termination
    await Promise.allSettled([
      sendBookingConfirmation(studioId, profileId, scheduleId, date),
      sendBookingNotification(studioId, profileId, scheduleId, date, "stripe"),
    ]).then((results) => {
      for (const r of results) {
        if (r.status === "rejected") console.error("[webhook] Email failed:", r.reason)
      }
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
  connectedAccountId: string | null,
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
      pack_tier_id: packTierId,
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

    const blocked = await bookingBlockedReason(supabase, studioId, scheduleId, date, {
      checkCapacity: true,
    })
    if (blocked) {
      await refundUnbookablePayment(supabase, {
        studioId,
        connectedAccountId,
        profileId,
        stripeId: session.id,
        scheduleId,
        date,
        reason: blocked,
      })
      return
    }

    await supabase.from("bookings").insert({
      studio_id: studioId,
      profile_id: profileId,
      schedule_id: scheduleId,
      date,
      status: "confirmed",
      payment_method: "stripe",
      stripe_session_id: session.id,
    })

    // Send booking emails — awaited to prevent serverless early termination
    await Promise.allSettled([
      sendBookingConfirmation(studioId, profileId, scheduleId, date),
      sendBookingNotification(studioId, profileId, scheduleId, date, "stripe"),
    ]).then((results) => {
      for (const r of results) {
        if (r.status === "rejected") console.error("[webhook] Email failed:", r.reason)
      }
    })
  }

  if (metadata.type === "waitlist_claim") {
    const scheduleId = metadata.schedule_id
    const date = metadata.date
    const claimToken = metadata.waitlist_claim_token
    if (!scheduleId || !date) return

    // The claimant's spot is held for them, so capacity is not re-checked here.
    const blocked = await bookingBlockedReason(supabase, studioId, scheduleId, date, {
      checkCapacity: false,
    })
    if (blocked) {
      await refundUnbookablePayment(supabase, {
        studioId,
        connectedAccountId,
        profileId,
        stripeId: session.id,
        scheduleId,
        date,
        reason: blocked,
      })
      return
    }

    await supabase.from("bookings").insert({
      studio_id: studioId,
      profile_id: profileId,
      schedule_id: scheduleId,
      date,
      status: "confirmed",
      payment_method: "stripe",
      stripe_session_id: session.id,
    })

    // Send booking emails — awaited to prevent serverless early termination
    await Promise.allSettled([
      sendBookingConfirmation(studioId, profileId, scheduleId, date),
      sendBookingNotification(studioId, profileId, scheduleId, date, "stripe"),
    ]).then((results) => {
      for (const r of results) {
        if (r.status === "rejected") console.error("[webhook] Email failed:", r.reason)
      }
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
 * stripe_session_id, marks it as refunded/cancelled, then emails the member.
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
  const amountRefundedPounds = (charge.amount_refunded / 100).toFixed(2)

  // If any refund on this charge was issued by the admin app (cancel flow,
  // skip flow, holiday flow), the cancellation email already told the member
  // about the refund — don't send a duplicate refund email from the webhook.
  const adminInitiatedReasons = new Set([
    "class_cancel",
    "booking_cancel",
    "holiday_cancel",
  ])
  const refundList = charge.refunds?.data ?? []
  const skipRefundEmail = refundList.some(
    (r) => adminInitiatedReasons.has((r.metadata?.initiated_by as string) ?? "")
  )

  // Fetch studio branding once for the email
  const { data: studio } = await supabase
    .from("studios")
    .select("name, branding")
    .eq("id", studioId)
    .single()
  const studioName = studio?.name ?? "Your studio"
  const branding = studio?.branding as StudioBranding | null

  // Look up directly by payment intent ID (primary path — Elements flow)
  const { data: packByPi } = await supabase
    .from("class_packs")
    .select("id, profile_id, pack_type, credits_total")
    .eq("stripe_session_id", paymentIntentId)
    .eq("studio_id", studioId)
    .maybeSingle()

  const { data: bookingByPi } = await supabase
    .from("bookings")
    .select("id, profile_id, schedule_id, date")
    .eq("stripe_session_id", paymentIntentId)
    .eq("studio_id", studioId)
    .maybeSingle()

  if (packByPi || bookingByPi) {
    if (bookingByPi) {
      await supabase
        .from("bookings")
        .update({ status: fullyRefunded ? "cancelled" : "confirmed" })
        .eq("stripe_session_id", paymentIntentId)
        .eq("studio_id", studioId)

      if (!skipRefundEmail) {
        sendRefundEmailForBooking({
          supabase, studioId, studioName, branding,
          profileId: bookingByPi.profile_id,
          scheduleId: bookingByPi.schedule_id,
          date: bookingByPi.date,
          amountRefundedPounds,
          fullyRefunded,
        }).catch((err) => console.error("[webhook] Refund email failed:", err))
      }
    }

    if (fullyRefunded && packByPi) {
      await supabase
        .from("class_packs")
        .update({ credits_remaining: 0 })
        .eq("stripe_session_id", paymentIntentId)
        .eq("studio_id", studioId)

      if (!skipRefundEmail) {
        sendRefundEmailForPack({
          supabase, studioId, studioName, branding,
          profileId: packByPi.profile_id,
          creditsTotal: packByPi.credits_total,
          amountRefundedPounds,
          fullyRefunded,
        }).catch((err) => console.error("[webhook] Refund email failed:", err))
      }
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

  const { data: legacyBooking } = await supabase
    .from("bookings")
    .select("id, profile_id, schedule_id, date")
    .eq("stripe_session_id", session.id)
    .eq("studio_id", studioId)
    .maybeSingle()

  const { data: legacyPack } = await supabase
    .from("class_packs")
    .select("id, profile_id, credits_total")
    .eq("stripe_session_id", session.id)
    .eq("studio_id", studioId)
    .maybeSingle()

  await supabase
    .from("bookings")
    .update({ status: fullyRefunded ? "cancelled" : "confirmed" })
    .eq("stripe_session_id", session.id)
    .eq("studio_id", studioId)

  if (legacyBooking && !skipRefundEmail) {
    sendRefundEmailForBooking({
      supabase, studioId, studioName, branding,
      profileId: legacyBooking.profile_id,
      scheduleId: legacyBooking.schedule_id,
      date: legacyBooking.date,
      amountRefundedPounds,
      fullyRefunded,
    }).catch((err) => console.error("[webhook] Refund email failed:", err))
  }

  if (fullyRefunded) {
    await supabase
      .from("class_packs")
      .update({ credits_remaining: 0 })
      .eq("stripe_session_id", session.id)
      .eq("studio_id", studioId)

    if (legacyPack && !skipRefundEmail) {
      sendRefundEmailForPack({
        supabase, studioId, studioName, branding,
        profileId: legacyPack.profile_id,
        creditsTotal: legacyPack.credits_total,
        amountRefundedPounds,
        fullyRefunded,
      }).catch((err) => console.error("[webhook] Refund email failed:", err))
    }
  }
}

/** Send a refund email for a booking refund. */
async function sendRefundEmailForBooking({
  supabase, studioId, studioName, branding,
  profileId, scheduleId, date,
  amountRefundedPounds, fullyRefunded,
}: {
  supabase: ReturnType<typeof createAdminClient>
  studioId: string
  studioName: string
  branding: StudioBranding | null
  profileId: string
  scheduleId: string
  date: string
  amountRefundedPounds: string
  fullyRefunded: boolean
}) {
  const [profileRes, slotRes] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", profileId).single(),
    supabase.from("schedule").select("start_time, classes:class_id(name)").eq("id", scheduleId).single(),
  ])

  const profile = profileRes.data
  const slot = slotRes.data
  if (!profile?.email || !slot) return

  const cls = slot.classes as unknown as { name: string }
  const formattedDate = new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  })
  const description = `${cls?.name ?? "Class"} on ${formattedDate} at ${formatTime(slot.start_time)}`

  const { subject, html } = refundEmail({
    memberName: profile.full_name?.split(" ")[0] ?? "there",
    amountPounds: amountRefundedPounds,
    description,
    fullyRefunded,
    studioName,
    branding,
  })

  await sendStudioEmail(studioId, { to: profile.email, subject, html })
}

/** Send a refund email for a class pack refund. */
async function sendRefundEmailForPack({
  supabase, studioId, studioName, branding,
  profileId, creditsTotal,
  amountRefundedPounds, fullyRefunded,
}: {
  supabase: ReturnType<typeof createAdminClient>
  studioId: string
  studioName: string
  branding: StudioBranding | null
  profileId: string
  creditsTotal: number
  amountRefundedPounds: string
  fullyRefunded: boolean
}) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", profileId)
    .single()

  if (!profile?.email) return

  const description = `${creditsTotal}-class pack`

  const { subject, html } = refundEmail({
    memberName: profile.full_name?.split(" ")[0] ?? "there",
    amountPounds: amountRefundedPounds,
    description,
    fullyRefunded,
    studioName,
    branding,
  })

  await sendStudioEmail(studioId, { to: profile.email, subject, html })
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

/**
 * Check if a class instance is skipped (has a schedule_exception for that date).
 * Used as a server-side guard to prevent bookings on skipped classes.
 */
/**
 * Why this paid booking cannot be written, or null if it can.
 *
 * The public site checks all of this before it creates the PaymentIntent, but
 * that check is minutes old by the time the payment succeeds. In between, the
 * class can fill up or be cancelled. This is the last gate before a booking row
 * exists, so it has to be at least as strict as the first one — it used to be
 * weaker, checking only `schedule_exceptions` and never capacity at all, which
 * is how two people could pay for the last spot and both get in.
 */
async function bookingBlockedReason(
  supabase: ReturnType<typeof createAdminClient>,
  studioId: string,
  scheduleId: string,
  date: string,
  opts: { checkCapacity: boolean },
): Promise<string | null> {
  const { data: slot } = await supabase
    .from("schedule")
    .select("start_time, class_id, is_active, classes:class_id(capacity)")
    .eq("id", scheduleId)
    .eq("studio_id", studioId)
    .single()

  if (!slot) return "that class is no longer on the timetable"
  if (!slot.is_active) return "that class is no longer on the timetable"

  const [{ data: exception }, { data: holidays }] = await Promise.all([
    supabase
      .from("schedule_exceptions")
      .select("id")
      .eq("studio_id", studioId)
      .eq("schedule_id", scheduleId)
      .eq("date", date)
      .maybeSingle(),
    supabase
      .from("studio_holidays")
      .select("start_date, end_date, start_time, end_time")
      .eq("studio_id", studioId)
      .lte("start_date", date)
      .gte("end_date", date),
  ])

  if (exception) return "that class was cancelled"

  // A holiday with no times closes the whole day; one with times closes only
  // the classes starting inside the window, which is how the dashboard decides
  // what to cancel.
  const startTime = slot.start_time as string
  const closed = (holidays ?? []).some((h) => {
    if (!h.start_time || !h.end_time) return true
    return startTime >= (h.start_time as string) && startTime < (h.end_time as string)
  })
  if (closed) return "the studio is closed that day"

  if (opts.checkCapacity) {
    const cls = slot.classes as unknown as { capacity: number | null } | null
    const capacity = cls?.capacity ?? 10

    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studioId)
      .eq("schedule_id", scheduleId)
      .eq("date", date)
      .eq("status", "confirmed")

    if ((count ?? 0) >= capacity) return "that class filled up"
  }

  return null
}

/**
 * The payment went through but the booking cannot be written. Refund it and
 * tell the member why.
 *
 * Returning early — which is what this used to do for a cancelled class — left
 * the member charged, unbooked and unnotified, with nothing logged anywhere
 * they could see. A charge with no booking behind it always gets refunded.
 */
async function refundUnbookablePayment(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    studioId: string
    connectedAccountId: string | null
    profileId: string
    stripeId: string
    scheduleId: string
    date: string
    reason: string
  },
): Promise<void> {
  const { studioId, connectedAccountId, profileId, stripeId, scheduleId, date, reason } = params

  console.warn(
    `[webhook] Refunding unbookable payment ${stripeId}: schedule=${scheduleId} date=${date} — ${reason}`,
  )

  if (!connectedAccountId) {
    console.error(
      `[webhook] Cannot refund ${stripeId} — studio ${studioId} has no connected account. REFUND BY HAND.`,
    )
    return
  }

  const refund = await issueAdminRefund({
    stripeId,
    connectedAccountId,
    initiatedBy: "booking_cancel",
  })

  if (!refund.ok) {
    console.error(
      `[webhook] Refund FAILED for ${stripeId}: ${refund.reason}. REFUND BY HAND.`,
    )
    return
  }

  const [profileRes, slotRes, studioRes] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", profileId).single(),
    supabase
      .from("schedule")
      .select("start_time, classes:class_id(name)")
      .eq("id", scheduleId)
      .single(),
    supabase.from("studios").select("name, branding").eq("id", studioId).single(),
  ])

  const profile = profileRes.data
  if (!profile?.email) return

  const cls = slotRes.data?.classes as unknown as { name: string } | null
  const formattedDate = new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  const time = slotRes.data?.start_time ? formatTime(slotRes.data.start_time as string) : ""

  const { subject, html } = refundEmail({
    memberName: profile.full_name?.split(" ")[0] ?? "there",
    amountPounds: (refund.amountPence / 100).toFixed(2),
    description: `${cls?.name ?? "Class"} on ${formattedDate}${time ? ` at ${time}` : ""} — we could not confirm your booking because ${reason}.`,
    fullyRefunded: true,
    studioName: studioRes.data?.name ?? "Your studio",
    branding: (studioRes.data?.branding as StudioBranding | null) ?? null,
  })

  await sendStudioEmail(studioId, { to: profile.email, subject, html }).catch((err) =>
    console.error("[webhook] Refund email failed:", err),
  )
}
