"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { formatUKPhoneDisplay } from "@/lib/phone-utils"
import { getMemberProfile, type MemberProfileDetail } from "@/app/actions/member-profile"
import { Mail, Phone, Calendar, CalendarHeart, X } from "lucide-react"

function calculateAge(dob: string | null): number | null {
  if (!dob) return null
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

function formatDOB(dob: string | null): string {
  if (!dob) return "—"
  return new Date(dob).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function formatBookingDate(date: string, start_time: string | null): string {
  const d = new Date(date)
  const dateStr = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
  if (!start_time) return dateStr
  return `${dateStr} · ${start_time.slice(0, 5)}`
}

function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  })
}

function initials(name: string | null): string {
  if (!name) return "?"
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
}

export function MemberProfileDialog({
  profileId,
  onOpenChange,
}: {
  profileId: string
  onOpenChange: (open: boolean) => void
}) {
  const [data, setData] = useState<MemberProfileDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getMemberProfile(profileId)
      .then((res) => {
        if (cancelled) return
        if (res.error) setError(res.error)
        else if (res.data) setData(res.data)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load")
      })
    return () => {
      cancelled = true
    }
  }, [profileId])

  const age = data ? calculateAge(data.profile.date_of_birth) : null

  return (
    <Dialog
      open={true}
      onOpenChange={onOpenChange}
      dominant
    >
      <DialogContent
        showCloseButton={false}
        className="max-w-lg overflow-hidden p-0 sm:max-w-lg"
      >
        {/* Header */}
        <div className="relative bg-cocoa px-6 pt-6 pb-5 text-wheat">
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full text-wheat/70 transition-colors hover:bg-white/10 hover:text-wheat"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="mb-3 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-gold">
            Member profile
          </p>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-gold/20 font-heading text-xl text-gold">
              {initials(data?.profile.full_name ?? null)}
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-heading text-2xl text-wheat">
                {data?.profile.full_name || (error ? "—" : "Loading…")}
              </h2>
              {data && (
                <p className="mt-0.5 text-[0.74rem] text-wheat/70">
                  {data.profile.role.charAt(0).toUpperCase() + data.profile.role.slice(1)}
                  {" · joined "}
                  {formatJoined(data.profile.joined_at)}
                </p>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="px-6 py-6 text-[0.85rem] text-ember">
            Couldn&apos;t load member: {error}
          </div>
        )}

        {data && (
          <>
            {/* Personal */}
            <div className="border-b border-sand px-6 py-4">
              <p className="mb-3 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-gold">
                Personal
              </p>
              <dl className="space-y-2.5">
                <Row
                  icon={<Calendar className="h-3.5 w-3.5" />}
                  label="Date of birth"
                  value={formatDOB(data.profile.date_of_birth)}
                  sub={age !== null ? `${age} years old` : null}
                />
                <Row
                  icon={<Phone className="h-3.5 w-3.5" />}
                  label="Phone"
                  value={
                    data.profile.phone
                      ? formatUKPhoneDisplay(data.profile.phone)
                      : "—"
                  }
                  href={data.profile.phone ? `tel:${data.profile.phone}` : null}
                />
                <Row
                  icon={<Mail className="h-3.5 w-3.5" />}
                  label="Email"
                  value={data.profile.email || "—"}
                  href={data.profile.email ? `mailto:${data.profile.email}` : null}
                />
              </dl>
            </div>

            {/* Stats */}
            <div className="border-b border-sand px-6 py-4">
              <p className="mb-3 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-gold">
                Attendance
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                <Stat label="Total classes" value={String(data.stats.total)} />
                <Stat label="Last 30 days" value={String(data.stats.last30)} />
                <Stat
                  label="Favourite"
                  value={data.stats.favourite_class || "—"}
                  small
                />
              </div>
            </div>

            {/* Recent activity */}
            <div className="px-6 py-4">
              <p className="mb-3 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-gold">
                Recent activity
              </p>
              {data.recent_bookings.length === 0 ? (
                <p className="py-3 text-[0.82rem] text-warm-grey">
                  No bookings yet.
                </p>
              ) : (
                <ul className="max-h-[260px] overflow-y-auto">
                  {data.recent_bookings.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-start gap-3 border-b border-sand/40 py-2.5 last:border-b-0"
                    >
                      <CalendarHeart className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warm-grey" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.85rem] font-semibold text-cocoa">
                          {b.class_name}
                        </p>
                        <p className="mt-0.5 text-[0.72rem] text-warm-grey">
                          {formatBookingDate(b.date, b.start_time)} · {b.instructor_name}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.06em] ${
                          b.status === "cancelled"
                            ? "bg-ember/10 text-ember"
                            : "bg-gold/15 text-gold"
                        }`}
                      >
                        {b.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Row({
  icon,
  label,
  value,
  sub,
  href,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string | null
  href?: string | null
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 text-warm-grey">{icon}</span>
      <div className="min-w-0 flex-1">
        <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-warm-grey">
          {label}
        </dt>
        <dd className="mt-0.5 text-[0.88rem] text-cocoa">
          {href ? (
            <a
              href={href}
              className="break-words text-cocoa transition-colors hover:text-gold"
            >
              {value}
            </a>
          ) : (
            <span className="break-words">{value}</span>
          )}
          {sub && (
            <span className="ml-2 text-[0.74rem] text-warm-grey">· {sub}</span>
          )}
        </dd>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  small,
}: {
  label: string
  value: string
  small?: boolean
}) {
  return (
    <div className="rounded-xl border border-sand bg-cream px-3 py-2.5">
      <p
        className={`truncate font-heading font-medium leading-tight text-cocoa ${
          small ? "text-[0.95rem]" : "text-2xl"
        }`}
        title={value}
      >
        {value}
      </p>
      <p className="mt-1 text-[0.58rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
        {label}
      </p>
    </div>
  )
}
