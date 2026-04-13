import { Skeleton } from "@/components/ui/skeleton"

export default function RegisterLoading() {
  return (
    <div>
      {/* Back link */}
      <Skeleton className="mb-5 h-4 w-36" />

      {/* Class header */}
      <div className="mb-6 rounded-2xl border border-sand bg-white p-6">
        <div className="flex items-start gap-4">
          <Skeleton className="h-14 w-1.5 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-12 w-12 rounded-full" />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-cream px-4 py-3 text-center">
              <Skeleton className="mx-auto mb-1 h-7 w-8" />
              <Skeleton className="mx-auto h-3 w-14" />
            </div>
          ))}
        </div>
      </div>

      {/* Register list */}
      <div className="rounded-2xl border border-sand bg-white overflow-hidden">
        <div className="bg-cocoa px-6 py-3">
          <Skeleton className="h-3 w-28 bg-wheat/20" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-sand/40 px-6 py-3">
            <Skeleton className="h-4 w-5" />
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 w-32 flex-1" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
