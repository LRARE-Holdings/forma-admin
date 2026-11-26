import { resend } from "@/lib/email"
import type { CheckStatus, MonitorConfig } from "./types"

/**
 * Sends one alert to every channel that's set up: Telegram, phone push (ntfy)
 * and email. Channels are independent, so Resend being down still leaves
 * Telegram and the push, and the other way round.
 */

export type AlertLevel = Exclude<CheckStatus, "unknown"> | "info"

export interface Alert {
  level: AlertLevel
  title: string
  items: { heading: string; lines?: string[] }[]
}

export interface DeliveryReport {
  telegram: "sent" | "failed" | "off"
  push: "sent" | "failed" | "off"
  email: "sent" | "failed" | "off"
  errors: string[]
}

const STATUS_URL = `${process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.burnmatstudio.co.uk"}/dashboard/status`

const MARK: Record<AlertLevel, string> = { down: "🔴", warn: "🟠", ok: "🟢", info: "🔵" }

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

async function sendTelegram(config: MonitorConfig, alert: Alert): Promise<void> {
  const text = [
    `${MARK[alert.level]} <b>${escapeHtml(alert.title)}</b>`,
    ...alert.items.flatMap((item) => [
      "",
      `<b>${escapeHtml(item.heading)}</b>`,
      ...(item.lines ?? []).slice(0, 6).map((l) => `• ${escapeHtml(l)}`),
    ]),
    "",
    `<a href="${STATUS_URL}">Open the status page</a>`,
  ].join("\n")

  const res = await fetch(`https://api.telegram.org/bot${config.telegram_token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: config.telegram_chat_id,
      text: text.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Telegram ${res.status}`)
}

async function sendPush(config: MonitorConfig, alert: Alert): Promise<void> {
  const priority = alert.level === "down" ? 5 : alert.level === "warn" ? 4 : 3
  const res = await fetch("https://ntfy.sh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic: config.ntfy_topic,
      title: `${MARK[alert.level]} ${alert.title}`,
      message: alert.items.map((i) => i.heading).join("\n").slice(0, 1000),
      priority,
      click: STATUS_URL,
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`ntfy ${res.status}`)
}

async function sendEmail(config: MonitorConfig, alert: Alert): Promise<void> {
  const colour = { down: "#b42318", warn: "#b54708", ok: "#067647", info: "#175cd3" }[alert.level]
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1d1a17">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${colour};font-weight:600">${
      { down: "Down", warn: "Needs a look", ok: "Back to normal", info: "Monitor" }[alert.level]
    }</p>
    <h1 style="margin:0 0 20px;font-size:20px;line-height:1.3">${escapeHtml(alert.title)}</h1>
    ${alert.items
      .map(
        (item) => `
      <div style="border-left:3px solid ${colour};padding:2px 0 2px 12px;margin:0 0 16px">
        <p style="margin:0 0 6px;font-weight:600;font-size:15px">${escapeHtml(item.heading)}</p>
        ${(item.lines ?? [])
          .slice(0, 10)
          .map((l) => `<p style="margin:0 0 3px;font-size:13px;color:#57514b">${escapeHtml(l)}</p>`)
          .join("")}
      </div>`
      )
      .join("")}
    <p style="margin:24px 0 0"><a href="${STATUS_URL}" style="color:#1d1a17">Open the status page</a></p>
  </div>`

  const { error } = await resend.emails.send({
    from: "Forma Monitor <monitor@useforma.co.uk>",
    to: config.alert_email!,
    subject: `${MARK[alert.level]} ${alert.title}`,
    html,
  })
  if (error) throw new Error(`Resend: ${error.message}`)
}

export async function deliverAlert(config: MonitorConfig, alert: Alert): Promise<DeliveryReport> {
  const report: DeliveryReport = { telegram: "off", push: "off", email: "off", errors: [] }
  const attempt = async (channel: "telegram" | "push" | "email", enabled: boolean, send: () => Promise<void>) => {
    if (!enabled) return
    try {
      await send()
      report[channel] = "sent"
    } catch (e) {
      report[channel] = "failed"
      report.errors.push(`${channel}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  await Promise.all([
    attempt("telegram", !!(config.telegram_token && config.telegram_chat_id), () => sendTelegram(config, alert)),
    attempt("push", !!config.ntfy_topic, () => sendPush(config, alert)),
    attempt("email", !!config.alert_email, () => sendEmail(config, alert)),
  ])
  if (report.errors.length) console.error("[monitor] alert delivery:", report.errors.join("; "))
  return report
}
