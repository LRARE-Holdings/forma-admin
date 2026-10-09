"use client"

import { Printer } from "lucide-react"

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex items-center gap-1.5 rounded-lg border border-sand px-3 py-1.5 text-[0.75rem] font-semibold text-warm-grey transition-colors hover:border-gold hover:text-cocoa print:hidden"
    >
      <Printer className="h-3.5 w-3.5" />
      Print summary
    </button>
  )
}
