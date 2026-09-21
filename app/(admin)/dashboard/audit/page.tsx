import { PageHeader } from "@/components/shared/page-header"
import { AuditShell } from "@/components/dashboard/audit/audit-shell"
import { AuditSummaryBand } from "@/components/dashboard/audit/audit-summary-band"
import { getAuditRows, getAuditSummary } from "@/app/actions/audit"
import { getCreditShortfalls } from "@/app/actions/credit-reconciliation"

export const dynamic = "force-dynamic"

export default async function AuditPage() {
  const [{ rows, total }, summary, shortfall] = await Promise.all([
    getAuditRows({ kind: "all" }),
    getAuditSummary(),
    getCreditShortfalls(),
  ])

  const owedCredits = shortfall.rows.reduce((sum, r) => sum + r.missing, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit audit"
        description="Every credit bought, spent, returned or adjusted, and who did it."
      />

      <AuditSummaryBand
        summary={summary}
        owedCredits={owedCredits}
        owedMembers={shortfall.rows.length}
      />

      <AuditShell
        initialRows={rows}
        initialTotal={total}
        shortfalls={shortfall.rows}
        skippedLegacyMembers={shortfall.skippedLegacyMembers}
      />
    </div>
  )
}
