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

 // Debug: track observer lifecycle
 const observerIdRef = useRef(0)

 // Debug: track onIntersect reference stability
 const prevOnIntersectRef = useRef(onIntersect)
 useEffect(() => {
 if (prevOnIntersectRef.current !== onIntersect) {
 console.log(`[InfiniteScroll] onIntersect REF CHANGED (this recreates observer)`)
 prevOnIntersectRef.current = onIntersect
 }
 }, [onIntersect])

 // Sync isLoading to ref (observer callback reads this)
 useEffect(() => {
 const prev = isLoadingRef.current
 isLoadingRef.current = isLoading
 console.log(`[InfiniteScroll] isLoading sync: ${prev} → ${isLoading}, guard=${guardRef.current}, loadedCount=${loadedCount}`)
 // When SWR confirms it's loading, clear the guard —
 // the load was accepted and is in progress.
 if (isLoading) guardRef.current = false
 }, [isLoading])

 // --- Persistent IntersectionObserver (NO isLoading dependency) ---
 // Uses intersection TRANSITIONS instead of observer recreation.
 useEffect(() => {
 if (!hasNextPage || error) {
 console.log(`[InfiniteScroll] Observer NOT created: hasNextPage=${hasNextPage}, error=${error}`)
 return
 }

 const observerId = ++observerIdRef.current
 let loadMoreFired = false
 console.log(`[InfiniteScroll] Observer #${observerId} CREATED (hasNextPage=${hasNextPage}, error=${error})`)

 const observer = new IntersectionObserver(
 (entries) => {
 const entry = entries[0]

 if (!entry.isIntersecting) {
 console.log(`[InfiniteScroll] Observer #${observerId}: LEFT viewport, resetting loadMoreFired (was ${loadMoreFired})`)
 loadMoreFired = false
 return
 }

 console.log(`[InfiniteScroll] Observer #${observerId}: ENTERED viewport, loadMoreFired=${loadMoreFired}, isLoadingRef=${isLoadingRef.current}, guard=${guardRef.current}`)

 if (loadMoreFired) {
 console.log(`[InfiniteScroll] Observer #${observerId}: SKIPPED — loadMoreFired=true`)
 return
 }
 if (isLoadingRef.current) {
 console.log(`[InfiniteScroll] Observer #${observerId}: SKIPPED — isLoadingRef=true`)
 return
 }
 if (guardRef.current) {
 console.log(`[InfiniteScroll] Observer #${observerId}: SKIPPED — guard=true`)
 return
 }

 loadMoreFired = true
 guardRef.current = true
 console.log(`[InfiniteScroll] Observer #${observerId}: FIRING onIntersect(), loadMoreFired=true, guard=true`)
 onIntersect()
 },
 { root: null, rootMargin: "800px", threshold: 0 }
 )

 if (triggerRef.current) observer.observe(triggerRef.current)
 return () => {
 console.log(`[InfiniteScroll] Observer #${observerId}: DISCONNECTED`)
 observer.disconnect()
 }
 // IMPORTANT: NO isLoading dependency — the observer is persistent
 // and reads loading state from a ref, not from the closure.
 }, [hasNextPage, error, onIntersect])

 // Reset guard when component unmounts or when search changes
 // (loadedCount resetting signals a new search)
 const prevLoadedCountRef = useRef(loadedCount)
 useEffect(() => {
 if (loadedCount === 0 && prevLoadedCountRef.current > 0) {
 console.log(`[InfiniteScroll] Search reset detected (loadedCount ${prevLoadedCountRef.current} → 0), clearing guard`)
 guardRef.current = false
 }
 prevLoadedCountRef.current = loadedCount
 }, [loadedCount])

 if (!hasNextPage) return null

 console.log(`[InfiniteScroll] RENDER: isLoading=${isLoading}, hasNextPage=${hasNextPage}, error=${error}, loadedCount=${loadedCount}, guard=${guardRef.current}`)

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
