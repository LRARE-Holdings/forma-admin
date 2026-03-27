import { Skeleton } from "@/components/ui/skeleton"

export default function PackagesLoading() {
  return (
    <div className="space-y-6 p-8">
      <Skeleton className="h-8 w-36" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
