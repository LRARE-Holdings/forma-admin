"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { setClassDiscount, clearClassDiscount } from "@/app/actions/class-discounts"
import { effectivePricePence, formatPrice } from "@/lib/pricing"
import { toast } from "sonner"

interface DiscountableRow {
  id: string
  name: string
  price_pence: number
  discount_percent: number | null
}

interface ClassDiscountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: DiscountableRow[]
}

/**
 * A promotion is almost always studio-wide and time-boxed, so this sets one
 * across many classes at once rather than making the admin open nine separate
 * class forms and remember the same percentage nine times.
 *
 * Class packs are not listed: the discount only exists on `classes`.
 */
export function ClassDiscountDialog({
  open,
  onOpenChange,
  classes,
}: ClassDiscountDialogProps) {
  const [percent, setPercent] = useState("20")
  const [startsOn, setStartsOn] = useState("")
  const [endsOn, setEndsOn] = useState("")
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(classes.map((c) => c.id))
  )
  const [saving, setSaving] = useState(false)

  const pct = parseInt(percent) || 0
  const anyDiscounted = classes.some((c) => c.discount_percent !== null)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleApply() {
    if (selected.size === 0) {
      toast.error("Pick at least one class.")
      return
    }
    setSaving(true)
    try {
      const res = await setClassDiscount(
        [...selected],
        pct,
        startsOn,
        endsOn || null
      )
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.stripeWarning) {
        toast.warning(`Discount saved for ${res.updated} classes`, {
          description: res.stripeWarning,
          duration: 12000,
        })
      } else {
        toast.success(
          `${pct}% off applied to ${res.updated} class${res.updated === 1 ? "" : "es"}`
        )
      }
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    try {
      const res = await clearClassDiscount([])
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        res.updated ? `Discount removed from ${res.updated} classes` : "No discounts to remove"
      )
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run a class discount</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <p className="text-[0.78rem] text-warm-grey">
            Applies to individual class prices only. Class packs keep their
            current pricing.
          </p>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="discount_percent">Discount</Label>
              <div className="relative">
                <Input
                  id="discount_percent"
                  type="number"
                  min={1}
                  max={99}
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  className="pr-7"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.8rem] text-warm-grey">
                  %
                </span>
              </div>
            </div>
            <div>
              <Label htmlFor="discount_starts">Starts</Label>
              <Input
                id="discount_starts"
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="discount_ends">Ends</Label>
              <Input
                id="discount_ends"
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </div>
          </div>

          <p className="text-[0.7rem] text-warm-grey">
            Prices go back to normal by themselves the day after the end date.
            Leave the end date empty to run it until you stop it.
          </p>

          <div>
            <Label>Classes</Label>
            <div className="mt-1.5 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-sand p-2">
              {classes.map((cls) => {
                const now = cls.price_pence
                const then = effectivePricePence({
                  price_pence: cls.price_pence,
                  discount_percent: pct || null,
                  discount_starts_on: null,
                  discount_ends_on: null,
                })
                const on = selected.has(cls.id)
                return (
                  <label
                    key={cls.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-cream"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(cls.id)}
                      className="size-4 accent-[var(--color-cocoa,#4a3728)]"
                    />
                    <span className="flex-1 text-[0.8rem] text-cocoa">{cls.name}</span>
                    <span className="text-[0.78rem] tabular-nums">
                      {on && pct > 0 && pct < 100 ? (
                        <>
                          <s className="text-warm-grey">{formatPrice(now)}</s>{" "}
                          <strong className="text-cocoa">{formatPrice(then)}</strong>
                        </>
                      ) : (
                        <span className="text-warm-grey">{formatPrice(now)}</span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {anyDiscounted ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleClear}
              disabled={saving}
              className="text-warm-grey hover:text-red-600"
            >
              End all discounts now
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" onClick={handleApply} disabled={saving}>
            {saving ? "Saving…" : "Apply discount"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
