"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface SidebarNavItemProps {
  href: string
  label: string
  icon: LucideIcon
  onNavigate?: () => void
}

export function SidebarNavItem({ href, label, icon: Icon, onNavigate }: SidebarNavItemProps) {
  const pathname = usePathname()
  const isActive =
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href)

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 border-l-[3px] border-transparent px-5 py-2.5 text-[0.82rem] font-medium text-warm-grey transition-all hover:bg-white/[0.04] hover:text-wheat",
        isActive &&
          "border-l-gold bg-gold/[0.08] text-gold"
      )}
    >
      <Icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.8} />
      {label}
    </Link>
  )
}
