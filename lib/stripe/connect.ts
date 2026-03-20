import { stripe } from "./index"

/**
 * Create a Stripe Standard connected account for a studio.
 * Standard accounts: the studio owns the full Stripe dashboard and pays their own fees.
 */
export async function createConnectedAccount(studioName: string, email: string) {
  const account = await stripe.accounts.create({
    type: "standard",
    email,
    business_profile: {
      name: studioName,
      mcc: "7941", // Sports clubs, fields, and promoters
    },
  })

  return account
}

/**
 * Generate an Account Link for Stripe onboarding.
 * The admin is redirected to this URL to complete setup.
 */
export async function createAccountLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
) {
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    return_url: returnUrl,
    refresh_url: refreshUrl,
  })

  return link
}

/**
 * Check if a connected account has completed onboarding.
 */
export async function getAccountStatus(accountId: string) {
  const account = await stripe.accounts.retrieve(accountId)

  return {
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    isComplete: account.charges_enabled && account.payouts_enabled,
  }
}
