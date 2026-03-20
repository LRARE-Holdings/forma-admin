"use client"

import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ember/10">
        <AlertTriangle className="h-7 w-7 text-ember" />
      </div>
      <h2 className="font-heading text-xl font-semibold text-cocoa">
        Something went wrong
      </h2>
      <p className="max-w-md text-center text-sm text-warm-grey">
        An error occurred while loading this page. Please try again or contact
        support if the problem persists.
      </p>
      <Button onClick={reset} className="mt-2">
        Try again
      </Button>
    </div>
  )
}
