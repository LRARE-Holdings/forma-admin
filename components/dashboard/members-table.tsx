"use client"

import { useState } from "react"
import { Search } from "lucide-react"
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
  credits: number
  classesThisMonth: number
  joinedAt: string
  packs: PackRow[]
  lastBookingDate: string | null
  atRisk: boolean
}

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

  const filteredMembers = searchTerm.trim()
    ? members.filter((m) => {
        const term = searchTerm.toLowerCase()
        return (
          m.name.toLowerCase().includes(term) ||
          m.email.toLowerCase().includes(term)
        )
      })
    : members

  // Derive from current props so data is always fresh after revalidation
  const selectedMember = selectedMemberId
    ? members.find((m) => m.id === selectedMemberId) ?? null
    : null

  const editMember = editMemberId
    ? members.find((m) => m.id === editMemberId) ?? null
    : null

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
            {/* Search */}
            <div className="border-b border-sand px-5 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-warm-grey" />
                <input
                  type="text"
                  placeholder="Search by name or email…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-9 w-full max-w-sm rounded-lg border border-sand bg-cream/50 pl-9 pr-3 text-[0.82rem] text-cocoa placeholder:text-warm-grey/60 outline-none transition-colors focus:border-gold focus:bg-white"
                />
              </div>
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
                      {["Name", "Email", "Pack credits", "Classes this month", "Joined", ""].map(
                        (h) => (
                          <th
                            key={h}
                            className="border-b border-sand bg-cream px-5 py-2.5 text-left text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map((m) => (
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
