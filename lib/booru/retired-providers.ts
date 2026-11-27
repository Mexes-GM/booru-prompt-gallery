import type { BooruPost } from "./types"

/**
 * Providers that closed and the provider that replaced them.
 *
 * e6ai.net went offline in 2026-11. Floofgens (floofgens.net) replaces it on
 * the same engine and carries over its posts with the same post ids and file
 * hashes, so a saved e6ai post is the Floofgens post with that id and its
 * images live at the same path on Floofgens' CDN.
 *
 * Data saved before the switch (the selected provider, favorites, copy
 * history, cached posts) still says "e6ai" and points at static1.e6ai.net;
 * the helpers below map it on read so it keeps working.
 */
const RETIRED_PROVIDERS: Record<string, string> = {
  e6ai: "floofgens",
}

const RETIRED_IMAGE_HOSTS: Record<string, string> = {
  "static1.e6ai.net": "static1.floofgens.net",
}

/** The current id for a provider id, lowercased; retired ids map to their replacement. */
export function canonicalProvider(provider: string): string {
  const id = String(provider).toLowerCase()
  return RETIRED_PROVIDERS[id] ?? id
}

/** An image URL on a retired provider's CDN, moved to its replacement's; other URLs unchanged. */
export function migrateRetiredImageUrl(url: string): string {
  if (!url) return url
  try {
    const parsed = new URL(url)
    const host = RETIRED_IMAGE_HOSTS[parsed.hostname]
    if (!host) return url
    parsed.hostname = host
    return parsed.toString()
  } catch {
    return url
  }
}

/** A saved post with its provider and image URLs moved off a retired provider. */
export function migrateRetiredPost<T extends Pick<BooruPost, "file_url" | "large_file_url" | "preview_file_url" | "_provider">>(post: T): T {
  const provider = post._provider ? canonicalProvider(post._provider) : post._provider
  const fileUrl = migrateRetiredImageUrl(post.file_url)
  const largeUrl = migrateRetiredImageUrl(post.large_file_url)
  const previewUrl = migrateRetiredImageUrl(post.preview_file_url)
  if (
    provider === post._provider &&
    fileUrl === post.file_url &&
    largeUrl === post.large_file_url &&
    previewUrl === post.preview_file_url
  ) {
    return post
  }
  return {
    ...post,
    _provider: provider,
    file_url: fileUrl,
    large_file_url: largeUrl,
    preview_file_url: previewUrl,
  }
}
