import { createClient } from "@/lib/supabase/server"
import { STUDIO_ID } from "@/lib/constants"
import { PageHeader } from "@/components/shared/page-header"
import { SettingsForm } from "@/components/dashboard/settings-form"
import { StripeConnectCard } from "@/components/dashboard/stripe-connect-card"

export default async function SettingsPage() {
  const supabase = await createClient()

  const { data: studio } = await supabase
    .from("studios")
    .select("*")
    .eq("id", STUDIO_ID)
    .single()

  if (!studio) {
    return <div>Studio not found</div>
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your studio profile and configuration."
      />
      <SettingsForm
        studio={{
          name: studio.name as string,
          slug: studio.slug as string,
          domain: (studio.domain as string) ?? null,
          email_from: (studio.email_from as string) ?? null,
          email_domain: (studio.email_domain as string) ?? null,
          plan_tier: studio.plan_tier as string,
          active: studio.active as boolean,
        }}
      />
      <div className="mt-6 max-w-2xl">
        <StripeConnectCard
          stripeAccountId={(studio.stripe_account_id as string) ?? null}
          onboardingComplete={studio.stripe_onboarding_complete as boolean}
        />
      </div>
    </>
  )
}
