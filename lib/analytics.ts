/**
 * Analytics / telemetry module — every track* helper routes into PostHog
 * product analytics through the crash-proof capture() choke point below.
 * PostHog is the only analytics tool (pageviews are captured by the SDK, see
 * capture_pageview in instrumentation-client.ts), so Vercel and Netlify report
 * identically.
 */

import { capture as queuedCapture } from "@/lib/posthog-queue"
import { setErrorContext } from "@/lib/error-reporting"

// Crash-proof PostHog capture. Guards SSR (no window) and never throws so
// telemetry can never take down the app. This is the single choke point that
// routes the track* helpers below into PostHog product analytics. posthog-js
// loads after the first paint; events tracked before that (e.g. app_open) wait
// in lib/posthog-queue.ts and are sent with their original timestamps.
function capture(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  queuedCapture(event, props)
}

/** Tracks a product event. Use this instead of importing posthog-js. */
export function track(event: string, props?: Record<string, unknown>) {
  capture(event, props)
}

// Generic event capture (kept for callers that use the raw API).
export function safeTrack(event: string, props: Record<string, any> = {}) {
  capture(event, props)
}

// Scroll-depth / time-on-page would be too noisy — keep no-op.
export function initScrollDepthTracking() { return () => { } }
export function trackTimeOnPage(_startTime: number) { }

// Fired once per page load when the ?tags= URL sync trips its circuit breaker
// (see useBooruSearch). Diagnostic only: a 2026-09-01 iOS Safari session showed
// the URL flapping "/" <-> "?tags=..." ~1,200 times, and the cause was never
// reproduced — this carries enough context to identify the competing writer.
export function trackUrlSyncLoop(props: {
  writes: number
  windowMs: number
  /** Last few history writes: method, target URL, Next-internal flag, top stack frames. */
  recentWrites: { method: string; url: string; nextInternal: boolean; stack: string }[]
}) {
  capture('url_sync_loop_detected', props)
}

export function trackExternalLink(href: string, context?: string) {
  capture('external_link_clicked', { href, context })
}

export function trackFavorite(postId: number, action: 'add' | 'remove') {
  capture(action === 'add' ? 'favorite_added' : 'favorite_removed', { post_id: postId })
}

export function trackLoadMore(params: { order: string; nextPage: number; currentCount: number }) {
  capture('results_load_more', {
    order: params.order,
    next_page: params.nextPage,
    current_count: params.currentCount,
  })
}

export function trackScaleChange(scale: string) {
  capture('card_scale_changed', { scale })
}

export function trackFilterChange(key: string, value: string) {
  capture('filter_changed', { filter_key: key, value })
}

export function trackRefresh(order: string) {
  capture('results_refreshed', { order })
}

export function trackProviderChange(provider: string) {
  // Provider is the single most useful triage dimension — attach it to every
  // subsequent event (including exceptions) AND send a PostHog event. This
  // helper is the code path used by the card-driven provider switch
  // (prompt-gallery.tsx), which the gallery-toolbar direct capture does NOT
  // cover — so this closes a real gap.
  setErrorContext({ provider })
  capture('provider_changed', { provider })
}

export function trackAibooruOption(option: string, enabled: boolean) {
  capture('provider_option_changed', { provider: 'aibooru', option, enabled })
}

export function trackOrderChange(order: string) {
  capture('order_changed', { order })
}

export function trackDanbooruOption(option: string, enabled: boolean) {
  capture('provider_option_changed', { provider: 'danbooru', option, enabled })
}

export function trackRule34Option(option: string, enabled: boolean) {
  capture('provider_option_changed', { provider: 'rule34', option, enabled })
}

export function trackE621Option(option: string, enabled: boolean) {
  capture('provider_option_changed', { provider: 'e621', option, enabled })
}
