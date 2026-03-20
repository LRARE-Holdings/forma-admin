import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { STUDIO_ID } from "@/lib/constants"
import { getUserRole, getInstructorForUser } from "@/lib/auth"
import { isPlanEligible } from "@/lib/assist/constants"
import { checkAndIncrementUsage } from "@/lib/assist/rate-limit"
import { getToolsForRole, isToolAllowed } from "@/lib/assist/permissions"
import { buildSystemPrompt } from "@/lib/assist/system-prompt"
import { getToolDefinitions, executeTool } from "@/lib/assist/tools"
import type { UserRole, Studio, Profile } from "@/lib/types"

const anthropic = new Anthropic()

export const maxDuration = 60

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    // Role check
    const role = await getUserRole()
    if (!role) {
      return NextResponse.json({ error: "No role found" }, { status: 403 })
    }

    // Get studio + profile
    const [studioRes, profileRes] = await Promise.all([
      supabase.from("studios").select("*").eq("id", STUDIO_ID).single(),
      supabase.from("profiles").select("*").eq("id", user.id).single(),
    ])

    const studio = studioRes.data as Studio
    const profile = profileRes.data as Profile

    if (!studio) {
      return NextResponse.json({ error: "Studio not found" }, { status: 404 })
    }

    // Plan gating
    if (!isPlanEligible(studio.plan_tier)) {
      return NextResponse.json(
        {
          error: "upgrade_required",
          message:
            "Forma Assist is available on Pro and Partner plans. Upgrade to unlock your AI studio assistant.",
        },
        { status: 403 }
      )
    }

    // Rate limiting
    const usage = await checkAndIncrementUsage(user.id, studio.plan_tier, role)
    if (!usage.allowed) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: `You've used all ${usage.limit} Assist requests for today. Your limit resets at midnight.`,
          limit: usage.limit,
          used: usage.used,
        },
        { status: 429 }
      )
    }

    // Parse body
    const body = await req.json()
    const messages: ChatMessage[] = body.messages ?? []

    if (!messages.length) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      )
    }

    // Get instructor if staff
    const instructor =
      role === "staff" ? await getInstructorForUser() : null

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      studio,
      profile,
      role,
      planTier: studio.plan_tier,
      instructor,
      remainingRequests: usage.remaining,
    })

    // Get allowed tools
    const allowedTools = getToolsForRole(role)
    const toolDefs = getToolDefinitions(allowedTools)

    // Build Anthropic messages
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    // Stream response with agentic tool loop
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          )
        }

        try {
          let currentMessages = [...anthropicMessages]
          let loopCount = 0
          const MAX_LOOPS = 10 // Safety limit on tool-use rounds

          while (loopCount < MAX_LOOPS) {
            loopCount++

            const response = await anthropic.messages.create({
              model: "claude-sonnet-4-5-20250929",
              max_tokens: 4096,
              system: systemPrompt,
              tools: toolDefs.length > 0 ? toolDefs : undefined,
              messages: currentMessages,
            })

            // Process content blocks
            let assistantText = ""
            const toolResults: Anthropic.ToolResultBlockParam[] = []
            let hasToolUse = false

            for (const block of response.content) {
              if (block.type === "text") {
                assistantText += block.text
                send({ type: "text", content: block.text })
              } else if (block.type === "tool_use") {
                hasToolUse = true

                // Check permission
                if (
                  !isToolAllowed(
                    role as UserRole,
                    block.name as Parameters<typeof isToolAllowed>[1]
                  )
                ) {
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: `Permission denied: you don't have access to ${block.name}.`,
                  })
                  send({
                    type: "tool_status",
                    tool: block.name,
                    status: "denied",
                  })
                  continue
                }

                // Notify frontend about tool call
                send({
                  type: "tool_call",
                  tool: block.name,
                  input: block.input,
                  tool_use_id: block.id,
                })

                // Execute tool
                const result = await executeTool(
                  block.name,
                  block.input as Record<string, unknown>,
                  { instructorId: instructor?.id ?? null }
                )

                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: result,
                })

                send({
                  type: "tool_result",
                  tool: block.name,
                  tool_use_id: block.id,
                  result,
                })
              }
            }

            // If no tool use, we're done
            if (!hasToolUse || response.stop_reason === "end_turn") {
              send({ type: "done", remaining: usage.remaining })
              break
            }

            // Continue the conversation with tool results
            currentMessages = [
              ...currentMessages,
              { role: "assistant" as const, content: response.content },
              {
                role: "user" as const,
                content: toolResults,
              },
            ]
          }

          if (loopCount >= MAX_LOOPS) {
            send({
              type: "text",
              content:
                "\n\nI've reached the maximum number of operations for this request. Please send a follow-up message if you need more help.",
            })
            send({ type: "done", remaining: usage.remaining })
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown error"
          send({ type: "error", content: message })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
