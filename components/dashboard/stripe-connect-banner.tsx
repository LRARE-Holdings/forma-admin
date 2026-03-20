"use client"

import Link from "next/link"

interface StripeConnectBannerProps {
  isConnected: boolean
}

export function StripeConnectBanner({ isConnected }: StripeConnectBannerProps) {
  if (isConnected) return null

  return (
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-gold/30 bg-gold/5 px-4 py-3">
      <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-gold" />
      <p className="text-[0.8rem] text-cocoa">
        Products are saved locally but won&apos;t be purchasable online until you{" "}
        <Link
          href="/dashboard/settings"
          className="font-semibold text-gold underline underline-offset-2 hover:text-ember"
        >
          connect Stripe
        </Link>
        .
      </p>
    </div>
  )
}
