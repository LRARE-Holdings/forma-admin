"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { getStudioStripeAccount } from "@/lib/stripe/account"
import {
  createStripeProduct,
  createStripePrice,
  updateStripeProduct,
  archiveStripePrice,
  archiveStripeProduct,
} from "@/lib/stripe/products"
import { ukWallClockToIso } from "@/lib/events"
import {
  cancelAndRefundTicket,
  cancelEventAndRefundAll,
  offerWaitlistPlaces,
} from "@/lib/event-tickets"

const PHOTOS_BUCKET = "photos"
const EVENT_IMAGE_DIR = "events/"
const EVENT_IMAGE_URL_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PHOTOS_BUCKET}/${EVENT_IMAGE_DIR}`

const MAX_CAPACITY = 1000
const MAX_PER_MEMBER = 20

type ActionResult = { error: string } | undefined

type EventFields = {
  title: string
  description: string
  event_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
  image_url: string | null
  link_url: string | null
  link_label: string | null
  is_published: boolean
  tickets_enabled: boolean
  price_pence: number
  capacity: number | null
  max_tickets_per_member: number
  sales_open_at: string | null
}

function optional(formData: FormData, key: string): string | null {
  const value = ((formData.get(key) as string | null) ?? "").trim()
  return value === "" ? null : value
}

/**
 * Reads and validates the event form. Returns a message rather than throwing so
 * the admin sees what to fix — the DB constraints are the backstop, not the UX.
 */
function parseEventForm(formData: FormData): EventFields | { error: string } {
  const title = ((formData.get("title") as string | null) ?? "").trim()
  const description = ((formData.get("description") as string | null) ?? "").trim()
  const event_date = optional(formData, "event_date")
  const start_time = optional(formData, "start_time")
  const end_time = optional(formData, "end_time")
  const link_url = optional(formData, "link_url")
  const image_url = optional(formData, "image_url")
  const tickets_enabled = formData.get("tickets_enabled") === "on"

  if (!title) return { error: "Give the event a title." }
  if (title.length > 120) return { error: "Keep the title under 120 characters." }
  if (!event_date || !/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
    return { error: "Pick a date for the event." }
  }
  if (end_time && !start_time) return { error: "Add a start time, or clear the end time." }
  if (start_time && end_time && end_time <= start_time) {
    return { error: "The end time must be after the start time." }
  }
  if (link_url && !/^https?:\/\//i.test(link_url)) {
    return { error: "The link must start with https://" }
  }
  // Only images this dashboard uploaded — the public site renders whatever is here.
  if (image_url && !image_url.startsWith(EVENT_IMAGE_URL_PREFIX)) {
    return { error: "That image could not be used. Try uploading it again." }
  }

  const base = {
    title,
    description,
    event_date,
    start_time,
    end_time,
    location: optional(formData, "location"),
    image_url,
    link_url: tickets_enabled ? null : link_url,
    link_label: !tickets_enabled && link_url ? optional(formData, "link_label") : null,
    is_published: formData.get("is_published") === "on",
  }

  if (!tickets_enabled) {
    return {
      ...base,
      tickets_enabled: false,
      price_pence: 0,
      capacity: null,
      max_tickets_per_member: 1,
      sales_open_at: null,
    }
  }

  const price = parseFloat((formData.get("price") as string | null) ?? "")
  const capacity = parseInt((formData.get("capacity") as string | null) ?? "", 10)
  const maxPerMember = parseInt((formData.get("max_tickets_per_member") as string | null) ?? "", 10)

  if (!Number.isFinite(price) || price < 0.3) {
    return { error: "Set a ticket price of at least £0.30 (Stripe's minimum card payment)." }
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
    return { error: `Set how many places there are (1 to ${MAX_CAPACITY}).` }
  }
  if (!Number.isInteger(maxPerMember) || maxPerMember < 1 || maxPerMember > MAX_PER_MEMBER) {
    return { error: `Set how many tickets one person can buy (1 to ${MAX_PER_MEMBER}).` }
  }
  if (maxPerMember > capacity) {
    return { error: "One person can't buy more tickets than there are places." }
  }

  let sales_open_at: string | null = null
  if (formData.get("sales_mode") === "scheduled") {
    const openDate = optional(formData, "sales_open_date")
    const openTime = optional(formData, "sales_open_time")
    if (!openDate || !openTime) {
      return { error: "Pick the date and time tickets go on sale." }
    }
    if (openDate > event_date) {
      return { error: "Tickets need to go on sale before the event." }
    }
    sales_open_at = ukWallClockToIso(openDate, openTime)
  }

  return {
    ...base,
    tickets_enabled: true,
    price_pence: Math.round(price * 100),
    capacity,
    max_tickets_per_member: maxPerMember,
    sales_open_at,
  }
}

/**
 * Best-effort: an orphaned image costs a little storage, never correctness, so a
 * failure here is logged and not surfaced. The service role is needed because
 * the photos bucket has no delete policy for signed-in users.
 */
async function removeEventImage(imageUrl: string | null) {
  if (!imageUrl?.startsWith(EVENT_IMAGE_URL_PREFIX)) return
  const path = EVENT_IMAGE_DIR + imageUrl.slice(EVENT_IMAGE_URL_PREFIX.length)
  const { error } = await createAdminClient().storage.from(PHOTOS_BUCKET).remove([path])
  if (error) console.error("Failed to remove event image:", error)
}

/**
 * Keep the event's Stripe Product and Price in step with its ticket price.
 * Checkout charges the amount from the database, so a sync failure is logged
 * and never blocks a save — the same trade-off classes make.
 */
async function syncEventToStripe(
  eventId: string,
  fields: EventFields,
  current: { stripe_product_id: string | null; stripe_price_id: string | null; price_pence: number } | null,
  stripeAccountId: string,
) {
  const supabase = await createClient()
  try {
    let productId = current?.stripe_product_id ?? null
    let priceId = current?.stripe_price_id ?? null

    if (productId) {
      await updateStripeProduct(productId, { name: fields.title, active: true }, stripeAccountId)
    } else {
      const product = await createStripeProduct(
        fields.title,
        { type: "event", forma_id: eventId },
        stripeAccountId,
      )
      productId = product.id
    }

    if (!priceId || current?.price_pence !== fields.price_pence) {
      if (priceId) await archiveStripePrice(priceId, stripeAccountId)
      const price = await createStripePrice(
        { productId, unitAmount: fields.price_pence, currency: "gbp" },
        stripeAccountId,
      )
      priceId = price.id
    }

    await supabase
      .from("events")
      .update({ stripe_product_id: productId, stripe_price_id: priceId })
      .eq("id", eventId)
  } catch (e) {
    console.error("Failed to sync event to Stripe:", e)
  }
}

export async function createEvent(formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const fields = parseEventForm(formData)
  if ("error" in fields) return fields

  const stripeAccountId = fields.tickets_enabled ? await getStudioStripeAccount() : null
  if (fields.tickets_enabled && !stripeAccountId) {
    return { error: "Connect Stripe in Settings before selling tickets." }
  }

  const { data: event, error } = await supabase
    .from("events")
    .insert({ studio_id: studioId, ...fields })
    .select("id")
    .single()
  if (error || !event) return { error: error?.message ?? "Failed to create event" }

  if (stripeAccountId) {
    await syncEventToStripe(event.id as string, fields, null, stripeAccountId)
  }

  revalidatePath("/dashboard/events")
}

export async function updateEvent(eventId: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const fields = parseEventForm(formData)
  if ("error" in fields) return fields

  const { data: current } = await supabase
    .from("events")
    .select("image_url, tickets_enabled, capacity, price_pence, stripe_product_id, stripe_price_id, cancelled_at")
    .eq("id", eventId)
    .eq("studio_id", studioId)
    .single()

  if (!current) return { error: "That event no longer exists." }
  if (current.cancelled_at) return { error: "This event has been cancelled and can't be edited." }

  const { data: sold } = await supabase
    .from("event_tickets")
    .select("quantity")
    .eq("event_id", eventId)
    .eq("status", "confirmed")
  const placesSold = (sold ?? []).reduce((sum, t) => sum + (t.quantity as number), 0)

  if (placesSold > 0 && !fields.tickets_enabled) {
    return { error: `${placesSold} ticket${placesSold === 1 ? " has" : "s have"} been sold. To stop the event, cancel it instead — that refunds everyone.` }
  }
  if (fields.capacity !== null && fields.capacity < placesSold) {
    return { error: `${placesSold} places are already sold, so the capacity can't go below that.` }
  }

  const stripeAccountId = fields.tickets_enabled ? await getStudioStripeAccount() : null
  if (fields.tickets_enabled && !stripeAccountId) {
    return { error: "Connect Stripe in Settings before selling tickets." }
  }

  const { error } = await supabase
    .from("events")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("studio_id", studioId)

  if (error) return { error: error.message }

  if (stripeAccountId) {
    await syncEventToStripe(
      eventId,
      fields,
      {
        stripe_product_id: current.stripe_product_id as string | null,
        stripe_price_id: current.stripe_price_id as string | null,
        price_pence: current.price_pence as number,
      },
      stripeAccountId,
    )
  }

  if (current.image_url && current.image_url !== fields.image_url) {
    await removeEventImage(current.image_url as string)
  }

  // More places may mean people on the waitlist can be offered one now.
  if (fields.tickets_enabled && (fields.capacity ?? 0) > ((current.capacity as number | null) ?? 0)) {
    await offerWaitlistPlaces(eventId)
  }

  revalidatePath("/dashboard/events")
  revalidatePath(`/dashboard/events/${eventId}`)
}

export async function deleteEvent(eventId: string): Promise<ActionResult> {
  await requireAdmin()
  const studioId = await getStudioId()
  const supabase = await createClient()

  // Anything that took money stays on record: cancel the event instead.
  const admin = createAdminClient()
  const { count: paid } = await admin
    .from("event_tickets")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .or("status.in.(confirmed,cancelled),stripe_payment_intent_id.not.is.null")
  if (paid) {
    return { error: "People have paid for this event, so it can't be deleted. Cancel it instead — that refunds everyone." }
  }

  // Abandoned checkouts (holds nobody paid for) have no record worth keeping.
  await admin.from("event_tickets").delete().eq("event_id", eventId)

  const { data: deleted, error } = await supabase
    .from("events")
    .delete()
    .eq("id", eventId)
    .eq("studio_id", studioId)
    .select("image_url, stripe_product_id, stripe_price_id")
    .maybeSingle()

  if (error) return { error: error.message }

  await removeEventImage((deleted?.image_url as string | null) ?? null)
  await archiveEventInStripe(deleted)

  revalidatePath("/dashboard/events")
}

async function archiveEventInStripe(
  event: { stripe_product_id?: unknown; stripe_price_id?: unknown } | null,
) {
  if (!event?.stripe_product_id) return
  const stripeAccountId = await getStudioStripeAccount()
  if (!stripeAccountId) return
  try {
    if (event.stripe_price_id) await archiveStripePrice(event.stripe_price_id as string, stripeAccountId)
    await archiveStripeProduct(event.stripe_product_id as string, stripeAccountId)
  } catch (e) {
    console.error("Failed to archive event in Stripe:", e)
  }
}

export async function cancelEvent(
  eventId: string,
): Promise<{ error: string } | { refunded: number; failed: number }> {
  await requireAdmin()
  const studioId = await getStudioId()

  const result = await cancelEventAndRefundAll(eventId, studioId)
  if ("error" in result) return result

  const { data: event } = await createAdminClient()
    .from("events")
    .select("stripe_product_id, stripe_price_id")
    .eq("id", eventId)
    .single()
  await archiveEventInStripe(event)

  revalidatePath("/dashboard/events")
  revalidatePath(`/dashboard/events/${eventId}`)
  return result
}

export async function cancelTicket(
  ticketId: string,
): Promise<{ error: string } | { refundPence: number | null; refundFailed: boolean }> {
  await requireAdmin()
  const studioId = await getStudioId()

  const result = await cancelAndRefundTicket(ticketId, studioId)
  if ("error" in result) return result

  revalidatePath("/dashboard/events", "layout")
  return result
}
