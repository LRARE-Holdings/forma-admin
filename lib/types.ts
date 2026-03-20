export type UserRole = "owner" | "admin" | "manager" | "reception" | "staff" | "member"

/** Roles that get access to the admin dashboard (sidebar + /dashboard routes) */
export const DASHBOARD_ROLES: UserRole[] = ["owner", "admin", "manager", "reception"]

/** Roles that can perform full CRUD on classes, schedule, team, settings, packs */
export const ADMIN_ROLES: UserRole[] = ["owner", "admin"]

/** Roles that can manage schedule, bookings, members (read-only classes, packages, settings) */
export const MANAGER_ROLES: UserRole[] = ["owner", "admin", "manager"]

/** Roles that can view bookings/members and create manual bookings */
export const RECEPTION_ROLES: UserRole[] = ["owner", "admin", "manager", "reception"]

export interface Studio {
  id: string
  name: string
  slug: string
  domain: string | null
  email_from: string | null
  email_domain: string | null
  branding: Record<string, unknown>
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_account_id: string | null
  stripe_onboarding_complete: boolean
  plan_tier: string
  active: boolean
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface StudioMembership {
  id: string
  studio_id: string
  profile_id: string
  role: UserRole
  created_at: string
}

export interface Class {
  id: string
  studio_id: string
  name: string
  slug: string
  description: string
  duration_mins: number
  price_pence: number
  capacity: number
  image_url: string | null
  stripe_product_id: string | null
  stripe_price_id: string | null
  created_at: string
}

export interface Instructor {
  id: string
  studio_id: string
  name: string
  slug: string
  bio: string
  photo_url: string | null
  profile_id: string | null
  created_at: string
}

export interface ScheduleSlot {
  id: string
  studio_id: string
  class_id: string
  instructor_id: string
  day_of_week: number
  start_time: string
  end_time: string
  is_active: boolean
  rule_id: string | null
  created_at: string
}

export type Recurrence = "weekly" | "fortnightly" | "monthly"

export interface ScheduleRule {
  id: string
  studio_id: string
  class_id: string
  instructor_id: string
  recurrence: Recurrence
  day_of_week: number
  start_time: string
  end_time: string
  starts_on: string
  ends_on: string | null
  is_active: boolean
  created_at: string
}

export type BookingStatus = "confirmed" | "cancelled"
export type PaymentMethod = "stripe" | "pack_credit" | "complimentary" | "membership"

export type BillingInterval = "week" | "month" | "year"

export interface MembershipTier {
  id: string
  studio_id: string
  name: string
  description: string
  price_pence: number
  interval: BillingInterval
  interval_count: number
  is_active: boolean
  stripe_product_id: string | null
  stripe_price_id: string | null
  created_at: string
}

export type MembershipStatus = "active" | "cancelled" | "past_due" | "trialing"

export interface Membership {
  id: string
  studio_id: string
  profile_id: string
  membership_tier_id: string
  stripe_subscription_id: string | null
  status: MembershipStatus
  current_period_start: string | null
  current_period_end: string | null
  cancelled_at: string | null
  created_at: string
}

export interface Booking {
  id: string
  studio_id: string
  schedule_id: string
  profile_id: string
  date: string
  status: BookingStatus
  payment_method: PaymentMethod
  stripe_session_id: string | null
  created_at: string
}

export type PackType = "5" | "10"

export interface ClassPack {
  id: string
  studio_id: string
  profile_id: string
  pack_type: PackType
  credits_total: number
  credits_remaining: number
  purchased_at: string
  expires_at: string
  stripe_session_id: string
  created_at: string
}

export interface PackTier {
  id: string
  studio_id: string
  name: string
  credits: number
  price_pence: number
  validity_days: number
  is_active: boolean
  stripe_product_id: string | null
  stripe_price_id: string | null
  created_at: string
}

// Joined types for queries
export interface ScheduleWithDetails extends ScheduleSlot {
  classes: Class
  instructors: Instructor
}

export interface BookingWithDetails extends Booking {
  profiles: Profile
  schedule: ScheduleSlot & {
    classes: Class
    instructors: Instructor
  }
}

export interface MemberWithDetails extends Profile {
  studio_memberships: StudioMembership[]
  bookings_count?: number
  credits_remaining?: number
}
