"use client"

import { useState } from "react"
import { EmptyState } from "@/components/shared/empty-state"
import { MemberPacksDialog } from "./member-packs-dialog"
import { EditMemberDialog } from "./edit-member-dialog"

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
}

interface MembersTableProps {
  members: MemberRow[]
}

export function MembersTable({ members }: MembersTableProps) {
  const [packsOpen, setPacksOpen] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editMemberId, setEditMemberId] = useState<string | null>(null)

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
                {members.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-sand/50 transition-colors last:border-b-0 hover:bg-cream/50"
                  >
                    <td className="px-5 py-3 text-[0.82rem]">
                      <strong className="text-cocoa">{m.name}</strong>
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    </>
  )
}
