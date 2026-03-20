"use client"

import { useState } from "react"
import { ClassColorBar } from "@/components/shared/class-color-bar"
import { formatPence } from "@/lib/utils"
import { EmptyState } from "@/components/shared/empty-state"
import { ClassFormDialog } from "./class-form-dialog"
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog"
import { deleteClass } from "@/app/actions/classes"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { toast } from "sonner"

interface ClassRow {
  id: string
  name: string
  slug: string
  description: string
  duration_mins: number
  price_pence: number
  capacity: number
}

interface ClassesTableProps {
  classes: ClassRow[]
  slotsByClass: Record<string, number>
}

export function ClassesTable({ classes, slotsByClass }: ClassesTableProps) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingClass, setEditingClass] = useState<ClassRow | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletingClass, setDeletingClass] = useState<ClassRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  function openCreate() {
    setEditingClass(null)
    setFormOpen(true)
  }

  function openEdit(cls: ClassRow) {
    setEditingClass(cls)
    setFormOpen(true)
  }

  function openDelete(cls: ClassRow) {
    setDeletingClass(cls)
    setDeleteOpen(true)
  }

  async function handleDelete() {
    if (!deletingClass) return
    setDeleteLoading(true)
    try {
      await deleteClass(deletingClass.id)
      toast.success("Class deleted")
      setDeleteOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete class")
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="flex items-center justify-between border-b border-sand px-5 py-4">
          <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
            All classes
          </h3>
          {classes.length > 0 && (
            <Button onClick={openCreate} size="sm">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New class
            </Button>
          )}
        </div>
        {classes.length === 0 ? (
          <EmptyState
            icon="star"
            title="No classes yet"
            description="Create your first class type to get started."
            action={
              <Button onClick={openCreate} size="sm">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New class
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Class", "Duration", "Price", "Capacity", "Weekly slots", ""].map(
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
                {classes.map((cls) => {
                  const sessionsPerWeek = slotsByClass[cls.id] ?? 0

                  return (
                    <tr
                      key={cls.id}
                      className="border-b border-sand/50 transition-colors last:border-b-0 hover:bg-cream/50"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <ClassColorBar
                            classSlug={cls.slug}
                            className="w-[3px] h-5"
                          />
                          <strong className="text-[0.82rem] text-cocoa">
                            {cls.name}
                          </strong>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-[0.82rem] text-slate">
                        {cls.duration_mins} min
                      </td>
                      <td className="px-5 py-3 text-[0.82rem] text-slate">
                        &pound;{formatPence(cls.price_pence)}
                      </td>
                      <td className="px-5 py-3 text-[0.82rem] text-slate">
                        {cls.capacity}
                      </td>
                      <td className="px-5 py-3 text-[0.82rem] text-slate">
                        {sessionsPerWeek} session{sessionsPerWeek !== 1 ? "s" : ""}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => openEdit(cls)}
                            className="text-[0.75rem] font-semibold text-gold hover:text-ember"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => openDelete(cls)}
                            className="text-[0.75rem] font-semibold text-warm-grey hover:text-red-600"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ClassFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingClass={editingClass}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete class"
        description={`Are you sure you want to delete "${deletingClass?.name}"? This cannot be undone. Classes with active schedule slots cannot be deleted.`}
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </>
  )
}
