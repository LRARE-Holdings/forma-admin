"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Mail, Loader2, CheckCircle } from "lucide-react"

interface LoginFormProps {
  studioId: string
}

export function LoginForm({ studioId }: LoginFormProps) {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { studio_id: studioId },
      },
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setSent(true)
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-bg">
          <CheckCircle className="h-6 w-6 text-success" />
        </div>
        <h2 className="font-heading text-xl font-semibold text-cocoa">
          Check your email
        </h2>
        <p className="mt-2 text-sm text-warm-grey">
          We sent a sign-in link to{" "}
          <span className="font-medium text-cocoa">{email}</span>
        </p>
        <button
          onClick={() => setSent(false)}
          className="mt-4 text-xs font-semibold uppercase tracking-wider text-gold hover:text-ember"
        >
          Try a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-warm-grey">
          Email address
        </Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-grey" />
          <Input
            id="email"
            type="email"
            placeholder="you@studio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
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
          "Send magic link"
        )}
      </Button>
    </form>
  )
}
