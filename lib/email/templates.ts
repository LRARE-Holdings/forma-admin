// --- Shared styles ---

const COLORS = {
  cocoa: "#473728",
  gold: "#C4A95A",
  wheat: "#DFD0A5",
  cream: "#F5F0E8",
  sand: "#E8DCC8",
  warmGrey: "#8A8070",
  ember: "#D4713A",
  white: "#FFFFFF",
} as const

function layout(studioName: string, body: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:${COLORS.cream};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.cream};padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:${COLORS.white};border-radius:12px;border:1px solid ${COLORS.sand};overflow:hidden;">
        <!-- Header -->
        <tr><td style="background-color:${COLORS.cocoa};padding:24px 32px;">
          <span style="font-size:20px;font-weight:600;color:${COLORS.wheat};">${studioName}</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid ${COLORS.sand};">
          <span style="font-size:12px;color:${COLORS.warmGrey};">Sent by ${studioName} via Forma</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// --- Schedule change emails (Feature 2) ---

interface ScheduleChangeParams {
  type: "assigned" | "changed" | "removed"
  instructorName: string
  className: string
  day: string
  time: string
  studioName: string
}

const SCHEDULE_SUBJECTS: Record<string, string> = {
  assigned: "New class added to your schedule",
  changed: "Your class schedule has been updated",
  removed: "A class has been removed from your schedule",
}

export function scheduleChangeEmail(params: ScheduleChangeParams) {
  const { type, instructorName, className, day, time, studioName } = params

  const messages: Record<string, string> = {
    assigned: `You've been assigned to teach <strong>${className}</strong>.`,
    changed: `Your <strong>${className}</strong> class has been updated.`,
    removed: `<strong>${className}</strong> has been removed from your schedule.`,
  }

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${COLORS.cocoa};">Hi ${instructorName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:${COLORS.cocoa};">${messages[type]}</p>
    <table cellpadding="0" cellspacing="0" style="background-color:${COLORS.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${COLORS.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Class</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${COLORS.cocoa};">${className}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${COLORS.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">When</p>
        <p style="margin:0;font-size:15px;color:${COLORS.cocoa};">${day} at ${time}</p>
      </td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:14px;color:${COLORS.warmGrey};">If you have any questions, contact your studio manager.</p>`

  return {
    subject: SCHEDULE_SUBJECTS[type],
    html: layout(studioName, body),
  }
}

// --- Class cancellation email (Feature 3) ---

interface ClassCancelledParams {
  memberName: string
  className: string
  date: string
  time: string
  reason?: string
  creditRestored: boolean
  studioName: string
}

export function classCancelledEmail(params: ClassCancelledParams) {
  const { memberName, className, date, time, reason, creditRestored, studioName } = params

  const creditLine = creditRestored
    ? `<p style="margin:16px 0 0;font-size:14px;color:${COLORS.cocoa};"><strong>Your class credit has been restored</strong> and is ready to use for another booking.</p>`
    : ""

  const reasonLine = reason
    ? `<p style="margin:16px 0 0;font-size:14px;color:${COLORS.warmGrey};"><strong>Reason:</strong> ${reason}</p>`
    : ""

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${COLORS.cocoa};">Hi ${memberName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:${COLORS.cocoa};">We're sorry to let you know that the following class has been cancelled:</p>
    <table cellpadding="0" cellspacing="0" style="background-color:${COLORS.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${COLORS.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Class</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${COLORS.cocoa};">${className}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${COLORS.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Date &amp; time</p>
        <p style="margin:0;font-size:15px;color:${COLORS.cocoa};">${date} at ${time}</p>
      </td></tr>
    </table>
    ${reasonLine}
    ${creditLine}
    <p style="margin:24px 0 0;font-size:14px;color:${COLORS.warmGrey};">We apologise for the inconvenience. We look forward to seeing you at another class soon.</p>`

  return {
    subject: `${className} on ${date} has been cancelled`,
    html: layout(studioName, body),
  }
}

// --- Waitlist offer email (Feature 1) ---

interface WaitlistOfferParams {
  memberName: string
  className: string
  date: string
  time: string
  claimUrl: string
  expiresInMinutes: number
  studioName: string
}

export function waitlistOfferEmail(params: WaitlistOfferParams) {
  const { memberName, className, date, time, claimUrl, expiresInMinutes, studioName } = params

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${COLORS.cocoa};">Hi ${memberName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:${COLORS.cocoa};">A spot has opened up in a class you're on the waitlist for!</p>
    <table cellpadding="0" cellspacing="0" style="background-color:${COLORS.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${COLORS.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Class</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${COLORS.cocoa};">${className}</p>
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${COLORS.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">Date &amp; time</p>
        <p style="margin:0;font-size:15px;color:${COLORS.cocoa};">${date} at ${time}</p>
      </td></tr>
    </table>
    <p style="margin:24px 0;font-size:14px;color:${COLORS.ember};font-weight:600;">You have ${expiresInMinutes} minutes to claim this spot before it's offered to the next person.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      <tr><td align="center">
        <a href="${claimUrl}" style="display:inline-block;background-color:${COLORS.gold};color:${COLORS.cocoa};font-size:15px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;">Claim your spot</a>
      </td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:${COLORS.warmGrey};">If this link doesn't work, copy and paste this URL into your browser: ${claimUrl}</p>`

  return {
    subject: `A spot opened up in ${className}!`,
    html: layout(studioName, body),
  }
}
