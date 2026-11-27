"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  connectTelegramBot,
  disconnectChannel,
  findTelegramChat,
  saveAlertEmail,
  sendTestAlert,
  setUpPush,
} from "@/app/actions/monitor"
import { cn } from "@/lib/utils"

interface AlertChannelsProps {
  telegram: "off" | "waiting" | "connected"
  telegramBot: string | null
  pushTopic: string | null
  email: string | null
}

function Channel({
  name,
  on,
  children,
  onRemove,
}: {
  name: string
  on: boolean
  children: React.ReactNode
  onRemove?: () => void
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[0.84rem] font-semibold text-cocoa">
          <span className={cn("h-2 w-2 rounded-full", on ? "bg-success" : "bg-warm-grey/40")} aria-hidden />
          {name}
        </span>
        {onRemove && (
          <button onClick={onRemove} className="-my-2 -mr-2 px-2 py-2 text-[0.74rem] text-warm-grey underline-offset-2 hover:text-cocoa hover:underline sm:text-[0.7rem]">
            Turn off
          </button>
        )}
      </div>
      <div className="space-y-2 text-[0.78rem] text-slate">{children}</div>
    </div>
  )
}

export function AlertChannels({ telegram, telegramBot, pushTopic, email }: AlertChannelsProps) {
  const [pending, start] = useTransition()
  const [token, setToken] = useState("")
  const [emailValue, setEmailValue] = useState(email ?? "")
  const [lastTest, setLastTest] = useState<string | null>(null)
  // Telegram setup errors stay on screen under the box, not just in a toast.
  const [telegramError, setTelegramError] = useState<string | null>(null)

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string, onError?: (e: string) => void) =>
    start(async () => {
      let res: { ok: boolean; error?: string }
      try {
        res = await fn()
      } catch {
        res = { ok: false, error: "Something went wrong. Refresh the page and try again." }
      }
      if (!res.ok) {
        const message = res.error ?? "That didn't work"
        toast.error(message)
        onError?.(message)
      } else {
        onError?.("")
        if (done) toast.success(done)
      }
    })

  const anyOn = telegram === "connected" || !!pushTopic || !!email

  return (
    <section>
      <h3 className="mb-1 font-heading text-[1.25rem] font-medium text-cocoa">Alerts</h3>
      <p className="mb-3 text-[0.76rem] text-warm-grey">
        Sent when something breaks for ten minutes, straight away if a customer paid and got nothing, and again
        when it recovers.
      </p>

      <div className="divide-y divide-sand rounded-xl border border-sand bg-white">
        <Channel
          name="Telegram"
          on={telegram === "connected"}
          onRemove={telegram !== "off" ? () => act(() => disconnectChannel("telegram"), "Telegram turned off") : undefined}
        >
          {telegram === "off" && (
            <>
              <p>
                In Telegram, message <span className="font-semibold">@BotFather</span>, send <code>/newbot</code> and
                give it any name. Paste the token it replies with:
              </p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  act(async () => {
                    const res = await connectTelegramBot(token)
                    if (res.ok) setToken("")
                    return res
                  }, "Bot connected", (e) => setTelegramError(e || null))
                }}
              >
                <Input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="123456:ABC…"
                  autoComplete="off"
                  className="h-8 text-[0.78rem]"
                />
                <Button size="sm" disabled={pending || !token.trim()}>{pending ? "Checking…" : "Connect"}</Button>
              </form>
              {telegramError && <p className="text-[0.74rem] font-medium text-red-700">{telegramError}</p>}
            </>
          )}
          {telegram === "waiting" && (
            <>
              <p>
                Open{" "}
                {telegramBot ? (
                  <a href={`https://t.me/${telegramBot}`} target="_blank" rel="noreferrer" className="font-semibold text-cocoa underline">
                    @{telegramBot}
                  </a>
                ) : (
                  "your bot"
                )}{" "}
                in Telegram and press <span className="font-semibold">Start</span>. Then:
              </p>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => act(findTelegramChat, "Telegram connected", (e) => setTelegramError(e || null))}
              >
                I&apos;ve pressed Start
              </Button>
              {telegramError && <p className="text-[0.74rem] font-medium text-red-700">{telegramError}</p>}
            </>
          )}
          {telegram === "connected" && <p>Connected{telegramBot ? ` to @${telegramBot}` : ""}.</p>}
        </Channel>

        <Channel
          name="Phone push"
          on={!!pushTopic}
          onRemove={pushTopic ? () => act(() => disconnectChannel("push"), "Push turned off") : undefined}
        >
          {pushTopic ? (
            <>
              <p>
                Install <span className="font-semibold">ntfy</span> (free, App Store or Google Play), tap +, and
                subscribe to this topic. Keep it private: anyone with it sees the alerts.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-cream px-2 py-1.5 text-[0.76rem] text-cocoa">{pushTopic}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(pushTopic).then(() => toast.success("Copied"))}
                >
                  Copy
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>Loud, instant notifications on your phone, even if email or Telegram is down.</p>
              <Button size="sm" disabled={pending} onClick={() => act(setUpPush, "Push topic created")}>
                Set up push
              </Button>
            </>
          )}
        </Channel>

        <Channel
          name="Email"
          on={!!email}
          onRemove={email ? () => act(async () => {
            const res = await disconnectChannel("email")
            if (res.ok) setEmailValue("")
            return res
          }, "Email alerts turned off") : undefined}
        >
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              act(() => saveAlertEmail(emailValue), "Email saved")
            }}
          >
            <Input
              type="email"
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
              placeholder="you@example.com"
              className="h-8 text-[0.78rem]"
            />
            <Button size="sm" variant={email ? "outline" : "default"} disabled={pending || emailValue.trim() === (email ?? "")}>
              Save
            </Button>
          </form>
          <p className="text-warm-grey">Has the full detail. Goes through Resend, so it can&apos;t warn you about Resend itself.</p>
        </Channel>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          className="h-10 sm:h-7"
          disabled={pending || !anyOn}
          onClick={() =>
            start(async () => {
              const res = await sendTestAlert()
              if (!res.ok) return void toast.error(res.error)
              const r = res.report
              setLastTest(
                [
                  r.telegram !== "off" && `Telegram ${r.telegram}`,
                  r.push !== "off" && `push ${r.push}`,
                  r.email !== "off" && `email ${r.email}`,
                ].filter(Boolean).join(", ")
              )
            })
          }
        >
          Send a test alert
        </Button>
        {lastTest && <span className="text-[0.74rem] text-warm-grey">{lastTest}</span>}
      </div>
    </section>
  )
}
