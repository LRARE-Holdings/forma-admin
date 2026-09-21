/**
 * Set up the October 2026 promotion and the Beginner's Course.
 *
 *   npx tsx scripts/setup-october-products.ts --dry-run
 *   npx tsx scripts/setup-october-products.ts --apply
 *
 * Writes to the studio's connected Stripe account, which is a LIVE account.
 * Run it with --dry-run first and read what it says it will do.
 *
 * It is safe to run twice: the Beginner's Course is matched by name and updated
 * rather than duplicated, and re-applying a discount archives the previous
 * discounted Price before creating the new one.
 */

import { createClient } from "@supabase/supabase-js"
import Stripe from "stripe"
import { config } from "dotenv"
import { resolve } from "path"

config({ path: resolve(process.cwd(), ".env.local") })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const STUDIO_ID = process.env.NEXT_PUBLIC_STUDIO_ID
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !STUDIO_ID || !STRIPE_SECRET_KEY) {
  console.error("Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_STUDIO_ID, STRIPE_SECRET_KEY")
  process.exit(1)
}

const APPLY = process.argv.includes("--apply")

// --- The promotion ---
const DISCOUNT_PERCENT = 20
const DISCOUNT_STARTS_ON = "2026-10-01"
const DISCOUNT_ENDS_ON = "2026-10-31"

// --- The course ---
const COURSE_NAME = "Beginner's Course"
const COURSE_PRICE_PENCE = 5400
const COURSE_CREDITS = 12
const COURSE_VALIDITY_DAYS = 42
const COURSE_MAX_PER_WEEK = 2
/** Only beginner classes count. Everything else is excluded by slug. */
const BEGINNER_SLUGS = ["beginners-pilates"]

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const stripe = new Stripe(STRIPE_SECRET_KEY)

function money(pence: number) {
  return `£${(pence / 100).toFixed(2)}`
}

function log(action: string, detail: string) {
  console.log(`  ${APPLY ? "✓" : "·"} ${action.padEnd(22)} ${detail}`)
}

async function main() {
  console.log(
    APPLY
      ? "\nAPPLYING — this writes to the live Stripe account.\n"
      : "\nDRY RUN — nothing will be written. Re-run with --apply to commit.\n"
  )

  const { data: studio } = await supabase
    .from("studios")
    .select("name, stripe_account_id, stripe_onboarding_complete")
    .eq("id", STUDIO_ID)
    .single()

  if (!studio) throw new Error(`Studio ${STUDIO_ID} not found`)

  const stripeAccountId =
    studio.stripe_onboarding_complete && studio.stripe_account_id
      ? (studio.stripe_account_id as string)
      : null

  if (!stripeAccountId) {
    throw new Error(
      `${studio.name} has no connected Stripe account, so products cannot be synced.`
    )
  }

  const opts = { stripeAccount: stripeAccountId }
  console.log(`Studio: ${studio.name}`)
  console.log(`Stripe: ${stripeAccountId}\n`)

  // ---------------------------------------------------------------- discount
  console.log(`October promotion — ${DISCOUNT_PERCENT}% off individual classes`)
  console.log(`  ${DISCOUNT_STARTS_ON} to ${DISCOUNT_ENDS_ON}\n`)

  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, price_pence, stripe_product_id, discount_stripe_price_id")
    .eq("studio_id", STUDIO_ID)
    .order("name")

  for (const cls of classes ?? []) {
    const listPence = cls.price_pence as number
    const salePence = Math.round((listPence * (100 - DISCOUNT_PERCENT)) / 100)

    log(cls.name as string, `${money(listPence)} → ${money(salePence)}`)

    if (!APPLY) continue

    // Stripe Prices are immutable, so a changed discount means a fresh Price.
    if (cls.discount_stripe_price_id) {
      await stripe.prices.update(
        cls.discount_stripe_price_id as string,
        { active: false },
        opts
      )
    }

    let discountPriceId: string | null = null
    if (cls.stripe_product_id) {
      const price = await stripe.prices.create(
        {
          product: cls.stripe_product_id as string,
          unit_amount: salePence,
          currency: "gbp",
          nickname: `${DISCOUNT_PERCENT}% off — Oct 2026`,
          metadata: { type: "class_discount", forma_id: cls.id as string },
        },
        opts
      )
      discountPriceId = price.id
    }

    const { error } = await supabase
      .from("classes")
      .update({
        discount_percent: DISCOUNT_PERCENT,
        discount_starts_on: DISCOUNT_STARTS_ON,
        discount_ends_on: DISCOUNT_ENDS_ON,
        discount_stripe_price_id: discountPriceId,
      })
      .eq("id", cls.id)
      .eq("studio_id", STUDIO_ID)

    if (error) throw new Error(`${cls.name}: ${error.message}`)
  }

  // ------------------------------------------------------------------ course
  console.log(`\n${COURSE_NAME} — ${money(COURSE_PRICE_PENCE)}`)
  console.log(
    `  ${COURSE_CREDITS} credits · ${COURSE_VALIDITY_DAYS} days · max ${COURSE_MAX_PER_WEEK}/week\n`
  )

  // Re-read with slug, since the select above omitted it.
  const { data: allClasses } = await supabase
    .from("classes")
    .select("id, name, slug")
    .eq("studio_id", STUDIO_ID)

  const beginner = (allClasses ?? []).filter((c) =>
    BEGINNER_SLUGS.includes(c.slug as string)
  )
  const excluded = (allClasses ?? []).filter(
    (c) => !BEGINNER_SLUGS.includes(c.slug as string)
  )

  if (beginner.length === 0) {
    throw new Error(
      `No class matches ${BEGINNER_SLUGS.join(", ")}. Create the beginner class first.`
    )
  }

  log("Valid on", beginner.map((c) => c.name).join(", "))
  log("Excluded", `${excluded.length} other classes`)

  const { data: existing } = await supabase
    .from("pack_tiers")
    .select("id, stripe_product_id, stripe_price_id, price_pence")
    .eq("studio_id", STUDIO_ID)
    .eq("name", COURSE_NAME)
    .maybeSingle()

  log(existing ? "Tier exists" : "Tier is new", existing ? "will update" : "will create")

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to commit.\n")
    return
  }

  let tierId = existing?.id as string | undefined

  if (tierId) {
    const { error } = await supabase
      .from("pack_tiers")
      .update({
        credits: COURSE_CREDITS,
        price_pence: COURSE_PRICE_PENCE,
        validity_days: COURSE_VALIDITY_DAYS,
        max_per_week: COURSE_MAX_PER_WEEK,
        is_active: true,
      })
      .eq("id", tierId)
    if (error) throw new Error(error.message)
  } else {
    const { data: created, error } = await supabase
      .from("pack_tiers")
      .insert({
        studio_id: STUDIO_ID,
        name: COURSE_NAME,
        credits: COURSE_CREDITS,
        price_pence: COURSE_PRICE_PENCE,
        validity_days: COURSE_VALIDITY_DAYS,
        max_per_week: COURSE_MAX_PER_WEEK,
        is_active: true,
      })
      .select("id")
      .single()
    if (error || !created) throw new Error(error?.message ?? "insert failed")
    tierId = created.id as string
  }

  // Replace the exclusion set so re-running cannot accumulate duplicates.
  await supabase.from("pack_tier_excluded_classes").delete().eq("pack_tier_id", tierId)
  if (excluded.length > 0) {
    const { error } = await supabase
      .from("pack_tier_excluded_classes")
      .insert(excluded.map((c) => ({ pack_tier_id: tierId, class_id: c.id })))
    if (error) throw new Error(error.message)
  }

  // Stripe product + price
  let productId = existing?.stripe_product_id as string | undefined
  if (!productId) {
    const product = await stripe.products.create(
      {
        name: COURSE_NAME,
        description: `${COURSE_CREDITS} beginner classes over ${COURSE_VALIDITY_DAYS / 7} weeks, up to ${COURSE_MAX_PER_WEEK} a week`,
        metadata: {
          type: "pack_tier",
          forma_id: tierId!,
          credits: String(COURSE_CREDITS),
        },
      },
      opts
    )
    productId = product.id
    log("Stripe product", productId)
  } else {
    await stripe.products.update(productId, { name: COURSE_NAME }, opts)
    log("Stripe product", `${productId} (updated)`)
  }

  if (existing?.stripe_price_id && existing.price_pence !== COURSE_PRICE_PENCE) {
    await stripe.prices.update(existing.stripe_price_id as string, { active: false }, opts)
  }

  const needsPrice =
    !existing?.stripe_price_id || existing.price_pence !== COURSE_PRICE_PENCE

  let priceId = existing?.stripe_price_id as string | undefined
  if (needsPrice) {
    const price = await stripe.prices.create(
      { product: productId, unit_amount: COURSE_PRICE_PENCE, currency: "gbp" },
      opts
    )
    priceId = price.id
    log("Stripe price", `${priceId} — ${money(COURSE_PRICE_PENCE)}`)
  }

  const { error: linkError } = await supabase
    .from("pack_tiers")
    .update({ stripe_product_id: productId, stripe_price_id: priceId })
    .eq("id", tierId)

  if (linkError) throw new Error(linkError.message)

  console.log("\nDone.\n")
}

main().catch((err) => {
  console.error("\nFailed:", err instanceof Error ? err.message : err, "\n")
  process.exit(1)
})
