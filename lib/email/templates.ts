import type { StudioBranding } from "@/lib/types"

// --- Default branding (Burn Mat Studio) used as fallback ---

const DEFAULT_BRANDING = {
  cocoa: "#473728",
  gold: "#C4A95A",
  wheat: "#DFD0A5",
  cream: "#F5F0E8",
  sand: "#E8DCC8",
  warmGrey: "#8A8070",
  ember: "#D4713A",
  white: "#FFFFFF",
  logo_url: "https://burnmatstudio.co.uk/burn-light.png",
}

export function resolveColors(branding?: StudioBranding | null) {
  return {
    cocoa:    branding?.colors?.cocoa    ?? DEFAULT_BRANDING.cocoa,
    gold:     branding?.colors?.gold     ?? DEFAULT_BRANDING.gold,
    wheat:    branding?.colors?.wheat    ?? DEFAULT_BRANDING.wheat,
    cream:    branding?.colors?.cream    ?? DEFAULT_BRANDING.cream,
    sand:     branding?.colors?.sand     ?? DEFAULT_BRANDING.sand,
    warmGrey: branding?.colors?.warmGrey ?? DEFAULT_BRANDING.warmGrey,
    ember:    branding?.colors?.ember    ?? DEFAULT_BRANDING.ember,
    white:    DEFAULT_BRANDING.white,
    logo_url: branding?.logo_url         ?? DEFAULT_BRANDING.logo_url,
  }
}

export function layout(studioName: string, body: string, branding?: StudioBranding | null) {
  const c = resolveColors(branding)
  const header = c.logo_url
    ? `<img src="${c.logo_url}" alt="${studioName}" width="180" style="display:block;" />`
    : `<span style="font-size:20px;font-weight:700;color:${c.white};">${studioName}</span>`

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:${c.cream};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${c.cream};padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:${c.white};border-radius:12px;border:1px solid ${c.sand};overflow:hidden;">
        <!-- Header -->
        <tr><td style="background-color:${c.cocoa};padding:24px 32px;" align="center">
          ${header}
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid ${c.sand};">
          <span style="font-size:12px;color:${c.warmGrey};">Sent by ${studioName} via Forma</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// --- Schedule change emails ---

interface ScheduleChangeParams {
  type: "assigned" | "changed" | "removed"
  instructorName: string
  className: string
  day: string
  time: string
  studioName: string
  branding?: StudioBranding | null
}

const SCHEDULE_SUBJECTS: Record<string, string> = {
  assigned: "New class added to your schedule",
  changed: "Your class schedule has been updated",
  removed: "A class has been removed from your schedule",
}

export function scheduleChangeEmail(params: ScheduleChangeParams) {
  const { type, instructorName, className, day, time, studioName, branding } = params
  const c = resolveColors(branding)

  const messages: Record<string, string> = {
    assigned: `You've been assigned to teach <strong>${className}</strong>.`,
    changed: `Your <strong>${className}</strong> class has been updated.`,
    removed: `<strong>${className}</strong> has been removed from your schedule.`,
  }

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${c.cocoa};">Hi ${instructorName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">${messages[type]}</p>
    <table cellpadding="0" cellspacing="0" style="background-color:${c.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Class</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${c.cocoa};">${className}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">When</p>
        <p style="margin:0;font-size:15px;color:${c.cocoa};">${day} at ${time}</p>
      </td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:14px;color:${c.warmGrey};">If you have any questions, contact your studio manager.</p>`

  return {
    subject: SCHEDULE_SUBJECTS[type],
    html: layout(studioName, body, branding),
  }
}

// --- Class cancellation email ---

interface ClassCancelledParams {
  memberName: string
  className: string
  date: string
  time: string
  reason?: string
  creditRestored: boolean
  refundPence?: number | null
  refundFailed?: boolean
  studioName: string
  branding?: StudioBranding | null
}

export function classCancelledEmail(params: ClassCancelledParams) {
  const { memberName, className, date, time, reason, creditRestored, refundPence, refundFailed, studioName, branding } = params
  const c = resolveColors(branding)

  const creditLine = creditRestored
    ? `<p style="margin:16px 0 0;font-size:14px;color:${c.cocoa};"><strong>Your class credit has been restored</strong> and is ready to use for another booking.</p>`
    : ""

  const refundLine = refundPence && refundPence > 0
    ? `<p style="margin:16px 0 0;font-size:14px;color:${c.cocoa};"><strong>A refund of £${(refundPence / 100).toFixed(2)}</strong> has been issued to the card you paid with. It usually takes 5–10 business days to appear on your statement.</p>`
    : refundFailed
      ? `<p style="margin:16px 0 0;font-size:14px;color:${c.cocoa};">A refund will be arranged for you shortly. If you don't see it within a few days, please contact the studio.</p>`
      : ""

  const reasonLine = reason
    ? `<p style="margin:16px 0 0;font-size:14px;color:${c.warmGrey};"><strong>Reason:</strong> ${reason}</p>`
    : ""

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${c.cocoa};">Hi ${memberName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">We're sorry to let you know that the following class has been cancelled:</p>
    <table cellpadding="0" cellspacing="0" style="background-color:${c.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Class</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${c.cocoa};">${className}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Date &amp; time</p>
        <p style="margin:0;font-size:15px;color:${c.cocoa};">${date} at ${time}</p>
      </td></tr>
    </table>
    ${reasonLine}
    ${creditLine}
    ${refundLine}
    <p style="margin:24px 0 0;font-size:14px;color:${c.warmGrey};">We apologise for the inconvenience. We look forward to seeing you at another class soon.</p>`

  return {
    subject: `${className} on ${date} has been cancelled`,
    html: layout(studioName, body, branding),
  }
}

// --- Individual booking cancellation email ---

interface BookingCancelledParams {
  memberName: string
  className: string
  date: string
  time: string
  creditRestored: boolean
  refundPence?: number | null
  refundFailed?: boolean
  studioName: string
  branding?: StudioBranding | null
}

export function bookingCancelledEmail(params: BookingCancelledParams) {
  const { memberName, className, date, time, creditRestored, refundPence, refundFailed, studioName, branding } = params
  const c = resolveColors(branding)

  const creditLine = creditRestored
    ? `<p style="margin:16px 0 0;font-size:14px;color:${c.cocoa};"><strong>Your class credit has been restored</strong> and is ready to use for another booking.</p>`
    : ""

  const refundLine = refundPence && refundPence > 0
    ? `<p style="margin:16px 0 0;font-size:14px;color:${c.cocoa};"><strong>A refund of £${(refundPence / 100).toFixed(2)}</strong> has been issued to the card you paid with. It usually takes 5–10 business days to appear on your statement.</p>`
    : refundFailed
      ? `<p style="margin:16px 0 0;font-size:14px;color:${c.cocoa};">A refund will be arranged for you shortly. If you don't see it within a few days, please contact the studio.</p>`
      : ""

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${c.cocoa};">Hi ${memberName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">Your booking for the following class has been cancelled:</p>
    <table cellpadding="0" cellspacing="0" style="background-color:${c.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Class</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${c.cocoa};">${className}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Date &amp; time</p>
        <p style="margin:0;font-size:15px;color:${c.cocoa};">${date} at ${time}</p>
      </td></tr>
    </table>
    ${creditLine}
    ${refundLine}
    <p style="margin:24px 0 0;font-size:14px;color:${c.warmGrey};">If you have any questions, please get in touch with us.</p>`

  return {
    subject: `Booking cancelled — ${className} on ${date}`,
    html: layout(studioName, body, branding),
  }
}

// --- Booking confirmation email ---

interface BookingConfirmationParams {
  memberName: string
  className: string
  date: string
  time: string
  studioName: string
  branding?: StudioBranding | null
}

export function bookingConfirmationEmail(params: BookingConfirmationParams) {
  const { memberName, className, date, time, studioName, branding } = params
  const c = resolveColors(branding)

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${c.cocoa};">Hi ${memberName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">Your booking has been confirmed!</p>
    <table cellpadding="0" cellspacing="0" style="background-color:${c.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Class</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${c.cocoa};">${className}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Date &amp; time</p>
        <p style="margin:0;font-size:15px;color:${c.cocoa};">${date} at ${time}</p>
      </td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:14px;color:${c.warmGrey};">We look forward to seeing you! If you need to cancel, please do so at least 24 hours before the class.</p>`

  return {
    subject: `Booking confirmed — ${className} on ${date}`,
    html: layout(studioName, body, branding),
  }
}

// --- Refund email ---

interface RefundParams {
  memberName: string
  amountPounds: string
  description: string  // e.g. "Hot Pilates on Monday 7 April" or "5-class pack"
  fullyRefunded: boolean
  studioName: string
  branding?: StudioBranding | null
}

export function refundEmail(params: RefundParams) {
  const { memberName, amountPounds, description, fullyRefunded, studioName, branding } = params
  const c = resolveColors(branding)

  const refundType = fullyRefunded ? "Full refund" : "Partial refund"
  const intro = fullyRefunded
    ? `A full refund of <strong>£${amountPounds}</strong> has been processed for the following:`
    : `A partial refund of <strong>£${amountPounds}</strong> has been processed for the following:`

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${c.cocoa};">Hi ${memberName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">${intro}</p>
    <table cellpadding="0" cellspacing="0" style="background-color:${c.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">${refundType}</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${c.cocoa};">£${amountPounds}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">For</p>
        <p style="margin:0;font-size:15px;color:${c.cocoa};">${description}</p>
      </td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:14px;color:${c.warmGrey};">Refunds typically appear on your statement within 5–10 business days. If you have any questions, please contact us.</p>`

  return {
    subject: `Your refund of £${amountPounds} is on its way`,
    html: layout(studioName, body, branding),
  }
}

// --- Booking notification email (for instructors & admins) ---

interface BookingNotificationParams {
  recipientName: string
  memberName: string
  memberEmail: string
  className: string
  date: string
  time: string
  paymentMethod: string
  bookedAt: string
  studioName: string
  branding?: StudioBranding | null
}

const PAYMENT_LABELS: Record<string, string> = {
  stripe: "Card (Stripe)",
  pack_credit: "Class pack credit",
  membership: "Membership",
  complimentary: "Complimentary",
  birthday: "Birthday treat",
}

export function bookingNotificationEmail(params: BookingNotificationParams) {
  const {
    recipientName, memberName, memberEmail, className,
    date, time, paymentMethod, bookedAt, studioName, branding,
  } = params
  const c = resolveColors(branding)
  const paymentLabel = PAYMENT_LABELS[paymentMethod] ?? paymentMethod

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${c.cocoa};">Hi ${recipientName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">A new booking has been made for your class.</p>
    <table cellpadding="0" cellspacing="0" style="background-color:${c.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Member</p>
        <p style="margin:0 0 2px;font-size:15px;font-weight:600;color:${c.cocoa};">${memberName}</p>
        <p style="margin:0 0 12px;font-size:14px;color:${c.warmGrey};">${memberEmail}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Class</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${c.cocoa};">${className}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Date &amp; time</p>
        <p style="margin:0 0 12px;font-size:15px;color:${c.cocoa};">${date} at ${time}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Payment</p>
        <p style="margin:0 0 12px;font-size:15px;color:${c.cocoa};">${paymentLabel}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Booked at</p>
        <p style="margin:0;font-size:15px;color:${c.cocoa};">${bookedAt}</p>
      </td></tr>
    </table>`

  return {
    subject: `New booking — ${memberName} for ${className} on ${date}`,
    html: layout(studioName, body, branding),
  }
}

// --- Booking cancellation notification email (for instructors & admins) ---

interface BookingCancellationNotificationParams {
  recipientName: string
  memberName: string
  memberEmail: string
  className: string
  date: string
  time: string
  paymentMethod: string
  cancelledAt: string
  cancelledBy: "member" | "admin"
  studioName: string
  branding?: StudioBranding | null
}

export function bookingCancellationNotificationEmail(
  params: BookingCancellationNotificationParams
) {
  const {
    recipientName, memberName, memberEmail, className,
    date, time, paymentMethod, cancelledAt, cancelledBy, studioName, branding,
  } = params
  const c = resolveColors(branding)
  const paymentLabel = PAYMENT_LABELS[paymentMethod] ?? paymentMethod
  const cancelledByLabel = cancelledBy === "admin" ? "the studio" : "the member"

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${c.cocoa};">Hi ${recipientName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">A booking has been cancelled by ${cancelledByLabel}.</p>
    <table cellpadding="0" cellspacing="0" style="background-color:${c.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Member</p>
        <p style="margin:0 0 2px;font-size:15px;font-weight:600;color:${c.cocoa};">${memberName}</p>
        <p style="margin:0 0 12px;font-size:14px;color:${c.warmGrey};">${memberEmail}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Class</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${c.cocoa};">${className}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Date &amp; time</p>
        <p style="margin:0 0 12px;font-size:15px;color:${c.cocoa};">${date} at ${time}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Original payment</p>
        <p style="margin:0 0 12px;font-size:15px;color:${c.cocoa};">${paymentLabel}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Cancelled at</p>
        <p style="margin:0;font-size:15px;color:${c.cocoa};">${cancelledAt}</p>
      </td></tr>
    </table>`

  return {
    subject: `Cancellation — ${memberName} for ${className} on ${date}`,
    html: layout(studioName, body, branding),
  }
}

// --- Waitlist offer email ---

interface WaitlistOfferParams {
  memberName: string
  className: string
  date: string
  time: string
  claimUrl: string
  expiresInMinutes: number
  studioName: string
  branding?: StudioBranding | null
}

export function waitlistOfferEmail(params: WaitlistOfferParams) {
  const { memberName, className, date, time, claimUrl, expiresInMinutes, studioName, branding } = params
  const c = resolveColors(branding)

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${c.cocoa};">Hi ${memberName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:${c.cocoa};">A spot has opened up in a class you're on the waitlist for!</p>
    <table cellpadding="0" cellspacing="0" style="background-color:${c.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Class</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${c.cocoa};">${className}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Date &amp; time</p>
        <p style="margin:0;font-size:15px;color:${c.cocoa};">${date} at ${time}</p>
      </td></tr>
    </table>
    <p style="margin:24px 0;font-size:14px;color:${c.ember};font-weight:600;">You have ${expiresInMinutes} minutes to claim this spot before it's offered to the next person.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      <tr><td align="center">
        <a href="${claimUrl}" style="display:inline-block;background-color:${c.gold};color:${c.cocoa};font-size:15px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;">Claim your spot</a>
      </td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:${c.warmGrey};">If this link doesn't work, copy and paste this URL into your browser: ${claimUrl}</p>`

  return {
    subject: `A spot opened up in ${className}!`,
    html: layout(studioName, body, branding),
  }
}

// --- Monday weekly summary (for admins) ---

export interface WeeklySummaryParams {
  recipientName: string
  studioName: string
  branding?: StudioBranding | null
  /** e.g. "Mon 29 Sep – Sun 5 Oct" */
  weekLabel: string
  money: {
    sales: number
    prevSales: number
    byType: Array<{ label: string; amount: number; count: number }>
    refunds: number
    refundCount: number
    cardFees: number
    net: number
    paidOut: number
    payoutCount: number
    payoutFees: number
  } | null
  classes: {
    held: number
    booked: number
    capacity: number
    fillPct: number | null
    prevFillPct: number | null
    busiest: { label: string; pct: number } | null
    quietest: { label: string; pct: number } | null
    noShows: number
    marked: number
    lateCancels: number
  }
  members: {
    firstTimers: number
    prevFirstTimers: number
    active30: number
    totalLapsed: number
  }
  lapsed: Array<{ name: string; email: string; phone: string; lastClass: string; classes: number }>
  ahead: { classes: number; booked: number; capacity: number }
  links: { money: string; insights: string; lapsed: string }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const gbp = (pence: number) =>
  `${pence < 0 ? "&minus;" : ""}&pound;${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function weeklySummaryEmail(p: WeeklySummaryParams) {
  const c = resolveColors(p.branding)
  const label = `margin:0 0 4px;font-size:11px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.08em;`
  const h2 = `margin:28px 0 10px;font-size:13px;font-weight:700;color:${c.cocoa};text-transform:uppercase;letter-spacing:0.08em;`
  const cell = `padding:7px 0;font-size:14px;color:${c.cocoa};border-bottom:1px solid ${c.sand};`
  const num = `${cell}text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;`

  // Change against last week, in words and an arrow; never colour alone
  const change = (now: number, before: number, unit: "%" | "pts") => {
    if (before === 0 && unit === "%") return now > 0 ? "new this week" : ""
    const diff = unit === "%" ? Math.round(((now - before) / before) * 100) : now - before
    if (diff === 0) return "same as last week"
    return `${diff > 0 ? "&#9650; up" : "&#9660; down"} ${Math.abs(diff)}${unit === "%" ? "%" : " pts"} on last week`
  }

  const tile = (title: string, value: string, sub: string) => `
    <td width="33%" valign="top" style="padding:14px 12px;background-color:${c.cream};border-radius:8px;">
      <p style="${label}">${title}</p>
      <p style="margin:0;font-size:22px;font-weight:700;color:${c.cocoa};">${value}</p>
      <p style="margin:4px 0 0;font-size:12px;color:${c.warmGrey};">${sub}</p>
    </td>`

  const m = p.money
  const k = p.classes
  const headline = `
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${tile("Card sales", m ? gbp(m.sales) : "&ndash;", m ? change(m.sales, m.prevSales, "%") : "Stripe not connected")}
      <td width="8"></td>
      ${tile("Classes full", k.fillPct === null ? "&ndash;" : `${k.fillPct}%`, k.prevFillPct === null || k.fillPct === null ? `${k.held} classes` : change(k.fillPct, k.prevFillPct, "pts"))}
      <td width="8"></td>
      ${tile("New members", String(p.members.firstTimers), change(p.members.firstTimers, p.members.prevFirstTimers, "%") || "first class this week")}
    </tr></table>`

  const moneyRows = m
    ? `
    <p style="${h2}">Money</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${m.byType.map((t) => `<tr><td style="${cell}">${esc(t.label)} <span style="color:${c.warmGrey};font-size:12px;">${t.count} sale${t.count === 1 ? "" : "s"}</span></td><td style="${num}">${gbp(t.amount)}</td></tr>`).join("")}
      <tr><td style="${cell}font-weight:700;">Sales</td><td style="${num}font-weight:700;">${gbp(m.sales)}</td></tr>
      ${m.refunds ? `<tr><td style="${cell}">Refunds <span style="color:${c.warmGrey};font-size:12px;">${m.refundCount}</span></td><td style="${num}">${gbp(-m.refunds)}</td></tr>` : ""}
      <tr><td style="${cell}">Stripe card fees</td><td style="${num}">${gbp(-m.cardFees)}</td></tr>
      <tr><td style="${cell}font-weight:700;">Net</td><td style="${num}font-weight:700;">${gbp(m.net)}</td></tr>
    </table>
    <p style="margin:10px 0 0;font-size:13px;color:${c.warmGrey};">
      ${m.payoutCount ? `${gbp(m.paidOut)} paid to the bank in ${m.payoutCount} payout${m.payoutCount === 1 ? "" : "s"}${m.payoutFees ? `, with ${gbp(m.payoutFees)} in instant payout fees` : ""}.` : "Nothing paid to the bank this week."}
      Card payments only; cash and complimentary classes aren't included.
    </p>`
    : ""

  const classes = `
    <p style="${h2}">Classes</p>
    <p style="margin:0 0 6px;font-size:14px;color:${c.cocoa};">
      ${k.held} classes, ${k.booked} of ${k.capacity} places booked${k.fillPct !== null ? ` (${k.fillPct}%)` : ""}.
    </p>
    ${k.busiest ? `<p style="margin:0 0 4px;font-size:14px;color:${c.cocoa};">Fullest: <strong>${esc(k.busiest.label)}</strong>, ${k.busiest.pct}%</p>` : ""}
    ${k.quietest ? `<p style="margin:0 0 4px;font-size:14px;color:${c.cocoa};">Quietest: <strong>${esc(k.quietest.label)}</strong>, ${k.quietest.pct}%</p>` : ""}
    <p style="margin:6px 0 0;font-size:13px;color:${c.warmGrey};">
      ${k.marked ? `${k.noShows} no-show${k.noShows === 1 ? "" : "s"} from ${k.marked} marked bookings` : "No attendance marked"}, ${k.lateCancels} late cancel${k.lateCancels === 1 ? "" : "s"}.
    </p>`

  const lapsedRows = p.lapsed
    .map(
      (l) => `
      <tr><td style="padding:10px 0;border-bottom:1px solid ${c.sand};">
        <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:${c.cocoa};">${esc(l.name)}</p>
        <p style="margin:0 0 2px;font-size:12px;color:${c.warmGrey};">Last came ${esc(l.lastClass)} &middot; ${l.classes} classes in all</p>
        <p style="margin:0;font-size:12px;color:${c.cocoa};">${[l.phone, l.email].filter(Boolean).map(esc).join(" &middot; ")}</p>
      </td></tr>`,
    )
    .join("")

  const members = `
    <p style="${h2}">Members</p>
    <p style="margin:0 0 6px;font-size:14px;color:${c.cocoa};">
      ${p.members.firstTimers} came to their first class. ${p.members.active30} members have been in the last 30 days.
    </p>
    ${
      p.lapsed.length
        ? `<p style="margin:12px 0 4px;font-size:14px;color:${c.cocoa};">${p.lapsed.length === 1 ? "One regular has" : `${p.lapsed.length} regulars have`} gone quiet: 3 or more classes, nothing for 30 days, nothing booked. A quick hello might bring them back.</p>
           <table width="100%" cellpadding="0" cellspacing="0">${lapsedRows}</table>
           <p style="margin:10px 0 0;font-size:13px;color:${c.warmGrey};">${p.members.totalLapsed} lapsed regulars in total. <a href="${p.links.lapsed}" style="color:${c.gold};font-weight:600;">See them all</a></p>`
        : `<p style="margin:0;font-size:13px;color:${c.warmGrey};">No regulars went quiet this week.</p>`
    }`

  const ahead = `
    <p style="${h2}">This week</p>
    <p style="margin:0;font-size:14px;color:${c.cocoa};">
      ${p.ahead.classes} classes on the timetable, ${p.ahead.booked} of ${p.ahead.capacity} places booked so far${p.ahead.capacity ? ` (${Math.round((p.ahead.booked / p.ahead.capacity) * 100)}%)` : ""}.
    </p>`

  const body = `
    <p style="margin:0 0 4px;font-size:15px;color:${c.cocoa};">Hi ${esc(p.recipientName)},</p>
    <p style="margin:0 0 20px;font-size:15px;color:${c.cocoa};">Here's how last week went, ${esc(p.weekLabel)}.</p>
    ${headline}
    ${moneyRows}
    ${classes}
    ${members}
    ${ahead}
    <p style="margin:28px 0 0;font-size:13px;color:${c.warmGrey};">
      More detail: <a href="${p.links.money}" style="color:${c.gold};font-weight:600;">Money</a> &middot;
      <a href="${p.links.insights}" style="color:${c.gold};font-weight:600;">Insights</a>
    </p>`

  const subject = m
    ? `Your week: ${gbp(m.sales).replace("&pound;", "£").replace("&minus;", "-")} in sales, classes ${k.fillPct ?? "–"}% full`
    : `Your week: classes ${k.fillPct ?? "–"}% full, ${p.members.firstTimers} new members`

  return { subject, html: layout(p.studioName, body, p.branding) }
}
