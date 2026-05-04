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

function resolveColors(branding?: StudioBranding | null) {
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

function layout(studioName: string, body: string, branding?: StudioBranding | null) {
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
  studioName: string
  branding?: StudioBranding | null
}

export function classCancelledEmail(params: ClassCancelledParams) {
  const { memberName, className, date, time, reason, creditRestored, studioName, branding } = params
  const c = resolveColors(branding)

  const creditLine = creditRestored
    ? `<p style="margin:16px 0 0;font-size:14px;color:${c.cocoa};"><strong>Your class credit has been restored</strong> and is ready to use for another booking.</p>`
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
  studioName: string
  branding?: StudioBranding | null
}

export function bookingCancelledEmail(params: BookingCancelledParams) {
  const { memberName, className, date, time, creditRestored, studioName, branding } = params
  const c = resolveColors(branding)

  const creditLine = creditRestored
    ? `<p style="margin:16px 0 0;font-size:14px;color:${c.cocoa};"><strong>Your class credit has been restored</strong> and is ready to use for another booking.</p>`
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
