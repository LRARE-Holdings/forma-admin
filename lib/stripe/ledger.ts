import type Stripe from "stripe"
import type { SupabaseClient } from "@supabase/supabase-js"
import { stripe } from "@/lib/stripe"

/**
 * Copies a connected account's balance transactions and payouts into
 * stripe_balance_transactions / stripe_payouts. Idempotent: rows are upserted
 * by Stripe ID, so re-running over the same window only refreshes them.
 *
 * Incremental runs re-read the last 14 days, which covers transactions moving
 * from pending to available (Burn Mat's payout delay is 3 days) and payouts
 * changing status after they're created.
 */
const OVERLAP_DAYS = 14
const UPSERT_BATCH = 500

export interface LedgerSyncResult {
  transactions: number
  payouts: number
  since: string | null
}

type Row = Record<string, unknown>

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null
  return typeof v === "string" ? v : v.id
}

function saleTypeOf(charge: Stripe.Charge): string | null {
  const t = charge.metadata?.type
  if (t) return t
  // Subscription renewals are created by Stripe, not our checkout, so they
  // carry no metadata; they come from an invoice instead.
  const invoice = (charge as unknown as { invoice?: unknown }).invoice
  return invoice ? "membership" : null
}

async function upsert(db: SupabaseClient, table: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + UPSERT_BATCH))
    if (error) throw new Error(`${table} upsert failed: ${error.message}`)
  }
}

async function latest(db: SupabaseClient, table: string, studioId: string): Promise<string | null> {
  const { data, error } = await db
    .from(table)
    .select("created_at")
    .eq("studio_id", studioId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`${table} read failed: ${error.message}`)
  return (data?.created_at as string | undefined) ?? null
}

/**
 * Sync one studio. `full` re-reads the account's whole history (the backfill);
 * otherwise it starts OVERLAP_DAYS before the newest row already stored.
 * `db` must be a service-role client: the tables have no write policies.
 */
export async function syncStripeLedger(
  db: SupabaseClient,
  studioId: string,
  stripeAccountId: string,
  { full = false }: { full?: boolean } = {},
): Promise<LedgerSyncResult> {
  const newest = full ? null : await latest(db, "stripe_balance_transactions", studioId)
  const gte = newest
    ? Math.floor(new Date(newest).getTime() / 1000) - OVERLAP_DAYS * 86400
    : undefined
  const created = gte !== undefined ? { gte } : undefined
  const opts = { stripeAccount: stripeAccountId }

  // Charges seen in this run, so a refund can take its sale's type without
  // another API call when both fall in the same window.
  const chargeInfo = new Map<string, { paymentIntentId: string | null; saleType: string | null }>()
  const refundsNeedingCharge: Row[] = []
  const txns: Row[] = []

  for await (const t of stripe.balanceTransactions.list(
    { limit: 100, ...(created ? { created } : {}), expand: ["data.source"] },
    opts,
  )) {
    const src = t.source as { object: string; id: string } | string | null
    const row: Row = {
      id: t.id,
      studio_id: studioId,
      type: t.type,
      reporting_category: t.reporting_category,
      amount: t.amount,
      fee: t.fee,
      net: t.net,
      currency: t.currency,
      status: t.status,
      created_at: new Date(t.created * 1000).toISOString(),
      available_on: new Date(t.available_on * 1000).toISOString(),
      description: t.description,
      source_id: idOf(src),
      charge_id: null,
      payment_intent_id: null,
      payout_id: null,
      sale_type: null,
      metadata: {},
      synced_at: new Date().toISOString(),
    }

    if (src && typeof src !== "string") {
      if (src.object === "charge") {
        const charge = src as unknown as Stripe.Charge
        row.charge_id = charge.id
        row.payment_intent_id = idOf(charge.payment_intent)
        row.sale_type = saleTypeOf(charge)
        row.metadata = charge.metadata ?? {}
        chargeInfo.set(charge.id, {
          paymentIntentId: row.payment_intent_id as string | null,
          saleType: row.sale_type as string | null,
        })
      } else if (src.object === "refund") {
        const refund = src as unknown as Stripe.Refund
        row.charge_id = idOf(refund.charge)
        row.payment_intent_id = idOf(refund.payment_intent)
        row.metadata = refund.metadata ?? {}
        refundsNeedingCharge.push(row)
      } else if (src.object === "payout") {
        row.payout_id = src.id
      }
    }
    // advance / advance_funding name their payout only in the description.
    if (!row.payout_id && (t.type === "advance" || t.type === "advance_funding")) {
      row.payout_id = t.description?.match(/\bpo_[A-Za-z0-9]+/)?.[0] ?? null
    }
    txns.push(row)
  }

  // Give each refund its sale's type: from this run, then from rows already
  // stored, then from Stripe as a last resort.
  const missing = refundsNeedingCharge.filter(
    (r) => r.charge_id && !chargeInfo.has(r.charge_id as string),
  )
  if (missing.length > 0) {
    const ids = [...new Set(missing.map((r) => r.charge_id as string))]
    const { data } = await db
      .from("stripe_balance_transactions")
      .select("charge_id, payment_intent_id, sale_type")
      .in("charge_id", ids)
      .in("type", ["charge", "payment"])
    for (const d of data ?? []) {
      chargeInfo.set(d.charge_id as string, {
        paymentIntentId: d.payment_intent_id as string | null,
        saleType: d.sale_type as string | null,
      })
    }
    for (const id of ids) {
      if (chargeInfo.has(id)) continue
      const charge = await stripe.charges.retrieve(id, opts)
      chargeInfo.set(id, { paymentIntentId: idOf(charge.payment_intent), saleType: saleTypeOf(charge) })
    }
  }
  for (const r of refundsNeedingCharge) {
    const info = r.charge_id ? chargeInfo.get(r.charge_id as string) : undefined
    if (!info) continue
    r.sale_type = info.saleType
    r.payment_intent_id ??= info.paymentIntentId
  }

  const payouts: Row[] = []
  for await (const p of stripe.payouts.list(
    { limit: 100, ...(created ? { created } : {}) },
    opts,
  )) {
    payouts.push({
      id: p.id,
      studio_id: studioId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      method: p.method,
      automatic: p.automatic,
      created_at: new Date(p.created * 1000).toISOString(),
      arrival_date: new Date(p.arrival_date * 1000).toISOString(),
      balance_transaction_id: idOf(p.balance_transaction as string | { id: string } | null),
      statement_descriptor: p.statement_descriptor,
      synced_at: new Date().toISOString(),
    })
  }

  await upsert(db, "stripe_balance_transactions", txns)
  await upsert(db, "stripe_payouts", payouts)

  return {
    transactions: txns.length,
    payouts: payouts.length,
    since: gte !== undefined ? new Date(gte * 1000).toISOString() : null,
  }
}
