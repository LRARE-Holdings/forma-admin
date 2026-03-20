import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { PageHeader } from "@/components/shared/page-header"
import { ClassesTable } from "@/components/dashboard/classes-table"
import { StripeConnectBanner } from "@/components/dashboard/stripe-connect-banner"

export default async function ClassesPage() {
  const supabase = await createClient()
  const studioId = await getStudioId()

  const { data: studio } = await supabase
    .from("studios")
    .select("stripe_onboarding_complete")
    .eq("id", studioId)
    .single()

  const { data: classes } = await supabase
    .from("classes")
    .select("*")
    .eq("studio_id", studioId)
    .order("name")

  // Count schedule slots per class
  const { data: scheduleSlots } = await supabase
    .from("schedule")
    .select("class_id")
    .eq("studio_id", studioId)
    .eq("is_active", true)

  const slotsByClass: Record<string, number> = {}
  for (const s of scheduleSlots ?? []) {
    slotsByClass[s.class_id] = (slotsByClass[s.class_id] ?? 0) + 1
  }

  const rows = (classes ?? []).map((cls) => ({
    id: cls.id as string,
    name: cls.name as string,
    slug: cls.slug as string,
    description: (cls.description as string) ?? "",
    duration_mins: cls.duration_mins as number,
    price_pence: cls.price_pence as number,
    capacity: (cls.capacity as number) ?? 10,
  }))

  return (
    <>
      <PageHeader
        title="Classes"
        description="Manage your class types and pricing."
      />
      <StripeConnectBanner isConnected={!!studio?.stripe_onboarding_complete} />
      <ClassesTable classes={rows} slotsByClass={slotsByClass} />
    </>
  )
}
