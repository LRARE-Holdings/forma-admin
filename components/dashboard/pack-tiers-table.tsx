"use client"

import { useState } from "react"
import { formatPence } from "@/lib/utils"
import { EmptyState } from "@/components/shared/empty-state"
import { PackTierFormDialog } from "./pack-tier-form-dialog"
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog"
import { deletePackTier } from "@/app/actions/packs"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { toast } from "sonner"

interface TierRow {
  id: string
  name: string
  credits: number
  price_pence: number
  validity_days: number
  is_active: boolean
}

interface PackTiersTableProps {
  tiers: TierRow[]
}

export function PackTiersTable({ tiers }: PackTiersTableProps) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingTier, setEditingTier] = useState<TierRow | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletingTier, setDeletingTier] = useState<TierRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  function openCreate() {
    setEditingTier(null)
    setFormOpen(true)
  }

  function openEdit(tier: TierRow) {
    setEditingTier(tier)
    setFormOpen(true)
  }

  function openDelete(tier: TierRow) {
    setDeletingTier(tier)
    setDeleteOpen(true)
  }

  async function handleDelete() {
    if (!deletingTier) return
    setDeleteLoading(true)
    try {
      await deletePackTier(deletingTier.id)
      toast.success("Pack tier archived")
      setDeleteOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to archive tier")
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="flex items-center justify-between border-b border-sand px-5 py-4">
          <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
            Pack tiers
          </h3>
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New tier
          </Button>
        </div>
        {tiers.length === 0 ? (
          <EmptyState
            icon="star"
            title="No pack tiers yet"
            description="Create your first pack tier to start selling class packs."
            action={
              <Button onClick={openCreate} size="sm">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New tier
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Name", "Credits", "Price", "Validity", "Status", ""].map(
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
                {tiers.map((tier) => (
                  <tr
                    key={tier.id}
                    className="border-b border-sand/50 transition-colors last:border-b-0 hover:bg-cream/50"
                  >
                    <td className="px-5 py-3 text-[0.82rem]">
                      <strong className="text-cocoa">{tier.name}</strong>
                    </td>
                    <td className="px-5 py-3 text-[0.82rem] text-slate">
                      {tier.credits} classes
                    </td>
                    <td className="px-5 py-3 text-[0.82rem] text-slate">
                      &pound;{formatPence(tier.price_pence)}
                    </td>
                    <td className="px-5 py-3 text-[0.82rem] text-slate">
                      {tier.validity_days} days
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase ${
                          tier.is_active
                            ? "bg-success-bg text-success"
                            : "bg-warm-grey/10 text-warm-grey"
                        }`}
                      >
                        {tier.is_active ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => openEdit(tier)}
                          className="text-[0.75rem] font-semibold text-gold hover:text-ember"
                        >
                          Edit
                        </button>
                        {tier.is_active && (
                          <button
                            onClick={() => openDelete(tier)}
                            className="text-[0.75rem] font-semibold text-warm-grey hover:text-red-600"
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PackTierFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingTier={editingTier}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Archive pack tier"
        description={`Archive "${deletingTier?.name}"? It will no longer be available for purchase, but existing packs won't be affected.`}
        onConfirm={handleDelete}
        loading={deleteLoading}
        actionLabel="Archive"
      />
    </>
  )
}
