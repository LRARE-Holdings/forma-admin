"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireReception, requireManager } from "@/lib/auth"
import { STUDIO_ID } from "@/lib/constants"

export async function createManualBooking(formData: FormData) {
  await requireReception()
  const supabase = await createClient()

  const profile_id = formData.get("profile_id") as string
  const schedule_id = formData.get("schedule_id") as string
  const date = formData.get("date") as string
  const payment_method = formData.get("payment_method") as string

  if (!profile_id || !schedule_id || !date || !payment_method) {
    throw new Error("All fields are required")
  }

  // If paying with pack credit, decrement the member's credits
  if (payment_method === "pack_credit") {
    const { data: packs } = await supabase
      .from("class_packs")
      .select("id, credits_remaining")
      .eq("studio_id", STUDIO_ID)
      .eq("profile_id", profile_id)
      .gt("credits_remaining", 0)
      .gte("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true })
      .limit(1)

    if (!packs || packs.length === 0) {
      throw new Error("This member has no available pack credits")
    }

    const pack = packs[0]
    const { error: creditError } = await supabase
      .from("class_packs")
      .update({ credits_remaining: pack.credits_remaining - 1 })
      .eq("id", pack.id)

    if (creditError) throw new Error(creditError.message)
  }

  const { error } = await supabase.from("bookings").insert({
    studio_id: STUDIO_ID,
    profile_id,
    schedule_id,
    date,
    status: "confirmed",
    payment_method,
  })

  if (error) throw new Error(error.message)
  revalidatePath("/dashboard/bookings")
  revalidatePath("/dashboard")
}

export async function cancelBooking(bookingId: string) {
  await requireManager()
  const supabase = await createClient()

  // Get the booking to check payment method
  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("studio_id", STUDIO_ID)
    .single()

  if (!booking) throw new Error("Booking not found")
  if (booking.status === "cancelled") throw new Error("Booking is already cancelled")

  // If was pack credit, refund the credit
  if (booking.payment_method === "pack_credit") {
    const { data: packs } = await supabase
      .from("class_packs")
      .select("id, credits_remaining, credits_total")
      .eq("studio_id", STUDIO_ID)
      .eq("profile_id", booking.profile_id)
      .order("expires_at", { ascending: true })
      .limit(1)

    if (packs && packs.length > 0) {
      const pack = packs[0]
      await supabase
        .from("class_packs")
        .update({
          credits_remaining: Math.min(
            pack.credits_remaining + 1,
            pack.credits_total
          ),
        })
        .eq("id", pack.id)
    }
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("studio_id", STUDIO_ID)

  if (error) throw new Error(error.message)
  revalidatePath("/dashboard/bookings")
  revalidatePath("/dashboard")
}
