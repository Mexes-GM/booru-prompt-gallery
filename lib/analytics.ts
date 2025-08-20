import { track } from '@vercel/analytics'

const ENABLED = process.env.NEXT_PUBLIC_DISABLE_ANALYTICS !== '1'

let _sessionId: string | null = null
function getSessionId() {
  if (typeof window === 'undefined') return 'ssr'
  if (_sessionId) return _sessionId
  try {
    const stored = sessionStorage.getItem('sessionId')
    if (stored) {
      _sessionId = stored
    } else {
      _sessionId = crypto.randomUUID()
      sessionStorage.setItem('sessionId', _sessionId)
    }
  } catch {
    _sessionId = 'na'
  }
  return _sessionId
}

export function safeTrack(event: string, props: Record<string, any> = {}) {
  if (!ENABLED) return
  try {
    track(event, { ...props, sessionId: getSessionId() })
  } catch {
    // ignore
  }
}

const firedDepths = new Set<number>()
export function initScrollDepthTracking() {
  if (typeof window === 'undefined') return
  const handler = () => {
    const scrollTop = window.scrollY
    const docHeight = document.documentElement.scrollHeight - window.innerHeight
    if (docHeight <= 0) return
    const pct = Math.min(100, Math.round((scrollTop / docHeight) * 100))
    const checkpoints = [25, 50, 75, 90]
    for (const cp of checkpoints) {
      if (pct >= cp && !firedDepths.has(cp)) {
        firedDepths.add(cp)
        safeTrack('scroll_depth', { depth: cp })
      }
    }
  }
  window.addEventListener('scroll', handler, { passive: true })
  return () => window.removeEventListener('scroll', handler)
}

export function trackTimeOnPage(startTime: number) {
  const now = Date.now()
  const seconds = Math.round((now - startTime) / 1000)
  safeTrack('session_end', { duration_s: seconds })
}

export function trackExternalLink(href: string, context?: string) {
  safeTrack('external_link', { href, context })
}

export function trackFavorite(postId: number, action: 'add' | 'remove') {
  safeTrack('favorite', { postId, action })
}

export function trackCopy(postId: number) {
  safeTrack('copy_prompt', { postId })
}

export function trackSearch(params: { query: string; rating: string; order: string; tagCount: number }) {
  safeTrack('search', params)
}

export function trackLoadMore(params: { order: string; nextPage: number; currentCount: number }) {
  safeTrack('load_more', params)
}

export function trackViewMode(mode: string) {
  safeTrack('view_mode_change', { mode })
}

export function trackScaleChange(scale: string) {
  safeTrack('card_scale_change', { scale })
}

export function trackFilterChange(key: string, value: string) {
  safeTrack('filter_change', { key, value })
}

export function trackRefresh(order: string) {
  safeTrack('refresh', { order })
}

export function trackProviderChange(provider: string) {
  safeTrack('provider_change', { provider })
}

export function trackAibooruOption(option: string, enabled: boolean) {
  safeTrack('aibooru_option', { option, enabled })
}

export function trackRatingChange(rating: string) {
  safeTrack('rating_change', { rating })
}

export function trackOrderChange(order: string) {
  safeTrack('order_change', { order })
}

export function trackDanbooruOption(option: string, enabled: boolean) {
  safeTrack('danbooru_option', { option, enabled })
}
