/**
 * Analytics / telemetry module.
 *
 * Vercel Web Analytics custom events stay DISABLED to protect the free-tier
 * quota (50K events/month) — only the automatic `<Analytics />` pageviews ship.
 *
 * However, every one of these already-wired call sites now also drops a Sentry
 * **breadcrumb** (and, for a few, a triage **tag**). Breadcrumbs ride *inside*
 * the error event Sentry already sends, so they cost ZERO extra quota and give
 * a full "what the user was doing" timeline for ANY future crash — not just the
 * translation bug (SENTRY-FULVOUS-ANCHOR-7). In dev / when Sentry is disabled
 * these are safe no-ops.
 */

import * as Sentry from "@sentry/nextjs"
import posthog from 'posthog-js'

// Thin, crash-proof wrappers so telemetry can never take down the app.
function crumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: Sentry.SeverityLevel = "info",
) {
  try {
    Sentry.addBreadcrumb({ category, message, level, data })
  } catch {
    /* non-fatal: telemetry is best-effort */
  }
}

function tag(key: string, value: string) {
  try {
    Sentry.setTag(key, value)
  } catch {
    /* non-fatal */
  }
}

// Generic event breadcrumb (kept for callers that use the raw API).
export function safeTrack(event: string, props: Record<string, any> = {}) {
  crumb("action", event, props)
}

// Scroll-depth / time-on-page would be too noisy as breadcrumbs — keep no-op.
export function initScrollDepthTracking() { return () => { } }
export function trackTimeOnPage(_startTime: number) { }

export function trackExternalLink(href: string, context?: string) {
  crumb("navigation", "external link", { href, context })
}

export function trackFavorite(postId: number, action: 'add' | 'remove') {
  crumb("favorites", `favorite ${action}`, { postId, action })
  if (typeof window !== 'undefined') {
    posthog.capture(action === 'add' ? 'favorite_added' : 'favorite_removed')
  }
}

export function trackCopy(postId: number) {
  crumb("action", "copy prompt", { postId })
}

export function trackSearch(params: { query: string; rating: string; order: string; tagCount: number }) {
  crumb("search", "search executed", params)
}

export function trackLoadMore(params: { order: string; nextPage: number; currentCount: number }) {
  crumb("search", "load more", params)
}

export function trackViewMode(mode: string) {
  tag("view_mode", mode)
  crumb("ui", "view mode", { mode })
}

export function trackScaleChange(scale: string) {
  crumb("ui", "card scale", { scale })
}

export function trackFilterChange(key: string, value: string) {
  crumb("filter", "filter change", { key, value })
}

export function trackRefresh(order: string) {
  crumb("search", "refresh", { order })
}

export function trackProviderChange(provider: string) {
  // Provider is the single most useful triage dimension — surface it as a tag
  // on every subsequent event, plus a breadcrumb for the timeline.
  tag("provider", provider)
  crumb("provider", "provider change", { provider })
}

export function trackAibooruOption(option: string, enabled: boolean) {
  crumb("filter", "aibooru option", { option, enabled })
}

export function trackRatingChange(rating: string) {
  tag("rating", rating)
  crumb("filter", "rating change", { rating })
}

export function trackOrderChange(order: string) {
  crumb("filter", "order change", { order })
}

export function trackDanbooruOption(option: string, enabled: boolean) {
  crumb("filter", "danbooru option", { option, enabled })
}

export function trackRule34Option(option: string, enabled: boolean) {
  crumb("filter", "rule34 option", { option, enabled })
}

export function trackE621Option(option: string, enabled: boolean) {
  crumb("filter", "e621 option", { option, enabled })
}
