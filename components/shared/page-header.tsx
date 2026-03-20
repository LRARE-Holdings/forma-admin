interface PageHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-7 flex items-start justify-between">
      <div>
        <h2 className="font-heading text-[1.8rem] font-medium text-cocoa">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-[0.82rem] text-warm-grey">{description}</p>
        )}
      </div>
      {action && <div className="flex gap-2.5">{action}</div>}
    </div>
  )
}
