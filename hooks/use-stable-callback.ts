"use client"

import { useCallback, useLayoutEffect, useRef } from "react"

/**
 * A function whose identity never changes and that always runs the latest `fn`. For handlers
 * passed to memoized lists: a handler that depends on fast-changing state would otherwise
 * re-render every item each time that state changes. Not for use while rendering.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback((...args: A) => ref.current(...args), [])
}
