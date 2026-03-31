import { ArrowUp, ArrowDown, Minus } from "lucide-react"

interface StatCardProps {
  label: string
  value: string | number
  subtitle?: string
  subtitleClassName?: string
  change?: {
    value: number
    label?: string
  }
}

export function StatCard({
  label,
  value,
  subtitle,
  subtitleClassName = "text-warm-grey",
  change,
}: StatCardProps) {
  const isUp = change && change.value > 0
  const isDown = change && change.value < 0
  const isFlat = change && change.value === 0

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
      {change && (
        <div className="mt-1.5 flex items-center gap-1">
          {isUp && (
            <>
              <span className="flex items-center gap-0.5 rounded-full bg-success/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-success">
                <ArrowUp className="h-3 w-3" />
                +{Math.abs(change.value)}%
              </span>
              <span className="text-[0.6rem] text-warm-grey">{change.label ?? "vs last week"}</span>
            </>
          )}
          {isDown && (
            <>
              <span className="flex items-center gap-0.5 rounded-full bg-ember/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-ember">
                <ArrowDown className="h-3 w-3" />
                -{Math.abs(change.value)}%
              </span>
              <span className="text-[0.6rem] text-warm-grey">{change.label ?? "vs last week"}</span>
            </>
          )}
          {isFlat && (
            <>
              <span className="flex items-center gap-0.5 rounded-full bg-warm-grey/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-warm-grey">
                <Minus className="h-3 w-3" />
                No change
              </span>
              <span className="text-[0.6rem] text-warm-grey">{change.label ?? "vs last week"}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
