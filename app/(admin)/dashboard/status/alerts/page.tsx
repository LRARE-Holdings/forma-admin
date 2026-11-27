import { loadMonitorConfig } from "@/lib/monitor/run"
import { AlertChannels } from "@/components/dashboard/status/alert-channels"

export const dynamic = "force-dynamic"

/** Where alerts go: Telegram, phone push (ntfy) and email. */
export default async function AlertSettings() {
  const config = await loadMonitorConfig()

  // The bot's @name, for the "open it in Telegram" link while setting up.
  let telegramBot: string | null = null
  if (config.telegram_token) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.telegram_token}/getMe`, { signal: AbortSignal.timeout(4000) })
      telegramBot = ((await res.json()) as { result?: { username?: string } }).result?.username ?? null
    } catch {
      telegramBot = null
    }
  }

  return (
    <div className="max-w-[460px]">
      <AlertChannels
        telegram={config.telegram_token ? (config.telegram_chat_id ? "connected" : "waiting") : "off"}
        telegramBot={telegramBot}
        pushTopic={config.ntfy_topic ?? null}
        email={config.alert_email ?? null}
      />
    </div>
  )
}
