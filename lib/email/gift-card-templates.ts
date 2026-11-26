import { layout, resolveColors } from "@/lib/email/templates"
import type { StudioBranding } from "@/lib/types"

// Names are typed by the buyer, so everything interpolated is escaped.
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

interface GiftEmailBase {
  recipientName: string
  senderName: string
  /** "5 classes" */
  value: string
  /** "26 May 2027" */
  claimBy: string
  /** "6 weeks" */
  packValidity: string
  code: string
  claimUrl: string
  studioName: string
  branding?: StudioBranding | null
}

function details(c: ReturnType<typeof resolveColors>, p: GiftEmailBase) {
  const row = (label: string, value: string, last = false) => `
    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${c.warmGrey};text-transform:uppercase;letter-spacing:0.05em;">${label}</p>
    <p style="margin:0 0 ${last ? "0" : "12px"};font-size:15px;color:${c.cocoa};">${value}</p>`
  return `
    <table cellpadding="0" cellspacing="0" style="background-color:${c.cream};border-radius:8px;padding:16px 20px;width:100%;">
      <tr><td>
        ${row("Gift", `${esc(p.value)} · any class`)}
        ${row("Code", `<span style="font-family:Menlo,Consolas,monospace;font-size:16px;letter-spacing:0.12em;font-weight:600;">${esc(p.code)}</span>`)}
        ${row("Claim by", esc(p.claimBy), true)}
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

const p = (c: ReturnType<typeof resolveColors>, html: string, mb = 16) =>
  `<p style="margin:0 0 ${mb}px;font-size:15px;line-height:1.55;color:${c.cocoa};">${html}</p>`

/** To the person who paid. Always sent, with the voucher attached. */
export function giftCardBuyerEmail(
  params: GiftEmailBase & {
    buyerFirstName: string
    /** "Friday 25 December" when they asked us to email the recipient */
    sendsOn: string | null
  },
) {
  const c = resolveColors(params.branding)
  const body = `
    ${p(c, `Hi ${esc(params.buyerFirstName)},`)}
    ${p(c, `Thanks for buying ${esc(params.recipientName)} a gift card. The voucher is attached as a PDF, ready to print or forward.`)}
    ${params.sendsOn ? p(c, `We'll also email it to ${esc(params.recipientName)} on the morning of ${esc(params.sendsOn)}.`) : ""}
    ${p(c, `${esc(params.recipientName)} claims it with the code below. Once claimed, they have ${esc(params.packValidity)} to use their classes.`, 24)}
    ${details(c, params)}
    ${button(c, params.claimUrl, "See the claim page")}`
  return {
    subject: `Your gift card for ${params.recipientName}`,
    html: layout(params.studioName, body, params.branding),
  }
}

/** To the recipient, on the date the buyer picked. */
export function giftCardRecipientEmail(params: GiftEmailBase) {
  const c = resolveColors(params.branding)
  const body = `
    ${p(c, `Hi ${esc(params.recipientName)},`)}
    ${p(c, `${esc(params.senderName)} sent you a gift card for ${esc(params.value)} at ${esc(params.studioName)}. Your voucher is attached.`)}
    ${p(c, `To claim it, sign in or create an account and enter your code. You have ${esc(params.packValidity)} from then to use your classes, on anything on the timetable.`, 24)}
    ${details(c, params)}
    ${button(c, params.claimUrl, "Claim your classes")}`
  return {
    subject: `${params.senderName} sent you a gift card`,
    html: layout(params.studioName, body, params.branding),
  }
}
