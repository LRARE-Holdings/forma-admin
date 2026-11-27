"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

interface Tab {
  href: string
  label: string
  urgent: number
  look: number
}

/** Overview · website · admin app, with a count of what needs attention on each. */
export function StatusTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname()
  const active = (href: string) =>
    href === "/dashboard/status" ? pathname === href || pathname.startsWith("/dashboard/status/alerts") : pathname.startsWith(href)
  return (
    <nav className="mb-7 mt-5 flex gap-0.5 overflow-x-auto border-b border-sand" aria-label="Status dashboards">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-4 pb-2.5 pt-2 text-[0.82rem] font-medium text-warm-grey hover:text-cocoa",
            active(t.href) && "border-cocoa text-cocoa",
          )}
        >
          {t.label}
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
