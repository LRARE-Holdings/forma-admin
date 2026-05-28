import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { PageHeader } from "@/components/shared/page-header"
import { PackTiersTable } from "@/components/dashboard/pack-tiers-table"
import { StripeConnectBanner } from "@/components/dashboard/stripe-connect-banner"

export default async function PackagesPage() {
  const supabase = await createClient()
  const studioId = await getStudioId()

  const { data: studio } = await supabase
    .from("studios")
    .select("stripe_onboarding_complete")
    .eq("id", studioId)
    .single()

  const { data: tiers } = await supabase
    .from("pack_tiers")
    .select("*")
    .eq("studio_id", studioId)
    .order("credits", { ascending: true })

  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, slug")
    .eq("studio_id", studioId)
    .order("name")

  const classRows = (classes ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    slug: c.slug as string,
  }))

  const tierIds = (tiers ?? []).map((t) => t.id as string)
  const exclusionsByTier: Record<string, string[]> = {}
  if (tierIds.length > 0) {
    const { data: exclusions } = await supabase
      .from("pack_tier_excluded_classes")
      .select("pack_tier_id, class_id")
      .in("pack_tier_id", tierIds)

    for (const row of exclusions ?? []) {
      const tierId = row.pack_tier_id as string
      if (!exclusionsByTier[tierId]) exclusionsByTier[tierId] = []
      exclusionsByTier[tierId].push(row.class_id as string)
    }
  }

  const rows = (tiers ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    credits: t.credits as number,
    price_pence: t.price_pence as number,
    validity_days: t.validity_days as number,
    is_active: t.is_active as boolean,
    excluded_class_ids: exclusionsByTier[t.id as string] ?? [],
  }))

  return (
    <>
      <PageHeader
        title="Packages"
        description="Manage class pack tiers and pricing."
      />
      <StripeConnectBanner isConnected={!!studio?.stripe_onboarding_complete} />
      <PackTiersTable tiers={rows} classes={classRows} />
    </>
  )
}
