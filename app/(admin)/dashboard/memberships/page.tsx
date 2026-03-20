import { createClient } from "@/lib/supabase/server"
import { STUDIO_ID } from "@/lib/constants"
import { PageHeader } from "@/components/shared/page-header"
import { MembershipTiersTable } from "@/components/dashboard/membership-tiers-table"
import { StripeConnectBanner } from "@/components/dashboard/stripe-connect-banner"

export default async function MembershipsPage() {
  const supabase = await createClient()

  const { data: studio } = await supabase
    .from("studios")
    .select("stripe_onboarding_complete")
    .eq("id", STUDIO_ID)
    .single()

  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("*")
    .eq("studio_id", STUDIO_ID)
    .order("price_pence", { ascending: true })

  const rows = (tiers ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    description: (t.description as string) ?? "",
    price_pence: t.price_pence as number,
    interval: t.interval as string,
    interval_count: t.interval_count as number,
    is_active: t.is_active as boolean,
  }))

  return (
    <>
      <PageHeader
        title="Memberships"
        description="Manage recurring membership tiers and pricing."
      />
      <StripeConnectBanner isConnected={!!studio?.stripe_onboarding_complete} />
      <MembershipTiersTable tiers={rows} />
    </>
  )
}
