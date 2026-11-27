/**
 * Plain-English "what this means / what to do" for everything the status
 * page can show going wrong. Each rule is written for Burn as it is today:
 * where to click, who to ask, and when to tell Claude.
 *
 * Anything not covered here still shows its full detail, with the general
 * advice from unknownError().
 */

export interface Insight {
  meaning: string
  steps: string[]
  /** How to stop it happening again, when there's a known fix. */
  prevent?: string
}

export type Platform = "website" | "admin" | "services"

/** Which dashboard a check belongs to. */
export function platformOf(key: string): Platform {
  if (/^site\.(public|timetable|checkout|gift)\./.test(key)) return "website"
  if (/^site\.admin\./.test(key) || /^(stripe\.webhooks|stripe\.fulfilment|supabase\.jobs|vercel\.jobs|bookings\.|errors\.)/.test(key)) {
    return "admin"
  }
  return "services"
}

const TELL_ME = "On the error's page, press Copy details for Claude and paste them to Claude."

export function checkInsight(key: string, status: string, summary: string): Insight | null {
  if (status === "ok" || status === "unknown") return null
  const slow = /slow/i.test(summary)

  if (/^site\.(public|timetable|gift)\./.test(key)) {
    return slow
      ? {
          meaning: "Pages are loading slowly for members. They still work, but some people give up before the timetable appears.",
          steps: [
            "Look at Services below: a slow Supabase or a Vercel incident is the usual cause.",
            "If it's still slow in an hour, tell Claude.",
          ],
        }
      : {
          meaning: "Members can't load this part of the website, so bookings and sales through it have stopped.",
          steps: [
            "Open burnmatstudio.co.uk on your phone to see what members see.",
            "Check Services below and vercel-status.com for an outage.",
            "If a new version went out just before it broke, roll back: Vercel → bms → Deployments → the previous one → Promote.",
            TELL_ME,
          ],
        }
  }
  if (/^site\.checkout\./.test(key)) {
    return {
      meaning: "The website's checkout isn't answering, so nobody can pay for a class, pack or gift card.",
      steps: [
        "Try booking a drop-in on the website yourself (you can cancel before paying).",
        "Check Stripe and Vercel in Services below.",
        TELL_ME,
      ],
    }
  }
  if (/^site\.admin\./.test(key)) {
    return {
      meaning: "Lucy can't open her dashboard. The members' website and payments carry on without it.",
      steps: ["Open admin.burnmatstudio.co.uk yourself.", "Check vercel-status.com.", TELL_ME],
    }
  }
  if (key === "site.certificates") {
    return {
      meaning: "A site's HTTPS certificate hasn't renewed. When it runs out, browsers show members a security warning instead of the site.",
      steps: [
        "Vercel renews these on its own. In Vercel → Domains, check each domain says Valid Configuration.",
        "If one shows a DNS error, the domain's records changed: tell Claude.",
      ],
    }
  }
  if (key === "site.domains") {
    return {
      meaning: "A domain is close to its renewal date. If it lapses, the website and emails from it stop.",
      steps: ["Log in to the domain registrar and check auto-renew is on and the card on file is current."],
    }
  }
  if (key === "supabase.database") {
    return /connections/i.test(summary)
      ? {
          meaning: "The database is running out of connections. If it hits the limit, pages and payments start failing.",
          steps: ["Usually a short spike that clears in minutes.", "If it stays high for 15 minutes, tell Claude."],
        }
      : {
          meaning: "The database isn't answering properly. Anything that needs data (logins, bookings, payments turning into bookings) is affected.",
          steps: [
            "Check status.supabase.com and Services below.",
            "In the Supabase dashboard, open the Forma DB project and check it isn't paused.",
            TELL_ME,
          ],
        }
  }
  if (key === "supabase.auth") {
    return {
      meaning: "Supabase's login service isn't answering, so members and Lucy can't log in. People already logged in carry on.",
      steps: ["Check status.supabase.com.", "Nothing to change on our side: it recovers when Supabase does."],
    }
  }
  if (key === "supabase.jobs") {
    return {
      meaning: "The database's scheduled jobs aren't running on time: event reminders, ticket holds and waitlist offers wait until they do.",
      steps: [
        "Supabase dashboard → Forma DB → Integrations → Cron: check the jobs are active.",
        "If they're active but failing, tell Claude.",
      ],
    }
  }
  if (key === "vercel.jobs") {
    return {
      meaning: "A daily job didn't run or hit errors: the nightly Stripe sync (Money page figures), gift card emails or birthday emails.",
      steps: [
        "See Background jobs on the Admin app tab for which one and the error.",
        "Missed gift card and birthday emails go out on the next run; tell Claude if one needs sending sooner.",
      ],
    }
  }
  if (key === "resend.domains") {
    return {
      meaning: "Resend can't send from Burn's email domain, so booking confirmations, gift cards and receipts aren't going out.",
      steps: ["Resend → Domains: check burnmatstudio.co.uk still shows Verified.", "If DNS records changed, tell Claude."],
    }
  }
  if (key === "resend.delivery") {
    return {
      meaning: "Some emails aren't reaching people. Usually it's one member with a mistyped address.",
      steps: [
        "See Emails on the Admin app tab for which addresses bounced.",
        "Ask Lucy to check the address with the member and fix it in Members.",
      ],
    }
  }
  if (key === "stripe.account") {
    return {
      meaning: "Stripe has paused something on Burn's account, or needs details from Lucy by a deadline.",
      steps: ["Lucy logs in to her Stripe dashboard: a banner at the top says exactly what Stripe needs."],
    }
  }
  if (key === "stripe.webhooks") {
    return {
      meaning: "Stripe can't tell the admin app about payments. People are paying, but their bookings, packs and gift cards aren't being created.",
      steps: [
        "Stripe → Developers → Webhooks: check the endpoint is enabled and look at the failed deliveries.",
        "Stripe keeps retrying for 3 days, so nothing is lost once it's fixed.",
        TELL_ME,
      ],
    }
  }
  if (key === "stripe.fulfilment") {
    return {
      meaning: "Someone paid and has nothing to show for it: no booking, pack or gift card.",
      steps: [
        "Open the payment in Stripe (listed in the detail).",
        "Give them what they bought by hand (Bookings → Add booking, or Members → add a pack), or refund it in Stripe.",
        TELL_ME,
      ],
    }
  }
  if (key === "bookings.stranded") {
    return {
      meaning: "Members are booked into a class that's no longer on the timetable, so it won't show on the register.",
      steps: ["Lucy's Overview page shows these with a button to move each booking onto the live class."],
    }
  }
  if (key === "bookings.products") {
    return {
      meaning: "Something on sale has no price in Stripe yet, so nobody can buy it until the 3am sync.",
      steps: ["It fixes itself overnight.", "If it can't wait, tell Claude to run the sync now."],
    }
  }
  if (key === "errors.recent") {
    return {
      meaning: "More errors than usual in the last hour.",
      steps: ["Open the errors on the Website and Admin app tabs, starting with the most frequent."],
    }
  }
  if (key.endsWith(".status")) {
    return {
      meaning: "This is the provider's own status page. Our own checks decide whether Burn is affected.",
      steps: ["Nothing to do unless one of Burn's checks fails as well."],
    }
  }
  return null
}

export function errorInsight(group: { app: string; kind: string; title: string; path?: string | null }): Insight {
  const t = group.title
  if (/No studio context/i.test(t)) {
    return {
      meaning: "A request reached the admin app without saying which studio it was for. Browsers asking for an icon do this.",
      steps: ["Nothing members see. Fixed on 26 Nov; if it keeps coming back, tell Claude."],
    }
  }
  if (/class is full|is full/i.test(t)) {
    return {
      meaning: "Someone tried to book a class that had just filled up.",
      steps: [
        "If they paid by card, the payment was refunded automatically and they were emailed.",
        "Check Payments on the Admin app tab to confirm the refund went through.",
      ],
      prevent: "Holding the place while someone pays stops this. Ask Claude if it keeps happening.",
    }
  }
  if (/email|resend/i.test(t)) {
    return {
      meaning: "An email didn't send. The booking or payment itself is fine; only the email is missing.",
      steps: ["Check Emails on the Admin app tab.", "Resend the email from the booking or gift card if the member needs it."],
    }
  }
  if (/fetch failed|ECONN|ETIMEDOUT|timed? ?out|socket/i.test(t)) {
    return {
      meaning: "A call to another service (Supabase, Stripe or Resend) didn't answer in time.",
      steps: ["One or two is a blip and needs nothing.", "If it keeps happening, check Services on the Overview tab, then tell Claude."],
    }
  }
  if (/JWT|permission denied|row-level security|RLS/i.test(t)) {
    return {
      meaning: "The database refused access. Usually a login that ran out mid-action.",
      steps: ["If it was one person, it fixes itself when they log in again.", "If it's repeating, tell Claude."],
    }
  }
  if (/duplicate key|already exists/i.test(t)) {
    return {
      meaning: "Something tried to save the same thing twice, so the second one was stopped. Nothing was lost.",
      steps: ["Usually a double click or Stripe retrying. Nothing to do unless a member reports a problem."],
    }
  }
  if (group.kind === "browser") {
    return {
      meaning: "Someone saw the \"Something went wrong\" page in their browser.",
      steps: ["Check whether it's still happening (last seen, above).", TELL_ME, "Mark it resolved once fixed; it reopens if it comes back."],
    }
  }
  return {
    meaning: "An error the monitor hasn't seen before. Its page shows where it happened and what led up to it.",
    steps: [
      "Check whether it's still happening (last seen, above).",
      TELL_ME,
      "Mark it resolved once fixed: it reopens if it comes back.",
    ],
  }
}

/** Card decline reasons in plain words, and whether they're the customer's side. */
export function declineReason(code?: string | null, declineCode?: string | null, message?: string | null): {
  label: string
  meaning: string
} {
  const c = declineCode || code || ""
  const map: Record<string, [string, string]> = {
    insufficient_funds: ["Card declined: not enough money", "The bank said no. Normal; most people try another card."],
    expired_card: ["Card expired", "Normal."],
    incorrect_cvc: ["Wrong security code", "A typo. They usually try again."],
    incorrect_number: ["Wrong card number", "A typo. They usually try again."],
    generic_decline: ["Card declined by the bank", "The bank didn't say why. Normal in small numbers."],
    card_declined: ["Card declined by the bank", "The bank didn't say why. Normal in small numbers."],
    do_not_honor: ["Card declined by the bank", "The bank didn't say why. Normal in small numbers."],
    authentication_required: ["Bank check (3D Secure) needed", "They didn't finish the bank's check. Normal on phones."],
    payment_intent_authentication_failure: ["Bank check (3D Secure) failed", "They closed or failed the bank's check. Normal on phones."],
    lost_card: ["Card reported lost", "Stripe blocked it. Nothing to do."],
    stolen_card: ["Card reported stolen", "Stripe blocked it. Nothing to do."],
    fraudulent: ["Blocked as likely fraud", "Stripe blocked it. Nothing to do."],
    processing_error: ["Card processor error", "A glitch between Stripe and the bank. Worth watching if it repeats."],
    card_velocity_exceeded: ["Card limit reached", "The bank's spending limit. Normal."],
  }
  const hit = map[c]
  if (hit) return { label: hit[0], meaning: hit[1] }
  return { label: message?.replace(/\.$/, "") || "Payment failed", meaning: "Unusual reason: worth a look if it repeats." }
}

export function stripeEventLabel(type: string): string {
  const map: Record<string, string> = {
    "payment_intent.succeeded": "Payment succeeded",
    "checkout.session.completed": "Checkout completed",
    "charge.refunded": "Refund",
    "charge.dispute.created": "Dispute opened",
    "customer.subscription.created": "Membership started",
    "customer.subscription.updated": "Membership changed",
    "customer.subscription.deleted": "Membership ended",
    "payout.created": "Payout created",
    "payout.paid": "Payout paid",
    "payout.failed": "Payout failed",
  }
  return map[type] ?? type
}

const PAGES: [RegExp, string][] = [
  [/^\/dashboard\/bookings/, "Bookings"],
  [/^\/dashboard\/members/, "Members"],
  [/^\/dashboard\/timetable/, "Timetable"],
  [/^\/dashboard\/registration/, "Registration"],
  [/^\/dashboard\/classes/, "Classes"],
  [/^\/dashboard\/events/, "Events"],
  [/^\/dashboard\/packages/, "Packages"],
  [/^\/dashboard\/gift-cards/, "Gift cards"],
  [/^\/dashboard\/memberships/, "Memberships"],
  [/^\/dashboard\/money/, "Money"],
  [/^\/dashboard\/analytics/, "Insights"],
  [/^\/dashboard\/team/, "Team"],
  [/^\/dashboard\/settings/, "Settings"],
  [/^\/dashboard\/audit/, "Credit audit"],
  [/^\/dashboard\/status/, "Status"],
  [/^\/dashboard\/?$/, "Overview"],
  [/^\/staff/, "Instructor pages"],
  [/^\/check-in/, "Door check-in"],
  [/^\/api\/checkout/, "Paying"],
  [/^\/api\/bookings/, "Booking a class"],
  [/^\/api\/waitlist/, "Waitlist"],
  [/^\/api\/gift/, "Gift cards"],
  [/^\/api\/events/, "Events"],
  [/^\/api\/timetable/, "Timetable"],
  [/^\/api\/auth/, "Logging in"],
  [/^\/api\/billing/, "Memberships"],
  [/^\/api\/wallet/, "Wallet passes"],
  [/^\/api\/monitor/, "Monitor"],
  [/^\/api\/internal/, "Internal jobs"],
  [/^\/api\/stripe/, "Stripe webhook"],
  [/^\/account/, "Member account"],
  [/^\/gift/, "Gift cards"],
]

export function pageLabel(path?: string | null): string {
  if (!path) return "Unknown page"
  const clean = path.split("?")[0]
  return PAGES.find(([re]) => re.test(clean))?.[1] ?? clean
}
