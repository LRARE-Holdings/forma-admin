import { stripe } from "@/lib/stripe"
import type Stripe from "stripe"

export type RefundOutcome =
  | { ok: true; amountPence: number; refundId: string }
  | { ok: false; reason: string }

/**
 * Issue a full refund for a booking or pack purchase against the studio's
 * connected Stripe account. The Stripe ID stored in `stripe_session_id` is
 * either a PaymentIntent (`pi_*`, the primary Elements flow) or a Checkout
 * Session (`cs_*`, the legacy flow). The webhook resolves both back via the
 * payment_intent, so we do the same here.
 *
 * The refund is tagged with metadata.initiated_by so the `charge.refunded`
 * webhook can skip its own refund email — the cancellation email already
 * tells the member the refund is on its way.
 */
export async function issueAdminRefund(params: {
  stripeId: string
  connectedAccountId: string
  initiatedBy: "class_cancel" | "booking_cancel" | "holiday_cancel"
  bookingId?: string
}): Promise<RefundOutcome> {
  const { stripeId, connectedAccountId, initiatedBy, bookingId } = params
  const stripeAccount = { stripeAccount: connectedAccountId }

  try {
    let paymentIntentId: string | null = null

    if (stripeId.startsWith("pi_")) {
      paymentIntentId = stripeId
    } else if (stripeId.startsWith("cs_")) {
      const session = await stripe.checkout.sessions.retrieve(stripeId, stripeAccount)
      paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent as Stripe.PaymentIntent | null)?.id ?? null
    }

    if (!paymentIntentId) {
      return { ok: false, reason: "No payment intent on this booking" }
    }

    const metadata: Record<string, string> = { initiated_by: initiatedBy }
    if (bookingId) metadata.booking_id = bookingId

    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, metadata },
      stripeAccount
    )

    return { ok: true, amountPence: refund.amount, refundId: refund.id }
  } catch (err) {
    const e = err as Stripe.errors.StripeError
    // charge_already_refunded: idempotent treat as success-but-zero
    if (e.code === "charge_already_refunded") {
      return { ok: true, amountPence: 0, refundId: "" }
    }
    return { ok: false, reason: e.message ?? "Stripe refund failed" }
  }
}
