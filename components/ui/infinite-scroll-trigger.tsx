"use client"

import { useEffect, useRef } from "react"
import { Loader2, Clock } from "lucide-react"

interface InfiniteScrollTriggerProps {
    onIntersect: () => void
    isLoading: boolean
    hasNextPage: boolean
    forceStop?: boolean
    error?: boolean
    isScrollThrottled?: boolean
    throttleCountdown?: number
}

export function InfiniteScrollTrigger({
    onIntersect,
    isLoading,
    hasNextPage,
    forceStop = false,
    error = false,
    isScrollThrottled = false,
    throttleCountdown = 0,
}: InfiniteScrollTriggerProps) {
    const triggerRef = useRef<HTMLDivElement>(null)
    const forceStopRef = useRef(forceStop)
    const isLoadingRef = useRef(isLoading)

    // Keep refs in sync so callbacks can read current values without
    // re-running effects on every props change.
    useEffect(() => {
        forceStopRef.current = forceStop
    }, [forceStop])
    useEffect(() => {
        isLoadingRef.current = isLoading
    }, [isLoading])

    useEffect(() => {
        if (isLoading || !hasNextPage || forceStop || error || isScrollThrottled) {
            console.log('[DanbooruThrottle] Observer effect SKIP', {
              isLoading, hasNextPage, forceStop, error, isScrollThrottled
            })
            return
        }

        console.log('[DanbooruThrottle] Observer CREATED')

        const observer = new IntersectionObserver(
            (entries) => {
                // Re-check via ref — the observer callback may fire after
                // disconnect() if it was queued before cleanup ran.
                if (entries[0].isIntersecting && !forceStopRef.current) {
                    console.log('[DanbooruThrottle] IO callback FIRED — calling onIntersect')
                    onIntersect()
                }
            },
            {
                root: null,
                rootMargin: "800px",
                threshold: 0,
            }
        )

        if (triggerRef.current) {
            observer.observe(triggerRef.current)
        }

        return () => {
            console.log('[DanbooruThrottle] Observer DISCONNECTED')
            observer.disconnect()
        }
    }, [onIntersect, isLoading, hasNextPage, forceStop, error, isScrollThrottled])

    // Auto-retry: when throttle expires and the trigger is visible, fire onIntersect.
    // Does NOT depend on isLoading or throttleCountdown — uses refs to avoid
    // re-firing when data finishes loading (which would see the just-pushed
    // timestamp and trigger an unnecessary throttle loop).
    useEffect(() => {
        console.log('[DanbooruThrottle] Auto-retry effect CHECK', {
          isScrollThrottled, throttleCountdown, hasNextPage, isLoading, error, forceStop
        })
        if (!isScrollThrottled && throttleCountdown <= 0 && hasNextPage && !isLoadingRef.current && !error && !forceStop) {
            const el = triggerRef.current
            if (el) {
                const rect = el.getBoundingClientRect()
                console.log('[DanbooruThrottle] Auto-retry trigger position', {
                  rectTop: rect.top,
                  windowInnerHeight: window.innerHeight,
                  threshold: window.innerHeight + 800,
                  visible: rect.top < window.innerHeight + 800
                })
                if (rect.top < window.innerHeight + 800) {
                    console.log('[DanbooruThrottle] Auto-retry FIRED — calling onIntersect')
                    onIntersect()
                }
            }
        }
    }, [isScrollThrottled, hasNextPage, error, onIntersect, forceStop])

    if (!hasNextPage) return null

    return (
        <div
            ref={triggerRef}
            className="w-full py-8 flex flex-col justify-center items-center min-h-[60px] gap-2"
        >
            {isLoading && (
                <>
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading more results...</p>
                </>
            )}
            {isScrollThrottled && throttleCountdown > 0 && (
                <>
                    <Clock className="w-5 h-5 text-amber-500" />
                    <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                        Loading too fast. Wait {throttleCountdown}s before loading more...
                    </p>
                </>
            )}
        </div>
    )
}
