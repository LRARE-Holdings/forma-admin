import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { localDateStr } from "@/lib/utils"
import { resolvePeriod } from "@/lib/money-periods"
import { categoryOf, getAccountingSettings, getLedgerLines, getPayouts } from "@/lib/money"
import { renderStatement, statementLines, type StatementFormat } from "@/lib/accounting-export"

const TYPE_LABELS: Record<string, string> = {
  charge: "Sale",
  payment: "Sale",
  refund: "Refund",
  payment_refund: "Refund",
  payout: "Payout to bank",
  payout_cancel: "Payout cancelled",
  payout_failure: "Payout failed",
}

const pounds = (pence: number) => (pence / 100).toFixed(2)

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function ukDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" }) // YYYY-MM-DD
}

function ukTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })
}

const FORMATS: StatementFormat[] = ["csv", "xero", "quickbooks", "freeagent"]

/**
 * GET /dashboard/money/export?kind=transactions|payouts|statement&from=YYYY-MM-DD&to=YYYY-MM-DD
 * `statement` takes &format=xero|quickbooks|freeagent|csv.
 */
export async function GET(request: Request) {
  await requireAdmin()
  const studioId = await getStudioId()
  const url = new URL(request.url)
  const kindParam = url.searchParams.get("kind")
  const kind = kindParam === "payouts" || kindParam === "statement" ? kindParam : "transactions"
  const settings = await getAccountingSettings(studioId)
  const period = resolvePeriod(
    { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined },
    localDateStr(),
    settings.yearEnd,
  )

  if (kind === "statement") {
    const requested = url.searchParams.get("format") as StatementFormat | null
    const format = requested && FORMATS.includes(requested) ? requested : "csv"
    const lines = statementLines(await getLedgerLines(studioId, period.from, period.to))
    // FreeAgent wants no byte-order mark; the others are fine either way.
    const body = (format === "freeagent" ? "" : "\uFEFF") + renderStatement(lines, format)
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="stripe-statement-${format}-${period.from}-to-${period.to}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  }

  let header: string[]
  let rows: Array<Array<string | number | null>>

  if (kind === "payouts") {
    const payouts = await getPayouts(studioId, period.from, period.to)
    header = ["Requested (UK)", "Arrives", "Amount (GBP)", "Payout fee (GBP)", "Type", "Status", "Stripe payout ID"]
    rows = payouts
      .slice()
      .reverse()
      .map((p) => [
        `${ukDate(p.createdAt)} ${ukTime(p.createdAt)}`,
        ukDate(p.arrivalDate),
        pounds(p.amount),
        pounds(p.fee),
        `${p.method === "instant" ? "Instant" : "Standard"}${p.automatic ? "" : " (manual)"}`,
        p.status,
        p.id,
      ])
  } else {
    const lines = await getLedgerLines(studioId, period.from, period.to)
    header = [
      "Date (UK)",
      "Time",
      "Type",
      "Category",
      "Member",
      "Item",
      "Gross (GBP)",
      "Stripe fee (GBP)",
      "Net (GBP)",
      "Stripe transaction ID",
      "Payment ID",
      "Payout ID",
    ]
    rows = lines.map((l) => {
      const isSale = ["charge", "payment", "refund", "payment_refund"].includes(l.type)
      return [
        ukDate(l.createdAt),
        ukTime(l.createdAt),
        TYPE_LABELS[l.type] ?? l.description ?? l.type,
        isSale ? categoryOf(l.saleType).label : "",
        l.member,
        l.item,
        pounds(l.amount),
        pounds(l.fee),
        pounds(l.net),
        l.id,
        l.paymentIntentId,
        l.payoutId,
      ]
    })
  }

  // Byte-order mark so Excel opens £ and names correctly.
  const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
  const filename = `${kind}-${period.from}-to-${period.to}.csv`
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
