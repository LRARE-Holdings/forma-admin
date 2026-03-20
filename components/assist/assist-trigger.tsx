"use client"

import { useState } from "react"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { AssistPanel } from "./assist-panel"

interface AssistTriggerProps {
  studioName: string
  planTier: string
  userName: string
  /** "sidebar" for admin layout, "topbar" for staff layout */
  variant: "sidebar" | "topbar"
}

export function AssistTrigger({
  studioName,
  planTier,
  userName,
  variant,
}: AssistTriggerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {variant === "sidebar" ? (
        <button
          onClick={() => setOpen(true)}
          className={cn(
            "group mx-3 mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all",
            "bg-gradient-to-r from-gold/[0.12] to-ember/[0.08]",
            "border border-gold/20",
            "hover:from-gold/[0.20] hover:to-ember/[0.14] hover:border-gold/30",
            "hover:shadow-[0_0_16px_rgba(196,169,90,0.12)]"
          )}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-gold to-ember shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={2.2} />
          </div>
          <div className="flex-1 text-left">
            <span className="text-[0.8rem] font-semibold text-wheat">
              Assist
            </span>
            <span className="ml-1.5 rounded-full bg-gold/20 px-1.5 py-[1px] text-[0.55rem] font-bold uppercase tracking-wider text-gold">
              AI
            </span>
          </div>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 transition-all",
            "bg-gradient-to-r from-gold/20 to-ember/10",
            "border border-gold/25",
            "hover:from-gold/30 hover:to-ember/20 hover:border-gold/40"
          )}
        >
          <Sparkles className="h-3.5 w-3.5 text-gold" strokeWidth={2.2} />
          <span className="text-[0.75rem] font-semibold text-wheat">
            Assist
          </span>
        </button>
      )}

      <AssistPanel
        open={open}
        onClose={() => setOpen(false)}
        studioName={studioName}
        planTier={planTier}
        userName={userName}
      />
    </>
  )
}
