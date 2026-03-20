"use client"

import { useState } from "react"
import { getInitial } from "@/lib/utils"
import { InviteStaffDialog } from "./invite-staff-dialog"
import { EditInstructorDialog } from "./edit-instructor-dialog"
import { Plus, Clock, Send, X } from "lucide-react"
import { resendInvite, revokeInvite } from "@/app/actions/team"
import { toast } from "sonner"

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

interface PendingInvite {
  id: string
  email: string
  name: string
  role: string
  created_at: string
  expires_at: string
}

interface TeamGridProps {
  team: TeamMember[]
  currentProfileId: string | null
  pendingInvites: PendingInvite[]
}

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  owner: { label: "Owner", className: "bg-cocoa text-wheat" },
  admin: { label: "Admin", className: "bg-gold/20 text-gold" },
  manager: { label: "Manager", className: "bg-blue-100 text-blue-700" },
  reception: { label: "Reception", className: "bg-purple-100 text-purple-700" },
  staff: { label: "Instructor", className: "bg-sand text-slate" },
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  return `${diffDays}d ago`
}

function expiresIn(dateStr: string): string {
  const now = Date.now()
  const expires = new Date(dateStr).getTime()
  const diffMs = expires - now
  if (diffMs <= 0) return "Expired"
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return "Expires today"
  if (diffDays === 1) return "Expires tomorrow"
  return `Expires in ${diffDays} days`
}

export function TeamGrid({ team, currentProfileId, pendingInvites }: TeamGridProps) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [loadingResend, setLoadingResend] = useState<string | null>(null)
  const [loadingRevoke, setLoadingRevoke] = useState<string | null>(null)

  function openEdit(member: TeamMember) {
    setEditingMember(member)
    setEditOpen(true)
  }

  async function handleResend(inviteId: string) {
    setLoadingResend(inviteId)
    const result = await resendInvite(inviteId)
    setLoadingResend(null)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Invite resent")
    }
  }

  async function handleRevoke(inviteId: string) {
    setLoadingRevoke(inviteId)
    const result = await revokeInvite(inviteId)
    setLoadingRevoke(null)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Invite revoked")
    }
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

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-4 font-heading text-[1rem] font-semibold text-cocoa">
            Pending invites
          </h3>
          <div className="space-y-3">
            {pendingInvites.map((invite) => {
              const badge = ROLE_BADGE[invite.role] ?? ROLE_BADGE.staff
              const expired = new Date(invite.expires_at).getTime() <= Date.now()

              return (
                <div
                  key={invite.id}
                  className="flex items-center justify-between rounded-xl border border-sand bg-white px-5 py-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sand/60">
                      <Clock className="h-4 w-4 text-warm-grey" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[0.88rem] font-semibold text-cocoa">
                          {invite.name}
                        </span>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.08em] ${badge.className}`}>
                          {badge.label}
                        </span>
                        {expired ? (
                          <span className="inline-block rounded-full bg-red-50 px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.08em] text-red-600">
                            Expired
                          </span>
                        ) : (
                          <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.08em] text-amber-600">
                            Pending
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[0.75rem] text-warm-grey">
                        {invite.email} &middot; Invited {timeAgo(invite.created_at)} &middot; {expiresIn(invite.expires_at)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleResend(invite.id)}
                      disabled={loadingResend === invite.id}
                      className="flex items-center gap-1.5 rounded-lg border border-sand px-3 py-1.5 text-[0.72rem] font-semibold text-cocoa transition-colors hover:bg-cream disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" />
                      {loadingResend === invite.id ? "Sending..." : "Resend"}
                    </button>
                    <button
                      onClick={() => handleRevoke(invite.id)}
                      disabled={loadingRevoke === invite.id}
                      className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-[0.72rem] font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                      {loadingRevoke === invite.id ? "Revoking..." : "Revoke"}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <InviteStaffDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <EditInstructorDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        instructor={editingMember}
        isSelf={editingMember?.profile_id === currentProfileId}
      />
    </>
  )
}
