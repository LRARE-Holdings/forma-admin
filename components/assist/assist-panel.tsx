"use client"

import { useState, useRef, useEffect } from "react"
import { X, Send, Square, Trash2, Sparkles, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAssist, type Message } from "@/lib/assist/hooks"
import { MessageBubble } from "./message-bubble"
import { ToolCallCard } from "./tool-call-card"
import { UpgradeGate } from "./upgrade-gate"

interface AssistPanelProps {
  open: boolean
  onClose: () => void
  studioName: string
  planTier: string
  userName: string
}

export function AssistPanel({
  open,
  onClose,
  studioName,
  planTier,
  userName,
}: AssistPanelProps) {
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [upgradeNeeded, setUpgradeNeeded] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")

  const { messages, isLoading, remaining, sendMessage, stop, clear } =
    useAssist({
      onError: (error) => {
        if (error === "upgrade_required") setUpgradeNeeded(true)
        else if (error === "rate_limited") setRateLimited(true)
      },
    })

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    setErrorMessage("")
    sendMessage(input)
    setInput("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const eligible = ["pro", "partner"].includes(planTier)
  const firstName = userName?.split(" ")[0] ?? "there"

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-[2px] transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={cn(
          "fixed right-0 top-0 z-[70] flex h-full w-full max-w-[420px] flex-col bg-cream shadow-2xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sand px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-gold to-ember">
              <Sparkles className="h-4 w-4 text-white" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-[0.9rem] font-semibold text-cocoa">
                Forma Assist
              </h2>
              <p className="text-[0.65rem] text-warm-grey">
                {studioName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={clear}
                className="rounded-lg p-2 text-warm-grey transition-colors hover:bg-sand hover:text-cocoa"
                title="Clear conversation"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-warm-grey transition-colors hover:bg-sand hover:text-cocoa"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Body */}
        {!eligible || upgradeNeeded ? (
          <UpgradeGate studioName={studioName} />
        ) : rateLimited ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="rounded-full bg-ember/10 p-3">
              <Sparkles className="h-6 w-6 text-ember" />
            </div>
            <p className="text-[0.85rem] font-medium text-cocoa">
              Daily limit reached
            </p>
            <p className="text-[0.78rem] text-warm-grey">
              {errorMessage ||
                "You've used all your Assist requests for today. Your limit resets at midnight."}
            </p>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-5 py-4"
            >
              {messages.length === 0 ? (
                <WelcomeScreen firstName={firstName} />
              ) : (
                <div className="flex flex-col gap-4">
                  {messages.map((msg) => (
                    <div key={msg.id}>
                      {msg.role === "assistant" &&
                        msg.toolCalls?.map((tc) => (
                          <ToolCallCard key={tc.tool_use_id} toolCall={tc} />
                        ))}
                      <MessageBubble message={msg} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer: remaining + input */}
            <div className="border-t border-sand">
              {remaining !== null && remaining <= 15 && (
                <div className="px-5 pt-2.5">
                  <p className="text-[0.68rem] text-warm-grey">
                    {remaining} request{remaining !== 1 ? "s" : ""} remaining
                    today
                  </p>
                </div>
              )}
              <form
                onSubmit={handleSubmit}
                className="flex items-end gap-2 px-4 pb-4 pt-3"
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask Assist anything..."
                  rows={1}
                  className="max-h-[120px] min-h-[42px] flex-1 resize-none rounded-xl border border-sand bg-white px-3.5 py-2.5 text-[0.82rem] text-cocoa placeholder:text-warm-grey/60 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30"
                />
                {isLoading ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-ember text-white transition-colors hover:bg-ember/90"
                    title="Stop generating"
                  >
                    <Square className="h-4 w-4" fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gold text-cocoa transition-colors hover:bg-gold/90 disabled:opacity-40 disabled:hover:bg-gold"
                    title="Send message"
                  >
                    <Send className="h-4 w-4" strokeWidth={2} />
                  </button>
                )}
              </form>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function WelcomeScreen({ firstName }: { firstName: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="rounded-2xl bg-gradient-to-br from-gold/15 to-ember/10 p-4">
        <Sparkles className="h-8 w-8 text-gold" strokeWidth={1.5} />
      </div>
      <div>
        <h3 className="text-[0.95rem] font-semibold text-cocoa">
          Hi {firstName}!
        </h3>
        <p className="mt-1 text-[0.78rem] leading-relaxed text-warm-grey">
          I'm Forma Assist, your AI studio assistant. I can help you manage
          classes, bookings, members, and more — just ask.
        </p>
      </div>
      <div className="mt-2 flex flex-col gap-2 w-full max-w-[280px]">
        {[
          "Who's booked into tomorrow's classes?",
          "Show me this week's stats",
          "Add a new class to the timetable",
        ].map((suggestion) => (
          <button
            key={suggestion}
            className="rounded-xl border border-sand bg-white px-3.5 py-2.5 text-left text-[0.76rem] text-cocoa transition-all hover:border-gold/40 hover:bg-gold/[0.04]"
            onClick={() => {
              // Find the textarea and set its value via a custom event
              const textarea = document.querySelector(
                "textarea[placeholder='Ask Assist anything...']"
              ) as HTMLTextAreaElement | null
              if (textarea) {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype,
                  "value"
                )?.set
                nativeInputValueSetter?.call(textarea, suggestion)
                textarea.dispatchEvent(
                  new Event("input", { bubbles: true })
                )
                textarea.focus()
              }
            }}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}
