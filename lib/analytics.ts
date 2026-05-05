/**
 * Analytics module — kept intentionally minimal to stay within
 * Vercel Web Analytics free-tier limits (50K events/month).
 *
 * Only the `<Analytics />` component in layout.tsx sends automatic
 * pageview events.  Custom events are disabled to save quota.
 *
 * If you need granular tracking later, re-enable individual
 * functions and budget ~20 events/session × expected sessions.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

// No-op: every consumer can still call these without breaking,
// but nothing is sent to Vercel Analytics.
export function safeTrack(_event: string, _props: Record<string, any> = {}) {
  // intentionally empty — saves Web Analytics Events quota
}

// Stubs so existing imports don't break
export function initScrollDepthTracking() { return () => { } }
export function trackTimeOnPage(_startTime: number) { }
export function trackExternalLink(_href: string, _context?: string) { }
export function trackFavorite(_postId: number, _action: 'add' | 'remove') { }
export function trackCopy(_postId: number) { }
export function trackSearch(_params: { query: string; rating: string; order: string; tagCount: number }) { }
export function trackLoadMore(_params: { order: string; nextPage: number; currentCount: number }) { }
export function trackViewMode(_mode: string) { }
export function trackScaleChange(_scale: string) { }
export function trackFilterChange(_key: string, _value: string) { }
export function trackRefresh(_order: string) { }
export function trackProviderChange(_provider: string) { }
export function trackAibooruOption(_option: string, _enabled: boolean) { }
export function trackRatingChange(_rating: string) { }
export function trackOrderChange(_order: string) { }
export function trackDanbooruOption(_option: string, _enabled: boolean) { }
export function trackRule34Option(_option: string, _enabled: boolean) { }
export function trackE621Option(_option: string, _enabled: boolean) { }
