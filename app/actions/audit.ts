"use server"

import { createClient } from "@/lib/supabase/server"
import { requireReception } from "@/lib/auth"
import { getStudioId } from "@/lib/studio-context"
import type { AuditFilters, AuditRow } from "@/lib/audit-types"

/**
 * The credit audit.
 *
 * Every movement of a class-pack credit is recorded by a database trigger on
 * class_packs, so this reads the same history whichever app caused it — this
 * dashboard, the member site, a webhook, or a manual fix run against the
 * database. Nothing here derives or infers; it reports what was recorded.
 */

const PAGE_SIZE = 100

const SELECT = `
  id, kind, delta, balance_after, reason, created_at, actor_role,
  profile_id, class_pack_id, booking_id,
  member:profile_id(full_name, email),
  actor:actor_profile_id(full_name, email),
  pack:class_pack_id(pack_type, credits_total, expires_at, tier:pack_tier_id(name)),
  booking:booking_id(date, payment_method, cancelled_by,
                     slot:schedule_id(start_time, class:class_id(name)))
` as const

type RawRow = Record<string, unknown>

function shape(r: RawRow): AuditRow {
  const member = r.member as { full_name: string | null; email: string | null } | null
  const actor = r.actor as { full_name: string | null; email: string | null } | null
  const pack = r.pack as {
    pack_type: string | null
    credits_total: number | null
    expires_at: string | null
    tier: { name: string } | null
  } | null
  const booking = r.booking as {
    date: string
    payment_method: string
    cancelled_by: string | null
    slot: { start_time: string; class: { name: string } | null } | null
  } | null

  return {
    id: r.id as string,
    kind: r.kind as AuditRow["kind"],
    delta: r.delta as number,
    balanceAfter: (r.balance_after as number) ?? null,
    reason: (r.reason as string) ?? null,
    createdAt: r.created_at as string,
    memberName: member?.full_name ?? null,
    memberEmail: member?.email ?? null,
    // A null actor with actor_role 'system' is a background job or a database
    // trigger, not a missing record — worth showing as such rather than blank.
    actorName: actor?.full_name ?? null,
    actorRole: (r.actor_role as string) ?? null,
    packName: pack?.tier?.name ?? pack?.pack_type ?? null,
    packTotal: pack?.credits_total ?? null,
    packExpiresAt: pack?.expires_at ?? null,
    className: booking?.slot?.class?.name ?? null,
    classDate: booking?.date ?? null,
    classTime: booking?.slot?.start_time ?? null,
    cancelledBy: booking?.cancelled_by ?? null,
  }
}

async function runQuery(filters: AuditFilters, limit: number, offset: number) {
  await requireReception()
  const studioId = await getStudioId()
  const supabase = await createClient()

  let q = supabase
    .from("credit_transactions")
    .select(SELECT, { count: "exact" })
    .eq("studio_id", studioId)

  if (filters.kind && filters.kind !== "all") q = q.eq("kind", filters.kind)
  if (filters.profileId) q = q.eq("profile_id", filters.profileId)
  if (filters.from) q = q.gte("created_at", `${filters.from}T00:00:00Z`)
  if (filters.to) q = q.lte("created_at", `${filters.to}T23:59:59Z`)

  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new Error(error.message)

  let rows = (data ?? []).map((r) => shape(r as RawRow))

  // Name/email search runs here rather than in the query: the searchable fields
  // live on the joined profile, and PostgREST cannot filter an embedded resource
  // without turning the join into an inner one and dropping rows whose member
  // record has since been removed — exactly the rows an audit must keep.
  const term = filters.search?.trim().toLowerCase()
  if (term) {
    rows = rows.filter(
      (r) =>
        r.memberName?.toLowerCase().includes(term) ||
        r.memberEmail?.toLowerCase().includes(term)
    )
  }

  return { rows, total: count ?? 0 }
}

export async function getAuditRows(
  filters: AuditFilters,
  page = 0
): Promise<{ rows: AuditRow[]; total: number }> {
  return runQuery(filters, PAGE_SIZE, page * PAGE_SIZE)
}

export interface AuditSummary {
  creditsReturned: number
  failedReturns: number
  manualAdjustments: number
  totalEvents: number
  since: string | null
}

/**
 * The headline numbers. Counts events rather than sampling the table, so the
 * figures stay true regardless of which filters the table is showing.
 */
export async function getAuditSummary(): Promise<AuditSummary> {
  await requireReception()
  const studioId = await getStudioId()
  const supabase = await createClient()

  const base = () =>
    supabase
      .from("credit_transactions")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studioId)

  const [returned, failed, manual, total, earliest] = await Promise.all([
    base().eq("kind", "refund"),
    base().eq("kind", "refund_failed"),
    base().eq("kind", "manual_adjustment"),
    base(),
    supabase
      .from("credit_transactions")
      .select("created_at")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  return {
    creditsReturned: returned.count ?? 0,
    failedReturns: failed.count ?? 0,
    manualAdjustments: manual.count ?? 0,
    totalEvents: total.count ?? 0,
    since: (earliest.data?.created_at as string) ?? null,
  }
}

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Export the current view as CSV. Applies the same filters as the table, but
 * without the page limit — an export that silently stopped at the first 100
 * rows would be worse than no export.
 */
export async function exportAuditCsv(filters: AuditFilters): Promise<string> {
  const { rows } = await runQuery(filters, 10000, 0)

  const header = [
    "Timestamp",
    "Member",
    "Email",
    "Event",
    "Credits",
    "Balance after",
    "Pack",
    "Pack size",
    "Pack expires",
    "Class",
    "Class date",
    "Class time",
    "Cancelled by",
    "Actor",
    "Actor role",
    "Detail",
  ]

  const lines = rows.map((r) =>
    [
      r.createdAt,
      r.memberName,
      r.memberEmail,
      r.kind,
      r.delta > 0 ? `+${r.delta}` : String(r.delta),
      r.balanceAfter,
      r.packName,
      r.packTotal,
      r.packExpiresAt,
      r.className,
      r.classDate,
      r.classTime,
      r.cancelledBy,
      r.actorName,
      r.actorRole,
      r.reason,
    ]
      .map(csvCell)
      .join(",")
  )

  return [header.join(","), ...lines].join("\n")
}
