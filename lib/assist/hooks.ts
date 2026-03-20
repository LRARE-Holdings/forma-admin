"use client"

import { useState, useCallback, useRef } from "react"

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
  isStreaming?: boolean
}

export interface ToolCall {
  tool: string
  input: Record<string, unknown>
  tool_use_id: string
  result?: string
  status?: "running" | "done" | "denied"
}

interface UseAssistOptions {
  onError?: (error: string) => void
}

export function useAssist(options: UseAssistOptions = {}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: content.trim(),
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        toolCalls: [],
        isStreaming: true,
      }

      setMessages((prev) => [...prev, userMessage, assistantMessage])
      setIsLoading(true)

      // Build conversation history for the API
      const history = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: userMessage.role, content: userMessage.content },
      ]

      const abort = new AbortController()
      abortRef.current = abort

      try {
        const res = await fetch("/api/assist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
          signal: abort.signal,
        })

        if (!res.ok) {
          const err = await res.json()
          const errorMsg =
            err.message ?? err.error ?? "Something went wrong"

          // Update assistant message with error
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessage.id
                ? { ...m, content: errorMsg, isStreaming: false }
                : m
            )
          )
          options.onError?.(err.error ?? "error")
          setIsLoading(false)
          return
        }

        const reader = res.body?.getReader()
        if (!reader) throw new Error("No response body")

        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const jsonStr = line.slice(6)

            try {
              const data = JSON.parse(jsonStr)

              switch (data.type) {
                case "text":
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? { ...m, content: m.content + data.content }
                        : m
                    )
                  )
                  break

                case "tool_call":
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            toolCalls: [
                              ...(m.toolCalls ?? []),
                              {
                                tool: data.tool,
                                input: data.input,
                                tool_use_id: data.tool_use_id,
                                status: "running" as const,
                              },
                            ],
                          }
                        : m
                    )
                  )
                  break

                case "tool_result":
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            toolCalls: m.toolCalls?.map((tc) =>
                              tc.tool_use_id === data.tool_use_id
                                ? {
                                    ...tc,
                                    result: data.result,
                                    status: "done" as const,
                                  }
                                : tc
                            ),
                          }
                        : m
                    )
                  )
                  break

                case "tool_status":
                  if (data.status === "denied") {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantMessage.id
                          ? {
                              ...m,
                              toolCalls: m.toolCalls?.map((tc) =>
                                tc.tool === data.tool
                                  ? { ...tc, status: "denied" as const }
                                  : tc
                              ),
                            }
                          : m
                      )
                    )
                  }
                  break

                case "done":
                  if (data.remaining !== undefined) {
                    setRemaining(data.remaining)
                  }
                  break

                case "error":
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            content:
                              m.content +
                              "\n\nSorry, something went wrong. Please try again.",
                          }
                        : m
                    )
                  )
                  break
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }

        // Mark streaming complete
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, isStreaming: false }
              : m
          )
        )
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessage.id
                ? {
                    ...m,
                    content: "Sorry, I couldn't connect. Please try again.",
                    isStreaming: false,
                  }
                : m
            )
          )
        }
      } finally {
        setIsLoading(false)
        abortRef.current = null
      }
    },
    [messages, isLoading, options]
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setIsLoading(false)
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
    )
  }, [])

  const clear = useCallback(() => {
    setMessages([])
    setRemaining(null)
  }, [])

  return { messages, isLoading, remaining, sendMessage, stop, clear }
}
