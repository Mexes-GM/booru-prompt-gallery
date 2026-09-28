/**
 * Shared motion curves for Framer Motion / inline styles. Mirrors the
 * --ease-* tokens in app/globals.css (@theme) — keep both in sync.
 */
export const EASE_OUT_STRONG = [0.23, 1, 0.32, 1] as const
export const EASE_IN_OUT_STRONG = [0.77, 0, 0.175, 1] as const
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const

export const EASE_OUT_STRONG_CSS = "cubic-bezier(0.23, 1, 0.32, 1)"

/** Sliding "active pill" in segmented controls (layoutId). */
export const SEGMENT_PILL_SPRING = { type: "spring", stiffness: 450, damping: 32 } as const

/** How long a search-filter control waits before committing (gallery
 *  re-render + refetch): roughly SEGMENT_PILL_SPRING's settle time, so the
 *  selection animation finishes on a free main thread. */
export const FILTER_COMMIT_DELAY_MS = 300
