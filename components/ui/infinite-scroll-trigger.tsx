"use client"

import { useEffect, useRef, useCallback } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"

interface InfiniteScrollTriggerProps {
  onIntersect: () => void
  isLoading: boolean
  hasNextPage: boolean
  error?: boolean
  /** Total posts already loaded (used to calculate current page) */
  loadedCount?: number
}

const PAGE_SIZE = 30 // Danbooru returns 30 posts per page

export function InfiniteScrollTrigger({
  onIntersect,
  isLoading,
  hasNextPage,
  error = false,
  loadedCount = 0,
}: InfiniteScrollTriggerProps) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef(isLoading)
  // Guard: prevents observer from firing loadMore again while
  // the previous call hasn't yet caused SWR to transition to isValidating=true.
  const guardRef = useRef(false)

  // Sync isLoading to ref (observer callback reads this)
  useEffect(() => {
    isLoadingRef.current = isLoading
    // When SWR confirms it's loading, clear the guard —
    // the load was accepted and is in progress.
    if (isLoading) guardRef.current = false
  }, [isLoading])

  // IntersectionObserver — only active when NOT loading and there's a next page
  useEffect(() => {
    if (isLoading || !hasNextPage || error) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return
        if (isLoadingRef.current) return
        if (guardRef.current) return

        guardRef.current = true
        onIntersect()
      },
      { root: null, rootMargin: "800px", threshold: 0 }
    )

    if (triggerRef.current) observer.observe(triggerRef.current)
    return () => observer.disconnect()
  }, [isLoading, hasNextPage, error, onIntersect])

  // Reset guard when component unmounts or when search changes
  // (loadedCount resetting signals a new search)
  const prevLoadedCountRef = useRef(loadedCount)
  useEffect(() => {
    if (loadedCount === 0 && prevLoadedCountRef.current > 0) {
      guardRef.current = false
    }
    prevLoadedCountRef.current = loadedCount
  }, [loadedCount])

  if (!hasNextPage) return null

  const currentPage = Math.floor(loadedCount / PAGE_SIZE) + 1

  return (
    <div
      ref={triggerRef}
      className="w-full py-8 flex flex-col justify-center items-center min-h-[60px] gap-2"
    >
      {isLoading ? (
        <div className="flex flex-col items-center gap-3 w-full max-w-xs mx-auto">
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div className="w-1/4 h-full bg-primary rounded-full animate-indeterminate-bar" />
          </div>
          <p className="text-sm text-muted-foreground">
            Loading page {currentPage}...
            <span className="text-xs ml-1 text-muted-foreground/60">
              ({loadedCount} posts loaded)
            </span>
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <Button onClick={onIntersect} variant="outline" size="sm" className="gap-2">
            <ChevronDown className="w-4 h-4" />
            Load More
          </Button>
          <p className="text-xs text-muted-foreground/40">or scroll down</p>
        </div>
      )}
    </div>
  )
}
