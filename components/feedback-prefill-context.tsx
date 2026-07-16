"use client"

// Lightweight module-level store that lets any code (e.g. the toastError()
// helper) request the FeedbackDialog to open pre-filled with specific
// content, without requiring a React Context provider to be wired into the
// tree. Mirrors the singleton dispatch/listener pattern already used by
// hooks/use-toast.ts, so it works the same way from event handlers, promise
// callbacks, etc. — not just from render.
//
// See docs/error-toast-reporting-plan.md (Fase 2).
import * as React from "react"

export interface PrefilledFeedback {
  type: "bug" | "feature" | "general"
  content: string
  /** Extra metadata merged into the feedback submission's `metadata` field. */
  metadata?: Record<string, unknown>
}

interface State {
  request: PrefilledFeedback | null
  /** Incremented on every openPrefilledFeedback() call so effects can react
   *  even if the same content is requested twice in a row. */
  requestId: number
}

let memoryState: State = { request: null, requestId: 0 }
const listeners: Array<(state: State) => void> = []

function dispatch(state: State) {
  memoryState = state
  listeners.forEach((listener) => listener(memoryState))
}

/** Request that the FeedbackDialog open pre-filled with the given content. */
export function openPrefilledFeedback(request: PrefilledFeedback): void {
  dispatch({ request, requestId: memoryState.requestId + 1 })
}

/** Clear the pending pre-fill request (called once FeedbackDialog consumes it). */
export function clearPrefilledFeedback(): void {
  dispatch({ request: null, requestId: memoryState.requestId })
}

/**
 * Subscribe to pre-fill requests. Returns the current state plus the
 * requestId so consumers can detect a *new* request even if `request` is
 * referentially different each time (it always is, since it's a fresh
 * object per call).
 */
export function useFeedbackPrefill(): State {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) listeners.splice(index, 1)
    }
  }, [])

  return state
}
