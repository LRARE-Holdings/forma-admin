"use client"

import { useState } from "react"
import { startStripeOnboarding, checkStripeStatus } from "@/app/actions/stripe-connect"
import { toast } from "sonner"

interface StripeConnectCardProps {
  stripeAccountId: string | null
  onboardingComplete: boolean
}

export function StripeConnectCard({
  stripeAccountId,
  onboardingComplete,
}: StripeConnectCardProps) {
  const [loading, setLoading] = useState(false)

  async function handleConnect() {
    setLoading(true)
    try {
      const { url } = await startStripeOnboarding()
      window.location.href = url
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start onboarding")
      setLoading(false)
    }
  }

  async function handleRefresh() {
    setLoading(true)
    try {
      const status = await checkStripeStatus()
      if (status.onboardingComplete) {
        toast.success("Stripe is fully connected")
      } else {
        toast.info("Onboarding is not yet complete. Redirecting...")
        const { url } = await startStripeOnboarding()
        window.location.href = url
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to check status")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-sand bg-white">
      <div className="border-b border-sand px-5 py-4">
        <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
          Payments
        </h3>
      </div>
      <div className="space-y-4 p-5">
        {!stripeAccountId && (
          <>
            <p className="text-[0.85rem] text-warm-grey">
              Connect a Stripe account to accept payments from your members. This lets
              them purchase class packs, drop-in sessions, and memberships directly from
              your website.
            </p>
            <button
              onClick={handleConnect}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-cocoa px-4 py-2.5 text-[0.8rem] font-semibold text-wheat transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Setting up..." : "Connect Stripe account"}
            </button>
          </>
        )}

        {stripeAccountId && !onboardingComplete && (
          <>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-gold" />
              <span className="text-[0.85rem] font-medium text-cocoa">
                Setup incomplete
              </span>
            </div>
            <p className="text-[0.85rem] text-warm-grey">
              Your Stripe account has been created but onboarding isn&apos;t finished.
              Complete the setup to start accepting payments.
            </p>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-cocoa px-4 py-2.5 text-[0.8rem] font-semibold text-wheat transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Checking..." : "Complete setup"}
            </button>
          </>
        )}

        {stripeAccountId && onboardingComplete && (
          <>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-success" />
              <span className="text-[0.85rem] font-medium text-cocoa">
                Stripe connected
              </span>
            </div>
            <p className="text-[0.85rem] text-warm-grey">
              Your Stripe account is active. Payments from your website will be deposited
              directly into your account. You can manage payouts, disputes, and fees from
              your own Stripe dashboard.
            </p>
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-sand/50 px-2.5 py-1 font-mono text-[0.75rem] text-warm-grey">
                {stripeAccountId}
              </span>
              <a
                href="https://dashboard.stripe.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[0.8rem] font-medium text-cocoa underline underline-offset-2 transition-opacity hover:opacity-70"
              >
                Open Stripe dashboard
              </a>
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="text-[0.8rem] font-medium text-warm-grey underline underline-offset-2 transition-opacity hover:opacity-70 disabled:opacity-50"
              >
                {loading ? "Checking..." : "Refresh status"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
