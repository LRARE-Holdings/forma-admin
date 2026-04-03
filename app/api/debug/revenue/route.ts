import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { getStudioStripeAccount } from "@/lib/stripe/account"
import { localDateStr } from "@/lib/utils"

/**
 * DEBUG ONLY — lists all balance transactions for the current month
 * so we can see exactly what types exist and what's being summed.
 * Remove after debugging.
 */
export async function GET() {
  const stripeAccountId = await getStudioStripeAccount()
  if (!stripeAccountId) {
    return NextResponse.json({ error: "No Stripe account" }, { status: 400 })
  }

  const todayStr = localDateStr()
  const monthStartStr = todayStr.slice(0, 8) + "01"
  const monthStart = new Date(monthStartStr + "T00:00:00Z")
  const createdGte = Math.floor(monthStart.getTime() / 1000)

  const allTxns: Array<{
    id: string
    type: string
    amount: number
    fee: number
    net: number
    created: string
    description: string | null
    source: string | null
  }> = []

  let hasMore = true
  let startingAfter: string | undefined

  while (hasMore) {
    const transactions = await stripe.balanceTransactions.list(
      {
        created: { gte: createdGte },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: stripeAccountId }
    )

    for (const txn of transactions.data) {
      allTxns.push({
        id: txn.id,
        type: txn.type,
        amount: txn.amount,
        fee: txn.fee,
        net: txn.net,
        created: new Date(txn.created * 1000).toISOString(),
        description: txn.description,
        source: typeof txn.source === "string" ? txn.source : txn.source?.id ?? null,
      })
    }

    hasMore = transactions.has_more
    if (transactions.data.length > 0) {
      startingAfter = transactions.data[transactions.data.length - 1].id
    }
  }

  const chargeRefundTotal = allTxns
    .filter(t => t.type === "charge" || t.type === "refund")
    .reduce((sum, t) => sum + t.net, 0)

  const paymentTotal = allTxns
    .filter(t => t.type === "payment" || t.type === "payment_refund")
    .reduce((sum, t) => sum + t.net, 0)

  const allRevenueTotal = chargeRefundTotal + paymentTotal

  const allNetTotal = allTxns.reduce((sum, t) => sum + t.net, 0)

  return NextResponse.json({
    month: monthStartStr,
    transactionCount: allTxns.length,
    chargeRefundTotal: `£${(chargeRefundTotal / 100).toFixed(2)}`,
    paymentTotal: `£${(paymentTotal / 100).toFixed(2)}`,
    allRevenueTotal: `£${(allRevenueTotal / 100).toFixed(2)}`,
    allNetTotal: `£${(allNetTotal / 100).toFixed(2)}`,
    transactions: allTxns,
  })
}
