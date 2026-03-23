"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Lock, Loader2 } from "lucide-react"

interface SetPasswordFormProps {
  redirectTo: string
}

export function SetPasswordForm({ redirectTo }: SetPasswordFormProps) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }

    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setLoading(false)
      setError(error.message)
      return
    }

    router.push(redirectTo)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-warm-grey">
          Password
        </Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-grey" />
          <Input
            id="password"
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="pl-10 bg-cream border-sand text-cocoa placeholder:text-warm-grey/50"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password" className="text-xs font-semibold uppercase tracking-wider text-warm-grey">
          Confirm password
        </Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-grey" />
          <Input
            id="confirm-password"
            type="password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className="pl-10 bg-cream border-sand text-cocoa placeholder:text-warm-grey/50"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-ember">{error}</p>
      )}

      <Button
        type="submit"
        disabled={loading}
        className="w-full rounded-full bg-gold text-cocoa font-semibold uppercase tracking-wider text-xs hover:bg-cocoa hover:text-wheat"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Set password & continue"
        )}
      </Button>
    </form>
  )
}
