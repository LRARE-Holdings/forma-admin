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
  /** "5 classes", or "1 Barre class" */
  value: string
  /** A single-class card: the credit only books that class. */
  classOnly: boolean
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
        ${row("Gift", p.classOnly ? esc(p.value) : `${esc(p.value)} · any class`)}
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

/**
 * To the recipient, on the date the buyer picked.
 *
 * This one is a present, not a receipt, so it has its own layout: the top of
 * Lucy's voucher artwork, a big "X got you Y" line, the code on a ticket-style
 * card and three short steps. Email-safe throughout: tables, inline styles,
 * Georgia for the serif (web fonts don't load in most mail clients), and the
 * header image is decoration only, so the email still reads with images off.
 */
export function giftCardRecipientEmail(params: GiftEmailBase & { heroImageUrl: string }) {
  const MAROON = "#4A0A0E"
  const DEEP = "#2B0709"
  const CREAM = "#F8E6AE"
  const INK = "#3B0A0A"
  const GOLD = "#C4A95A"
  const SOFT = "#7A5A50"
  const serif = "Georgia,'Times New Roman',serif"
  const sans = "'Helvetica Neue',Helvetica,Arial,sans-serif"
  const r = esc(params.recipientName)
  const from = esc(params.senderName)
  const value = esc(params.value)

  const step = (n: string, title: string, text: string) => `
    <td valign="top" width="33%" style="padding:0 8px;">
      <p style="margin:0;font-family:${serif};font-size:28px;font-style:italic;color:${GOLD};line-height:1;">${n}</p>
      <p style="margin:6px 0 2px;font-family:${sans};font-size:13px;font-weight:700;color:${INK};">${title}</p>
      <p style="margin:0;font-family:${sans};font-size:12px;line-height:1.45;color:${SOFT};">${text}</p>
    </td>`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>A gift for you</title></head>
<body style="margin:0;padding:0;background-color:${DEEP};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${from} got you ${value} at ${esc(params.studioName)}. Your code is inside.</div>
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:${DEEP};padding:28px 12px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;background-color:#FFFDF7;border-radius:14px;overflow:hidden;">
        <tr><td style="background-color:${MAROON};line-height:0;">
          <a href="${esc(params.claimUrl)}"><img src="${esc(params.heroImageUrl)}" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0;" /></a>
        </td></tr>

        <tr><td style="padding:34px 36px 6px;">
          <p style="margin:0 0 10px;font-family:${sans};font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${GOLD};">A gift for ${r}</p>
          <h1 style="margin:0 0 14px;font-family:${serif};font-size:32px;line-height:1.15;font-weight:normal;font-style:italic;color:${INK};">${from} got you ${value} at Burn.</h1>
          <p style="margin:0;font-family:${sans};font-size:15px;line-height:1.6;color:${SOFT};">${params.classOnly ? "Book it whenever that class is on the timetable." : "Good for any class on the timetable."} Your voucher is attached too, if you'd like to print it or stick it on the fridge.</p>
        </td></tr>

        <tr><td style="padding:26px 36px 4px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:${CREAM};border:2px dashed ${GOLD};border-radius:12px;">
            <tr><td align="center" style="padding:20px 16px;">
              <p style="margin:0 0 6px;font-family:${sans};font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${MAROON};">Your code</p>
              <p style="margin:0 0 8px;font-family:Menlo,Consolas,'Courier New',monospace;font-size:22px;font-weight:700;letter-spacing:0.1em;white-space:nowrap;color:${INK};">${esc(params.code)}</p>
              <p style="margin:0;font-family:${sans};font-size:13px;color:${SOFT};">Claim by <strong style="color:${INK};">${esc(params.claimBy)}</strong></p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td align="center" style="padding:26px 36px 8px;">
          <a href="${esc(params.claimUrl)}" style="display:inline-block;background-color:${MAROON};color:${CREAM};font-family:${sans};font-size:15px;font-weight:700;letter-spacing:0.04em;text-decoration:none;padding:15px 36px;border-radius:999px;">Claim your classes &rarr;</a>
        </td></tr>

        <tr><td style="padding:30px 28px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
            ${step("1", "Tap the button", "Or type your code on the claim page.")}
            ${step("2", "Log in or sign up", "It takes a minute if you're new to Burn.")}
            ${params.classOnly
              ? step("3", "Book your class", `You'll have ${esc(params.packValidity)} to use it.`)
              : step("3", "Book any class", `You'll have ${esc(params.packValidity)} to use your classes.`)}
          </tr></table>
        </td></tr>

        <tr><td style="padding:22px 36px 30px;">
          <p style="margin:0;font-family:${sans};font-size:12px;line-height:1.5;color:${SOFT};">If the button doesn't work, copy this link into your browser:<br><span style="color:${INK};">${esc(params.claimUrl)}</span></p>
        </td></tr>

        <tr><td style="padding:16px 36px;border-top:1px solid #EFE3C8;">
          <span style="font-family:${sans};font-size:12px;color:${SOFT};">Sent by ${esc(params.studioName)} via Forma</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return {
    subject: `${params.senderName} got you ${params.value} at Burn 🎁`,
    html,
  }
}
