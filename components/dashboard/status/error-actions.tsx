"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { setErrorGroupStatus } from "@/app/actions/monitor"

/** Resolve / mute / reopen an error group, and copy its details to paste to Claude. */
export function ErrorActions({ fingerprint, state, report }: { fingerprint: string; state: string; report: string }) {
  const [pending, start] = useTransition()
  const set = (status: "resolved" | "muted" | "open", hours?: number, done?: string) =>
    start(async () => {
      const res = await setErrorGroupStatus(fingerprint, status, hours)
      if (res.ok) toast.success(done ?? "Saved")
      else toast.error(res.error)
    })
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap [&_button]:h-10 sm:[&_button]:h-8">
      {state === "resolved" || state === "muted" ? (
        <Button variant="outline" disabled={pending} onClick={() => set("open", undefined, "Opened again")}>Open again</Button>
      ) : (
        <>
          <Button disabled={pending} onClick={() => set("resolved", undefined, "Marked resolved. It reopens if it happens again.")}>Mark resolved</Button>
          <Button variant="outline" disabled={pending} onClick={() => set("muted", 24, "Muted for 24 hours")}>Mute 24h</Button>
          <Button variant="outline" disabled={pending} onClick={() => set("muted", 24 * 7, "Muted for a week")}>Mute a week</Button>
        </>
      )}
      <Button
        variant="outline"
        className="col-span-2 sm:col-span-1"
        onClick={() => navigator.clipboard.writeText(report).then(() => toast.success("Copied. Paste it to Claude."))}
      >
        Copy details for Claude
      </Button>
    </div>
  )
}
