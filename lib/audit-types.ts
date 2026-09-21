/**
 * Shared shapes for the credit audit. Kept out of the server-action module
 * because a "use server" file may only export async functions.
 */

export type AuditKind =
  | "purchase"
  | "debit"
  | "refund"
  | "manual_adjustment"
  | "expiry_revival"
  | "refund_failed"

export interface AuditFilters {
  kind?: AuditKind | "all"
  profileId?: string
  search?: string
  from?: string
  to?: string
}

export interface AuditRow {
  id: string
  kind: AuditKind
  delta: number
  balanceAfter: number | null
  reason: string | null
  createdAt: string
  memberName: string | null
  memberEmail: string | null
  actorName: string | null
  actorRole: string | null
  packName: string | null
  packTotal: number | null
  packExpiresAt: string | null
  className: string | null
  classDate: string | null
  classTime: string | null
  cancelledBy: string | null
}

/** A member whose bought credits exceed what they have spent plus what is left. */
export interface ShortfallRow {
  profileId: string
  name: string | null
  email: string | null
  bought: number
  used: number
  cancelled: number
  remaining: number
  missing: number
}

/** Plain-English labels — the raw enum values leak the schema into the UI. */
export const KIND_LABELS: Record<AuditKind, string> = {
  purchase: "Pack bought",
  debit: "Credit used",
  refund: "Credit returned",
  manual_adjustment: "Adjusted by hand",
  expiry_revival: "Expiry extended",
  refund_failed: "Credit NOT returned",
}

/**
 * `refund_failed` is the one an admin must never scroll past: it means a member
 * cancelled and got nothing back. It is styled as an alert, not a neutral row.
 */
export const KIND_STYLES: Record<AuditKind, string> = {
  purchase: "bg-wheat/40 text-cocoa",
  debit: "bg-sand/50 text-slate",
  refund: "bg-success-bg text-success",
  manual_adjustment: "bg-gold/20 text-cocoa",
  expiry_revival: "bg-gold/20 text-cocoa",
  refund_failed: "bg-ember/15 text-ember",
}

/** Left-edge stripe on the row, so a problem is visible before you read it. */
export const KIND_STRIPES: Record<AuditKind, string> = {
  purchase: "before:bg-wheat",
  debit: "before:bg-sand",
  refund: "before:bg-success",
  manual_adjustment: "before:bg-gold",
  expiry_revival: "before:bg-gold",
  refund_failed: "before:bg-ember",
}
