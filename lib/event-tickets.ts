import { createAdminClient } from "@/lib/supabase/admin"
import { sendStudioEmail } from "@/lib/email/send"
import {
  eventTicketCancelledEmail,
  eventTicketConfirmationEmail,
  eventTicketsOnSaleEmail,
  eventWaitlistOfferEmail,
} from "@/lib/email/event-templates"
import { issueAdminRefund, type RefundInitiator } from "@/lib/stripe/refunds"
import { formatEventWhen, formatPounds, formatUkInstant } from "@/lib/events"
import type { EventTicket, EventWaitlistEntry, StudioBranding, StudioEvent } from "@/lib/types"

/**
 * Server-side event ticketing: emails, refunds, and the scheduled job.
 *
 * Who can buy is decided in the database (reserve_event_tickets,
 * confirm_event_ticket, offer_event_waitlist — see the 20260923_01 migration).
 * This module does what the database cannot: talk to Stripe and send email.
 * Every function here uses the service role and is safe to call from the
 * webhook or a cron, where there is no signed-in user.
 */

type Admin = ReturnType<typeof createAdminClient>

interface StudioContext {
  id: string
  name: string
  publicBaseUrl: string
  branding: StudioBranding | null
  connectedAccountId: string | null
}

async function loadStudio(supabase: Admin, studioId: string): Promise<StudioContext> {
  const { data } = await supabase
    .from("studios")
    .select("id, name, domain, branding, stripe_account_id, stripe_onboarding_complete")
    .eq("id", studioId)
    .single()

  return {
    id: studioId,
    name: (data?.name as string) ?? "Your studio",
    publicBaseUrl: `https://${(data?.domain as string | null) ?? "burnmatstudio.co.uk"}`,
    branding: (data?.branding as StudioBranding | null) ?? null,
    connectedAccountId:
      data?.stripe_onboarding_complete && data?.stripe_account_id
        ? (data.stripe_account_id as string)
        : null,
  }
}

async function loadMember(supabase: Admin, profileId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", profileId)
    .single()
  return {
    email: (data?.email as string | null) ?? null,
    firstName: (data?.full_name as string | null)?.split(" ")[0] ?? "there",
  }
}

async function loadEvent(supabase: Admin, eventId: string): Promise<StudioEvent | null> {
  const { data } = await supabase.from("events").select("*").eq("id", eventId).single()
  return (data as StudioEvent | null) ?? null
}

function emailBase(event: StudioEvent, studio: StudioContext, memberName: string) {
  return {
    memberName,
    eventTitle: event.title,
    when: formatEventWhen(event),
    location: event.location,
    studioName: studio.name,
    branding: studio.branding,
  }
}

// ─── Emails ─────────────────────────────────────────────────────────────────

export async function sendTicketConfirmation(ticketId: string) {
  const supabase = createAdminClient()
  const { data: ticket } = await supabase.from("event_tickets").select("*").eq("id", ticketId).single()
  if (!ticket) return
  const t = ticket as EventTicket

  const [event, studio, member] = await Promise.all([
    loadEvent(supabase, t.event_id),
    loadStudio(supabase, t.studio_id),
    loadMember(supabase, t.profile_id),
  ])
  if (!event || !member.email) return

  // Served by burn-public (lib/wallet). Each wallet is switched on here once
  // its credentials are in burn-public's environment.
  const walletLinks = {
    apple: process.env.WALLET_APPLE_ENABLED === "true"
      ? `${studio.publicBaseUrl}/api/wallet/apple/${t.wallet_token}`
      : undefined,
    google: process.env.WALLET_GOOGLE_ENABLED === "true"
      ? `${studio.publicBaseUrl}/api/wallet/google/${t.wallet_token}`
      : undefined,
  }

  const { subject, html } = eventTicketConfirmationEmail({
    ...emailBase(event, studio, member.firstName),
    quantity: t.quantity,
    amountPounds: (t.amount_pence / 100).toFixed(2),
    accountUrl: `${studio.publicBaseUrl}/account/events`,
    walletLinks,
  })
  await sendStudioEmail(t.studio_id, { to: member.email, subject, html })
}

async function sendTicketCancelled(
  supabase: Admin,
  ticket: EventTicket,
  event: StudioEvent,
  studio: StudioContext,
  reason: "ticket_cancelled" | "event_cancelled" | "not_confirmed" | "refund_after_member_cancel",
  refundPence: number | null,
  refundFailed: boolean,
) {
  const member = await loadMember(supabase, ticket.profile_id)
  if (!member.email) return
  const { subject, html } = eventTicketCancelledEmail({
    ...emailBase(event, studio, member.firstName),
    quantity: ticket.quantity,
    reason,
    refundPence,
    refundFailed,
  })
  await sendStudioEmail(ticket.studio_id, { to: member.email, subject, html })
}

async function sendWaitlistOffer(supabase: Admin, entry: EventWaitlistEntry) {
  const [event, studio, member] = await Promise.all([
    loadEvent(supabase, entry.event_id),
    loadStudio(supabase, entry.studio_id),
    loadMember(supabase, entry.profile_id),
  ])
  if (!event || !member.email || !entry.expires_at) return

  const { subject, html } = eventWaitlistOfferEmail({
    ...emailBase(event, studio, member.firstName),
    quantity: entry.quantity,
    claimUrl: `${studio.publicBaseUrl}/events/claim/${entry.claim_token}`,
    expiresText: formatUkInstant(entry.expires_at),
  })
  const result = await sendStudioEmail(entry.studio_id, { to: member.email, subject, html })
  if (!result.success) {
    console.error(`[event-tickets] Waitlist offer email failed for entry ${entry.id}: ${result.error}`)
  }
}

// ─── Refunds ────────────────────────────────────────────────────────────────

/**
 * Refund a ticket's payment in full and record it. Returns what happened so
 * the caller can tell the member. Never throws.
 */
async function refundTicketPayment(
  supabase: Admin,
  ticket: EventTicket,
  studio: StudioContext,
  initiatedBy: RefundInitiator,
): Promise<{ refundPence: number | null; refundFailed: boolean }> {
  if (!ticket.stripe_payment_intent_id || ticket.refunded_at) {
    return { refundPence: null, refundFailed: false }
  }
  if (!studio.connectedAccountId) {
    console.error(
      `[event-tickets] Cannot refund ticket ${ticket.id} — studio has no connected Stripe account. REFUND BY HAND.`,
    )
    return { refundPence: null, refundFailed: true }
  }

  const refund = await issueAdminRefund({
    stripeId: ticket.stripe_payment_intent_id,
    connectedAccountId: studio.connectedAccountId,
    initiatedBy,
    eventTicketId: ticket.id,
  })

  if (!refund.ok) {
    console.error(`[event-tickets] Refund FAILED for ticket ${ticket.id}: ${refund.reason}. REFUND BY HAND.`)
    return { refundPence: null, refundFailed: true }
  }

  await supabase
    .from("event_tickets")
    .update({ refunded_at: new Date().toISOString(), refund_amount_pence: refund.amountPence })
    .eq("id", ticket.id)

  return { refundPence: refund.amountPence, refundFailed: false }
}

/**
 * The webhook took a payment but confirm_event_ticket() would not honour it
 * (no room left after the hold lapsed, event cancelled, ticket already
 * cancelled). A charge with no ticket behind it is always refunded.
 */
export async function refundUnconfirmedTicket(ticketId: string, outcome: string) {
  const supabase = createAdminClient()
  const { data } = await supabase.from("event_tickets").select("*").eq("id", ticketId).single()
  if (!data) {
    console.error(`[event-tickets] Paid ticket ${ticketId} not found (${outcome}). REFUND BY HAND.`)
    return
  }
  const ticket = data as EventTicket
  console.warn(`[event-tickets] Refunding unconfirmed ticket ${ticket.id}: ${outcome}`)

  const [event, studio] = await Promise.all([
    loadEvent(supabase, ticket.event_id),
    loadStudio(supabase, ticket.studio_id),
  ])
  const { refundPence, refundFailed } = await refundTicketPayment(supabase, ticket, studio, "event_unconfirmed")
  if (event) {
    await sendTicketCancelled(
      supabase, ticket, event, studio,
      event.cancelled_at ? "event_cancelled" : "not_confirmed",
      refundPence, refundFailed,
    )
  }
}

/**
 * Studio-side cancellation of one ticket, with a full refund. Also used to
 * refund a ticket the member already cancelled themselves.
 */
export async function cancelAndRefundTicket(
  ticketId: string,
  studioId: string,
): Promise<{ error: string } | { refundPence: number | null; refundFailed: boolean }> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("event_tickets")
    .select("*")
    .eq("id", ticketId)
    .eq("studio_id", studioId)
    .single()
  if (!data) return { error: "Ticket not found." }
  const ticket = data as EventTicket

  if (ticket.status !== "confirmed" && ticket.status !== "cancelled") {
    return { error: "Only confirmed or cancelled tickets can be refunded." }
  }
  if (ticket.status === "cancelled" && ticket.refunded_at) {
    return { error: "This ticket has already been refunded." }
  }

  const wasConfirmed = ticket.status === "confirmed"
  if (wasConfirmed) {
    const { error } = await supabase
      .from("event_tickets")
      .update({ status: "cancelled", cancelled_by: "studio", cancelled_at: new Date().toISOString() })
      .eq("id", ticket.id)
      .eq("status", "confirmed")
    if (error) return { error: error.message }
  }

  const [event, studio] = await Promise.all([
    loadEvent(supabase, ticket.event_id),
    loadStudio(supabase, ticket.studio_id),
  ])
  const outcome = await refundTicketPayment(supabase, ticket, studio, "event_ticket_cancel")

  if (event) {
    await sendTicketCancelled(
      supabase, ticket, event, studio,
      wasConfirmed ? "ticket_cancelled" : "refund_after_member_cancel",
      outcome.refundPence, outcome.refundFailed,
    )
  }

  // A freed place goes to the waitlist straight away rather than on the next tick.
  if (wasConfirmed) await offerWaitlistPlaces(ticket.event_id)

  return outcome
}

/**
 * Call the whole event off: stop sales, refund every confirmed ticket and
 * every member-cancelled ticket that was never refunded, tell everyone, and
 * clear the waitlist.
 */
export async function cancelEventAndRefundAll(
  eventId: string,
  studioId: string,
): Promise<{ error: string } | { refunded: number; failed: number }> {
  const supabase = createAdminClient()

  const { data: event, error } = await supabase
    .from("events")
    .update({ cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("studio_id", studioId)
    .is("cancelled_at", null)
    .select("*")
    .maybeSingle()

  if (error) return { error: error.message }
  if (!event) return { error: "That event is already cancelled." }

  const studio = await loadStudio(supabase, studioId)

  // Stop anyone mid-checkout. A payment that still lands is refunded by the
  // webhook, because confirm_event_ticket() refuses a cancelled event.
  await supabase
    .from("event_tickets")
    .update({ status: "expired" })
    .eq("event_id", eventId)
    .eq("status", "pending")

  await supabase
    .from("event_waitlist")
    .update({ status: "removed" })
    .eq("event_id", eventId)
    .in("status", ["waiting", "offered"])

  const { data: tickets } = await supabase
    .from("event_tickets")
    .select("*")
    .eq("event_id", eventId)
    .or("status.eq.confirmed,and(status.eq.cancelled,refunded_at.is.null)")

  let refunded = 0
  let failed = 0
  for (const t of (tickets ?? []) as EventTicket[]) {
    if (t.status === "confirmed") {
      await supabase
        .from("event_tickets")
        .update({ status: "cancelled", cancelled_by: "studio", cancelled_at: new Date().toISOString() })
        .eq("id", t.id)
    }
    const outcome = await refundTicketPayment(supabase, t, studio, "event_cancel")
    if (outcome.refundFailed) failed++
    else if (outcome.refundPence !== null) refunded++

    await sendTicketCancelled(
      supabase, t, event as StudioEvent, studio, "event_cancelled",
      outcome.refundPence, outcome.refundFailed,
    ).catch((err) => console.error(`[event-tickets] Cancellation email failed for ticket ${t.id}:`, err))
  }

  return { refunded, failed }
}

// ─── Waitlist and alerts (the scheduled job) ────────────────────────────────

/** Offer any free places on one event to its waitlist, and email the offers. */
export async function offerWaitlistPlaces(eventId: string): Promise<number> {
  const supabase = createAdminClient()
  const { data: offered, error } = await supabase.rpc("offer_event_waitlist", { p_event_id: eventId })
  if (error) {
    console.error(`[event-tickets] offer_event_waitlist failed for ${eventId}:`, error.message)
    return 0
  }
  const entries = (offered ?? []) as EventWaitlistEntry[]
  await Promise.allSettled(entries.map((e) => sendWaitlistOffer(supabase, e)))
  return entries.length
}

/**
 * One tick of the every-minute job. Covers every studio in the database.
 */
export async function runEventJobs() {
  const supabase = createAdminClient()
  let alertsSent = 0
  let offersMade = 0

  // 1. "Tickets are on sale" alerts. claim_due_sale_alerts() marks them sent
  //    before we send, so overlapping runs can never email anyone twice.
  const { data: alerts, error: alertError } = await supabase.rpc("claim_due_sale_alerts")
  if (alertError) {
    console.error("[event-jobs] claim_due_sale_alerts failed:", alertError.message)
  }

  const byEvent = new Map<string, { studio_id: string; profile_id: string }[]>()
  for (const a of (alerts ?? []) as { event_id: string; studio_id: string; profile_id: string }[]) {
    byEvent.set(a.event_id, [...(byEvent.get(a.event_id) ?? []), a])
  }

  for (const [eventId, recipients] of byEvent) {
    const event = await loadEvent(supabase, eventId)
    if (!event) continue
    const studio = await loadStudio(supabase, event.studio_id)
    const priceText = `${formatPounds(event.price_pence)} per ticket`

    const results = await Promise.allSettled(
      recipients.map(async (r) => {
        const member = await loadMember(supabase, r.profile_id)
        if (!member.email) return
        const { subject, html } = eventTicketsOnSaleEmail({
          ...emailBase(event, studio, member.firstName),
          priceText,
          eventUrl: `${studio.publicBaseUrl}/#events`,
        })
        const result = await sendStudioEmail(event.studio_id, { to: member.email, subject, html })
        if (!result.success) throw new Error(result.error)
      }),
    )
    for (const r of results) {
      if (r.status === "fulfilled") alertsSent++
      else console.error(`[event-jobs] Sale alert email failed for event ${eventId}:`, r.reason)
    }
  }

  // 2. Waitlists: any event with someone waiting, or an offer that has lapsed.
  const { data: queued } = await supabase
    .from("event_waitlist")
    .select("event_id")
    .or(`status.eq.waiting,and(status.eq.offered,expires_at.lt.${new Date().toISOString()})`)

  const eventIds = [...new Set((queued ?? []).map((q) => q.event_id as string))]
  for (const eventId of eventIds) {
    offersMade += await offerWaitlistPlaces(eventId)
  }

  return { alertsSent, offersMade, waitlistsChecked: eventIds.length }
}
