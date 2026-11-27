"use server"

import { randomBytes } from "node:crypto"
import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePlatformOwner } from "@/lib/monitor/owner"
import { runMonitor, loadMonitorConfig } from "@/lib/monitor/run"
import { deliverAlert, type DeliveryReport } from "@/lib/monitor/alerts"

/**
 * Status page actions. Every one checks the caller is a platform owner first;
 * secrets (the Telegram token) go straight into Vault and never come back to
 * the browser.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

async function setConfig(key: string, value: string | null) {
  const { error } = await createAdminClient().rpc("monitor_set_config", { p_key: key, p_value: value })
  if (error) throw new Error(error.message)
}

export async function runChecksNow(): Promise<Result<{ ran: number }>> {
  await requirePlatformOwner()
  const report = await runMonitor({ force: true })
  revalidatePath("/dashboard/status", "layout")
  return { ok: true, ran: report.ran }
}

export async function saveAlertEmail(email: string): Promise<Result> {
  await requirePlatformOwner()
  const value = email.trim()
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, error: "That doesn't look like an email address" }
  await setConfig("alert_email", value || null)
  revalidatePath("/dashboard/status", "layout")
  return { ok: true }
}

export async function setUpPush(): Promise<Result> {
  await requirePlatformOwner()
  // Anyone who knows a ntfy topic can read it, so make it unguessable.
  const topic = `forma-${randomBytes(12).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "")}`
  await setConfig("ntfy_topic", topic)
  revalidatePath("/dashboard/status", "layout")
  return { ok: true }
}

export async function connectTelegramBot(token: string): Promise<Result<{ username: string }>> {
  await requirePlatformOwner()
  // Accept the whole BotFather message, a "bot" prefix or a stray space: pick
  // the token out of whatever was pasted.
  const value = token.match(/(\d{5,}:[A-Za-z0-9_-]{30,})/)?.[1]
  if (!value) {
    return { ok: false, error: "That doesn't look like a bot token. It's the line from BotFather like 123456789:AAH…" }
  }
  let data: { ok?: boolean; description?: string; result?: { username?: string } } | null = null
  try {
    const res = await fetch(`https://api.telegram.org/bot${value}/getMe`, { signal: AbortSignal.timeout(8000) })
    data = await res.json().catch(() => null)
  } catch {
    return { ok: false, error: "Couldn't reach Telegram. Try again in a minute." }
  }
  if (!data?.ok || !data.result?.username) {
    return { ok: false, error: `Telegram didn't accept that token${data?.description ? ` (${data.description})` : ""}. Copy it again from BotFather.` }
  }
  await setConfig("telegram_token", value)
  await setConfig("telegram_chat_id", null)
  revalidatePath("/dashboard/status", "layout")
  return { ok: true, username: data.result.username }
}

/** After you've sent the bot a message, find your chat with it. */
export async function findTelegramChat(): Promise<Result> {
  await requirePlatformOwner()
  const config = await loadMonitorConfig()
  if (!config.telegram_token) return { ok: false, error: "Connect the bot first" }
  let data: { ok?: boolean; result?: { message?: { chat?: { id: number; type: string } } }[] } | null = null
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram_token}/getUpdates?limit=20`, {
      signal: AbortSignal.timeout(8000),
    })
    data = await res.json().catch(() => null)
  } catch {
    return { ok: false, error: "Couldn't reach Telegram. Try again in a minute." }
  }
  const chat = [...(data?.result ?? [])].reverse().find((u) => u.message?.chat?.type === "private")?.message?.chat
  if (!chat) return { ok: false, error: "No message found yet. Open the bot in Telegram, press Start, then try again" }
  await setConfig("telegram_chat_id", String(chat.id))
  await deliverAlert({ telegram_token: config.telegram_token, telegram_chat_id: String(chat.id) }, {
    level: "info",
    title: "Connected. Burn's alerts will arrive here.",
    items: [],
  })
  revalidatePath("/dashboard/status", "layout")
  return { ok: true }
}

export async function disconnectChannel(channel: "telegram" | "push" | "email"): Promise<Result> {
  await requirePlatformOwner()
  if (channel === "telegram") {
    await setConfig("telegram_token", null)
    await setConfig("telegram_chat_id", null)
  } else if (channel === "push") {
    await setConfig("ntfy_topic", null)
  } else {
    await setConfig("alert_email", null)
  }
  revalidatePath("/dashboard/status", "layout")
  return { ok: true }
}

export async function sendTestAlert(): Promise<Result<{ report: DeliveryReport }>> {
  await requirePlatformOwner()
  const report = await deliverAlert(await loadMonitorConfig(), {
    level: "info",
    title: "Test alert from the Forma monitor",
    items: [{ heading: "If you can read this, alerts reach you on this channel.", lines: [] }],
  })
  return { ok: true, report }
}

/** Error inbox: mark fixed (reopens if it comes back), mute for a while, or open again. */
export async function setErrorGroupStatus(
  fingerprint: string,
  status: "resolved" | "muted" | "open",
  muteHours?: number,
): Promise<Result> {
  await requirePlatformOwner()
  if (!/^[0-9a-f]{16}$/.test(fingerprint)) return { ok: false, error: "Unknown error" }
  const update =
    status === "resolved"
      ? { status, resolved_at: new Date().toISOString(), muted_until: null, reopened: false }
      : status === "muted"
        ? { status, muted_until: new Date(Date.now() + (muteHours ?? 24) * 3_600_000).toISOString() }
        : { status, muted_until: null, resolved_at: null }
  const { error } = await createAdminClient().from("error_groups").update(update).eq("fingerprint", fingerprint)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/dashboard/status", "layout")
  return { ok: true }
}
