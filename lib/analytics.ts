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

// Crash-proof PostHog capture. Guards SSR (no window) and never throws so
// telemetry can never take down the app. This is the single choke point that
// routes the track* helpers below into PostHog product analytics — previously
// these only dropped Sentry breadcrumbs, so the data was collected but never
// queryable in the PostHog dashboard.
function capture(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  try {
    posthog.capture(event, props)
  } catch {
    /* non-fatal: telemetry is best-effort */
  }
}

// Generic event breadcrumb (kept for callers that use the raw API).
export function safeTrack(event: string, props: Record<string, any> = {}) {
  crumb("action", event, props)
  capture(event, props)
}

// Scroll-depth / time-on-page would be too noisy — keep no-op.
export function initScrollDepthTracking() { return () => { } }
export function trackTimeOnPage(_startTime: number) { }

export function trackExternalLink(href: string, context?: string) {
  crumb("navigation", "external link", { href, context })
  capture('external_link_clicked', { href, context })
}

export function trackFavorite(postId: number, action: 'add' | 'remove') {
  crumb("favorites", `favorite ${action}`, { postId, action })
  capture(action === 'add' ? 'favorite_added' : 'favorite_removed', { post_id: postId })
}

// NOTE: prompt_copied is captured directly at the copy call site
// (prompt-gallery.tsx) with rich props (copy_type, booru_source). Keep this a
// breadcrumb-only helper so we do NOT double-count copies in PostHog.
export function trackCopy(postId: number) {
  crumb("action", "copy prompt", { postId })
}

// NOTE: search_executed is captured directly by search-bar.tsx (with provider
// + is_shuffle). Keep this breadcrumb-only to avoid double-counting searches.
export function trackSearch(params: { query: string; rating: string; order: string; tagCount: number }) {
  crumb("search", "search executed", params)
}

export function trackLoadMore(params: { order: string; nextPage: number; currentCount: number }) {
  crumb("search", "load more", params)
  capture('results_load_more', {
    order: params.order,
    next_page: params.nextPage,
    current_count: params.currentCount,
  })
}

export function trackViewMode(mode: string) {
  tag("view_mode", mode)
  crumb("ui", "view mode", { mode })
  capture('view_mode_changed', { mode })
}

export function trackScaleChange(scale: string) {
  crumb("ui", "card scale", { scale })
  capture('card_scale_changed', { scale })
}

export function trackFilterChange(key: string, value: string) {
  crumb("filter", "filter change", { key, value })
  capture('filter_changed', { filter_key: key, value })
}

export function trackRefresh(order: string) {
  crumb("search", "refresh", { order })
  capture('results_refreshed', { order })
}

export function trackProviderChange(provider: string) {
  // Provider is the single most useful triage dimension — surface it as a
  // Sentry tag on every subsequent event, a breadcrumb for the timeline, AND a
  // PostHog event. This helper is the code path used by the card-driven
  // provider switch (prompt-gallery.tsx), which the gallery-toolbar's direct
  // capture does NOT cover — so this closes a real gap.
  tag("provider", provider)
  crumb("provider", "provider change", { provider })
  capture('provider_changed', { provider })
}

export function trackAibooruOption(option: string, enabled: boolean) {
  crumb("filter", "aibooru option", { option, enabled })
  capture('provider_option_changed', { provider: 'aibooru', option, enabled })
}

export function trackRatingChange(rating: string) {
  tag("rating", rating)
  crumb("filter", "rating change", { rating })
  capture('rating_filter_changed', { rating })
}

export function trackOrderChange(order: string) {
  crumb("filter", "order change", { order })
  capture('order_changed', { order })
}

export function trackDanbooruOption(option: string, enabled: boolean) {
  crumb("filter", "danbooru option", { option, enabled })
  capture('provider_option_changed', { provider: 'danbooru', option, enabled })
}

export function trackRule34Option(option: string, enabled: boolean) {
  crumb("filter", "rule34 option", { option, enabled })
  capture('provider_option_changed', { provider: 'rule34', option, enabled })
}

export function trackE621Option(option: string, enabled: boolean) {
  crumb("filter", "e621 option", { option, enabled })
  capture('provider_option_changed', { provider: 'e621', option, enabled })
}
