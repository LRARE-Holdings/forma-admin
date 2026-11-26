export type CheckStatus = "ok" | "warn" | "down" | "unknown"

export type CheckArea =
  | "site"
  | "supabase"
  | "vercel"
  | "resend"
  | "stripe"
  | "bookings"
  | "errors"

export const AREA_LABELS: Record<CheckArea, string> = {
  site: "Websites",
  supabase: "Supabase",
  vercel: "Vercel",
  resend: "Resend",
  stripe: "Stripe",
  bookings: "Bookings & data",
  errors: "Errors",
}

export interface CheckResult {
  key: string
  label: string
  area: CheckArea
  status: CheckStatus
  /** One line, written for a phone notification. */
  summary: string
  /** Extra lines shown on the status page and in the email. */
  lines?: string[]
  /**
   * Alert on the first bad result instead of waiting for a second run to
   * confirm it. For problems that are never a blip: a member paid and got
   * nothing, Stripe has switched payouts off.
   */
  urgent?: boolean
  /** Record it and show it on the status page, but don't push an alert. */
  quiet?: boolean
}

export interface LiveStudio {
  id: string
  name: string
  domain: string
  email_domain: string | null
  stripe_account_id: string | null
}

export interface MonitorConfig {
  telegram_token?: string
  telegram_chat_id?: string
  ntfy_topic?: string
  alert_email?: string
}
