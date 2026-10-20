import { PROVIDER_URLS } from "@/lib/constants"
import { userPreferences } from "@/lib/storage"
import { createPostsKey } from "./posts-key"

/**
 * First-page prefetch for the gallery.
 *
 * The gallery is a `next/dynamic` chunk, so on a cold load its first-page
 * request only starts once that chunk has downloaded, run and mounted. On
 * tall desktop viewports the first row of cards is the LCP element, and that
 * wait was most of it. app/page-client.tsx calls prefetchFirstPostsPage() when
 * the page chunk runs; the fetcher in lib/api-client.ts picks the response up
 * when useBooruSearch asks for the same URL.
 *
 * The URL comes from the same createPostsKey() and the same stored
 * preferences useBooruSearch starts from, so it matches the hook's first key.
 * If it ever doesn't, the fetcher simply never claims it.
 */

export const readTagsFromUrl = (): string => {
  if (typeof window === 'undefined') return ""
  return new URLSearchParams(window.location.search).get('tags') ?? ""
}

// Only a response this fresh may stand in for the gallery's own request.
const PREFETCH_TTL_MS = 15_000

const prefetched = new Map<string, { at: number; response: Promise<Response> }>()

// Shuffle URLs carry a random seed. The prefetch picks it and useBooruSearch
// starts from the same one (initialShuffleSeed), so both build the same URL.
let prefetchSeed: { at: number; seed: number } | undefined

export function prefetchFirstPostsPage(): void {
  if (typeof window === 'undefined') return
  try {
    // Signed-in requests to our Worker carry an Authorization header that
    // needs the Supabase client; leave those to the fetcher.
    if (/(?:^|;\s*)sb-[^=]*-auth-token/.test(document.cookie)) return

    const isShuffle = userPreferences.getIsShuffle()
    const randomSeed = isShuffle ? Date.now() : undefined
    const url = createPostsKey({
      tags: readTagsFromUrl(),
      ratingFilter: userPreferences.getRatingFilter(),
      order: isShuffle ? 'random' : 'recent',
      randomSeed,
      provider: userPreferences.getBooruProvider(),
      hasPrompt: userPreferences.getHasPromptFilter(),
      tagCountFilter: userPreferences.getMinimumTagCount(),
      scoreTier: userPreferences.getScoreTier(),
    })(0, null)
    if (!url || prefetched.has(url)) return

    // Same headers the fetcher sends for an anonymous request.
    const headers: HeadersInit = url.startsWith(PROVIDER_URLS.AIBOORU) ? {} : { Accept: 'application/json' }
    const response = fetch(url, { headers })
    response.catch(() => { /* the fetcher retries on its own */ })
    prefetched.set(url, { at: Date.now(), response })
    if (randomSeed !== undefined) prefetchSeed = { at: Date.now(), seed: randomSeed }
  } catch {
    // A prefetch must never break the page.
  }
}

/** Hands over (once) a fresh prefetched response for `url`, if there is one. */
export function takePrefetchedPosts(url: string): Promise<Response> | undefined {
  const entry = prefetched.get(url)
  if (!entry) return undefined
  prefetched.delete(url)
  return Date.now() - entry.at < PREFETCH_TTL_MS ? entry.response : undefined
}

/**
 * The seed useBooruSearch starts Shuffle with: the prefetch's while its
 * response is still fresh, a new one otherwise. Not consumed on read, so a
 * double-invoked state initializer (Strict Mode) gets the same value.
 */
export function initialShuffleSeed(): number {
  if (prefetchSeed && Date.now() - prefetchSeed.at < PREFETCH_TTL_MS) return prefetchSeed.seed
  return Date.now()
}
