"use client"

import { useRef } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SubmitButton } from "@/components/shared/submit-button"
import { updateStudioSettings } from "@/app/actions/studio"
import { toast } from "sonner"

interface StudioData {
  name: string
  slug: string
  domain: string | null
  email_from: string | null
  email_domain: string | null
  plan_tier: string
  active: boolean
}

interface SettingsFormProps {
  studio: StudioData
}

export function SettingsForm({ studio }: SettingsFormProps) {
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(formData: FormData) {
    try {
      await updateStudioSettings(formData)
      toast.success("Settings updated")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update settings")
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Studio Profile */}
      <div className="overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="border-b border-sand px-5 py-4">
          <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
            Studio Profile
          </h3>
        </div>
        <form ref={formRef} key={`${studio.name}-${studio.domain}-${studio.email_from}-${studio.email_domain}`} action={handleSubmit} className="space-y-4 p-5">
          <div>
            <Label htmlFor="name" className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
              Studio Name
            </Label>
            <Input id="name" name="name" defaultValue={studio.name} required />
          </div>
          <div>
            <Label htmlFor="domain" className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
              Domain
            </Label>
            <Input id="domain" name="domain" defaultValue={studio.domain ?? ""} placeholder="burnmatstudio.co.uk" />
          </div>
          <div>
            <Label htmlFor="email_from" className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
              Email From
            </Label>
            <Input id="email_from" name="email_from" defaultValue={studio.email_from ?? ""} placeholder="hello@studio.com" />
          </div>
          <div>
            <Label htmlFor="email_domain" className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
              Email Domain
            </Label>
            <Input id="email_domain" name="email_domain" defaultValue={studio.email_domain ?? ""} placeholder="useforma.co.uk" />
          </div>
          <div>
            <Label className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
              Slug
            </Label>
            <div className="text-[0.9rem] text-cocoa">{studio.slug}</div>
          </div>
          <div className="pt-2">
            <SubmitButton>Save changes</SubmitButton>
          </div>
        </form>
      </div>

      {/* Subscription (read-only) */}
      <div className="overflow-hidden rounded-2xl border border-sand bg-white">
        <div className="border-b border-sand px-5 py-4">
          <h3 className="font-heading text-[1.15rem] font-semibold text-cocoa">
            Subscription
          </h3>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <label className="mb-1 block text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
                Plan
              </label>
              <div className="text-[0.9rem] text-cocoa capitalize">
                {studio.plan_tier}
              </div>
            </div>
            <span
              className={`inline-block rounded-full px-3 py-1 text-[0.65rem] font-semibold uppercase ${
                studio.active
                  ? "bg-success-bg text-success"
                  : "bg-warm-grey/10 text-warm-grey"
              }`}
            >
              {studio.active ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
