"use client"

import { useEffect, useRef } from "react"
import { Loader2 } from "lucide-react"

interface InfiniteScrollTriggerProps {
    onIntersect: () => void
    isLoading: boolean
    hasNextPage: boolean
    forceStop?: boolean
    error?: boolean
}

export function InfiniteScrollTrigger({
    onIntersect,
    isLoading,
    hasNextPage,
    forceStop = false,
    error = false,
}: InfiniteScrollTriggerProps) {
    const triggerRef = useRef<HTMLDivElement>(null)
    const onIntersectRef = useRef(onIntersect)
    const forceStopRef = useRef(forceStop)
    const hasNextPageRef = useRef(hasNextPage)
    const errorRef = useRef(error)

    // Sync refs so the IO callback always calls the latest onIntersect
    // and checks current values without re-creating the observer.
    useEffect(() => {
        onIntersectRef.current = onIntersect
    }, [onIntersect])
    useEffect(() => {
        forceStopRef.current = forceStop
    }, [forceStop])
    useEffect(() => {
        hasNextPageRef.current = hasNextPage
    }, [hasNextPage])
    useEffect(() => {
        errorRef.current = error
    }, [error])

    // Single observer: the IO callback fires when the trigger enters the viewport,
    // including immediately after creation if already visible.
    // Dependencies:
    //   isLoading — trigger position may have changed after data loads
    //   forceStop — reveal animation ended, re-check intersection
    useEffect(() => {
        if (isLoading || !hasNextPageRef.current || forceStop || error) {
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !forceStopRef.current) {
                    onIntersectRef.current()
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
    }, [isLoading, forceStop])

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
        </div>
    )
}
