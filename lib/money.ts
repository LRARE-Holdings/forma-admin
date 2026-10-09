import { createClient } from "@/lib/supabase/server"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { ukMidnightISO } from "@/lib/utils"
import { addDays } from "@/lib/member-activity"

// Money figures come from the local Stripe ledger (migration 18), never from
// booking counts × list prices. Reads go through the signed-in user's client,
// so RLS limits them to owners and admins.

export interface LedgerSummary {
  from: string
  to: string
  currency: string
  gross_sales: number
  refunds: number
  card_fees: number
  net_sales: number
  payouts: number
  payout_fees: number
  other: number
  other_types: Record<string, number>
  opening_balance: number
  closing_balance: number
  by_type: Array<{ sale_type: string; gross: number; sales: number; refunded: number; refunds: number }>
  last_synced_at: string | null
}

/** Sale types as an accountant would read them, in display order. */
export const SALE_CATEGORIES: Array<{ key: string; label: string; types: string[] }> = [
  // A waitlist claim is a drop-in paid for when a place came free.
  { key: "drop_in", label: "Drop-in classes", types: ["drop_in_class", "waitlist_claim"] },
  { key: "packs", label: "Class packs", types: ["pack_tier"] },
  { key: "memberships", label: "Memberships", types: ["membership"] },
  { key: "events", label: "Event tickets", types: ["event_ticket"] },
  { key: "other", label: "Other sales", types: ["other"] },
]

export function categoryOf(saleType: string | null): { key: string; label: string } {
  const c = SALE_CATEGORIES.find((c) => c.types.includes(saleType ?? "other"))
  return c ?? SALE_CATEGORIES[SALE_CATEGORIES.length - 1]
}

export async function getLedgerSummary(studioId: string, from: string, to: string): Promise<LedgerSummary> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("stripe_ledger_summary", {
    p_studio_id: studioId,
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(error.message)
  return data as LedgerSummary
}

/** Group by_type into the display categories. */
export function salesByCategory(summary: LedgerSummary) {
  return SALE_CATEGORIES.map((c) => {
    const rows = summary.by_type.filter((r) => c.types.includes(r.sale_type))
    return {
      ...c,
      gross: rows.reduce((s, r) => s + r.gross, 0),
      sales: rows.reduce((s, r) => s + r.sales, 0),
      refunded: rows.reduce((s, r) => s + r.refunded, 0),
      refunds: rows.reduce((s, r) => s + r.refunds, 0),
    }
  }).filter((c) => c.sales > 0 || c.refunds > 0)
}

export interface PayoutRow {
  id: string
  createdAt: string
  arrivalDate: string
  amount: number
  fee: number
  method: string
  status: string
  automatic: boolean
}

/** Payouts made in [from, to] (UK dates), newest first, with their fee. */
export async function getPayouts(studioId: string, from: string, to: string): Promise<PayoutRow[]> {
  const supabase = await createClient()
  const payouts = await fetchAllRows((rf, rt) =>
    supabase
      .from("stripe_payouts")
      .select("id, created_at, arrival_date, amount, method, status, automatic, balance_transaction_id")
      .eq("studio_id", studioId)
      .gte("created_at", ukMidnightISO(from))
      .lt("created_at", ukMidnightISO(addDays(to, 1)))
      .order("created_at", { ascending: false })
      .order("id")
      .range(rf, rt),
  )

  const txnIds = payouts.map((p) => p.balance_transaction_id as string | null).filter(Boolean) as string[]
  const fees = new Map<string, number>()
  for (let i = 0; i < txnIds.length; i += 200) {
    const { data, error } = await supabase
      .from("stripe_balance_transactions")
      .select("id, fee")
      .in("id", txnIds.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const t of data ?? []) fees.set(t.id as string, t.fee as number)
  }

  return payouts.map((p) => ({
    id: p.id as string,
    createdAt: p.created_at as string,
    arrivalDate: p.arrival_date as string,
    amount: p.amount as number,
    fee: fees.get(p.balance_transaction_id as string) ?? 0,
    method: p.method as string,
    status: p.status as string,
    automatic: p.automatic as boolean,
  }))
}

/** The credit ledger (credit_transactions) starts here; balances before it can't be rebuilt. */
export const CREDIT_LEDGER_START = "2026-09-21"

export interface UnusedCredits {
  asOf: string
  supported: boolean
  packs: number
  credits: number
  /** What members paid for those credits, pro rata per credit. */
  valuePence: number
  /** Credits on packs with no known price (e.g. migrated or gifted packs). */
  unpricedCredits: number
}

/**
 * Credits bought but not yet used at the end of `asOf` (UK), on packs not
 * yet expired. Paid for but not yet delivered, which an accountant may treat
 * as deferred income.
 *
 * A pack's balance at that moment is the balance_after of its last ledger
 * entry up to then; failing that, the balance just before its first later
 * entry; failing that (no activity since), its current balance.
 */
export async function getUnusedPackCredits(studioId: string, asOf: string): Promise<UnusedCredits> {
  const empty = { asOf, packs: 0, credits: 0, valuePence: 0, unpricedCredits: 0 }
  if (asOf < CREDIT_LEDGER_START) return { ...empty, supported: false }

  const supabase = await createClient()
  const cutoff = ukMidnightISO(addDays(asOf, 1))

  const [packs, ledger, tiers, sales] = await Promise.all([
    fetchAllRows((rf, rt) =>
      supabase
        .from("class_packs")
        .select("id, credits_total, credits_remaining, purchased_at, expires_at, stripe_session_id, pack_tier_id")
        .eq("studio_id", studioId)
        .lt("purchased_at", cutoff)
        .gte("expires_at", cutoff)
        .order("id")
        .range(rf, rt),
    ),
    fetchAllRows((rf, rt) =>
      supabase
        .from("credit_transactions")
        .select("class_pack_id, delta, balance_after, created_at")
        .eq("studio_id", studioId)
        .not("class_pack_id", "is", null)
        .order("created_at")
        .order("id")
        .range(rf, rt),
    ),
    supabase.from("pack_tiers").select("id, price_pence, credits").eq("studio_id", studioId),
    fetchAllRows((rf, rt) =>
      supabase
        .from("stripe_balance_transactions")
        .select("payment_intent_id, amount")
        .eq("studio_id", studioId)
        .eq("sale_type", "pack_tier")
        .in("type", ["charge", "payment"])
        .order("id")
        .range(rf, rt),
    ),
  ])

  const byPack = new Map<string, Array<{ delta: number; balance_after: number; created_at: string }>>()
  for (const t of ledger) {
    const list = byPack.get(t.class_pack_id as string) ?? []
    list.push(t as { delta: number; balance_after: number; created_at: string })
    byPack.set(t.class_pack_id as string, list)
  }
  const paidByIntent = new Map(sales.map((s) => [s.payment_intent_id as string, s.amount as number]))
  const tierPrice = new Map((tiers.data ?? []).map((t) => [t.id as string, t.price_pence as number]))

  const out = { ...empty, supported: true }
  for (const p of packs) {
    const entries = byPack.get(p.id as string) ?? []
    const before = entries.filter((e) => e.created_at < cutoff)
    const after = entries.find((e) => e.created_at >= cutoff)
    const balance = before.length > 0
      ? before[before.length - 1].balance_after
      : after
        ? after.balance_after - after.delta
        : (p.credits_remaining as number)
    if (balance <= 0) continue

    out.packs++
    out.credits += balance
    const paid = paidByIntent.get(p.stripe_session_id as string)
      ?? (p.pack_tier_id ? tierPrice.get(p.pack_tier_id as string) : undefined)
    const total = p.credits_total as number
    if (paid !== undefined && total > 0) out.valuePence += Math.round((paid * balance) / total)
    else out.unpricedCredits += balance
  }
  return out
}

export interface LedgerLine {
  id: string
  createdAt: string
  type: string
  saleType: string | null
  amount: number
  fee: number
  net: number
  description: string | null
  paymentIntentId: string | null
  payoutId: string | null
  member: string | null
  item: string | null
}

/**
 * Every balance transaction in [from, to] for the CSV, oldest first, with the
 * member and what they bought where we can find them. Instant-payout advance
 * lines are left out: they net to zero and only confuse a reader.
 */
export async function getLedgerLines(studioId: string, from: string, to: string): Promise<LedgerLine[]> {
  const supabase = await createClient()
  const rows = await fetchAllRows((rf, rt) =>
    supabase
      .from("stripe_balance_transactions")
      .select("id, created_at, type, sale_type, amount, fee, net, description, payment_intent_id, payout_id, metadata")
      .eq("studio_id", studioId)
      .gte("created_at", ukMidnightISO(from))
      .lt("created_at", ukMidnightISO(addDays(to, 1)))
      .not("type", "in", "(advance,advance_funding)")
      .order("created_at")
      .order("id")
      .range(rf, rt),
  )

  const meta = (r: Record<string, unknown>) => (r.metadata ?? {}) as Record<string, string>
  const profileIds = [...new Set(rows.map((r) => meta(r).profile_id).filter(Boolean))]
  const scheduleIds = [...new Set(rows.map((r) => meta(r).schedule_id).filter(Boolean))]
  const tierIds = [...new Set(rows.map((r) => meta(r).pack_tier_id).filter(Boolean))]
  const ticketIds = [...new Set(rows.map((r) => meta(r).event_ticket_id).filter(Boolean))]

  const inChunks = async <T,>(ids: string[], q: (chunk: string[]) => PromiseLike<{ data: T[] | null }>) => {
    const out: T[] = []
    for (let i = 0; i < ids.length; i += 200) out.push(...((await q(ids.slice(i, i + 200))).data ?? []))
    return out
  }

  const [profiles, schedules, tiers, tickets] = await Promise.all([
    inChunks(profileIds, (c) => supabase.from("profiles").select("id, full_name").in("id", c)),
    inChunks(scheduleIds, (c) => supabase.from("schedule").select("id, start_time, classes:class_id(name)").in("id", c)),
    inChunks(tierIds, (c) => supabase.from("pack_tiers").select("id, name").in("id", c)),
    inChunks(ticketIds, (c) => supabase.from("event_tickets").select("id, events:event_id(title)").in("id", c)),
  ])
  const name = new Map(profiles.map((p) => [p.id as string, p.full_name as string | null]))
  const slot = new Map(schedules.map((s) => [s.id as string, s as unknown as { start_time: string; classes: { name: string } | null }]))
  const tier = new Map(tiers.map((t) => [t.id as string, t.name as string]))
  const ticket = new Map(tickets.map((t) => [t.id as string, (t as unknown as { events: { title: string } | null }).events?.title ?? null]))

  return rows.map((r) => {
    const m = meta(r)
    let item: string | null = null
    if (m.schedule_id) {
      const s = slot.get(m.schedule_id)
      item = `${s?.classes?.name ?? "Class (since removed)"}${m.date ? `, ${m.date}` : ""}${s?.start_time ? ` ${s.start_time.slice(0, 5)}` : ""}`
    } else if (m.pack_tier_id) {
      item = tier.get(m.pack_tier_id) ?? "Class pack"
    } else if (m.event_ticket_id) {
      item = ticket.get(m.event_ticket_id) ?? "Event ticket"
    }
    return {
      id: r.id as string,
      createdAt: r.created_at as string,
      type: r.type as string,
      saleType: r.sale_type as string | null,
      amount: r.amount as number,
      fee: r.fee as number,
      net: r.net as number,
      description: r.description as string | null,
      paymentIntentId: r.payment_intent_id as string | null,
      payoutId: r.payout_id as string | null,
      member: m.profile_id ? name.get(m.profile_id) ?? null : null,
      item,
    }
  })
}

/**
 * Card sales (before fees and refunds) per Monday–Sunday UK week, for weeks
 * starting on each of `mondays`.
 */
export async function getWeeklySales(studioId: string, mondays: string[]): Promise<Array<{ monday: string; gross: number }>> {
  if (mondays.length === 0) return []
  const supabase = await createClient()
  const rows = await fetchAllRows((rf, rt) =>
    supabase
      .from("stripe_balance_transactions")
      .select("created_at, amount")
      .eq("studio_id", studioId)
      .in("type", ["charge", "payment"])
      .gte("created_at", ukMidnightISO(mondays[0]))
      .lt("created_at", ukMidnightISO(addDays(mondays[mondays.length - 1], 7)))
      .order("id")
      .range(rf, rt),
  )
  const totals = new Map(mondays.map((m) => [m, 0]))
  for (const r of rows) {
    const day = new Date(r.created_at as string).toLocaleDateString("en-CA", { timeZone: "Europe/London" })
    // The latest Monday on or before the sale's UK date
    const monday = [...mondays].reverse().find((m) => m <= day)
    if (monday) totals.set(monday, totals.get(monday)! + (r.amount as number))
  }
  return mondays.map((m) => ({ monday: m, gross: totals.get(m)! }))
}
