interface PageHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    // Phones: the action goes under the title instead of squeezing it.
    <div className="mb-6 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="font-heading text-[1.8rem] font-medium text-cocoa">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-[0.82rem] text-warm-grey">{description}</p>
        )}
      </div>
      {action && <div className="flex flex-wrap gap-2.5">{action}</div>}
    </div>
  )
}
