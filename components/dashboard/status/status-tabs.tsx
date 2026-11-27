"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

interface Tab {
  href: string
  label: string
  /** Shown on phones, where the full label doesn't fit. */
  short: string
  urgent: number
  look: number
}

/** Overview · website · admin app, with a count of what needs attention on each. */
export function StatusTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname()
  const active = (href: string) =>
    href === "/dashboard/status" ? pathname === href || pathname.startsWith("/dashboard/status/alerts") : pathname.startsWith(href)
  return (
    <nav className="mb-5 mt-5 grid grid-cols-3 border-b border-sand sm:mb-7 sm:flex sm:gap-0.5" aria-label="Status dashboards">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "-mb-px flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2 text-[0.86rem] font-medium text-warm-grey hover:text-cocoa sm:min-h-0 sm:justify-start sm:gap-2 sm:px-4 sm:pb-2.5 sm:pt-2 sm:text-[0.82rem]",
            active(t.href) && "border-cocoa text-cocoa",
          )}
        >
          <span className="sm:hidden">{t.short}</span>
          <span className="hidden sm:inline">{t.label}</span>
          {t.urgent + t.look > 0 && (
            <span className={cn("rounded-full px-1.5 text-[0.62rem] font-semibold text-white", t.urgent ? "bg-red-700" : "bg-ember")}>
              {t.urgent + t.look}
            </span>
          )}
        </Link>
      ))}
    </nav>
  )
}
