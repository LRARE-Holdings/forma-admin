"use client"

import { useMemo, useState } from "react"
import { Search, Gift } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  cancelGiftCardRequestAction,
  emailGiftCardRequestAgain,
  giftCardRequestLink,
  resendGiftCard,
} from "@/app/actions/gift-cards"
import { unwrap } from "@/lib/action-result"

export interface GiftCardRow {
  id: string
  code: string
  credits: number
  amountPence: number
  /** "pending" only for cards set up here that are waiting for payment. */
  status: "pending" | "paid" | "redeemed" | "refunded"
  recipientName: string
  senderName: string
  recipientEmail: string | null
  sendOn: string | null
  paidAt: string | null
  expiresAt: string | null
  buyerEmailedAt: string | null
  recipientEmailedAt: string | null
  redeemedAt: string | null
  buyerName: string | null
  buyerEmail: string | null
  claimerName: string | null
  /** Single-class cards only. */
  className: string | null
  /** Set when the studio created the card and sent a payment link. */
  requestedAt: string | null
  requestEmailedAt: string | null
}

type Shown = "awaiting" | "unclaimed" | "claimed" | "refunded" | "expired"

function shownStatus(c: GiftCardRow, now: number): Shown {
  if (c.status === "pending") return "awaiting"
  if (c.status === "redeemed") return "claimed"
  if (c.status === "refunded") return "refunded"
  if (c.expiresAt && new Date(c.expiresAt).getTime() < now) return "expired"
  return "unclaimed"
}

const BADGE: Record<Shown, { label: string; className: string }> = {
  awaiting: { label: "Awaiting payment", className: "bg-sand/70 text-cocoa" },
  unclaimed: { label: "Not claimed", className: "bg-gold/15 text-gold" },
  claimed: { label: "Claimed", className: "bg-success-bg text-success" },
  refunded: { label: "Refunded", className: "bg-ember/10 text-ember" },
  expired: { label: "Expired", className: "bg-sand/60 text-warm-grey" },
}

const pounds = (p: number) => `£${(p / 100).toFixed(2)}`
const value = (credits: number, className: string | null) =>
  className ? `1 ${className} class` : credits === 1 ? "1 class" : `${credits} classes`

function day(iso: string | null, withYear = false) {
  if (!iso) return ""
  const d = iso.length === 10 ? new Date(iso + "T12:00:00Z") : new Date(iso)
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "Europe/London",
  })
}

/** What happened with the emails, in one line. */
function emailLine(c: GiftCardRow) {
  if (c.recipientEmail && c.recipientEmailedAt) return `Emailed to ${c.recipientEmail} on ${day(c.recipientEmailedAt)}`
  if (c.recipientEmail && c.sendOn) return `Emails ${c.recipientEmail} on ${day(c.sendOn)}`
  return c.buyerEmailedAt ? "Sent to the buyer only" : "Buyer's email not sent yet"
}

/** `now` is the server's clock at render, for deciding which cards have expired. */
export function GiftCardsTable({ cards, now }: { cards: GiftCardRow[]; now: number }) {
  const [search, setSearch] = useState("")
  const [resending, setResending] = useState<GiftCardRow | null>(null)
  const [relinking, setRelinking] = useState<GiftCardRow | null>(null)
  const [cancelling, setCancelling] = useState<GiftCardRow | null>(null)

  async function copyLink(c: GiftCardRow) {
    try {
      const { link } = unwrap(await giftCardRequestLink(c.id))
      await navigator.clipboard.writeText(link)
      toast.success("Payment link copied")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't copy the link")
    }
  }

  const summary = useMemo(() => {
    const live = cards.filter((c) => c.status === "paid" || c.status === "redeemed")
    const waiting = cards.filter((c) => shownStatus(c, now) === "unclaimed")
    return {
      sold: live.length,
      takenPence: live.reduce((s, c) => s + c.amountPence, 0),
      claimed: cards.filter((c) => c.status === "redeemed").length,
      waiting: waiting.length,
      waitingPence: waiting.reduce((s, c) => s + c.amountPence, 0),
    }
  }, [cards, now])

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return cards
    // Codes get read out over the phone with or without the dashes.
    const bare = term.replace(/[^a-z0-9]/g, "")
    return cards.filter((c) =>
      [c.code, c.recipientName, c.senderName, c.recipientEmail, c.buyerName, c.buyerEmail, c.claimerName, c.className]
        .filter(Boolean)
        .some((f) => {
          const v = (f as string).toLowerCase()
          return v.includes(term) || (bare.length >= 4 && v.replace(/[^a-z0-9]/g, "").includes(bare))
        }),
    )
  }, [cards, search])

  return (
    <>
      <div className="mb-6 grid grid-cols-1 divide-y divide-sand overflow-hidden rounded-2xl border border-sand bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[
          { label: "Sold", value: String(summary.sold), sub: `${pounds(summary.takenPence)} taken` },
          { label: "Claimed", value: String(summary.claimed), sub: "Turned into class packs" },
          { label: "Waiting to be claimed", value: String(summary.waiting), sub: `${pounds(summary.waitingPence)} of classes owed` },
        ].map((s) => (
          <div key={s.label} className="px-5 py-4">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">{s.label}</div>
            <div className="mt-1 font-heading text-[1.5rem] text-cocoa">{s.value}</div>
            <div className="text-[0.72rem] text-warm-grey">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand px-5 py-4">
          <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">All gift cards</h3>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-warm-grey" />
            <input
              type="text"
              placeholder="Search by code, name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-sand bg-cream/50 pl-9 pr-3 text-[0.82rem] text-cocoa placeholder:text-warm-grey/60 outline-none transition-colors focus:border-gold focus:bg-white"
            />
          </div>
        </div>

        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sand/50">
              <Gift className="h-6 w-6 text-warm-grey" />
            </div>
            <h3 className="font-heading text-lg font-semibold text-cocoa">No gift cards yet</h3>
            <p className="mt-1 max-w-sm text-sm text-warm-grey">
              When someone buys a gift card on your website, it shows up here with its code.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-[0.82rem] text-warm-grey">
            No gift card matches &ldquo;{search.trim()}&rdquo;. Check the code against the voucher.
          </p>
        ) : (
          <ul>
            {shown.map((c) => {
              const s = shownStatus(c, now)
              const badge = BADGE[s]
              return (
                <li
                  key={c.id}
                  className="flex flex-col gap-3 border-b border-sand/50 px-5 py-3.5 transition-colors last:border-b-0 hover:bg-cream/50 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[0.85rem] text-cocoa">
                        {c.recipientName}
                        <span className="font-normal text-warm-grey"> from {c.senderName}</span>
                      </strong>
                      <span className={`rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[0.75rem] text-warm-grey">
                      {value(c.credits, c.className)} · {pounds(c.amountPence)} ·{" "}
                      {s === "awaiting" ? `set up ${day(c.requestedAt)} for` : `bought ${day(c.paidAt)}`}
                      {c.buyerName ? ` ${s === "awaiting" ? "" : "by "}${c.buyerName}` : ""}
                    </div>
                    <div className="mt-0.5 text-[0.72rem] text-warm-grey">
                      {s === "awaiting"
                        ? c.requestEmailedAt
                          ? `Payment link emailed to ${c.buyerEmail} on ${day(c.requestEmailedAt)}`
                          : "Payment link not emailed yet: copy it and send it yourself"
                        : s === "claimed"
                        ? `Claimed by ${c.claimerName ?? "a member"} on ${day(c.redeemedAt)}`
                        : s === "unclaimed"
                          ? `Claim by ${day(c.expiresAt, true)} · ${emailLine(c)}`
                          : s === "expired"
                            ? `Not claimed by ${day(c.expiresAt, true)}`
                            : "Refunded, so the code no longer works"}
                    </div>
                  </div>
                  {s === "awaiting" ? (
                    <div className="flex shrink-0 items-center gap-4">
                      <button onClick={() => copyLink(c)} className="text-[0.75rem] font-semibold text-cocoa hover:text-gold">
                        Copy link
                      </button>
                      <button onClick={() => setRelinking(c)} className="text-[0.75rem] font-semibold text-gold hover:text-ember">
                        Email again
                      </button>
                      <button onClick={() => setCancelling(c)} className="text-[0.75rem] font-semibold text-warm-grey hover:text-ember">
                        Cancel
                      </button>
                    </div>
                  ) : (
                  <div className="flex shrink-0 items-center gap-4">
                    <code className="rounded-md bg-cream px-2 py-1 font-mono text-[0.72rem] font-semibold tracking-[0.08em] text-cocoa">
                      {c.code}
                    </code>
                    {/* Fixed width so the codes line up whether or not "Send again" shows. */}
                    <div className="flex w-[108px] items-center gap-4">
                      <a
                        href={`/dashboard/gift-cards/${c.id}/voucher`}
                        className="text-[0.75rem] font-semibold text-cocoa hover:text-gold"
                      >
                        PDF
                      </a>
                      {s === "unclaimed" && (
                        <button
                          onClick={() => setResending(c)}
                          className="text-[0.75rem] font-semibold text-gold hover:text-ember"
                        >
                          Send again
                        </button>
                      )}
                    </div>
                  </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ResendDialog card={resending} onClose={() => setResending(null)} />
      <RelinkDialog card={relinking} onClose={() => setRelinking(null)} />
      <CancelRequestDialog card={cancelling} onClose={() => setCancelling(null)} />
    </>
  )
}

function ResendDialog({ card, onClose }: { card: GiftCardRow | null; onClose: () => void }) {
  const [who, setWho] = useState<"buyer" | "recipient">("buyer")
  const [to, setTo] = useState("")
  const [sending, setSending] = useState(false)
  const [lastCard, setLastCard] = useState<string | null>(null)

  // Reset the form each time a different card opens it.
  if (card && card.id !== lastCard) {
    setLastCard(card.id)
    setWho(card.recipientEmail ? "recipient" : "buyer")
    setTo(card.recipientEmail ?? card.buyerEmail ?? "")
  }
  if (!card) return null

  function pick(next: "buyer" | "recipient") {
    setWho(next)
    setTo((next === "buyer" ? card!.buyerEmail : card!.recipientEmail) ?? "")
  }

  async function send() {
    if (!card) return
    setSending(true)
    try {
      unwrap(await resendGiftCard(card.id, who, to))
      toast.success(`Voucher sent to ${to}`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The email didn't send")
    } finally {
      setSending(false)
    }
  }

  const option = (key: "buyer" | "recipient", title: string, detail: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={who === key}
      onClick={() => pick(key)}
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
        who === key ? "border-gold bg-gold/10" : "border-sand hover:border-gold/50"
      }`}
    >
      <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px] ${who === key ? "border-[5px] border-gold" : "border-sand"}`} />
      <span>
        <span className="block text-[0.82rem] font-semibold text-cocoa">{title}</span>
        <span className="block text-[0.72rem] text-warm-grey">{detail}</span>
      </span>
    </button>
  )

  return (
    <Dialog open={!!card} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send the voucher again</DialogTitle>
          <DialogDescription>
            We&apos;ll email the PDF with the code {card.code} straight away.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" className="space-y-2">
          {option("buyer", card.buyerName ? `${card.buyerName} (bought it)` : "The buyer", "Gets the buyer's version of the email")}
          {option("recipient", `${card.recipientName} (the gift)`, "Gets the email telling them how to claim it")}
        </div>
        <div>
          <Label htmlFor="resend-to">Email address</Label>
          <Input id="resend-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
          {who === "recipient" && card.recipientEmail && to.trim() && to.trim() !== card.recipientEmail && (
            <p className="mt-1 text-[0.7rem] text-warm-grey">This also replaces {card.recipientEmail} on the gift card.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending || !to.trim()}>
            {sending ? "Sending…" : "Send voucher"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RelinkDialog({ card, onClose }: { card: GiftCardRow | null; onClose: () => void }) {
  const [to, setTo] = useState("")
  const [sending, setSending] = useState(false)
  const [lastCard, setLastCard] = useState<string | null>(null)
  if (card && card.id !== lastCard) {
    setLastCard(card.id)
    setTo(card.buyerEmail ?? "")
  }
  if (!card) return null

  async function send() {
    if (!card) return
    setSending(true)
    try {
      unwrap(await emailGiftCardRequestAgain(card.id, to))
      toast.success(`Payment link sent to ${to}`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The email didn't send")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={!!card} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Email the payment link again</DialogTitle>
          <DialogDescription>
            {card.buyerName ?? "The buyer"} gets the same link to pay {pounds(card.amountPence)} for {card.recipientName}&apos;s gift card.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="relink-to">Email address</Label>
          <Input id="relink-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending || !to.trim()}>{sending ? "Sending…" : "Send link"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelRequestDialog({ card, onClose }: { card: GiftCardRow | null; onClose: () => void }) {
  const [working, setWorking] = useState(false)
  if (!card) return null

  async function cancel() {
    if (!card) return
    setWorking(true)
    try {
      unwrap(await cancelGiftCardRequestAction(card.id))
      toast.success("Gift card cancelled")
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel it")
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open={!!card} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this gift card?</DialogTitle>
          <DialogDescription>
            The payment link stops working, so {card.buyerName ?? "the buyer"} can&apos;t pay for it. Nothing has been
            charged yet.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={working}>Keep it</Button>
          <Button variant="destructive" onClick={cancel} disabled={working}>{working ? "Cancelling…" : "Cancel gift card"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
