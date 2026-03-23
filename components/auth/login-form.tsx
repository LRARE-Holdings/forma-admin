"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Mail, Lock, Loader2, CheckCircle, ArrowLeft } from "lucide-react"

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<"login" | "forgot">("login")
  const [resetSent, setResetSent] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setLoading(false)
      setError("Invalid email or password")
      return
    }

    // Supabase session is now set in cookies — let the server
    // resolve the user's role and redirect appropriately
    router.refresh()
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setResetSent(true)
  }

  if (resetSent) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-bg">
          <CheckCircle className="h-6 w-6 text-success" />
        </div>
        <h2 className="font-heading text-xl font-semibold text-cocoa">
          Check your email
        </h2>
        <p className="mt-2 text-sm text-warm-grey">
          We sent a password reset link to{" "}
          <span className="font-medium text-cocoa">{email}</span>
        </p>
        <button
          onClick={() => {
            setResetSent(false)
            setMode("login")
          }}
          className="mt-4 text-xs font-semibold uppercase tracking-wider text-gold hover:text-ember"
        >
          Back to sign in
        </button>
      </div>
    )
  }

  if (mode === "forgot") {
    return (
      <form onSubmit={handleForgotPassword} className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setMode("login")
            setError(null)
          }}
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-warm-grey hover:text-cocoa"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>

        <p className="text-sm text-warm-grey">
          Enter your email and we&apos;ll send you a link to reset your password.
        </p>

        <div className="space-y-2">
          <Label htmlFor="reset-email" className="text-xs font-semibold uppercase tracking-wider text-warm-grey">
            Email address
          </Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-grey" />
            <Input
              id="reset-email"
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
            "Send reset link"
          )}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={handleLogin} className="space-y-4">
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

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-warm-grey">
            Password
          </Label>
          <button
            type="button"
            onClick={() => {
              setMode("forgot")
              setError(null)
            }}
            className="text-xs font-semibold text-gold hover:text-ember"
          >
            Forgot password?
          </button>
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-grey" />
          <Input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          "Sign in"
        )}
      </Button>
    </form>
  )
}
