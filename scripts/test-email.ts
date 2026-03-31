import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })
import { Resend } from "resend"
import { createClient } from "@supabase/supabase-js"

const STUDIO_ID = process.env.NEXT_PUBLIC_STUDIO_ID!

const COLORS = {
  cocoa: "#473728",
  gold: "#C4A95A",
  wheat: "#DFD0A5",
  cream: "#F5F0E8",
  sand: "#E8DCC8",
  warmGrey: "#8A8070",
  white: "#FFFFFF",
} as const

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: studio } = await supabase
    .from("studios")
    .select("name, email_from, email_domain")
    .eq("id", STUDIO_ID)
    .single()

  const studioName = studio?.name ?? "Forma Studio"
  const emailFrom = studio?.email_from ?? "noreply@useforma.co.uk"
  // email_from is already a full email address
  const from = `${studioName} <${emailFrom}>`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:${COLORS.cream};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.cream};padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:${COLORS.white};border-radius:12px;border:1px solid ${COLORS.sand};overflow:hidden;">
        <!-- Header -->
        <tr><td style="background-color:${COLORS.cocoa};padding:24px 32px;" align="center">
          <img src="https://yzcerbbiifususbxczns.supabase.co/storage/v1/object/sign/forma/burn-light.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9iMzA5MDMxNC0zYWM3LTQxNzAtOTBiZi0xMzU3ZDdkZTBiMmUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJmb3JtYS9idXJuLWxpZ2h0LnBuZyIsImlhdCI6MTc3NDk2MzA4OCwiZXhwIjoxODY5NTcxMDg4fQ.pRHHxo0F52S2d7ryCvqf7sceyNe59MMYIfxGJHmWqo0" alt="${studioName}" width="180" style="display:block;" />
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:15px;color:${COLORS.cocoa};">Hi Alex,</p>
          <p style="margin:0 0 16px;font-size:15px;color:${COLORS.cocoa};">This is a test email to verify the new logo header is working correctly.</p>
          <p style="margin:0;font-size:14px;color:${COLORS.warmGrey};">If you can see the Burn Mat Studio logo above, the update was successful.</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid ${COLORS.sand};">
          <span style="font-size:12px;color:${COLORS.warmGrey};">Sent by ${studioName} via Forma</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const resend = new Resend(process.env.RESEND_API_KEY!)
  const { data, error } = await resend.emails.send({
    from,
    to: "alex@pellar.co.uk",
    subject: "Test — New logo header",
    html,
  })

  if (error) {
    console.error("Failed:", error)
    process.exit(1)
  }

  console.log("Sent! ID:", data?.id)
}

main()
