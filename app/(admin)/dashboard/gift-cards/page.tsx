import { createClient } from "@/lib/supabase/server"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { getStudioId } from "@/lib/studio-context"
import { requireAdmin } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { GiftCardsTable, type GiftCardRow } from "@/components/dashboard/gift-cards-table"

type Person = { full_name: string | null; email: string | null } | null

/** When this page was rendered; cards past their claim date show as expired. */
const renderedAt = () => Date.now()

export default async function GiftCardsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const studioId = await getStudioId()

  // "pending" cards are checkouts that were never paid for; they're noise here.
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("gift_cards")
      .select(
        `id, code, credits, amount_pence, status, recipient_name, sender_name,
         recipient_email, send_on, paid_at, expires_at, buyer_emailed_at,
         recipient_emailed_at, redeemed_at,
         buyer:profiles!gift_cards_buyer_profile_id_fkey(full_name, email),
         claimer:profiles!gift_cards_redeemed_by_fkey(full_name, email)`,
      )
      .eq("studio_id", studioId)
      .in("status", ["paid", "redeemed", "refunded"])
      .order("paid_at", { ascending: false })
      .order("id")
      .range(from, to),
  )

  const one = (p: unknown): Person => (Array.isArray(p) ? (p[0] ?? null) : (p as Person))
  const cards: GiftCardRow[] = rows.map((r) => {
    const buyer = one(r.buyer)
    const claimer = one(r.claimer)
    return {
      id: r.id as string,
      code: r.code as string,
      credits: r.credits as number,
      amountPence: r.amount_pence as number,
      status: r.status as GiftCardRow["status"],
      recipientName: r.recipient_name as string,
      senderName: r.sender_name as string,
      recipientEmail: (r.recipient_email as string | null) ?? null,
      sendOn: (r.send_on as string | null) ?? null,
      paidAt: (r.paid_at as string | null) ?? null,
      expiresAt: (r.expires_at as string | null) ?? null,
      buyerEmailedAt: (r.buyer_emailed_at as string | null) ?? null,
      recipientEmailedAt: (r.recipient_emailed_at as string | null) ?? null,
      redeemedAt: (r.redeemed_at as string | null) ?? null,
      buyerName: buyer?.full_name ?? null,
      buyerEmail: buyer?.email ?? null,
      claimerName: claimer?.full_name ?? claimer?.email ?? null,
    }
  })

  return (
    <>
      <PageHeader
        title="Gift cards"
        description="Gift cards bought on your website. Look up a code, see who claimed it, or send the voucher again."
      />
      <GiftCardsTable cards={cards} now={renderedAt()} />
    </>
  )
}
