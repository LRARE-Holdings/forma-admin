import { createClient } from "@/lib/supabase/server"
import { STUDIO_ID } from "@/lib/constants"
import { PageHeader } from "@/components/shared/page-header"
import { PackTiersTable } from "@/components/dashboard/pack-tiers-table"
import { StripeConnectBanner } from "@/components/dashboard/stripe-connect-banner"

export default async function PackagesPage() {
  const supabase = await createClient()

  const { data: studio } = await supabase
    .from("studios")
    .select("stripe_onboarding_complete")
    .eq("id", STUDIO_ID)
    .single()

  const { data: tiers } = await supabase
    .from("pack_tiers")
    .select("*")
    .eq("studio_id", STUDIO_ID)
    .order("credits", { ascending: true })

  const rows = (tiers ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    credits: t.credits as number,
    price_pence: t.price_pence as number,
    validity_days: t.validity_days as number,
    is_active: t.is_active as boolean,
  }))

  return (
    <>
      <PageHeader
        title="Packages"
        description="Manage class pack tiers and pricing."
      />
      <StripeConnectBanner isConnected={!!studio?.stripe_onboarding_complete} />
      <PackTiersTable tiers={rows} />
    </>
  )
}
