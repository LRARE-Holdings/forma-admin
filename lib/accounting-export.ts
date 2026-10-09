import { categoryOf, type LedgerLine } from "@/lib/money"

// The Stripe account as a bank statement, for importing into accounting
// software as its own "Stripe" bank account. Each sale, Stripe fee, refund,
// payout and instant-payout fee is one line, signed, so the lines add up to
// the change in the Stripe balance and each payout matches a line on the real
// bank account (a transfer between the two in the software).
//
// Not VAT-registered, so there are no VAT columns.

export type StatementFormat = "csv" | "xero" | "quickbooks" | "freeagent"

export interface StatementLine {
  date: string // YYYY-MM-DD, UK
  amount: number // pence, signed: money into Stripe positive
  payee: string
  description: string
  reference: string
}

function ukDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" })
}

export function statementLines(lines: LedgerLine[]): StatementLine[] {
  const out: StatementLine[] = []
  for (const l of lines) {
    const date = ukDate(l.createdAt)
    const what = [l.member, l.item].filter(Boolean).join(", ")
    const isSale = l.type === "charge" || l.type === "payment"
    const isRefund = l.type === "refund" || l.type === "payment_refund"
    const isPayout = l.type === "payout" || l.type === "payout_cancel" || l.type === "payout_failure"

    if (isSale || isRefund) {
      const category = categoryOf(l.saleType).label
      out.push({
        date,
        amount: l.amount,
        payee: l.member ?? "Stripe customer",
        // The member is the payee; the description says what was bought
        description: `${isRefund ? "Refund: " : ""}${category}${l.item ? ` - ${l.item}` : ""}`,
        reference: l.paymentIntentId ?? l.id,
      })
      if (l.fee !== 0) {
        out.push({
          date,
          amount: -l.fee,
          payee: "Stripe",
          description: `Stripe fee${what ? ` - ${what}` : ""}`,
          reference: l.id,
        })
      }
    } else if (isPayout) {
      out.push({
        date,
        amount: l.amount,
        payee: "Transfer to bank",
        description: l.type === "payout" ? "Stripe payout to bank" : `Stripe ${l.type.replace("_", " ")}`,
        reference: l.payoutId ?? l.id,
      })
      if (l.fee !== 0) {
        out.push({ date, amount: -l.fee, payee: "Stripe", description: "Instant payout fee", reference: l.payoutId ?? l.id })
      }
    } else {
      out.push({ date, amount: l.net, payee: "Stripe", description: l.description ?? l.type, reference: l.id })
    }
  }
  return out
}

const pounds = (pence: number) => (pence / 100).toFixed(2)
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** FreeAgent refuses commas and quote marks anywhere in a field. */
function freeAgentText(v: string): string {
  return v.replace(/[",\r\n]/g, " ").replace(/\s+/g, " ").trim()
}

export const FORMAT_LABELS: Record<Exclude<StatementFormat, "csv">, string> = {
  xero: "Xero",
  quickbooks: "QuickBooks",
  freeagent: "FreeAgent",
}

/** Render statement lines in the layout each package's bank-statement import expects. */
export function renderStatement(lines: StatementLine[], format: StatementFormat): string {
  let rows: string[]
  switch (format) {
    case "xero":
      // Xero: header row; signed Amount; dates as dd/mm/yyyy for a UK organisation
      rows = [
        "Date,Amount,Payee,Description,Reference",
        ...lines.map((l) => [dmy(l.date), pounds(l.amount), csvCell(l.payee), csvCell(l.description), csvCell(l.reference)].join(",")),
      ]
      break
    case "quickbooks":
      // QuickBooks Online, 3-column layout
      rows = [
        "Date,Description,Amount",
        ...lines.map((l) => [dmy(l.date), csvCell(`${l.payee}: ${l.description}`), pounds(l.amount)].join(",")),
      ]
      break
    case "freeagent":
      // FreeAgent: no header; date, amount, description; no commas or quotes
      rows = lines.map((l) => [dmy(l.date), pounds(l.amount), freeAgentText(`${l.payee} - ${l.description} - ${l.reference}`)].join(","))
      break
    default:
      rows = [
        "Date,Amount (GBP),Payee,Description,Reference",
        ...lines.map((l) => [l.date, pounds(l.amount), csvCell(l.payee), csvCell(l.description), csvCell(l.reference)].join(",")),
      ]
  }
  return rows.join("\r\n") + "\r\n"
}
