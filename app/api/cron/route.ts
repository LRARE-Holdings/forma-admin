import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createStripeProduct, createStripePrice } from "@/lib/stripe/products"
import { stripe } from "@/lib/stripe"
import { syncStripeLedger, type LedgerSyncResult } from "@/lib/stripe/ledger"
import { sendWeeklySummary } from "@/lib/email/weekly-summary"
import { localDateStr, ukDayOfWeek } from "@/lib/utils"
import type { BillingInterval } from "@/lib/types"

// Product sync, the ledger sync for every studio and, on Mondays, the weekly
// summary run one after another; give them the full five minutes.
export const maxDuration = 300

/**
 * GET /api/cron
 *
 * Daily cron (Vercel Hobby plan) — handles Stripe product/price sync and
 * copies each studio's Stripe transactions and payouts into the ledger tables.
 * On Mondays (UK) it also sends each studio's admins the weekly summary email.
 * Waitlist expiry runs separately via Supabase Edge Function + pg_cron (every 5 min).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminClient()
  let synced = 0
  let failed = 0

  try {
    const { data: studios } = await supabase
      .from("studios")
      .select("id, stripe_account_id")
      .eq("stripe_onboarding_complete", true)
      .not("stripe_account_id", "is", null)

    for (const studio of studios ?? []) {
      const stripeAccountId = studio.stripe_account_id as string

      try {
        const account = await stripe.accounts.retrieve(stripeAccountId)
        if (!account.charges_enabled) continue
      } catch {
        continue
      }

      // Pack tiers missing Stripe sync
      const { data: packTiers } = await supabase
        .from("pack_tiers")
        .select("id, name, credits, price_pence, stripe_product_id, stripe_price_id")
        .eq("studio_id", studio.id)
        .eq("is_active", true)
        .is("stripe_price_id", null)

      for (const tier of packTiers ?? []) {
        try {
          let productId = tier.stripe_product_id as string | null

          if (!productId) {
            const product = await createStripeProduct(
              tier.name,
              { type: "pack_tier", forma_id: tier.id, credits: String(tier.credits) },
              stripeAccountId,
            )
            productId = product.id
          }

          const price = await createStripePrice(
            { productId, unitAmount: tier.price_pence, currency: "gbp" },
            stripeAccountId,
          )

          await supabase
            .from("pack_tiers")
            .update({ stripe_product_id: productId, stripe_price_id: price.id })
            .eq("id", tier.id)

          synced++
        } catch (e) {
          console.error(`[cron] Failed to sync pack tier ${tier.id}:`, e)
          failed++
        }
      }

      // Classes missing Stripe sync
      const { data: classes } = await supabase
        .from("classes")
        .select("id, name, price_pence, stripe_product_id, stripe_price_id")
        .eq("studio_id", studio.id)
        .is("stripe_price_id", null)

      for (const cls of classes ?? []) {
        try {
          let productId = cls.stripe_product_id as string | null

          if (!productId) {
            const product = await createStripeProduct(
              cls.name,
              { type: "drop_in_class", forma_id: cls.id },
              stripeAccountId,
            )
            productId = product.id
          }

          const price = await createStripePrice(
            { productId, unitAmount: cls.price_pence, currency: "gbp" },
            stripeAccountId,
          )

          await supabase
            .from("classes")
            .update({ stripe_product_id: productId, stripe_price_id: price.id })
            .eq("id", cls.id)

          synced++
        } catch (e) {
          console.error(`[cron] Failed to sync class ${cls.id}:`, e)
          failed++
        }
      }

      // Membership tiers missing Stripe sync
      const { data: membershipTiers } = await supabase
        .from("membership_tiers")
        .select("id, name, price_pence, interval, interval_count, stripe_product_id, stripe_price_id")
        .eq("studio_id", studio.id)
        .eq("is_active", true)
        .is("stripe_price_id", null)

      for (const tier of membershipTiers ?? []) {
        try {
          let productId = tier.stripe_product_id as string | null

          if (!productId) {
            const product = await createStripeProduct(
              tier.name,
              { type: "membership", forma_id: tier.id },
              stripeAccountId,
            )
            productId = product.id
          }

          const price = await createStripePrice(
            {
              productId,
              unitAmount: tier.price_pence,
              currency: "gbp",
              recurring: {
                interval: tier.interval as BillingInterval,
                interval_count: tier.interval_count,
              },
            },
            stripeAccountId,
          )

          await supabase
            .from("membership_tiers")
            .update({ stripe_product_id: productId, stripe_price_id: price.id })
            .eq("id", tier.id)

          synced++
        } catch (e) {
          console.error(`[cron] Failed to sync membership tier ${tier.id}:`, e)
          failed++
        }
      }
    }

    console.log(`[cron] Stripe sync — Synced: ${synced}, Failed: ${failed}`)

    // Ledger copy runs for every connected studio, charges enabled or not:
    // refunds and payouts still happen on a paused account.
    const ledger: Record<string, LedgerSyncResult | { error: string }> = {}
    for (const studio of studios ?? []) {
      try {
        ledger[studio.id] = await syncStripeLedger(supabase, studio.id, studio.stripe_account_id as string)
      } catch (e) {
        console.error(`[cron] Ledger sync failed for studio ${studio.id}:`, e)
        ledger[studio.id] = { error: e instanceof Error ? e.message : String(e) }
      }
    }
    console.log("[cron] Ledger sync —", JSON.stringify(ledger))

    // Runs at 03:00 UTC, so 03:00 or 04:00 on Monday in the UK.
    const digest: Record<string, unknown> = {}
    if (ukDayOfWeek() === 0) {
      const { data: allStudios } = await supabase.from("studios").select("id").eq("active", true)
      for (const s of allStudios ?? []) {
        try {
          digest[s.id] = await sendWeeklySummary(s.id, localDateStr())
        } catch (e) {
          console.error(`[cron] Weekly summary failed for studio ${s.id}:`, e)
          digest[s.id] = { error: e instanceof Error ? e.message : String(e) }
        }
      }
      console.log("[cron] Weekly summary —", JSON.stringify(digest))
    }

    return NextResponse.json({ ok: true, synced, failed, ledger, digest })
  } catch (err) {
    console.error("[cron] Stripe sync error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
