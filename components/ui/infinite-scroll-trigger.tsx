"use client"

import { useEffect, useRef } from "react"
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
 // Stable ref for onIntersect — the observer reads from this instead
 // of the closure, so the observer effect never recreates when the
 // callback reference changes (e.g. due to `size` in useCallback deps).
 const onIntersectRef = useRef(onIntersect)

 // Sync props to refs (observer callback reads these, not the closure)
 useEffect(() => { onIntersectRef.current = onIntersect }, [onIntersect])
  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])

 // --- Single persistent IntersectionObserver ---
 // Created once when hasNextPage/error stabilize, NEVER recreates
 // on isLoading or onIntersect changes.
 useEffect(() => {
 if (!hasNextPage || error) {
 console.log(`[InfiniteScroll] Observer NOT created: hasNextPage=${hasNextPage}, error=${error}`)
 return
 }

 let loadMoreFired = false
 console.log(`[InfiniteScroll] Observer CREATED (persistent, hasNextPage=${hasNextPage})`)

 const observer = new IntersectionObserver(
 (entries) => {
 const entry = entries[0]

 if (!entry.isIntersecting) {
 // Trigger left viewport — safe to reset for next scroll-down
 loadMoreFired = false
 return
 }

 // Trigger entered viewport — fire loadMore ONCE per intersection
 if (loadMoreFired) {
 console.log(`[InfiniteScroll] SKIPPED — loadMoreFired=true`)
 return
 }
 if (isLoadingRef.current) {
 console.log(`[InfiniteScroll] SKIPPED — isLoading=true`)
 return
 }

 loadMoreFired = true
 console.log(`[InfiniteScroll] FIRING onIntersect(), loadMoreFired=true`)
 onIntersectRef.current()
 },
 { root: null, rootMargin: "800px", threshold: 0 }
 )

 if (triggerRef.current) observer.observe(triggerRef.current)
 return () => {
 console.log(`[InfiniteScroll] Observer DISCONNECTED`)
 observer.disconnect()
 }
 // ONLY hasNextPage and error can recreate the observer.
 // isLoading and onIntersect are read from refs.
 }, [hasNextPage, error])

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
