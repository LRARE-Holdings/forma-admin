"use client"

import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import type { Message } from "@/lib/assist/hooks"

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user"
  const isEmpty = !message.content && message.isStreaming

  if (!message.content && !message.isStreaming) return null

  return (
    <div
      className={cn("flex", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-[0.82rem] leading-relaxed",
          isUser
            ? "bg-cocoa text-wheat"
            : "bg-white text-cocoa shadow-sm ring-1 ring-sand/60"
        )}
      >
        {isEmpty ? (
          <div className="flex items-center gap-2 py-0.5 text-warm-grey">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-[0.75rem]">Thinking...</span>
          </div>
        ) : (
          <div className="assist-content whitespace-pre-wrap">
            <FormattedContent content={message.content} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Simple markdown-lite renderer for Assist messages.
 * Handles **bold**, bullet points, and line breaks.
 */
function FormattedContent({ content }: { content: string }) {
  const lines = content.split("\n")

  return (
    <>
      {lines.map((line, i) => {
        const trimmed = line.trim()

        // Bullet points
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={i} className="flex gap-1.5 py-0.5">
              <span className="mt-[2px] text-warm-grey">&#8226;</span>
              <span>
                <BoldText text={trimmed.slice(2)} />
              </span>
            </div>
          )
        }

        // Empty lines
        if (!trimmed) {
          return <div key={i} className="h-2" />
        }

        return (
          <div key={i} className="py-[1px]">
            <BoldText text={line} />
          </div>
        )
      })}
    </>
  )
}

function BoldText({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*)/g)

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
