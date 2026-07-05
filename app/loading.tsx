import { Skeleton } from "@/components/ui/skeleton"

/**
 * Route-level loading UI shown while the page segment streams in.
 * Mirrors the gallery layout (header + masonry grid) so the transition
 * doesn't flash a blank screen. Replaces the previous `return null`.
 */
export default function Loading() {
  return (
    <div
      className="min-h-screen"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>

      {/* Header placeholder */}
      <div className="w-full border-b glass-effect">
        <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-3">
          <Skeleton className="h-8 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>

      {/* Search bar placeholder */}
      <div className="container mx-auto px-4 py-6">
        <Skeleton className="mx-auto h-11 w-full max-w-2xl rounded-lg" />
      </div>

      {/* Masonry grid placeholder */}
      <div className="container mx-auto px-4 pb-10">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton
                className="w-full rounded-lg"
                style={{ height: `${220 + ((i % 4) * 60)}px` }}
              />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
