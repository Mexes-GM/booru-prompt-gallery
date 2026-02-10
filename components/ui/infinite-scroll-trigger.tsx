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
    error = false
}: InfiniteScrollTriggerProps) {
    const triggerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (isLoading || !hasNextPage || forceStop || error) return

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    onIntersect()
                }
            },
            {
                root: null,
                rootMargin: "400px", // Trigger earlier
                threshold: 0,
            }
        )

        if (triggerRef.current) {
            observer.observe(triggerRef.current)
        }

        return () => {
            observer.disconnect()
        }
    }, [onIntersect, isLoading, hasNextPage, forceStop, error])

    if (!hasNextPage) return null

    return (
        <div
            ref={triggerRef}
            className="w-full py-8 flex justify-center items-center min-h-[60px]"
        >
            {isLoading && <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />}
        </div>
    )
}
