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
  revalidatePath("/dashboard/status")
  return { ok: true, ran: report.ran }
}

export async function saveAlertEmail(email: string): Promise<Result> {
  await requirePlatformOwner()
  const value = email.trim()
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, error: "That doesn't look like an email address" }
  await setConfig("alert_email", value || null)
  revalidatePath("/dashboard/status")
  return { ok: true }
}

export async function setUpPush(): Promise<Result> {
  await requirePlatformOwner()
  // Anyone who knows a ntfy topic can read it, so make it unguessable.
  const topic = `forma-${randomBytes(12).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "")}`
  await setConfig("ntfy_topic", topic)
  revalidatePath("/dashboard/status")
  return { ok: true }
}

export async function connectTelegramBot(token: string): Promise<Result<{ username: string }>> {
  await requirePlatformOwner()
  const value = token.trim()
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(value)) {
    return { ok: false, error: "Paste the whole token BotFather gave you (numbers, a colon, then letters)" }
  }
  const res = await fetch(`https://api.telegram.org/bot${value}/getMe`, { signal: AbortSignal.timeout(8000) })
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: { username?: string } } | null
  if (!data?.ok || !data.result?.username) return { ok: false, error: "Telegram didn't accept that token" }
  await setConfig("telegram_token", value)
  await setConfig("telegram_chat_id", null)
  revalidatePath("/dashboard/status")
  return { ok: true, username: data.result.username }
}

/** After you've sent the bot a message, find your chat with it. */
export async function findTelegramChat(): Promise<Result> {
  await requirePlatformOwner()
  const config = await loadMonitorConfig()
  if (!config.telegram_token) return { ok: false, error: "Connect the bot first" }
  const res = await fetch(`https://api.telegram.org/bot${config.telegram_token}/getUpdates?limit=20`, {
    signal: AbortSignal.timeout(8000),
  })
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean
    result?: { message?: { chat?: { id: number; type: string } } }[]
  } | null
  const chat = [...(data?.result ?? [])].reverse().find((u) => u.message?.chat?.type === "private")?.message?.chat
  if (!chat) return { ok: false, error: "No message found yet. Open the bot in Telegram, press Start, then try again" }
  await setConfig("telegram_chat_id", String(chat.id))
  await deliverAlert({ telegram_token: config.telegram_token, telegram_chat_id: String(chat.id) }, {
    level: "info",
    title: "Connected. Burn's alerts will arrive here.",
    items: [],
  })
  revalidatePath("/dashboard/status")
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
  revalidatePath("/dashboard/status")
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
