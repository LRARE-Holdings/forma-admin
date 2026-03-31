import { stripe } from "@/lib/stripe"
import { getStudioStripeAccount } from "@/lib/stripe/account"

/**
 * Get total revenue for the current month from the studio's connected Stripe account.
 * Returns amount in pence. Returns 0 if Stripe is not connected.
 */
export async function getMonthlyRevenue(): Promise<{
  revenuePence: number
  stripeConnected: boolean
}> {
  const stripeAccountId = await getStudioStripeAccount()

  if (!stripeAccountId) {
    return { revenuePence: 0, stripeConnected: false }
  }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const createdGte = Math.floor(monthStart.getTime() / 1000)

  try {
    let revenuePence = 0
    let hasMore = true
    let startingAfter: string | undefined

    while (hasMore) {
      const transactions = await stripe.balanceTransactions.list(
        {
          created: { gte: createdGte },
          type: "charge",
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        },
        { stripeAccount: stripeAccountId }
      )

      for (const txn of transactions.data) {
        // net = amount after Stripe fees and refunds
        revenuePence += txn.net
      }

      hasMore = transactions.has_more
      if (transactions.data.length > 0) {
        startingAfter = transactions.data[transactions.data.length - 1].id
      }
    }

    return { revenuePence, stripeConnected: true }
  } catch (e) {
    console.error("Failed to fetch Stripe revenue:", e)
    return { revenuePence: 0, stripeConnected: true }
  }
}

/**
 * Get revenue for the same period of the previous month.
 * E.g. if today is March 27, returns revenue from Feb 1–27.
 * Used for month-over-month comparison on the dashboard.
 */
export async function getPreviousMonthRevenue(): Promise<number> {
  const stripeAccountId = await getStudioStripeAccount()
  if (!stripeAccountId) return 0

  const now = new Date()
  const dayOfMonth = now.getDate()

  // Previous month start
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  // Same day offset in previous month (capped to last day of prev month)
  const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate()
  const prevMonthEnd = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    Math.min(dayOfMonth, prevMonthLastDay),
    23, 59, 59
  )

  const createdGte = Math.floor(prevMonthStart.getTime() / 1000)
  const createdLte = Math.floor(prevMonthEnd.getTime() / 1000)

  try {
    let revenuePence = 0
    let hasMore = true
    let startingAfter: string | undefined

    while (hasMore) {
      const transactions = await stripe.balanceTransactions.list(
        {
          created: { gte: createdGte, lte: createdLte },
          type: "charge",
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        },
        { stripeAccount: stripeAccountId }
      )

      for (const txn of transactions.data) {
        revenuePence += txn.net
      }

      hasMore = transactions.has_more
      if (transactions.data.length > 0) {
        startingAfter = transactions.data[transactions.data.length - 1].id
      }
    }

    return revenuePence
  } catch (e) {
    console.error("Failed to fetch previous month Stripe revenue:", e)
    return 0
  }
}
