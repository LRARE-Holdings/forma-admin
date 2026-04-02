import type Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getStudioId } from "@/lib/studio-context"
import { formatPence, dayName, formatTime } from "@/lib/utils"
import { getMonthlyRevenue } from "@/lib/stripe/revenue"
import { revalidatePath } from "next/cache"
import { sendBookingConfirmation } from "@/lib/email/booking-confirmation"
import { sendBookingNotification } from "@/lib/email/booking-notification"
import type { AssistToolName } from "./permissions"

// ---------------------------------------------------------------------------
// Tool definitions (JSON Schema for Claude)
// ---------------------------------------------------------------------------

const allToolDefinitions: Record<AssistToolName, Anthropic.Tool> = {
  // ── Read tools ──────────────────────────────────────────────────────────

  list_classes: {
    name: "list_classes",
    description:
      "List all class types at this studio. Returns name, duration, price, capacity, and ID for each class.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  list_schedule: {
    name: "list_schedule",
    description:
      "List the weekly timetable. Can filter by day of week or instructor. Returns slot details with class name, instructor, day, time.",
    input_schema: {
      type: "object" as const,
      properties: {
        day_of_week: {
          type: "number",
          description:
            "Filter by day: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday",
        },
        instructor_id: {
          type: "string",
          description: "Filter by instructor ID",
        },
      },
      required: [],
    },
  },

  list_bookings: {
    name: "list_bookings",
    description:
      "List bookings. Can filter by date, status, member, or class. Returns up to 50 most recent bookings.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "Filter by date (YYYY-MM-DD)",
        },
        status: {
          type: "string",
          enum: ["confirmed", "cancelled"],
          description: "Filter by booking status",
        },
        profile_id: {
          type: "string",
          description: "Filter by member profile ID",
        },
        schedule_id: {
          type: "string",
          description: "Filter by schedule slot ID",
        },
      },
      required: [],
    },
  },

  list_members: {
    name: "list_members",
    description:
      "List all members at this studio. Returns name, email, join date, and profile ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        search: {
          type: "string",
          description:
            "Search by name or email (partial match)",
        },
      },
      required: [],
    },
  },

  get_member_packs: {
    name: "get_member_packs",
    description:
      "Get a specific member's class pack balances (active packs with remaining credits).",
    input_schema: {
      type: "object" as const,
      properties: {
        profile_id: {
          type: "string",
          description: "The member's profile ID",
        },
      },
      required: ["profile_id"],
    },
  },

  list_pack_tiers: {
    name: "list_pack_tiers",
    description:
      "List all class pack tiers (pricing options). Returns name, credits, price, validity, and active status.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  list_instructors: {
    name: "list_instructors",
    description:
      "List all instructors at this studio. Returns name, bio, and ID.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  get_studio_stats: {
    name: "get_studio_stats",
    description:
      "Get studio statistics: today's bookings, this week's bookings, active members, total revenue this month.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          enum: ["today", "this_week", "this_month"],
          description: "Time period for stats (default: today)",
        },
      },
      required: [],
    },
  },

  list_at_risk_members: {
    name: "list_at_risk_members",
    description:
      "List members who are at risk of churning — those who haven't booked a class in 30+ days. Returns name, email, last booking date, and days since last booking, sorted by longest absence first.",
    input_schema: {
      type: "object" as const,
      properties: {
        days_threshold: {
          type: "number",
          description:
            "Number of days without a booking to be considered at risk (default: 30)",
        },
      },
      required: [],
    },
  },

  // ── Admin write tools ──────────────────────────────────────────────────

  create_class: {
    name: "create_class",
    description:
      "Create a new class type. Requires name, duration in minutes, price in pounds, and capacity.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Class name (e.g. 'Hot Pilates')" },
        description: { type: "string", description: "Class description" },
        duration_mins: { type: "number", description: "Duration in minutes" },
        price_pounds: { type: "number", description: "Price in pounds (e.g. 12.50)" },
        capacity: { type: "number", description: "Max attendees per class" },
      },
      required: ["name", "duration_mins", "price_pounds", "capacity"],
    },
  },

  update_class: {
    name: "update_class",
    description: "Update an existing class type by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        class_id: { type: "string", description: "The class ID to update" },
        name: { type: "string", description: "New class name" },
        description: { type: "string", description: "New description" },
        duration_mins: { type: "number", description: "New duration in minutes" },
        price_pounds: { type: "number", description: "New price in pounds" },
        capacity: { type: "number", description: "New max capacity" },
      },
      required: ["class_id"],
    },
  },

  delete_class: {
    name: "delete_class",
    description:
      "Delete a class type. Will fail if the class has active schedule slots.",
    input_schema: {
      type: "object" as const,
      properties: {
        class_id: { type: "string", description: "The class ID to delete" },
      },
      required: ["class_id"],
    },
  },

  create_schedule_slot: {
    name: "create_schedule_slot",
    description:
      "Add a new slot to the weekly timetable. Requires class ID, instructor ID, day of week, start time, and end time.",
    input_schema: {
      type: "object" as const,
      properties: {
        class_id: { type: "string", description: "The class type ID" },
        instructor_id: { type: "string", description: "The instructor ID" },
        day_of_week: {
          type: "number",
          description: "0=Monday through 6=Sunday",
        },
        start_time: {
          type: "string",
          description: "Start time in HH:MM format (e.g. '07:00')",
        },
        end_time: {
          type: "string",
          description: "End time in HH:MM format (e.g. '08:00')",
        },
      },
      required: [
        "class_id",
        "instructor_id",
        "day_of_week",
        "start_time",
        "end_time",
      ],
    },
  },

  update_schedule_slot: {
    name: "update_schedule_slot",
    description: "Update an existing timetable slot.",
    input_schema: {
      type: "object" as const,
      properties: {
        slot_id: { type: "string", description: "The schedule slot ID" },
        class_id: { type: "string", description: "New class type ID" },
        instructor_id: { type: "string", description: "New instructor ID" },
        day_of_week: { type: "number", description: "New day (0-6)" },
        start_time: { type: "string", description: "New start time HH:MM" },
        end_time: { type: "string", description: "New end time HH:MM" },
      },
      required: ["slot_id"],
    },
  },

  delete_schedule_slot: {
    name: "delete_schedule_slot",
    description: "Remove a slot from the timetable (soft delete — marks as inactive).",
    input_schema: {
      type: "object" as const,
      properties: {
        slot_id: { type: "string", description: "The schedule slot ID to remove" },
      },
      required: ["slot_id"],
    },
  },

  create_booking: {
    name: "create_booking",
    description:
      "Create a manual booking for a member. Requires member profile ID, schedule slot ID, date, and payment method.",
    input_schema: {
      type: "object" as const,
      properties: {
        profile_id: { type: "string", description: "The member's profile ID" },
        schedule_id: { type: "string", description: "The schedule slot ID" },
        date: { type: "string", description: "Booking date (YYYY-MM-DD)" },
        payment_method: {
          type: "string",
          enum: ["pack_credit", "complimentary"],
          description: "Payment method (pack_credit or complimentary)",
        },
      },
      required: ["profile_id", "schedule_id", "date", "payment_method"],
    },
  },

  cancel_booking: {
    name: "cancel_booking",
    description: "Cancel a booking by its ID. Will refund pack credit if applicable.",
    input_schema: {
      type: "object" as const,
      properties: {
        booking_id: { type: "string", description: "The booking ID to cancel" },
      },
      required: ["booking_id"],
    },
  },

  create_pack_tier: {
    name: "create_pack_tier",
    description: "Create a new class pack tier.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Tier name (e.g. '10 Class Pack')" },
        credits: { type: "number", description: "Number of class credits" },
        price_pounds: { type: "number", description: "Price in pounds" },
        validity_days: { type: "number", description: "How many days the pack is valid" },
      },
      required: ["name", "credits", "price_pounds", "validity_days"],
    },
  },

  update_pack_tier: {
    name: "update_pack_tier",
    description: "Update an existing pack tier.",
    input_schema: {
      type: "object" as const,
      properties: {
        tier_id: { type: "string", description: "The pack tier ID" },
        name: { type: "string" },
        credits: { type: "number" },
        price_pounds: { type: "number" },
        validity_days: { type: "number" },
      },
      required: ["tier_id"],
    },
  },

  delete_pack_tier: {
    name: "delete_pack_tier",
    description: "Deactivate a pack tier (soft delete).",
    input_schema: {
      type: "object" as const,
      properties: {
        tier_id: { type: "string", description: "The pack tier ID" },
      },
      required: ["tier_id"],
    },
  },

  invite_staff: {
    name: "invite_staff",
    description:
      "Invite a new staff member / instructor. Creates their auth account, profile, membership, and instructor record.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Full name of the staff member" },
        email: { type: "string", description: "Their email address" },
      },
      required: ["name", "email"],
    },
  },

  // ── Staff-only tools ────────────────────────────────────────────────────

  my_schedule: {
    name: "my_schedule",
    description:
      "Get the current staff member's assigned classes from the timetable. Can filter by day.",
    input_schema: {
      type: "object" as const,
      properties: {
        day_of_week: {
          type: "number",
          description: "Filter by day: 0=Monday through 6=Sunday",
        },
      },
      required: [],
    },
  },

  my_class_attendees: {
    name: "my_class_attendees",
    description:
      "Get the attendee list for one of the staff member's classes on a specific date.",
    input_schema: {
      type: "object" as const,
      properties: {
        schedule_id: { type: "string", description: "The schedule slot ID" },
        date: { type: "string", description: "The date (YYYY-MM-DD)" },
      },
      required: ["schedule_id", "date"],
    },
  },

  my_stats: {
    name: "my_stats",
    description:
      "Get the staff member's class statistics: total classes this week, total attendees, average attendance.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
}

/** Get tool definitions filtered to the allowed set */
export function getToolDefinitions(
  allowedTools: AssistToolName[]
): Anthropic.Tool[] {
  return allowedTools
    .map((name) => allToolDefinitions[name])
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

interface ToolContext {
  instructorId?: string | null
}

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext = {}
): Promise<string> {
  const studioId = await getStudioId()
  const supabase = await createClient()

  try {
    switch (toolName) {
      // ── Reads ─────────────────────────────────────────────────────────

      case "list_classes": {
        const { data } = await supabase
          .from("classes")
          .select("*")
          .eq("studio_id", studioId)
          .order("name")

        if (!data?.length) return "No classes found."
        return JSON.stringify(
          data.map((c) => ({
            id: c.id,
            name: c.name,
            duration_mins: c.duration_mins,
            price: `£${formatPence(c.price_pence)}`,
            capacity: c.capacity,
            description: c.description,
          }))
        )
      }

      case "list_schedule": {
        let query = supabase
          .from("schedule")
          .select("*, classes(*), instructors(*)")
          .eq("studio_id", studioId)
          .eq("is_active", true)
          .order("day_of_week")
          .order("start_time")

        if (input.day_of_week !== undefined)
          query = query.eq("day_of_week", input.day_of_week)
        if (input.instructor_id)
          query = query.eq("instructor_id", input.instructor_id)

        const { data } = await query

        if (!data?.length) return "No schedule slots found."
        return JSON.stringify(
          data.map((s: Record<string, unknown>) => ({
            id: s.id,
            day: dayName(s.day_of_week as number),
            day_of_week: s.day_of_week,
            start_time: formatTime(s.start_time as string),
            end_time: formatTime(s.end_time as string),
            class_name: (s.classes as Record<string, unknown>)?.name,
            class_id: s.class_id,
            instructor_name: (s.instructors as Record<string, unknown>)?.name,
            instructor_id: s.instructor_id,
          }))
        )
      }

      case "list_bookings": {
        let query = supabase
          .from("bookings")
          .select(
            "*, profiles(full_name, email), schedule(*, classes(name), instructors(name))"
          )
          .eq("studio_id", studioId)
          .order("date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(50)

        if (input.date) query = query.eq("date", input.date)
        if (input.status) query = query.eq("status", input.status)
        if (input.profile_id) query = query.eq("profile_id", input.profile_id)
        if (input.schedule_id) query = query.eq("schedule_id", input.schedule_id)

        const { data } = await query

        if (!data?.length) return "No bookings found."
        return JSON.stringify(
          data.map((b: Record<string, unknown>) => {
            const schedule = b.schedule as Record<string, unknown> | null
            return {
              id: b.id,
              date: b.date,
              status: b.status,
              payment_method: b.payment_method,
              member_name: (b.profiles as Record<string, unknown>)?.full_name,
              member_email: (b.profiles as Record<string, unknown>)?.email,
              class_name: (schedule?.classes as Record<string, unknown>)?.name,
              instructor_name: (schedule?.instructors as Record<string, unknown>)?.name,
              start_time: schedule ? formatTime(schedule.start_time as string) : null,
            }
          })
        )
      }

      case "list_members": {
        let query = supabase
          .from("studio_memberships")
          .select("profile_id, role, profiles(id, full_name, email, created_at)")
          .eq("studio_id", studioId)
          .eq("role", "member")
          .order("created_at", { ascending: false })

        const { data } = await query

        if (!data?.length) return "No members found."

        let members = data.map((m: Record<string, unknown>) => {
          const p = m.profiles as Record<string, unknown>
          return {
            profile_id: p?.id,
            name: p?.full_name,
            email: p?.email,
            joined: p?.created_at,
          }
        })

        if (input.search) {
          const search = (input.search as string).toLowerCase()
          members = members.filter(
            (m) =>
              (m.name as string)?.toLowerCase().includes(search) ||
              (m.email as string)?.toLowerCase().includes(search)
          )
        }

        return JSON.stringify(members)
      }

      case "get_member_packs": {
        const { data } = await supabase
          .from("class_packs")
          .select("*")
          .eq("studio_id", studioId)
          .eq("profile_id", input.profile_id)
          .gt("credits_remaining", 0)
          .gte("expires_at", new Date().toISOString())
          .order("expires_at")

        if (!data?.length) return "No active packs found for this member."
        return JSON.stringify(
          data.map((p) => ({
            id: p.id,
            pack_type: p.pack_type,
            credits_remaining: p.credits_remaining,
            credits_total: p.credits_total,
            expires_at: p.expires_at,
          }))
        )
      }

      case "list_pack_tiers": {
        const { data } = await supabase
          .from("pack_tiers")
          .select("*")
          .eq("studio_id", studioId)
          .order("credits")

        if (!data?.length) return "No pack tiers found."
        return JSON.stringify(
          data.map((t) => ({
            id: t.id,
            name: t.name,
            credits: t.credits,
            price: `£${formatPence(t.price_pence)}`,
            validity_days: t.validity_days,
            is_active: t.is_active,
          }))
        )
      }

      case "list_instructors": {
        const { data } = await supabase
          .from("instructors")
          .select("*")
          .eq("studio_id", studioId)
          .order("name")

        if (!data?.length) return "No instructors found."
        return JSON.stringify(
          data.map((i) => ({
            id: i.id,
            name: i.name,
            bio: i.bio,
            has_account: !!i.profile_id,
          }))
        )
      }

      case "get_studio_stats": {
        const now = new Date()
        const today = now.toISOString().split("T")[0]

        // Start of week (Monday)
        const dayOfWeek = now.getDay()
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
        const monday = new Date(now)
        monday.setDate(now.getDate() + mondayOffset)
        const weekStart = monday.toISOString().split("T")[0]

        // Start of month
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`

        const [todayBookings, weekBookings, monthBookings, activeMembers, revenue] =
          await Promise.all([
            supabase
              .from("bookings")
              .select("id", { count: "exact" })
              .eq("studio_id", studioId)
              .eq("date", today)
              .eq("status", "confirmed"),
            supabase
              .from("bookings")
              .select("id", { count: "exact" })
              .eq("studio_id", studioId)
              .gte("date", weekStart)
              .eq("status", "confirmed"),
            supabase
              .from("bookings")
              .select("id", { count: "exact" })
              .eq("studio_id", studioId)
              .gte("date", monthStart)
              .eq("status", "confirmed"),
            supabase
              .from("studio_memberships")
              .select("id", { count: "exact" })
              .eq("studio_id", studioId)
              .eq("role", "member"),
            getMonthlyRevenue(),
          ])

        return JSON.stringify({
          today_bookings: todayBookings.count ?? 0,
          week_bookings: weekBookings.count ?? 0,
          month_bookings: monthBookings.count ?? 0,
          active_members: activeMembers.count ?? 0,
          month_revenue: revenue.stripeConnected
            ? `£${formatPence(revenue.revenuePence)}`
            : "Stripe not connected",
        })
      }

      case "list_at_risk_members": {
        const threshold = (input.days_threshold as number) ?? 30

        // Get all members
        const { data: memberRows } = await supabase
          .from("studio_memberships")
          .select("profile_id, profiles(id, full_name, email)")
          .eq("studio_id", studioId)
          .eq("role", "member")

        if (!memberRows?.length) return "No members found."

        // Get all confirmed bookings (most recent per member)
        const { data: allBookings } = await supabase
          .from("bookings")
          .select("profile_id, date")
          .eq("studio_id", studioId)
          .eq("status", "confirmed")
          .order("date", { ascending: false })

        const memberIds = new Set(
          memberRows.map((m: Record<string, unknown>) => m.profile_id as string)
        )

        const lastBookingByProfile: Record<string, string> = {}
        for (const b of allBookings ?? []) {
          if (memberIds.has(b.profile_id) && !lastBookingByProfile[b.profile_id]) {
            lastBookingByProfile[b.profile_id] = b.date
          }
        }

        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - threshold)
        const cutoffStr = cutoffDate.toISOString().split("T")[0]
        const nowMs = Date.now()

        const atRisk: Array<{
          profile_id: string
          name: string
          email: string
          last_booking_date: string | null
          days_since_last_booking: number | null
        }> = []

        for (const m of memberRows) {
          const p = (m as Record<string, unknown>).profiles as {
            id: string
            full_name: string | null
            email: string | null
          } | null
          if (!p) continue

          const lastDate = lastBookingByProfile[p.id]
          if (!lastDate || lastDate < cutoffStr) {
            const daysSince = lastDate
              ? Math.floor(
                  (nowMs - new Date(lastDate + "T00:00:00").getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              : null
            atRisk.push({
              profile_id: p.id,
              name: p.full_name ?? "Unknown",
              email: p.email ?? "",
              last_booking_date: lastDate ?? null,
              days_since_last_booking: daysSince,
            })
          }
        }

        // Sort: longest-absent first, never-booked last
        atRisk.sort((a, b) => {
          if (a.days_since_last_booking === null && b.days_since_last_booking === null) return 0
          if (a.days_since_last_booking === null) return 1
          if (b.days_since_last_booking === null) return -1
          return b.days_since_last_booking - a.days_since_last_booking
        })

        if (!atRisk.length)
          return `No at-risk members found (all members have booked within the last ${threshold} days).`

        return JSON.stringify({
          threshold_days: threshold,
          total_at_risk: atRisk.length,
          members: atRisk,
        })
      }

      // ── Admin writes ──────────────────────────────────────────────────

      case "create_class": {
        const slug = (input.name as string)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
        const { error } = await supabase.from("classes").insert({
          studio_id: studioId,
          name: input.name,
          slug,
          description: input.description ?? "",
          duration_mins: input.duration_mins,
          price_pence: Math.round((input.price_pounds as number) * 100),
          capacity: input.capacity,
        })
        if (error) return `Error: ${error.message}`
        revalidatePath("/dashboard/classes")
        return `Class "${input.name}" created successfully.`
      }

      case "update_class": {
        const updates: Record<string, unknown> = {}
        if (input.name !== undefined) updates.name = input.name
        if (input.description !== undefined) updates.description = input.description
        if (input.duration_mins !== undefined) updates.duration_mins = input.duration_mins
        if (input.price_pounds !== undefined)
          updates.price_pence = Math.round((input.price_pounds as number) * 100)
        if (input.capacity !== undefined) updates.capacity = input.capacity

        const { error } = await supabase
          .from("classes")
          .update(updates)
          .eq("id", input.class_id)
          .eq("studio_id", studioId)

        if (error) return `Error: ${error.message}`
        revalidatePath("/dashboard/classes")
        return `Class updated successfully.`
      }

      case "delete_class": {
        // Check for active slots
        const { data: slots } = await supabase
          .from("schedule")
          .select("id")
          .eq("class_id", input.class_id)
          .eq("is_active", true)
          .limit(1)

        if (slots?.length) {
          return "Cannot delete this class — it has active schedule slots. Remove the slots first."
        }

        const { error } = await supabase
          .from("classes")
          .delete()
          .eq("id", input.class_id)
          .eq("studio_id", studioId)

        if (error) return `Error: ${error.message}`
        revalidatePath("/dashboard/classes")
        return "Class deleted successfully."
      }

      case "create_schedule_slot": {
        const startTime = (input.start_time as string).length === 5
          ? `${input.start_time}:00`
          : input.start_time
        const endTime = (input.end_time as string).length === 5
          ? `${input.end_time}:00`
          : input.end_time

        const { error } = await supabase.from("schedule").insert({
          studio_id: studioId,
          class_id: input.class_id,
          instructor_id: input.instructor_id,
          day_of_week: input.day_of_week,
          start_time: startTime,
          end_time: endTime,
        })

        if (error) return `Error: ${error.message}`
        revalidatePath("/dashboard/timetable")
        revalidatePath("/dashboard")
        return "Schedule slot created successfully."
      }

      case "update_schedule_slot": {
        const updates: Record<string, unknown> = {}
        if (input.class_id !== undefined) updates.class_id = input.class_id
        if (input.instructor_id !== undefined) updates.instructor_id = input.instructor_id
        if (input.day_of_week !== undefined) updates.day_of_week = input.day_of_week
        if (input.start_time !== undefined) {
          const t = input.start_time as string
          updates.start_time = t.length === 5 ? `${t}:00` : t
        }
        if (input.end_time !== undefined) {
          const t = input.end_time as string
          updates.end_time = t.length === 5 ? `${t}:00` : t
        }

        const { error } = await supabase
          .from("schedule")
          .update(updates)
          .eq("id", input.slot_id)
          .eq("studio_id", studioId)

        if (error) return `Error: ${error.message}`
        revalidatePath("/dashboard/timetable")
        revalidatePath("/dashboard")
        return "Schedule slot updated successfully."
      }

      case "delete_schedule_slot": {
        const { error } = await supabase
          .from("schedule")
          .update({ is_active: false })
          .eq("id", input.slot_id)
          .eq("studio_id", studioId)

        if (error) return `Error: ${error.message}`
        revalidatePath("/dashboard/timetable")
        revalidatePath("/dashboard")
        return "Schedule slot removed."
      }

      case "create_booking": {
        // If pack_credit, check and decrement
        if (input.payment_method === "pack_credit") {
          const { data: packs } = await supabase
            .from("class_packs")
            .select("id, credits_remaining")
            .eq("studio_id", studioId)
            .eq("profile_id", input.profile_id)
            .gt("credits_remaining", 0)
            .gte("expires_at", new Date().toISOString())
            .order("expires_at", { ascending: true })
            .limit(1)

          if (!packs?.length) {
            return "This member has no available pack credits."
          }

          const pack = packs[0]
          await supabase
            .from("class_packs")
            .update({ credits_remaining: pack.credits_remaining - 1 })
            .eq("id", pack.id)
        }

        const { error } = await supabase.from("bookings").insert({
          studio_id: studioId,
          profile_id: input.profile_id,
          schedule_id: input.schedule_id,
          date: input.date,
          status: "confirmed",
          payment_method: input.payment_method,
        })

        if (error) return `Error: ${error.message}`

        // Send confirmation to member + notification to instructor/admin
        await Promise.allSettled([
          sendBookingConfirmation(studioId, input.profile_id as string, input.schedule_id as string, input.date as string),
          sendBookingNotification(studioId, input.profile_id as string, input.schedule_id as string, input.date as string, input.payment_method as string),
        ])

        revalidatePath("/dashboard/bookings")
        revalidatePath("/dashboard")
        return "Booking created successfully."
      }

      case "cancel_booking": {
        const { data: booking } = await supabase
          .from("bookings")
          .select("*")
          .eq("id", input.booking_id)
          .eq("studio_id", studioId)
          .single()

        if (!booking) return "Booking not found."
        if (booking.status === "cancelled") return "This booking is already cancelled."

        // Refund pack credit if applicable
        if (booking.payment_method === "pack_credit") {
          const { data: packs } = await supabase
            .from("class_packs")
            .select("id, credits_remaining, credits_total")
            .eq("studio_id", studioId)
            .eq("profile_id", booking.profile_id)
            .order("expires_at", { ascending: true })
            .limit(1)

          if (packs?.length) {
            const pack = packs[0]
            await supabase
              .from("class_packs")
              .update({
                credits_remaining: Math.min(
                  pack.credits_remaining + 1,
                  pack.credits_total
                ),
              })
              .eq("id", pack.id)
          }
        }

        const { error } = await supabase
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("id", input.booking_id)
          .eq("studio_id", studioId)

        if (error) return `Error: ${error.message}`
        revalidatePath("/dashboard/bookings")
        revalidatePath("/dashboard")
        return "Booking cancelled successfully."
      }

      case "create_pack_tier": {
        const { error } = await supabase.from("pack_tiers").insert({
          studio_id: studioId,
          name: input.name,
          credits: input.credits,
          price_pence: Math.round((input.price_pounds as number) * 100),
          validity_days: input.validity_days,
          is_active: true,
        })

        if (error) return `Error: ${error.message}`
        revalidatePath("/dashboard/packages")
        return `Pack tier "${input.name}" created successfully.`
      }

      case "update_pack_tier": {
        const updates: Record<string, unknown> = {}
        if (input.name !== undefined) updates.name = input.name
        if (input.credits !== undefined) updates.credits = input.credits
        if (input.price_pounds !== undefined)
          updates.price_pence = Math.round((input.price_pounds as number) * 100)
        if (input.validity_days !== undefined) updates.validity_days = input.validity_days

        const { error } = await supabase
          .from("pack_tiers")
          .update(updates)
          .eq("id", input.tier_id)
          .eq("studio_id", studioId)

        if (error) return `Error: ${error.message}`
        revalidatePath("/dashboard/packages")
        return "Pack tier updated successfully."
      }

      case "delete_pack_tier": {
        const { error } = await supabase
          .from("pack_tiers")
          .update({ is_active: false })
          .eq("id", input.tier_id)
          .eq("studio_id", studioId)

        if (error) return `Error: ${error.message}`
        revalidatePath("/dashboard/packages")
        return "Pack tier deactivated."
      }

      case "invite_staff": {
        const adminClient = createAdminClient()

        // Get studio for email
        const { data: studio } = await supabase
          .from("studios")
          .select("name, email_from")
          .eq("id", studioId)
          .single()

        const { data: authUser, error: authError } =
          await adminClient.auth.admin.inviteUserByEmail(input.email as string, {
            data: { full_name: input.name },
          })

        if (authError) return `Error creating account: ${authError.message}`
        if (!authUser.user) return "Error: failed to create user."

        const userId = authUser.user.id

        await adminClient.from("profiles").upsert({
          id: userId,
          full_name: input.name,
          email: input.email,
        })

        await adminClient.from("studio_memberships").insert({
          studio_id: studioId,
          profile_id: userId,
          role: "staff",
        })

        const slug = (input.name as string)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")

        await adminClient.from("instructors").insert({
          studio_id: studioId,
          profile_id: userId,
          name: input.name,
          slug,
          bio: "",
        })

        // Track invite status
        const { data: { user: currentUser } } = await supabase.auth.getUser()
        if (currentUser) {
          await adminClient.from("admin_invites").insert({
            studio_id: studioId,
            email: input.email,
            name: input.name,
            role: "staff",
            invited_by: currentUser.id,
          })
        }

        revalidatePath("/dashboard/team")
        return `${input.name} has been invited as staff. They'll receive a sign-in email at ${input.email}.`
      }

      // ── Staff-scoped tools ────────────────────────────────────────────

      case "my_schedule": {
        if (!ctx.instructorId)
          return "Your instructor profile hasn't been linked to your account yet. Please ask an admin to link it."

        let query = supabase
          .from("schedule")
          .select("*, classes(*)")
          .eq("studio_id", studioId)
          .eq("instructor_id", ctx.instructorId)
          .eq("is_active", true)
          .order("day_of_week")
          .order("start_time")

        if (input.day_of_week !== undefined)
          query = query.eq("day_of_week", input.day_of_week)

        const { data } = await query

        if (!data?.length) return "You have no assigned classes."
        return JSON.stringify(
          data.map((s: Record<string, unknown>) => ({
            id: s.id,
            day: dayName(s.day_of_week as number),
            day_of_week: s.day_of_week,
            start_time: formatTime(s.start_time as string),
            end_time: formatTime(s.end_time as string),
            class_name: (s.classes as Record<string, unknown>)?.name,
            capacity: (s.classes as Record<string, unknown>)?.capacity,
          }))
        )
      }

      case "my_class_attendees": {
        if (!ctx.instructorId)
          return "Your instructor profile hasn't been linked yet."

        // Verify the slot belongs to this instructor
        const { data: slot } = await supabase
          .from("schedule")
          .select("id, instructor_id")
          .eq("id", input.schedule_id)
          .eq("studio_id", studioId)
          .single()

        if (!slot) return "Schedule slot not found."
        if (slot.instructor_id !== ctx.instructorId)
          return "You can only view attendees for your own classes."

        const { data } = await supabase
          .from("bookings")
          .select("id, status, profiles(full_name)")
          .eq("studio_id", studioId)
          .eq("schedule_id", input.schedule_id)
          .eq("date", input.date)
          .eq("status", "confirmed")

        if (!data?.length) return "No confirmed bookings for this class on that date."
        return JSON.stringify(
          data.map((b: Record<string, unknown>) => ({
            booking_id: b.id,
            name: (b.profiles as Record<string, unknown>)?.full_name,
          }))
        )
      }

      case "my_stats": {
        if (!ctx.instructorId)
          return "Your instructor profile hasn't been linked yet."

        const now = new Date()
        const dayOfWeekNum = now.getDay()
        const mondayOffset = dayOfWeekNum === 0 ? -6 : 1 - dayOfWeekNum
        const monday = new Date(now)
        monday.setDate(now.getDate() + mondayOffset)
        const weekStart = monday.toISOString().split("T")[0]
        const sunday = new Date(monday)
        sunday.setDate(monday.getDate() + 6)
        const weekEnd = sunday.toISOString().split("T")[0]

        // Get my slots
        const { data: mySlots } = await supabase
          .from("schedule")
          .select("id, classes(capacity)")
          .eq("studio_id", studioId)
          .eq("instructor_id", ctx.instructorId)
          .eq("is_active", true)

        const slotIds = mySlots?.map((s) => s.id) ?? []

        if (!slotIds.length) return "You have no assigned classes this week."

        const { data: bookings } = await supabase
          .from("bookings")
          .select("id, schedule_id")
          .eq("studio_id", studioId)
          .in("schedule_id", slotIds)
          .gte("date", weekStart)
          .lte("date", weekEnd)
          .eq("status", "confirmed")

        const totalClasses = slotIds.length
        const totalAttendees = bookings?.length ?? 0
        const avgAttendance =
          totalClasses > 0
            ? Math.round(totalAttendees / totalClasses)
            : 0

        return JSON.stringify({
          classes_this_week: totalClasses,
          total_attendees_this_week: totalAttendees,
          avg_attendance_per_class: avgAttendance,
        })
      }

      default:
        return `Unknown tool: ${toolName}`
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return `Error executing ${toolName}: ${message}`
  }
}
