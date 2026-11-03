/**
 * The app's only handle on PostHog. posthog-js (~295 KB) is loaded with a
 * dynamic import after the first paint (instrumentation-client.ts), so nothing
 * else may import it as a value: a single static import pulls it back into the
 * scripts the HTML loads.
 *
 * Calls made before the SDK is ready are queued in order and replayed once it
 * is, so super properties registered early still apply to the events captured
 * after them. Captures keep the time they happened: plain events through the
 * `timestamp` capture option, exceptions through the QUEUED_* properties that
 * the before_send hook in instrumentation-client.ts turns back into the event's
 * timestamp and uuid.
 *
 * Type-only imports are erased at build time and cost nothing.
 */

import type { PostHog } from "posthog-js"

/** Property carrying the original time (ms) of a queued exception. Read and removed by before_send. */
export const QUEUED_TIMESTAMP_PROP = "__queued_at"
/** Property carrying the uuid already handed out for a queued exception. Read and removed by before_send. */
export const QUEUED_UUID_PROP = "__queued_uuid"

// Bounded: on localhost or without a key PostHog never loads, and the queue
// just stops growing.
const MAX_PENDING = 100
const pending: Array<(ph: PostHog) => void> = []
let client: PostHog | null = null

/** The loaded PostHog instance, or null until instrumentation-client.ts hands it over. */
export function getPostHog(): PostHog | null {
  return client
}

/**
 * Runs `fn` with PostHog now if it is loaded, otherwise once it is. Never
 * throws. Callers that need the original time must capture it themselves
 * before queueing (see capture()).
 */
export function withPostHog(fn: (ph: PostHog) => void): void {
  if (typeof window === "undefined") return
  if (client) {
    try {
      fn(client)
    } catch {
      /* non-fatal: telemetry is best-effort */
    }
    return
  }
  if (pending.length < MAX_PENDING) pending.push(fn)
}

/** Crash-proof capture that keeps the event's original time when it has to wait. */
export function capture(event: string, props?: Record<string, unknown>): void {
  if (client) {
    withPostHog((ph) => ph.capture(event, props))
    return
  }
  const timestamp = new Date()
  withPostHog((ph) => ph.capture(event, props, { timestamp }))
}

/**
 * Called once from PostHog's `loaded` callback: replays everything queued, in
 * order. `beforeReplay` runs first, with calls going straight to PostHog, so
 * page-level super properties registered there also apply to queued events.
 */
export function setPostHogClient(ph: PostHog, beforeReplay?: () => void): void {
  client = ph
  try {
    beforeReplay?.()
  } catch {
    /* non-fatal */
  }
  for (const fn of pending.splice(0)) {
    try {
      fn(ph)
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * before_send step: moves the QUEUED_* properties of an exception reported
 * before PostHog loaded onto the event itself (its timestamp and the uuid
 * already handed out), and drops them from the properties.
 */
export function applyQueuedMetadata<T extends { properties?: Record<string, unknown>; timestamp?: Date; uuid: string }>(
  event: T,
): T {
  const props = event.properties
  if (!props) return event
  const queuedAt = props[QUEUED_TIMESTAMP_PROP]
  const queuedUuid = props[QUEUED_UUID_PROP]
  delete props[QUEUED_TIMESTAMP_PROP]
  delete props[QUEUED_UUID_PROP]
  if (typeof queuedAt === "number") event.timestamp = new Date(queuedAt)
  if (typeof queuedUuid === "string") event.uuid = queuedUuid
  return event
}

/**
 * UUIDv7 (time-ordered, the format posthog-js uses for event ids), so an
 * exception reported before PostHog loads can still show its reference code.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let ms = now
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256
    ms = Math.floor(ms / 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
