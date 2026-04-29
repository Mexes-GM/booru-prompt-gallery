"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, ChevronDown } from "lucide-react"

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
    const cooldownRef = useRef(false)
    const wasLoadingRef = useRef(isLoading)
    const [cooldownActive, setCooldownActive] = useState(false)

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

    // Track isLoading → false transitions to apply cooldown.
    // Prevents the observer from firing synchronously on observe() when the
    // target element is already intersecting after a load cycle completes.
    useEffect(() => {
        if (wasLoadingRef.current && !isLoading) {
            cooldownRef.current = true
            setCooldownActive(true)
            const timer = setTimeout(() => {
                cooldownRef.current = false
                setCooldownActive(false)
            }, 500)
            wasLoadingRef.current = isLoading
            return () => clearTimeout(timer)
        }
        wasLoadingRef.current = isLoading
    }, [isLoading])

    useEffect(() => {
        if (isLoading || !hasNextPageRef.current || forceStop || errorRef.current) {
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (cooldownRef.current) return
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
            {isLoading ? (
                <>
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading more results...</p>
                </>
            ) : cooldownActive ? (
                <p className="text-sm text-muted-foreground/60">Loading more...</p>
            ) : (
                <div className="flex flex-col items-center gap-1">
                    <ChevronDown className="w-4 h-4 text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground/40">Scroll for more</p>
                </div>
            )}
        </div>
    )
}
