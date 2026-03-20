"use client"

import { Sparkles, ArrowRight } from "lucide-react"

interface UpgradeGateProps {
  studioName: string
}

export function UpgradeGate({ studioName }: UpgradeGateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
      <div className="rounded-2xl bg-gradient-to-br from-gold/15 to-ember/10 p-5">
        <Sparkles className="h-10 w-10 text-gold" strokeWidth={1.5} />
      </div>

      <div>
        <h3 className="text-[1rem] font-semibold text-cocoa">
          Unlock Forma Assist
        </h3>
        <p className="mt-2 text-[0.8rem] leading-relaxed text-warm-grey">
          Forma Assist is your AI-powered studio assistant. Manage
          classes, bookings, members, and your timetable — all through
          conversation.
        </p>
        <p className="mt-3 text-[0.78rem] text-warm-grey">
          Available on <strong className="text-cocoa">Pro</strong> and{" "}
          <strong className="text-cocoa">Partner</strong> plans.
        </p>
      </div>

      <a
        href="https://useforma.co.uk/pricing"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-2 rounded-xl bg-gold px-5 py-2.5 text-[0.82rem] font-semibold uppercase tracking-wide text-cocoa transition-colors hover:bg-gold/90"
      >
        View Plans
        <ArrowRight className="h-4 w-4" strokeWidth={2} />
      </a>
    </div>
  )
}
