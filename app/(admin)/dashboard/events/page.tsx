import { createClient } from "@/lib/supabase/server"
import { getStudioId } from "@/lib/studio-context"
import { requireAdmin } from "@/lib/auth"
import { localDateStr } from "@/lib/utils"
import { PageHeader } from "@/components/shared/page-header"
import { EventsTable } from "@/components/dashboard/events-table"
import { StripeConnectBanner } from "@/components/dashboard/stripe-connect-banner"
import type { StudioEvent } from "@/lib/types"

const PAST_EVENTS_SHOWN = 20

export default async function EventsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const studioId = await getStudioId()
  // An event stays upcoming for the whole of its day, matching the public site.
  const today = localDateStr()

  const [{ data: upcoming }, { data: past }, { data: studio }, { data: sold }] = await Promise.all([
    supabase
      .from("events")
      .select("*")
      .eq("studio_id", studioId)
      .gte("event_date", today)
      .order("event_date")
      .order("start_time", { nullsFirst: true }),
    supabase
      .from("events")
      .select("*")
      .eq("studio_id", studioId)
      .lt("event_date", today)
      .order("event_date", { ascending: false })
      .limit(PAST_EVENTS_SHOWN),
    supabase.from("studios").select("stripe_onboarding_complete").eq("id", studioId).single(),
    supabase
      .from("event_tickets")
      .select("event_id, quantity")
      .eq("studio_id", studioId)
      .eq("status", "confirmed"),
  ])

  const placesSold: Record<string, number> = {}
  for (const t of sold ?? []) {
    placesSold[t.event_id as string] = (placesSold[t.event_id as string] ?? 0) + (t.quantity as number)
  }
  const stripeConnected = !!studio?.stripe_onboarding_complete

  return (
    <>
      <PageHeader
        title="Events"
        description="Post workshops, socials and special classes. Upcoming events show on your website's home page."
      />
      <StripeConnectBanner isConnected={stripeConnected} />
      <EventsTable
        upcoming={(upcoming as StudioEvent[]) ?? []}
        past={(past as StudioEvent[]) ?? []}
        placesSold={placesSold}
        stripeConnected={stripeConnected}
      />
    </>
  )
}
