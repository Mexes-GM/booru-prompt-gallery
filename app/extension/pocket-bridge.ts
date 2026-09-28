"use client"

import { useEffect, useRef } from "react"

// The sidepanel host is an extension page, whose origin is dynamic and
// browser-dependent: `chrome-extension://<id>` on Chrome/Chromium,
// `moz-extension://<id>` on Firefox. We therefore post to the parent with "*"
// and rely on the parent verifying our origin (extension/sidepanel/ checks
// event.source + event.origin against its iframe). Messages received from the
// parent are trusted only when they originate from window.parent AND from one
// of those two extension-page schemes or a known web host.
const TARGET_ORIGIN = "*"
const ALLOWED_ORIGINS = ["https://tensor.art", "https://seaart.ai"]

/** True when a message genuinely comes from our embedding parent (the sidepanel). */
export function isTrustedParentMessage(event: MessageEvent): boolean {
  if (event.source !== window.parent) return false
  if (typeof event.origin !== "string") return false
  return (
    event.origin.startsWith("chrome-extension://") ||
    event.origin.startsWith("moz-extension://") ||
    ALLOWED_ORIGINS.includes(event.origin)
  )
}

/** Whether the Pocket is actually embedded (sidepanel) vs. opened as a plain tab. */
export function isEmbedded(): boolean {
  try {
    return typeof window !== "undefined" && window.parent !== window
  } catch {
    return true
  }
}

// ── Pocket → host messages ──────────────────────────────────────────────────
export type QueueAction =
  | { action: "target"; targetKind?: "prompt" | "generate" | "queue" | "width" | "height" }
  | { action: "clear" | "pause" | "resume" | "export_job_ledger" | "requeue_lost_jobs" | "clear_batch_report" }
  | { action: "set_auto_download" | "set_character_subfolders" | "set_background_generation"; value: boolean }
  | { action: "capture_busy_signal"; step: "idle" | "busy" }
  | { action: "set_concurrency_limit"; value: number; unlimited?: boolean }

export type PocketToHostMessage =
  | { type: "INJECT_PROMPT"; prompt: string; width?: number; height?: number; character?: string }
  | ({ type: "QUEUE_ACTION" } & QueueAction)
  | { type: "REQUEST_QUEUE_STATUS" }
  | { type: "REQUEST_SITE_PROFILE_STATUS" }
  | { type: "THEME_CHANGE"; theme: "dark" | "light" }
  | { type: "POCKET_READY" }

/** Post a message to the sidepanel host. No-op when not embedded. */
export function postToParent(message: PocketToHostMessage): void {
  if (!isEmbedded()) return
  try {
    window.parent.postMessage(message, TARGET_ORIGIN)
  } catch {
    /* parent unavailable */
  }
}

export function sendQueueAction(action: QueueAction): void {
  postToParent({ type: "QUEUE_ACTION", ...action } as PocketToHostMessage)
}

/**
 * Subscribe to trusted messages of the given `type` from the sidepanel host.
 * The handler is kept in a ref so callers can pass an inline function without
 * re-subscribing on every render.
 */
export function useHostMessage<T = Record<string, unknown>>(
  type: string,
  handler: (data: T & { type: string }) => void
): void {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedParentMessage(event)) return
      if (!event.data || event.data.type !== type) return
      handlerRef.current(event.data)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [type])
}
