"use client"

import { MasonryGrid } from "@/components/masonry-grid"
import type { BooruPost } from "@/lib/api-client"
import type { CardScale } from "@/hooks/use-gallery-view-state"

interface ResultsGridProps {
  posts: BooruPost[]
  effectiveScale: CardScale
  renderItem: (post: BooruPost, width: number, height: number, index: number) => React.ReactNode
  /** Id of the currently expanded card (in-place expansion), forwarded to the grid. */
  expandedItemId?: number | string | null
}

/**
 * Renders the filtered posts as a masonry grid. `renderItem` is the caller's
 * memoized `renderMasonryItem` callback — it is NOT re-wrapped here so its
 * referential stability (and the perf optimization it exists for) is
 * preserved.
 */
export function ResultsGrid({ posts, effectiveScale, renderItem, expandedItemId }: ResultsGridProps) {
  return (
    <div id="results-anchor" data-tour="results" className="mb-8 min-h-[500px] scroll-mt-20 overflow-x-clip">
      <MasonryGrid
        items={posts}
        scale={effectiveScale}
        renderItem={renderItem}
        expandedItemId={expandedItemId}
      />
    </div>
  )
}
