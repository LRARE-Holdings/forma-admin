"use client"

import { useMemo, useState } from "react"
import { Plus } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createGiftCardRequestAction } from "@/app/actions/gift-cards"
import { unwrap } from "@/lib/action-result"

export interface GiftOption {
  id: string
  credits: number
  pricePence: number | null
  pricedByClass: boolean
}

interface GiftClass {
  id: string
  name: string
  pricePence: number
}

const pounds = (p: number) => `£${(p / 100).toFixed(2)}`

function ukToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date())
}

export function CreateGiftCardButton({ options, classes }: { options: GiftOption[]; classes: GiftClass[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Create gift card
      </Button>
      {open && <CreateGiftCardDialog options={options} classes={classes} onClose={() => setOpen(false)} />}
    </>
  )
}

function CreateGiftCardDialog({
  options,
  classes,
  onClose,
}: {
  options: GiftOption[]
  classes: GiftClass[]
  onClose: () => void
}) {
  const [tierId, setTierId] = useState(options.find((o) => !o.pricedByClass)?.id ?? options[0]?.id ?? "")
  const [classId, setClassId] = useState("")
  const [buyerName, setBuyerName] = useState("")
  const [buyerEmail, setBuyerEmail] = useState("")
  const [recipientName, setRecipientName] = useState("")
  const [senderName, setSenderName] = useState("")
  const [senderTouched, setSenderTouched] = useState(false)
  // On by default: most gifts should reach the recipient by email.
  const [emailRecipient, setEmailRecipient] = useState(true)
  const [recipientEmail, setRecipientEmail] = useState("")
  const [sendOn, setSendOn] = useState(ukToday())
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<{ link: string; emailed: boolean } | null>(null)

  const tier = options.find((o) => o.id === tierId)
  const price = useMemo(() => {
    if (!tier) return null
    if (tier.pricedByClass) return classes.find((c) => c.id === classId)?.pricePence ?? null
    return tier.pricePence
  }, [tier, classId, classes])

  const firstName = buyerName.trim().split(/\s+/)[0] ?? ""
  const from = senderTouched ? senderName : firstName

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = unwrap(
        await createGiftCardRequestAction({
          tierId,
          classId: tier?.pricedByClass ? classId || null : null,
          buyerName,
          buyerEmail,
          recipientName,
          senderName: from,
          recipientEmail: emailRecipient ? recipientEmail : null,
          sendOn: emailRecipient ? sendOn : null,
        }),
      )
      setDone({ link: res.link, emailed: res.emailed })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the gift card")
    } finally {
      setSaving(false)
    }
  }

  const label = (o: GiftOption) => (o.pricedByClass ? "One class" : `${o.credits} classes`)
  const detail = (o: GiftOption) =>
    o.pricedByClass ? "Pick the class · that class only" : `Any class · ${o.pricePence ? pounds(o.pricePence) : ""}`

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>{done.emailed ? "Payment link sent" : "Gift card created"}</DialogTitle>
              <DialogDescription>
                {done.emailed
                  ? `${firstName || "The buyer"} has an email with a link to pay ${price ? pounds(price) : ""}. Once they pay, they get the voucher and a receipt${emailRecipient ? `, and ${recipientName} gets their gift` : ""}.`
                  : "The email didn't send. Copy the link below and send it to them yourself."}
              </DialogDescription>
            </DialogHeader>
            <div>
              <Label>Payment link</Label>
              <div className="flex gap-2">
                <Input readOnly value={done.link} onFocus={(e) => e.currentTarget.select()} className="text-[0.75rem]" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(done.link).then(() => toast.success("Link copied"))}
                >
                  Copy
                </Button>
              </div>
              <p className="mt-1.5 text-[0.72rem] text-warm-grey">
                You can also text or WhatsApp it. It shows under Gift cards as &ldquo;Awaiting payment&rdquo; until they pay.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <DialogHeader>
              <DialogTitle>Create a gift card</DialogTitle>
              <DialogDescription>
                For someone buying over the phone or in the studio. They get an email with a link to pay, and the
                voucher once they have.
              </DialogDescription>
            </DialogHeader>

            <div role="radiogroup" aria-label="Gift card" className="grid gap-2 sm:grid-cols-3">
              {options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={tierId === o.id}
                  onClick={() => setTierId(o.id)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    tierId === o.id ? "border-gold bg-gold/10" : "border-sand hover:border-gold/50"
                  }`}
                >
                  <span className="block text-[0.82rem] font-semibold text-cocoa">{label(o)}</span>
                  <span className="block text-[0.7rem] text-warm-grey">{detail(o)}</span>
                </button>
              ))}
            </div>

            {tier?.pricedByClass && (
              <div>
                <Label htmlFor="gift-class">Which class</Label>
                <select
                  id="gift-class"
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-cocoa outline-none focus:border-gold"
                >
                  <option value="">Choose a class</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {pounds(c.pricePence)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <fieldset className="space-y-3">
              <legend className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
                Who&apos;s paying
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="buyer-name">Name</Label>
                  <Input id="buyer-name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="buyer-email">Email</Label>
                  <Input id="buyer-email" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} required />
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
                On the voucher
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="recipient-name">To</Label>
                  <Input id="recipient-name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} maxLength={40} required />
                </div>
                <div>
                  <Label htmlFor="sender-name">From</Label>
                  <Input
                    id="sender-name"
                    value={from}
                    onChange={(e) => {
                      setSenderTouched(true)
                      setSenderName(e.target.value)
                    }}
                    maxLength={40}
                    required
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-[0.82rem] text-cocoa">
                <input
                  type="checkbox"
                  checked={emailRecipient}
                  onChange={(e) => setEmailRecipient(e.target.checked)}
                  className="h-4 w-4 accent-[#C4A95A]"
                />
                Email the gift to {recipientName.trim() || "them"} too
              </label>
              {emailRecipient && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="recipient-email">Their email</Label>
                    <Input id="recipient-email" type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} required />
                  </div>
                  <div>
                    <Label htmlFor="send-on">Send on</Label>
                    <Input id="send-on" type="date" min={ukToday()} value={sendOn} onChange={(e) => setSendOn(e.target.value)} required />
                    <p className="mt-1 text-[0.68rem] text-warm-grey">
                      {sendOn <= ukToday() ? "As soon as it's paid" : "8am that day, once it's paid"}
                    </p>
                  </div>
                </div>
              )}
            </fieldset>

            <DialogFooter className="items-center sm:justify-between">
              <p className="text-[0.82rem] text-cocoa">
                {price ? (
                  <>
                    They pay <strong>{pounds(price)}</strong>
                  </>
                ) : (
                  <span className="text-warm-grey">Pick a class to see the price</span>
                )}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !price}>
                  {saving ? "Sending…" : "Email payment link"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
