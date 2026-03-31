"use client"

import { useState, useMemo } from "react"
import { Search, Download, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react"
import { localDateStr } from "@/lib/utils"
import { EmptyState } from "@/components/shared/empty-state"
import { MemberPacksDialog } from "./member-packs-dialog"
import { EditMemberDialog } from "./edit-member-dialog"
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog"
import { deleteMember } from "@/app/actions/members"
import { toast } from "sonner"

interface PackRow {
  id: string
  pack_type: string
  credits_total: number
  credits_remaining: number
  expires_at: string
}

interface MemberRow {
  id: string
  name: string
  email: string
  phone: string
  credits: number
  totalClasses: number
  classesThisMonth: number
  joinedAt: string
  joinedRaw: string
  packs: PackRow[]
  lastBookingDate: string | null
  membershipStatus: string | null
  membershipTier: string | null
  atRisk: boolean
}

type SortKey = "name" | "email" | "credits" | "totalClasses" | "classesThisMonth" | "joinedRaw"
type SortDir = "asc" | "desc"

interface MembersTableProps {
  members: MemberRow[]
}

export function MembersTable({ members }: MembersTableProps) {
  const [packsOpen, setPacksOpen] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editMemberId, setEditMemberId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletingMember, setDeletingMember] = useState<MemberRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [page, setPage] = useState(0)
  const pageSize = 100

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      // Default: name/email sort A-Z, numeric/date sort highest first
      setSortDir(key === "name" || key === "email" ? "asc" : "desc")
    }
    setPage(0)
  }

  const filteredMembers = useMemo(() => {
    let result = members
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(term) ||
          m.email.toLowerCase().includes(term)
      )
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const av = a[sortKey]
        const bv = b[sortKey]
        let cmp: number
        if (typeof av === "number" && typeof bv === "number") {
          cmp = av - bv
        } else {
          cmp = String(av).localeCompare(String(bv))
        }
        return sortDir === "asc" ? cmp : -cmp
      })
    }
    return result
  }, [members, searchTerm, sortKey, sortDir])

  const totalPages = Math.ceil(filteredMembers.length / pageSize)
  const paginatedMembers = filteredMembers.slice(page * pageSize, (page + 1) * pageSize)

  // Derive from current props so data is always fresh after revalidation
  const selectedMember = selectedMemberId
    ? members.find((m) => m.id === selectedMemberId) ?? null
    : null

  const editMember = editMemberId
    ? members.find((m) => m.id === editMemberId) ?? null
    : null

  function exportCsv() {
    const headers = [
      "Name",
      "Email",
      "Phone",
      "Joined",
      "Total classes",
      "Classes this month",
      "Pack credits",
      "Membership status",
      "Membership tier",
      "Last booking",
      "At risk",
    ]
    const escape = (v: string) =>
      v.includes(",") || v.includes('"') || v.includes("\n")
        ? `"${v.replace(/"/g, '""')}"`
        : v
    const rows = members.map((m) =>
      [
        escape(m.name),
        escape(m.email),
        escape(m.phone),
        escape(m.joinedAt),
        String(m.totalClasses),
        String(m.classesThisMonth),
        String(m.credits),
        m.membershipStatus ?? "",
        m.membershipTier ?? "",
        m.lastBookingDate ?? "",
        m.atRisk ? "Yes" : "No",
      ].join(",")
    )
    const csv = [headers.join(","), ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const date = localDateStr()
    a.download = `members-export-${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function openPacks(memberId: string) {
    setSelectedMemberId(memberId)
    setPacksOpen(true)
  }

  function openEdit(memberId: string) {
    setEditMemberId(memberId)
    setEditOpen(true)
  }

  function openDelete(member: MemberRow) {
    setDeletingMember(member)
    setDeleteOpen(true)
  }

  async function handleDelete() {
    if (!deletingMember) return
    setDeleteLoading(true)
    const result = await deleteMember(deletingMember.id)
    setDeleteLoading(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`${deletingMember.name} has been removed`)
      setDeleteOpen(false)
      setDeletingMember(null)
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-sand bg-white">
        {members.length === 0 ? (
          <EmptyState
            icon="users"
            title="No members yet"
            description="Members will appear here when they sign up on the public site."
          />
        ) : (
          <>
            {/* Search + Export */}
            <div className="flex items-center justify-between border-b border-sand px-5 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-warm-grey" />
                <input
                  type="text"
                  placeholder="Search by name or email…"
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setPage(0) }}
                  className="h-9 w-full max-w-sm rounded-lg border border-sand bg-cream/50 pl-9 pr-3 text-[0.82rem] text-cocoa placeholder:text-warm-grey/60 outline-none transition-colors focus:border-gold focus:bg-white"
                />
              </div>
              <button
                onClick={exportCsv}
                className="flex items-center gap-1.5 rounded-lg border border-sand px-3 py-1.5 text-[0.75rem] font-semibold text-warm-grey transition-colors hover:border-gold hover:text-cocoa"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>

            {filteredMembers.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-[0.82rem] text-warm-grey">
                  No members match &ldquo;{searchTerm}&rdquo;
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {([
                        { label: "Name", key: "name" as SortKey },
                        { label: "Email", key: "email" as SortKey },
                        { label: "Pack credits", key: "credits" as SortKey },
                        { label: "Total classes", key: "totalClasses" as SortKey },
                        { label: "This month", key: "classesThisMonth" as SortKey },
                        { label: "Joined", key: "joinedRaw" as SortKey },
                        { label: "", key: null },
                      ] as const).map((col) => (
                        <th
                          key={col.label}
                          className={`border-b border-sand bg-cream px-5 py-2.5 text-left text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey${col.key ? " cursor-pointer select-none" : ""}`}
                          onClick={col.key ? () => toggleSort(col.key!) : undefined}
                        >
                          {col.key ? (
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              {sortKey === col.key ? (
                                sortDir === "asc" ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )
                              ) : (
                                <ChevronsUpDown className="h-3 w-3 opacity-30" />
                              )}
                            </span>
                          ) : (
                            col.label
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedMembers.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-sand/50 transition-colors last:border-b-0 hover:bg-cream/50"
                      >
                        <td className="px-5 py-3 text-[0.82rem]">
                          <div className="flex items-center gap-2">
                            <strong className="text-cocoa">{m.name}</strong>
                            {m.atRisk && (
                              <span className="inline-block rounded-full bg-ember/15 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.04em] text-ember">
                                At risk
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-[0.82rem] text-slate">
                          {m.email}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase ${
                              m.credits > 0
                                ? "bg-gold/15 text-gold"
                                : "bg-warm-grey/10 text-warm-grey"
                            }`}
                          >
                            {m.credits} remaining
                          </span>
                        </td>
                        <td className="px-5 py-3 text-[0.82rem] text-slate">
                          {m.totalClasses}
                        </td>
                        <td className="px-5 py-3 text-[0.82rem] text-slate">
                          {m.classesThisMonth}
                        </td>
                        <td className="px-5 py-3 text-[0.82rem] text-warm-grey">
                          {m.joinedAt}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex gap-3">
                            <button
                              onClick={() => openEdit(m.id)}
                              className="text-[0.75rem] font-semibold text-gold hover:text-ember"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => openPacks(m.id)}
                              className="text-[0.75rem] font-semibold text-gold hover:text-ember"
                            >
                              Manage
                            </button>
                            <button
                              onClick={() => openDelete(m)}
                              className="text-[0.75rem] font-semibold text-warm-grey hover:text-red-600"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-sand px-5 py-3">
                <p className="text-[0.75rem] text-warm-grey">
                  Showing {page * pageSize + 1}&ndash;{Math.min((page + 1) * pageSize, filteredMembers.length)} of {filteredMembers.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="rounded-lg border border-sand p-1.5 text-warm-grey transition-colors hover:border-gold hover:text-cocoa disabled:opacity-30 disabled:hover:border-sand disabled:hover:text-warm-grey"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="px-2 text-[0.75rem] text-cocoa">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="rounded-lg border border-sand p-1.5 text-warm-grey transition-colors hover:border-gold hover:text-cocoa disabled:opacity-30 disabled:hover:border-sand disabled:hover:text-warm-grey"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <EditMemberDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        member={editMember ? { id: editMember.id, name: editMember.name, email: editMember.email } : null}
      />

      <MemberPacksDialog
        open={packsOpen}
        onOpenChange={setPacksOpen}
        member={selectedMember ? { id: selectedMember.id, name: selectedMember.name } : null}
        packs={selectedMember?.packs ?? []}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove member"
        description={`Remove ${deletingMember?.name ?? "this member"} from your studio? Their booking history will be kept, but they will lose access and any active subscriptions will be cancelled.`}
        onConfirm={handleDelete}
        loading={deleteLoading}
        actionLabel="Remove"
        loadingLabel="Removing…"
      />
    </>
  )
}
