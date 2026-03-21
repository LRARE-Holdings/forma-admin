"use client"

import Link from "next/link"
import { X, Check, ArrowRight } from "lucide-react"
import { dismissOnboardingChecklist } from "@/app/actions/onboarding"
import { toast } from "sonner"

interface ChecklistItem {
  label: string
  href: string
  completed: boolean
}

interface OnboardingChecklistProps {
  items: ChecklistItem[]
}

export function OnboardingChecklist({ items }: OnboardingChecklistProps) {
  const completedCount = items.filter((i) => i.completed).length
  const allDone = completedCount === items.length
  const progress = (completedCount / items.length) * 100

  async function handleDismiss() {
    const result = await dismissOnboardingChecklist()
    if (result.error) {
      toast.error(result.error)
    }
  }

  if (allDone) return null

  return (
    <div className="mb-7 overflow-hidden rounded-2xl border border-gold/30 bg-white">
      <div className="flex items-center justify-between border-b border-sand px-5 py-4">
        <div>
          <h3 className="font-heading text-[1.05rem] font-semibold text-cocoa">
            Get your studio set up
          </h3>
          <p className="mt-0.5 text-[0.72rem] text-warm-grey">
            {completedCount} of {items.length} complete
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="flex h-7 w-7 items-center justify-center rounded-md text-warm-grey hover:bg-cream hover:text-cocoa"
          aria-label="Dismiss checklist"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full bg-sand/50">
        <div
          className="h-full bg-gold transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="divide-y divide-sand/40">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-cream/50"
          >
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                item.completed
                  ? "bg-success text-white"
                  : "border-2 border-sand bg-white"
              }`}
            >
              {item.completed && <Check className="h-3.5 w-3.5" />}
            </div>
            <span
              className={`flex-1 text-[0.82rem] font-medium ${
                item.completed ? "text-warm-grey line-through" : "text-cocoa"
              }`}
            >
              {item.label}
            </span>
            {!item.completed && (
              <ArrowRight className="h-4 w-4 text-gold" />
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
