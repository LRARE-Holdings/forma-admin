"use client"

import { useEffect, useRef, useState } from "react"
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
import { SubmitButton } from "@/components/shared/submit-button"
import { addMemberCredits, adjustMemberCredits } from "@/app/actions/packs"
import { toast } from "sonner"

interface PackRow {
  id: string
  pack_type: string
  credits_total: number
  credits_remaining: number
  expires_at: string
}

interface MemberPacksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: { id: string; name: string } | null
  packs: PackRow[]
}

export function MemberPacksDialog({
  open,
  onOpenChange,
  member,
  packs,
}: MemberPacksDialogProps) {
  const addFormRef = useRef<HTMLFormElement>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingPackId, setEditingPackId] = useState<string | null>(null)

  // Reset internal state when dialog closes or member changes
  useEffect(() => {
    if (!open) {
      setShowAddForm(false)
      setEditingPackId(null)
      addFormRef.current?.reset()
    }
  }, [open])

  if (!member) return null

  async function handleAddCredits(formData: FormData) {
    formData.set("profile_id", member!.id)
    try {
      await addMemberCredits(formData)
      toast.success("Credits added")
      setShowAddForm(false)
      addFormRef.current?.reset()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add credits")
    }
  }

  async function handleAdjust(packId: string, formData: FormData) {
    try {
      await adjustMemberCredits(packId, formData)
      toast.success("Credits adjusted")
      setEditingPackId(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to adjust credits")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{member.name} — Pack credits</DialogTitle>
        </DialogHeader>

        {packs.length === 0 && !showAddForm ? (
          <p className="py-4 text-center text-sm text-warm-grey">
            No packs for this member.
          </p>
        ) : (
          <div className="space-y-3">
            {packs.map((pack) => {
              const expired = new Date(pack.expires_at) < new Date()
              return (
                <div
                  key={pack.id}
                  className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                    expired ? "border-warm-grey/20 bg-warm-grey/5" : "border-sand"
                  }`}
                >
                  <div>
                    <div className="text-[0.82rem] font-semibold text-cocoa">
                      {pack.pack_type}-class pack
                    </div>
                    <div className="text-[0.7rem] text-warm-grey">
                      Expires{" "}
                      {new Date(pack.expires_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {expired && " (expired)"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {editingPackId === pack.id ? (
                      <form
                        action={(fd) => handleAdjust(pack.id, fd)}
                        className="flex items-center gap-2"
                      >
                        <Input
                          key={`${pack.id}-${pack.credits_remaining}`}
                          name="credits_remaining"
                          type="number"
                          min={0}
                          max={pack.credits_total}
                          defaultValue={pack.credits_remaining}
                          className="w-16"
                        />
                        <SubmitButton>Save</SubmitButton>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingPackId(null)}
                        >
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <>
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold ${
                            pack.credits_remaining > 0
                              ? "bg-gold/15 text-gold"
                              : "bg-warm-grey/10 text-warm-grey"
                          }`}
                        >
                          {pack.credits_remaining}/{pack.credits_total}
                        </span>
                        <button
                          onClick={() => setEditingPackId(pack.id)}
                          className="text-[0.72rem] font-semibold text-gold hover:text-ember"
                        >
                          Adjust
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {showAddForm ? (
          <form
            ref={addFormRef}
            action={handleAddCredits}
            className="space-y-3 rounded-lg border border-sand p-4"
          >
            <div className="text-[0.82rem] font-semibold text-cocoa">
              Add credits
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="add-credits">Credits</Label>
                <Input
                  id="add-credits"
                  name="credits"
                  type="number"
                  required
                  min={1}
                  placeholder="10"
                />
              </div>
              <div>
                <Label htmlFor="add-validity">Validity (days)</Label>
                <Input
                  id="add-validity"
                  name="validity_days"
                  type="number"
                  required
                  min={1}
                  defaultValue={42}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <SubmitButton>Add credits</SubmitButton>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <DialogFooter>
            <Button onClick={() => setShowAddForm(true)} size="sm">
              Add credits
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
