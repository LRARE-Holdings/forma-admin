"use client"

import { useState } from "react"
import { getInitial } from "@/lib/utils"
import { InviteStaffDialog } from "./invite-staff-dialog"
import { EditInstructorDialog } from "./edit-instructor-dialog"
import { Plus } from "lucide-react"

interface TeamMember {
  id: string
  name: string
  bio: string
  photo_url: string | null
  profile_id: string | null
  membershipId: string | null
  role: string
  classNames: string
}

interface TeamGridProps {
  team: TeamMember[]
}

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  owner: { label: "Owner", className: "bg-cocoa text-wheat" },
  admin: { label: "Admin", className: "bg-gold/20 text-gold" },
  manager: { label: "Manager", className: "bg-blue-100 text-blue-700" },
  reception: { label: "Reception", className: "bg-purple-100 text-purple-700" },
  staff: { label: "Instructor", className: "bg-sand text-slate" },
}

export function TeamGrid({ team }: TeamGridProps) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)

  function openEdit(member: TeamMember) {
    setEditingMember(member)
    setEditOpen(true)
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {team.map((member) => {
          const badge = ROLE_BADGE[member.role] ?? ROLE_BADGE.staff
          const isInstructor = member.role === "staff" || member.role === "admin" || member.role === "owner"

          return (
            <div
              key={member.id}
              className="overflow-hidden rounded-2xl border border-sand bg-white"
            >
              <div className="p-6 text-center">
                {member.photo_url ? (
                  <img
                    src={member.photo_url}
                    alt={member.name}
                    className="mx-auto mb-3 h-14 w-14 rounded-full object-cover"
                  />
                ) : (
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gold font-heading text-[1.3rem] font-semibold text-cocoa">
                    {getInitial(member.name)}
                  </div>
                )}
                <div className="font-heading text-[1.2rem] font-semibold text-cocoa">
                  {member.name}
                </div>
                <div className="mb-2.5 mt-1 flex items-center justify-center gap-1.5">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.08em] ${badge.className}`}>
                    {badge.label}
                  </span>
                  {isInstructor && member.role !== "staff" && (
                    <span className="inline-block rounded-full bg-sand px-2.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-slate">
                      Instructor
                    </span>
                  )}
                </div>
                {member.classNames && (
                  <div className="mb-3 text-[0.78rem] leading-relaxed text-warm-grey">
                    {member.classNames}
                  </div>
                )}
                <button
                  onClick={() => openEdit(member)}
                  className="text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-gold hover:text-ember"
                >
                  Edit profile
                </button>
              </div>
            </div>
          )
        })}

        {/* Invite card */}
        <button
          onClick={() => setInviteOpen(true)}
          className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-sand bg-cream/30 p-6 transition-colors hover:border-gold/40 hover:bg-cream/50"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sand/50">
            <Plus className="h-6 w-6 text-warm-grey" />
          </div>
          <span className="text-[0.82rem] font-semibold text-warm-grey">
            Add team member
          </span>
        </button>
      </div>

      <InviteStaffDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <EditInstructorDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        instructor={editingMember}
      />
    </>
  )
}
