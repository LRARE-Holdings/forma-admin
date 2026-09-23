import { layout, resolveColors } from "@/lib/email/templates"
import type { StudioBranding } from "@/lib/types"

// Event titles, locations and descriptions are free text typed by an admin, so
// everything interpolated here is escaped.
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

interface EventEmailBase {
  memberName: string
  eventTitle: string
  /** "Saturday 11 October, 18:00–20:00" */
  when: string
  location?: string | null
  studioName: string
  branding?: StudioBranding | null
}

function detailsBox(c: ReturnType<typeof resolveColors>, p: EventEmailBase, extra = "") {
  const label = (text: string) =>
    `<p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">${text}</p>`
  return `
    <table cellpadding="0" cellspacing="0" style="background-color:${c.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        ${label("Event")}
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${c.cocoa};">${esc(p.eventTitle)}</p>
        ${label("When")}
        <p style="margin:0 0 ${p.location || extra ? "12px" : "0"};font-size:15px;color:${c.cocoa};">${esc(p.when)}</p>
        ${p.location ? `${label("Where")}<p style="margin:0 0 ${extra ? "12px" : "0"};font-size:15px;color:${c.cocoa};">${esc(p.location)}</p>` : ""}
        ${extra}
      </td></tr>
    </table>`
}

function button(c: ReturnType<typeof resolveColors>, href: string, text: string) {
  return `
    <table cellpadding="0" cellspacing="0" style="width:100%;margin-top:24px;">
      <tr><td align="center">
        <a href="${esc(href)}" style="display:inline-block;background-color:${c.gold};color:${c.cocoa};font-size:15px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;">${text}</a>
      </td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:${c.warmGrey};">If the button doesn't work, copy and paste this link into your browser: ${esc(href)}</p>`
}

function greeting(c: ReturnType<typeof resolveColors>, name: string) {
  return `<p style="margin:0 0 16px;font-size:15px;color:${c.cocoa};">Hi ${esc(name)},</p>`
}

function ticketsLine(c: ReturnType<typeof resolveColors>, quantity: number, amount?: string) {
  const tickets = `${quantity} ticket${quantity === 1 ? "" : "s"}`
  return `
    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Tickets</p>
    <p style="margin:0;font-size:15px;color:${c.cocoa};">${tickets}${amount ? ` · ${amount} paid` : ""}</p>`
}

// --- Wallet buttons ---

/**
 * Black pill buttons in the style of the official badges. Apple's and Google's
 * badge artwork can replace these once downloaded from their brand pages;
 * plain HTML is used so the buttons show even when a mail client blocks images.
 */
function walletButtons(links: { apple?: string; google?: string }) {
  const pill = (href: string, text: string) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:0 4px 8px;background-color:#000000;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:22px;">${text}</a>`
  const buttons = [
    links.apple ? pill(links.apple, "Add to Apple Wallet") : "",
    links.google ? pill(links.google, "Add to Google Wallet") : "",
  ].join("")
  if (!buttons) return ""
  return `
    <table cellpadding="0" cellspacing="0" style="width:100%;margin-top:20px;">
      <tr><td align="center">${buttons}</td></tr>
    </table>`
}

// --- Ticket confirmed ---

export function eventTicketConfirmationEmail(
  params: EventEmailBase & {
    quantity: number
    amountPounds: string
    accountUrl: string
    /** Present only for the wallets that are switched on */
    walletLinks?: { apple?: string; google?: string }
  },
) {
  const c = resolveColors(params.branding)
  const body = `
    ${greeting(c, params.memberName)}
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">You're in! Your tickets are confirmed.</p>
    ${detailsBox(c, params, ticketsLine(c, params.quantity, `£${params.amountPounds}`))}
    ${walletButtons(params.walletLinks ?? {})}
    ${button(c, params.accountUrl, "View my tickets")}`
  return {
    subject: `Tickets confirmed: ${params.eventTitle}`,
    html: layout(params.studioName, body, params.branding),
  }
}

// --- Tickets on sale ---

export function eventTicketsOnSaleEmail(
  params: EventEmailBase & { priceText: string; eventUrl: string },
) {
  const c = resolveColors(params.branding)
  const body = `
    ${greeting(c, params.memberName)}
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">You asked us to let you know: tickets for this event are on sale now. Places are limited, so don't wait too long.</p>
    ${detailsBox(c, params, `
      <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Price</p>
      <p style="margin:0;font-size:15px;color:${c.cocoa};">${esc(params.priceText)}</p>`)}
    ${button(c, params.eventUrl, "Get tickets")}`
  return {
    subject: `Tickets on sale now: ${params.eventTitle}`,
    html: layout(params.studioName, body, params.branding),
  }
}

// --- Waitlist offer ---

export function eventWaitlistOfferEmail(
  params: EventEmailBase & { quantity: number; claimUrl: string; expiresText: string },
) {
  const c = resolveColors(params.branding)
  const places = params.quantity === 1 ? "A place has" : `${params.quantity} places have`
  const body = `
    ${greeting(c, params.memberName)}
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">${places} opened up at an event you're on the waitlist for, and ${params.quantity === 1 ? "it's" : "they're"} being held for you.</p>
    ${detailsBox(c, params, ticketsLine(c, params.quantity))}
    <p style="margin:24px 0 0;font-size:14px;color:${c.ember};font-weight:600;">This offer is held for you until ${esc(params.expiresText)}. After that it goes to the next person on the waitlist.</p>
    ${button(c, params.claimUrl, "Claim my tickets")}`
  return {
    subject: `Tickets available: ${params.eventTitle}`,
    html: layout(params.studioName, body, params.branding),
  }
}

// --- Ticket cancelled by the studio, or the event called off, or a payment we could not honour ---

export function eventTicketCancelledEmail(
  params: EventEmailBase & {
    quantity: number
    reason: "ticket_cancelled" | "event_cancelled" | "not_confirmed" | "refund_after_member_cancel"
    refundPence: number | null
    refundFailed: boolean
  },
) {
  const c = resolveColors(params.branding)

  const intro = {
    ticket_cancelled: "The studio has cancelled your tickets for the following event:",
    event_cancelled: "We're sorry, but the following event has been cancelled:",
    not_confirmed: "Your payment went through, but by the time it did the event had no places left, so we couldn't confirm your tickets:",
    refund_after_member_cancel: "The studio has refunded the tickets you cancelled for the following event:",
  }[params.reason]

  const refundLine =
    params.refundPence && params.refundPence > 0
      ? `<p style="margin:24px 0 0;font-size:14px;color:${c.cocoa};"><strong>A refund of £${(params.refundPence / 100).toFixed(2)}</strong> has been issued to the card you paid with. It usually takes 5–10 business days to appear on your statement.</p>`
      : params.refundFailed
        ? `<p style="margin:24px 0 0;font-size:14px;color:${c.cocoa};">A refund will be arranged for you shortly. If you don't see it within a few days, please contact the studio.</p>`
        : ""

  const body = `
    ${greeting(c, params.memberName)}
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">${intro}</p>
    ${detailsBox(c, params, ticketsLine(c, params.quantity))}
    ${refundLine}
    <p style="margin:24px 0 0;font-size:14px;color:${c.warmGrey};">If you have any questions, please get in touch with us.</p>`

  const subject = {
    ticket_cancelled: `Tickets cancelled: ${params.eventTitle}`,
    event_cancelled: `Event cancelled: ${params.eventTitle}`,
    not_confirmed: `We couldn't confirm your tickets: ${params.eventTitle}`,
    refund_after_member_cancel: `Refund issued: ${params.eventTitle}`,
  }[params.reason]

  return { subject, html: layout(params.studioName, body, params.branding) }
}
