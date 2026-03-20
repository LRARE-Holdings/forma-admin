import {
  Calendar,
  CheckSquare,
  Users,
  Star,
  Activity,
  type LucideIcon,
} from "lucide-react"

const iconMap: Record<string, LucideIcon> = {
  calendar: Calendar,
  "check-square": CheckSquare,
  users: Users,
  star: Star,
  activity: Activity,
}

interface EmptyStateProps {
  icon?: string
  title: string
  description: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const Icon = icon ? iconMap[icon] : undefined

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sand/50">
          <Icon className="h-6 w-6 text-warm-grey" />
        </div>
      )}
      <h3 className="font-heading text-lg font-semibold text-cocoa">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-warm-grey">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
