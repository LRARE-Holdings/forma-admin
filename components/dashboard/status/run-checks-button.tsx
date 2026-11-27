"use client"

import { useTransition } from "react"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { runChecksNow } from "@/app/actions/monitor"

export function RunChecksButton() {
  const [pending, start] = useTransition()
  return (
    <Button
      variant="outline"
      className="h-10 flex-1 sm:h-8 sm:flex-none"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await runChecksNow()
          if (res.ok) toast.success(`Ran ${res.ran} checks`)
          else toast.error(res.error)
        })
      }
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {pending ? "Checking…" : "Check now"}
    </Button>
  )
}
