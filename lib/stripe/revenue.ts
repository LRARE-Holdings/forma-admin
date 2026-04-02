import { stripe } from "@/lib/stripe"
import { getStudioStripeAccount } from "@/lib/stripe/account"
import { localDateStr } from "@/lib/utils"

/**
 * Sum net revenue from a paginated list of balance transactions.
 * Only processes `charge` (positive) and `refund` (negative) types.
 */
async function sumBalanceTransactions(
  stripeAccountId: string,
  created: { gte: number; lte?: number },
): Promise<number> {
  let revenuePence = 0
  let hasMore = true
  let startingAfter: string | undefined

  while (hasMore) {
    const transactions = await stripe.balanceTransactions.list(
      {
        created,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: stripeAccountId }
    )

    for (const txn of transactions.data) {
      if (txn.type === "charge" || txn.type === "refund") {
        revenuePence += txn.net
      }
    }

    hasMore = transactions.has_more
    if (transactions.data.length > 0) {
      startingAfter = transactions.data[transactions.data.length - 1].id
    }
  }

  return revenuePence
}

/**
 * Get total revenue for the current month from the studio's connected Stripe account.
 * Includes charges and refunds so the net figure is accurate.
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

  const todayStr = localDateStr()
  const monthStartStr = todayStr.slice(0, 8) + "01"
  const monthStart = new Date(monthStartStr + "T00:00:00Z")
  const createdGte = Math.floor(monthStart.getTime() / 1000)

  try {
    const revenuePence = await sumBalanceTransactions(stripeAccountId, { gte: createdGte })
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

  const todayStr = localDateStr()
  const ukToday = new Date(todayStr + "T12:00:00Z")
  const dayOfMonth = ukToday.getDate()

  // Previous month start
  const prevMonthStart = new Date(ukToday.getFullYear(), ukToday.getMonth() - 1, 1)
  // Same day offset in previous month (capped to last day of prev month)
  const prevMonthLastDay = new Date(ukToday.getFullYear(), ukToday.getMonth(), 0).getDate()
  const prevMonthEnd = new Date(
    ukToday.getFullYear(),
    ukToday.getMonth() - 1,
    Math.min(dayOfMonth, prevMonthLastDay),
    23, 59, 59
  )

  const createdGte = Math.floor(prevMonthStart.getTime() / 1000)
  const createdLte = Math.floor(prevMonthEnd.getTime() / 1000)

  try {
    return await sumBalanceTransactions(stripeAccountId, { gte: createdGte, lte: createdLte })
  } catch (e) {
    console.error("Failed to fetch previous month Stripe revenue:", e)
    return 0
  }
}

/**
 * Get weekly revenue for the last 8 weeks from Stripe balance transactions.
 * Buckets charges and refunds into Mon–Sun weeks.
 */
export async function getWeeklyRevenue(): Promise<{
  weeklyData: { week: string; revenue: number }[]
  totalRevenue: number
  stripeConnected: boolean
}> {
  const stripeAccountId = await getStudioStripeAccount()

  if (!stripeAccountId) {
    return { weeklyData: [], totalRevenue: 0, stripeConnected: false }
  }

  const today = localDateStr()
  const ukToday = new Date(today + "T12:00:00Z")
  const jsDow = ukToday.getDay()
  const mondayOffset = jsDow === 0 ? -6 : 1 - jsDow
  const thisMonday = new Date(ukToday)
  thisMonday.setDate(ukToday.getDate() + mondayOffset)
  thisMonday.setHours(0, 0, 0, 0)

  const thisSunday = new Date(thisMonday)
  thisSunday.setDate(thisMonday.getDate() + 6)
  thisSunday.setHours(23, 59, 59, 999)

  const eightWeeksAgo = new Date(thisMonday)
  eightWeeksAgo.setDate(thisMonday.getDate() - 7 * 7) // 7 more weeks back

  const createdGte = Math.floor(eightWeeksAgo.getTime() / 1000)
  const createdLte = Math.floor(thisSunday.getTime() / 1000)

  // Build week keys for bucketing
  const weekMondays: Date[] = []
  for (let i = 7; i >= 0; i--) {
    const m = new Date(thisMonday)
    m.setDate(thisMonday.getDate() - i * 7)
    weekMondays.push(m)
  }

  const weekMap: Record<string, number> = {}
  for (const m of weekMondays) {
    weekMap[m.toISOString().slice(0, 10)] = 0
  }

  try {
    let hasMore = true
    let startingAfter: string | undefined

    while (hasMore) {
      const transactions = await stripe.balanceTransactions.list(
        {
          created: { gte: createdGte, lte: createdLte },
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        },
        { stripeAccount: stripeAccountId }
      )

      for (const txn of transactions.data) {
        if (txn.type !== "charge" && txn.type !== "refund") continue

        const txnDate = new Date(txn.created * 1000)
        const txnDow = txnDate.getDay()
        const txnMondayOffset = txnDow === 0 ? -6 : 1 - txnDow
        const txnMonday = new Date(txnDate)
        txnMonday.setDate(txnDate.getDate() + txnMondayOffset)
        const key = txnMonday.toISOString().slice(0, 10)

        if (key in weekMap) {
          weekMap[key] += txn.net
        }
      }

      hasMore = transactions.has_more
      if (transactions.data.length > 0) {
        startingAfter = transactions.data[transactions.data.length - 1].id
      }
    }

    const weeklyData = weekMondays.map((m) => {
      const key = m.toISOString().slice(0, 10)
      const label = m.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
      return { week: label, revenue: weekMap[key] }
    })

    const totalRevenue = weeklyData.reduce((sum, w) => sum + w.revenue, 0)

    return { weeklyData, totalRevenue, stripeConnected: true }
  } catch (e) {
    console.error("Failed to fetch weekly Stripe revenue:", e)
    return { weeklyData: [], totalRevenue: 0, stripeConnected: true }
  }
}
