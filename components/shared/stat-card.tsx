interface StatCardProps {
  label: string
  value: string | number
  subtitle?: string
  subtitleClassName?: string
}

export function StatCard({
  label,
  value,
  subtitle,
  subtitleClassName = "text-warm-grey",
}: StatCardProps) {
  return (
    <div className="rounded-[14px] border border-sand bg-white p-5 transition-all hover:border-gold hover:shadow-[0_4px_16px_rgba(71,55,40,0.06)]">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-warm-grey">
        {label}
      </div>
      <div className="mt-1 font-heading text-[2rem] font-medium text-cocoa">
        {value}
      </div>
      {subtitle && (
        <div className={`mt-0.5 text-[0.7rem] font-semibold ${subtitleClassName}`}>
          {subtitle}
        </div>
      )}
    </div>
  )
}
