"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Check, ExternalLink, Link2 } from "lucide-react"

/**
 * The shareable address of an event's public page, for Lucy's social posts
 * and for collaborators. Drafts have no public page, so they get a note
 * instead of a link.
 */
export function CopyEventLink({
  url,
  published,
  variant = "compact",
}: {
  url: string
  published: boolean
  variant?: "compact" | "full"
}) {
  const [copied, setCopied] = useState(false)

  if (!published) {
    return (
      <span className="text-[0.72rem] text-warm-grey">
        {variant === "full" ? "Publish this event to get a shareable link." : "Draft — no link yet"}
      </span>
    )
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success("Link copied")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually")
    }
  }

  if (variant === "full") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-sand bg-cream px-3 py-2 text-[0.75rem] text-cocoa">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cocoa px-3 py-2 text-[0.75rem] font-semibold text-wheat hover:bg-gold hover:text-cocoa"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-sand px-3 py-2 text-[0.75rem] font-semibold text-cocoa hover:border-gold"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          View
        </a>
      </div>
    )
  }

  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-cocoa hover:text-gold"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy link"}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-cocoa hover:text-gold"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        View
      </a>
    </span>
  )
}
