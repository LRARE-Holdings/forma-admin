import { createClient } from "@/lib/supabase/server"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { getStudioId } from "@/lib/studio-context"
import { requireAdmin } from "@/lib/auth"
import { PageHeader } from "@/components/shared/page-header"
import { GiftCardsTable, type GiftCardRow } from "@/components/dashboard/gift-cards-table"
import { CreateGiftCardButton, type GiftOption } from "@/components/dashboard/create-gift-card-dialog"

type Person = { full_name: string | null; email: string | null } | null

/** When this page was rendered; cards past their claim date show as expired. */
const renderedAt = () => Date.now()

export default async function GiftCardsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const studioId = await getStudioId()

  // Pending cards are either unfinished website checkouts (noise, left out) or
  // ones Lucy set up for a customer and is waiting on payment for (shown).
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("gift_cards")
      .select(
        `id, code, credits, amount_pence, status, recipient_name, sender_name,
         recipient_email, send_on, paid_at, expires_at, buyer_emailed_at,
         recipient_emailed_at, redeemed_at, classes(name), buyer_name, buyer_email,
         buyer:profiles!gift_cards_buyer_profile_id_fkey(full_name, email),
         claimer:profiles!gift_cards_redeemed_by_fkey(full_name, email),
         requested_at, request_emailed_at`,
      )
      .eq("studio_id", studioId)
      .or("status.in.(paid,redeemed,refunded),and(status.eq.pending,requested_at.not.is.null)")
      .order("paid_at", { ascending: false, nullsFirst: true })
      .order("requested_at", { ascending: false })
      .order("id")
      .range(from, to),
  )

  const one = (p: unknown): Person => (Array.isArray(p) ? (p[0] ?? null) : (p as Person))
  const cards: GiftCardRow[] = rows.map((r) => {
    const buyer = one(r.buyer)
    const claimer = one(r.claimer)
    const cls = (Array.isArray(r.classes) ? r.classes[0] : r.classes) as { name: string } | null
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
      // A guest buyer has no account: use what they typed at checkout.
      buyerName: buyer?.full_name ?? (r.buyer_name as string | null) ?? null,
      buyerEmail: buyer?.email ?? (r.buyer_email as string | null) ?? null,
      claimerName: claimer?.full_name ?? claimer?.email ?? null,
      className: cls?.name ? cls.name.replace(/\s+/g, " ").trim() : null,
      requestedAt: (r.requested_at as string | null) ?? null,
      requestEmailedAt: (r.request_emailed_at as string | null) ?? null,
    }
  })

  // What Lucy can set up: the same cards, at the same prices, as the website.
  const [tiersRes, classesRes] = await Promise.all([
    supabase.from("gift_card_tiers").select("id, name, credits, price_pence, priced_by_class")
      .eq("studio_id", studioId).eq("is_active", true).order("credits"),
    supabase.from("classes").select("id, name, price_pence").eq("studio_id", studioId).order("name"),
  ])
  const options: GiftOption[] = (tiersRes.data ?? []).map((t) => ({
    id: t.id as string,
    credits: t.credits as number,
    pricePence: (t.price_pence as number | null) ?? null,
    pricedByClass: !!t.priced_by_class,
  }))
  const giftClasses = (classesRes.data ?? [])
    .filter((c) => c.price_pence)
    .map((c) => ({ id: c.id as string, name: String(c.name).replace(/\s+/g, " ").trim(), pricePence: c.price_pence as number }))

  return (
    <>
      <PageHeader
        title="Gift cards"
        description="Gift cards bought on your website or set up here. Look up a code, see who claimed it, or send the voucher again."
        action={options.length ? <CreateGiftCardButton options={options} classes={giftClasses} /> : undefined}
      />
      <GiftCardsTable cards={cards} now={renderedAt()} />
    </>
  )
}
