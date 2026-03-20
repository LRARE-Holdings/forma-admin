/**
 * Create a test admin user for a Forma studio.
 *
 * Usage:
 *   npx tsx scripts/create-test-admin.ts <email> [name]
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and STUDIO_ID from .env.local
 * (or the environment). Creates an auth user, profile, and admin membership.
 *
 * The user can then log in via magic link on the admin panel.
 */

import { createClient } from "@supabase/supabase-js"
import { config } from "dotenv"
import { resolve } from "path"

// Load .env.local from the project root
config({ path: resolve(process.cwd(), ".env.local") })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const STUDIO_ID = process.env.NEXT_PUBLIC_STUDIO_ID

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !STUDIO_ID) {
  console.error("Missing required env vars. Ensure .env.local contains:")
  console.error("  NEXT_PUBLIC_SUPABASE_URL")
  console.error("  SUPABASE_SERVICE_ROLE_KEY")
  console.error("  NEXT_PUBLIC_STUDIO_ID")
  process.exit(1)
}

const email = process.argv[2]
const name = process.argv[3] || "Test Admin"

if (!email) {
  console.error("Usage: npx tsx scripts/create-test-admin.ts <email> [name]")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  console.log(`Creating test admin for studio ${STUDIO_ID}...`)
  console.log(`  Email: ${email}`)
  console.log(`  Name:  ${name}`)
  console.log()

  // Check if user already exists
  const { data: existingUsers } = await supabase.auth.admin.listUsers()
  const existing = existingUsers?.users?.find((u) => u.email === email)

  let userId: string

  if (existing) {
    console.log(`Auth user already exists (${existing.id}), reusing.`)
    userId = existing.id
  } else {
    // Create auth user with email confirmed
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: name },
    })

    if (error) {
      console.error("Failed to create auth user:", error.message)
      process.exit(1)
    }

    userId = data.user.id
    console.log(`Created auth user: ${userId}`)
  }

  // Upsert profile
  const { error: profileError } = await supabase.from("profiles").upsert(
    { id: userId, full_name: name, email },
    { onConflict: "id" }
  )

  if (profileError) {
    console.error("Failed to upsert profile:", profileError.message)
    process.exit(1)
  }
  console.log("Profile ready.")

  // Check for existing membership
  const { data: existingMembership } = await supabase
    .from("studio_memberships")
    .select("id, role")
    .eq("studio_id", STUDIO_ID)
    .eq("profile_id", userId)
    .maybeSingle()

  if (existingMembership) {
    if (existingMembership.role === "admin") {
      console.log("Admin membership already exists. Nothing to do.")
    } else {
      // Upgrade to admin
      await supabase
        .from("studio_memberships")
        .update({ role: "admin" })
        .eq("id", existingMembership.id)
      console.log(`Upgraded existing ${existingMembership.role} membership to admin.`)
    }
  } else {
    const { error: membershipError } = await supabase
      .from("studio_memberships")
      .insert({ studio_id: STUDIO_ID, profile_id: userId, role: "admin" })

    if (membershipError) {
      console.error("Failed to create membership:", membershipError.message)
      process.exit(1)
    }
    console.log("Admin membership created.")
  }

  console.log()
  console.log("Done! The user can now log in via magic link at the admin panel.")
}

main()
