import { Download } from "lucide-react"
import { requireAdmin } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import { formatPence, localDateStr } from "@/lib/utils"
import { formatUkDate, effectiveEnd, presetPeriods, resolvePeriod } from "@/lib/money-periods"
import {
  getLedgerSummary,
  getPayouts,
  getUnusedPackCredits,
  getAccountingSettings,
  salesByCategory,
  CREDIT_LEDGER_START,
} from "@/lib/money"
import { PageHeader } from "@/components/shared/page-header"
import { PeriodPicker } from "@/components/dashboard/money/period-picker"
import { PrintButton } from "@/components/dashboard/money/print-button"
import { AccountingSettings } from "@/components/dashboard/money/accounting-settings"
import { FORMAT_LABELS } from "@/lib/accounting-export"

export const dynamic = "force-dynamic"

const gbp = (pence: number) => `${pence < 0 ? "−" : ""}£${formatPence(Math.abs(pence))}`

function ukDateTime(iso: string, withTime = false): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  })
}

function Line({
  label,
  value,
  detail,
  strong,
  indent,
}: {
  label: string
  value: string
  detail?: string
  strong?: boolean
  indent?: boolean
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 px-5 py-2.5 ${
        strong ? "border-t border-sand font-semibold text-cocoa" : "text-slate"
      }`}
    >
      <div className={`text-[0.82rem] ${indent ? "pl-4" : ""}`}>
        {label}
        {detail && <span className="ml-2 text-[0.7rem] font-normal text-warm-grey">{detail}</span>}
      </div>
      <div className="text-[0.85rem] tabular-nums">{value}</div>
    </div>
  )
}

function Section({ title, subtitle, children, action }: {
  title: string
  subtitle?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-sand bg-white break-inside-avoid">
      <div className="flex items-start justify-between gap-3 border-b border-sand px-5 py-4">
        <div>
          <h3 className="font-heading text-[1.05rem] font-semibold text-cocoa">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[0.7rem] text-warm-grey">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  await requireAdmin()
  const studioId = await getStudioId()
  const today = localDateStr()
  const settings = await getAccountingSettings(studioId)
  const period = resolvePeriod(await searchParams, today, settings.yearEnd)
  const asOf = effectiveEnd(period, today)

  const [summary, payouts, unused] = await Promise.all([
    getLedgerSummary(studioId, period.from, period.to),
    getPayouts(studioId, period.from, period.to),
    getUnusedPackCredits(studioId, asOf),
  ])

  const categories = salesByCategory(summary)
  const instantPayouts = payouts.filter((p) => p.method === "instant")
  const reconciles =
    summary.opening_balance + summary.net_sales - summary.payouts - summary.payout_fees + summary.other ===
    summary.closing_balance
  const exportQuery = `from=${period.from}&to=${period.to}`

  return (
    <>
      <PageHeader
        title="Money"
        description={`${period.label} · ${formatUkDate(period.from)} to ${formatUkDate(period.to)}, UK time`}
        action={<PrintButton />}
      />

      <PeriodPicker presets={presetPeriods(today, settings.yearEnd)} from={period.from} to={period.to} />

      <div className="grid grid-cols-1 gap-x-5 lg:grid-cols-2">
        <Section
          title="Statement"
          subtitle="Card payments taken through Stripe. Sales are counted on the day they're paid."
        >
          <Line label="Sales" value={gbp(summary.gross_sales)} strong />
          {categories.map((c) => (
            <Line
              key={c.key}
              label={c.label}
              value={gbp(c.gross)}
              detail={`${c.sales} sale${c.sales === 1 ? "" : "s"}`}
              indent
            />
          ))}
          <Line
            label="Refunds"
            value={gbp(-summary.refunds)}
            detail={summary.refunds > 0 ? `${categories.reduce((s, c) => s + c.refunds, 0)} refunded` : undefined}
          />
          <Line label="Stripe card fees" value={gbp(-summary.card_fees)} />
          <Line label="Net sales" value={gbp(summary.net_sales)} strong />
          {summary.other !== 0 && (
            <Line
              label="Other Stripe adjustments"
              value={gbp(summary.other)}
              detail={Object.keys(summary.other_types).join(", ")}
            />
          )}
        </Section>

        <Section
          title="Stripe balance"
          subtitle="How the money moved from Stripe to the bank in this period."
        >
          <Line label={`Balance at start of ${formatUkDate(period.from)}`} value={gbp(summary.opening_balance)} />
          <Line label="Net sales" value={gbp(summary.net_sales)} />
          {summary.other !== 0 && <Line label="Other adjustments" value={gbp(summary.other)} />}
          <Line
            label="Paid out to bank"
            value={gbp(-summary.payouts)}
            detail={`${payouts.length} payout${payouts.length === 1 ? "" : "s"}`}
          />
          <Line
            label="Instant payout fees"
            value={gbp(-summary.payout_fees)}
            detail={instantPayouts.length > 0 ? `${instantPayouts.length} instant` : undefined}
          />
          <Line label={`Balance at end of ${formatUkDate(asOf)}`} value={gbp(summary.closing_balance)} strong />
          <p className={`px-5 pb-4 pt-1 text-[0.7rem] ${reconciles ? "text-warm-grey" : "font-semibold text-ember"}`}>
            {reconciles
              ? "Adds up to the penny with Stripe's records."
              : "These figures don't add up. Please contact support before using them."}
            {summary.last_synced_at && ` Copied from Stripe ${ukDateTime(summary.last_synced_at, true)}.`}
          </p>
        </Section>
      </div>

      <Section
        title="Unused pack credits"
        subtitle={`Credits members had paid for but not yet used at the end of ${formatUkDate(asOf)}, on packs that hadn't expired.`}
      >
        {unused.supported ? (
          <div className="grid grid-cols-3 divide-x divide-sand">
            {[
              { label: "Credits", value: String(unused.credits) },
              { label: "Paid for", value: gbp(unused.valuePence) },
              { label: "Packs", value: String(unused.packs) },
            ].map((s) => (
              <div key={s.label} className="px-5 py-4">
                <div className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">{s.label}</div>
                <div className="mt-1 font-heading text-[1.5rem] text-cocoa">{s.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-4 text-[0.8rem] text-warm-grey">
            Credit records start on {formatUkDate(CREDIT_LEDGER_START)}, so this can only be worked out for periods ending on or after that date.
          </p>
        )}
        {unused.supported && unused.unpricedCredits > 0 && (
          <p className="border-t border-sand px-5 py-3 text-[0.7rem] text-warm-grey">
            {unused.unpricedCredits} of these credits are on packs with no recorded price (added by hand or carried over), so they aren&apos;t in the &ldquo;Paid for&rdquo; figure.
          </p>
        )}
      </Section>

      <Section
        title="Payouts"
        subtitle="Each one should appear on the bank statement on its arrival date, for the amount shown."
        action={
          <a
            href={`/dashboard/money/export?kind=payouts&${exportQuery}`}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-sand px-3 py-1.5 text-[0.75rem] font-semibold text-warm-grey transition-colors hover:border-gold hover:text-cocoa print:hidden"
          >
            <Download className="h-3.5 w-3.5" />
            Payouts CSV
          </a>
        }
      >
        {payouts.length === 0 ? (
          <p className="px-5 py-6 text-center text-[0.8rem] text-warm-grey">No payouts in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Arrives", "Amount", "Fee", "Type", "Status"].map((h) => (
                    <th
                      key={h}
                      className="border-b border-sand bg-cream px-5 py-2.5 text-left text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-sand/50 last:border-b-0">
                    <td className="px-5 py-2.5 text-[0.82rem] text-cocoa">{ukDateTime(p.arrivalDate)}</td>
                    <td className="px-5 py-2.5 text-[0.82rem] tabular-nums text-cocoa">{gbp(p.amount)}</td>
                    <td className="px-5 py-2.5 text-[0.82rem] tabular-nums text-slate">{p.fee ? gbp(p.fee) : "—"}</td>
                    <td className="px-5 py-2.5 text-[0.82rem] text-slate">
                      {p.method === "instant" ? "Instant" : "Standard"}
                      {p.automatic ? "" : ", manual"}
                    </td>
                    <td className="px-5 py-2.5 text-[0.82rem] capitalize text-slate">{p.status.replace("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="For your accountant"
        subtitle="Every Stripe transaction in this period. Not VAT-registered, so no VAT is shown. Pack sales count as income when paid."
      >
        <div className="flex flex-wrap gap-2 px-5 py-4 print:hidden">
          {settings.software !== "none" && (
            <a
              href={`/dashboard/money/export?kind=statement&format=${settings.software}&${exportQuery}`}
              className="flex items-center gap-1.5 rounded-lg border border-gold bg-cream px-3 py-1.5 text-[0.75rem] font-semibold text-cocoa transition-colors hover:border-ember"
            >
              <Download className="h-3.5 w-3.5" />
              Stripe statement for {FORMAT_LABELS[settings.software]}
            </a>
          )}
          <a
            href={`/dashboard/money/export?kind=transactions&${exportQuery}`}
            className="flex items-center gap-1.5 rounded-lg border border-sand px-3 py-1.5 text-[0.75rem] font-semibold text-warm-grey transition-colors hover:border-gold hover:text-cocoa"
          >
            <Download className="h-3.5 w-3.5" />
            Transactions CSV
          </a>
        </div>
        <p className="px-5 pb-4 text-[0.8rem] text-slate">
          {settings.software !== "none"
            ? `The Stripe statement imports into ${FORMAT_LABELS[settings.software]} as a bank account called "Stripe": every sale, fee, refund and payout is a line, and each payout matches a transfer on the business bank account. `
            : "Choose your accounting software below to get a statement it can import. "}
          The transactions CSV lists the member, what they bought, the amount, Stripe&apos;s fee and the amount after fees.
          Cash and complimentary bookings aren&apos;t included, only card payments through Stripe.
        </p>
        <AccountingSettings yearEnd={settings.yearEnd} software={settings.software} />
      </Section>
    </>
  )
}
