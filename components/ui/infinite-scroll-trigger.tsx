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

    // Keep ref in sync so the observer callback can read the current value
    useEffect(() => {
        forceStopRef.current = forceStop
    }, [forceStop])

    useEffect(() => {
        if (isLoading || !hasNextPage || forceStop || error || isScrollThrottled) {
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                // Re-check via ref — the observer callback may fire after
                // disconnect() if it was queued before cleanup ran.
                if (entries[0].isIntersecting && !forceStopRef.current) {
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
            observer.disconnect()
        }
    }, [onIntersect, isLoading, hasNextPage, forceStop, error, isScrollThrottled])

    // Auto-retry: when throttle expires and the trigger is visible, fire onIntersect
    useEffect(() => {
        if (!isScrollThrottled && throttleCountdown <= 0 && hasNextPage && !isLoading && !error && !forceStop) {
            const el = triggerRef.current
            if (el) {
                const rect = el.getBoundingClientRect()
                if (rect.top < window.innerHeight + 800) {
                    onIntersect()
                }
            }
        }
    }, [isScrollThrottled, throttleCountdown, hasNextPage, isLoading, error, onIntersect, forceStop])

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
