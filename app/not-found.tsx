import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream p-8">
      <h1 className="font-heading text-6xl font-bold text-cocoa">404</h1>
      <h2 className="font-heading text-xl font-semibold text-cocoa">
        Page not found
      </h2>
      <p className="max-w-md text-center text-sm text-warm-grey">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link href="/dashboard">
        <Button className="mt-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to dashboard
        </Button>
      </Link>
    </div>
  )
}
