"use client"

import type { Studio, Profile, UserRole } from "@/lib/types"
import { ADMIN_ROLES, MANAGER_ROLES, RECEPTION_ROLES } from "@/lib/types"
import { SidebarNavItem } from "./sidebar-nav-item"
import { SidebarSignOut } from "./sidebar-sign-out"
import { AssistTrigger } from "@/components/assist/assist-trigger"
import { getInitial } from "@/lib/utils"
import {
  LayoutGrid,
  Calendar,
  CheckSquare,
  Users,
  Star,
  Package,
  Repeat,
  User,
  Settings,
  BarChart3,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

interface SidebarProps {
  studio: Studio
  profile: Profile
  role: UserRole
  onNavigate?: () => void
}

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  minRoles: UserRole[]
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid, minRoles: RECEPTION_ROLES },
  { href: "/dashboard/timetable", label: "Timetable", icon: Calendar, minRoles: MANAGER_ROLES },
  { href: "/dashboard/bookings", label: "Bookings", icon: CheckSquare, minRoles: RECEPTION_ROLES },
  { href: "/dashboard/members", label: "Members", icon: Users, minRoles: RECEPTION_ROLES },
  { href: "/dashboard/classes", label: "Classes", icon: Star, minRoles: ADMIN_ROLES },
  { href: "/dashboard/packages", label: "Packages", icon: Package, minRoles: ADMIN_ROLES },
  { href: "/dashboard/memberships", label: "Memberships", icon: Repeat, minRoles: ADMIN_ROLES },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, minRoles: ADMIN_ROLES },
  { href: "/dashboard/team", label: "Team", icon: User, minRoles: ADMIN_ROLES },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, minRoles: ADMIN_ROLES },
]

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  reception: "Reception",
}

export function Sidebar({ studio, profile, role, onNavigate }: SidebarProps) {
  const visibleItems = navItems.filter((item) => item.minRoles.includes(role))

  return (
    <nav className="fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col bg-cocoa">
      {/* Brand */}
      <div className="border-b border-white/[0.06] px-5 pb-5 pt-6">
        <h1 className="font-heading text-[1.3rem] font-semibold text-wheat">
          {studio.name?.replace(" Studio", "") ?? "Studio"}
        </h1>
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-warm-grey">
          {ROLE_LABELS[role] ?? "Admin"} Dashboard
        </span>
      </div>

      {/* Forma Assist */}
      <div className="px-0 pt-4 pb-2">
        <AssistTrigger
          studioName={studio.name ?? "Studio"}
          planTier={studio.plan_tier}
          userName={profile.full_name ?? "Admin"}
          variant="sidebar"
        />
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-4">
        {visibleItems.map((item) => (
          <SidebarNavItem key={item.href} href={item.href} label={item.label} icon={item.icon} onNavigate={onNavigate} />
        ))}
      </div>

      {/* User */}
      <div className="flex items-center gap-3 border-t border-white/[0.06] px-5 py-4">
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gold font-heading text-[0.9rem] font-semibold text-cocoa">
          {getInitial(profile.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate text-[0.8rem] font-semibold text-wheat">
            {profile.full_name ?? "Admin"}
          </div>
          <SidebarSignOut />
        </div>
      </div>
    </nav>
  )
}
