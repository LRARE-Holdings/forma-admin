"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, QrCode, Search, UserCheck, AlertTriangle, XCircle, Loader2 } from "lucide-react"
import { QrScanView } from "@/components/shared/qr-scan-view"
import { AttendanceDropdown } from "@/components/shared/attendance-dropdown"
import { markAttendance } from "@/app/actions/bookings"
import { bookWalkIn, checkInClassByCode, type ClassCheckInResult, type WalkInOption } from "@/app/actions/check-in"
import { getInitial } from "@/lib/utils"
import type { AttendanceStatus } from "@/lib/types"

export interface CheckInAttendee {
  id: string
  profile_id: string
  full_name: string | null
  payment_method: string
  attendance_status: AttendanceStatus | null
}

const PAYMENT_LABEL: Record<string, string> = {
  pack_credit: "Pack",
  membership: "Membership",
  complimentary: "Comp",
  stripe: "Drop-in",
}

const WALK_IN_LABEL: Record<WalkInOption, string> = {
  membership: "Book with their membership",
  pack_credit: "Use a pack credit",
  complimentary: "Add as complimentary",
}

/**
 * The register at the door: scan members' check-in codes, or tap names.
 * Used on the instructor's register and the studio's registration page.
 */
export function ClassCheckIn({
  scheduleId,
  date,
  capacity,
  attendees,
  initialMode = "names",
}: {
  scheduleId: string
  date: string
  capacity: number
  attendees: CheckInAttendee[]
  /** The door check-in site opens straight onto the camera. */
  initialMode?: "names" | "scan"
}) {
  const router = useRouter()
  const [mode, setMode] = useState<"names" | "scan">(initialMode)
  const [query, setQuery] = useState("")
  // Optimistic statuses on top of what the server last sent.
  const [overrides, setOverrides] = useState<Record<string, AttendanceStatus | null>>({})
  const [result, setResult] = useState<ClassCheckInResult | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [walkInBusy, startWalkIn] = useTransition()

  const list = useMemo(
    () =>
      attendees
        .map((a) => ({ ...a, attendance_status: a.id in overrides ? overrides[a.id] : a.attendance_status }))
        .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")),
    [attendees, overrides],
  )
  const shown = query
    ? list.filter((a) => (a.full_name ?? "").toLowerCase().includes(query.toLowerCase()))
    : list

  const booked = list.length
  const checkedIn = list.filter((a) => a.attendance_status === "attended").length
  const noShow = list.filter((a) => a.attendance_status === "no_show").length

  async function toggle(att: CheckInAttendee & { attendance_status: AttendanceStatus | null }) {
    const next: AttendanceStatus | null = att.attendance_status === "attended" ? null : "attended"
    setPendingId(att.id)
    setOverrides((o) => ({ ...o, [att.id]: next }))
    try {
      const res = await markAttendance(att.id, next)
      if (res.error) throw new Error(res.error)
    } catch (err) {
      setOverrides((o) => ({ ...o, [att.id]: att.attendance_status }))
      toast.error(err instanceof Error ? err.message : "Couldn't update the register. Please try again.")
    } finally {
      setPendingId(null)
    }
  }

  async function handleScan(code: string) {
    const res = await checkInClassByCode(scheduleId, date, code)
    setResult(res)
    if (res.status === "checked_in") {
      setOverrides((o) => ({ ...o, [res.bookingId]: "attended" }))
      navigator.vibrate?.(60)
    }
  }

  function walkIn(profileId: string, name: string, method: WalkInOption) {
    startWalkIn(async () => {
      const res = await bookWalkIn(scheduleId, date, profileId, method)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(`${name} is booked in and checked in`)
      setResult({ status: "checked_in", bookingId: res.bookingId, profileId, name })
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {/* Live counts */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Booked", value: `${booked}/${capacity}`, tone: "text-cocoa" },
          { label: "Checked in", value: checkedIn, tone: "text-success" },
          { label: "No-show", value: noShow, tone: "text-red-500" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-sand bg-white px-4 py-3 text-center">
            <span className={`block font-heading text-[1.4rem] font-semibold ${s.tone}`}>{s.value}</span>
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-warm-grey">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Mode */}
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-sand bg-cream p-1" role="tablist">
        {(
          [
            ["names", "Names", UserCheck],
            ["scan", "Scan QR", QrCode],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={mode === key}
            onClick={() => {
              setMode(key)
              setResult(null)
            }}
            className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-[0.82rem] font-semibold transition-colors ${
              mode === key ? "bg-white text-cocoa shadow-sm" : "text-warm-grey hover:text-cocoa"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {mode === "scan" ? (
        <div className="space-y-3">
          <QrScanView onScan={handleScan} />
          <p className="text-center text-[0.75rem] text-warm-grey">
            Members find their code under <strong>Check-in code</strong> in their account.
          </p>
          {result && <ScanResult result={result} busy={walkInBusy} onWalkIn={walkIn} />}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-sand bg-white">
          <div className="border-b border-sand p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-grey" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a name"
                className="w-full rounded-lg border border-sand bg-cream py-2 pl-9 pr-3 text-[0.85rem] text-cocoa placeholder:text-warm-grey/70 focus:border-gold focus:outline-none"
              />
            </label>
          </div>
          {shown.length === 0 ? (
            <p className="px-5 py-8 text-center text-[0.82rem] text-warm-grey">
              {booked === 0 ? "No one is booked in yet." : "No one by that name is booked in."}
            </p>
          ) : (
            <ul>
              {shown.map((att) => {
                const isIn = att.attendance_status === "attended"
                return (
                  <li key={att.id} className="flex items-center gap-3 border-b border-sand/50 px-4 py-2.5 last:border-b-0">
                    <button
                      onClick={() => toggle(att)}
                      disabled={pendingId === att.id}
                      aria-pressed={isIn}
                      className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
                        isIn ? "bg-success/10" : "hover:bg-cream"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-heading text-[0.85rem] font-semibold ${
                          isIn ? "bg-success text-white" : "bg-sand text-cocoa"
                        }`}
                      >
                        {pendingId === att.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isIn ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          getInitial(att.full_name)
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9rem] font-semibold text-cocoa">
                          {att.full_name ?? "Unknown"}
                        </span>
                        <span className="text-[0.7rem] text-warm-grey">
                          {PAYMENT_LABEL[att.payment_method] ?? att.payment_method}
                          {isIn ? " · Checked in — tap to undo" : " · Tap to check in"}
                        </span>
                      </span>
                    </button>
                    {/* No-show / late cancel still live here. Keyed so it
                        follows taps on the name. */}
                    <AttendanceDropdown
                      key={`${att.id}:${att.attendance_status ?? "none"}`}
                      bookingId={att.id}
                      currentStatus={att.attendance_status}
                      onStatusChange={(s) => setOverrides((o) => ({ ...o, [att.id]: s }))}
                      size="sm"
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function ScanResult({
  result,
  busy,
  onWalkIn,
}: {
  result: ClassCheckInResult
  busy: boolean
  onWalkIn: (profileId: string, name: string, method: WalkInOption) => void
}) {
  if (result.status === "checked_in") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-2xl bg-success px-5 py-4 text-white">
        <Check className="h-7 w-7 shrink-0" />
        <div>
          <p className="text-[1.05rem] font-semibold">{result.name}</p>
          <p className="text-[0.8rem] opacity-90">Checked in</p>
        </div>
      </div>
    )
  }
  if (result.status === "already_checked_in") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-2xl bg-amber-100 px-5 py-4 text-cocoa">
        <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
        <div>
          <p className="text-[1.05rem] font-semibold">{result.name}</p>
          <p className="text-[0.8rem]">Already checked in for this class</p>
        </div>
      </div>
    )
  }
  if (result.status === "not_booked") {
    return (
      <div role="status" className="space-y-3 rounded-2xl border border-ember/30 bg-ember/10 px-5 py-4 text-cocoa">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 shrink-0 text-ember" />
          <div>
            <p className="text-[1.05rem] font-semibold">{result.name}</p>
            <p className="text-[0.8rem]">Isn&apos;t booked into this class</p>
          </div>
        </div>
        {result.classFull ? (
          <p className="text-[0.8rem]">The class is full, so they can&apos;t be added.</p>
        ) : result.options.length === 0 ? (
          <p className="text-[0.8rem]">
            They have no membership or pack credits for this class. They can book and pay on their phone.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {result.options.map((option) => (
              <button
                key={option}
                disabled={busy}
                onClick={() => onWalkIn(result.profileId, result.name, option)}
                className="rounded-lg bg-cocoa px-4 py-2 text-[0.8rem] font-semibold text-wheat hover:bg-gold hover:text-cocoa disabled:opacity-60"
              >
                {busy ? "Booking…" : WALK_IN_LABEL[option]}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (result.status === "error") {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-red-700">
        <XCircle className="h-6 w-6 shrink-0" />
        <p className="text-[0.88rem] font-medium">{result.message}</p>
      </div>
    )
  }
  return null
}
