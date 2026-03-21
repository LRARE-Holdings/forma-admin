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
