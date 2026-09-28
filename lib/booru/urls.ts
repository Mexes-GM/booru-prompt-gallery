import { PROVIDER_URLS } from "@/lib/constants"

/**
 * URL helpers for booru API access.
 *
 * `apiUrl` targets the Cloudflare Worker base (which serves both the image proxy
 * and the `/api/*` routes). When `NEXT_PUBLIC_IMAGE_PROXY_URL` is empty (local
 * dev), it falls back to same-origin `/api/*` routes.
 */

// CF Worker base URL — same worker handles both image proxy and API routes.
// Set NEXT_PUBLIC_IMAGE_PROXY_URL to your Cloudflare Worker URL.
// When empty (local dev), uses same-origin /api/* routes.
const API_BASE = process.env.NEXT_PUBLIC_IMAGE_PROXY_URL || ""

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

/**
 * Safely checks whether a URL's host equals `host` or is a subdomain of it.
 *
 * Prefer this over `url.includes("example.com")` for host checks. A bare
 * substring test also matches attacker-shaped URLs such as
 * `https://evil.com/?x=e621.net` or `https://e621.net.evil.com`
 * (CodeQL js/incomplete-url-substring-sanitization). Relative or unparseable
 * URLs resolve against a sentinel host and therefore return false.
 */
export function urlHasHost(url: string, host: string): boolean {
  try {
    const h = new URL(url, "http://relative.invalid").hostname.toLowerCase()
    const target = host.toLowerCase()
    return h === target || h.endsWith("." + target)
  } catch {
    return false
  }
}

export const DANBOORU_ONLY_FIELDS =
  "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,tag_string_meta,rating,score,image_width,image_height"

/**
 * Direct Danbooru lookup of up to 100 posts by id in ONE request (`id:a,b,c`
 * counts as a single tag). Used for favorites/history hydration from the
 * browser, so it spends the user's own Danbooru quota instead of the shared
 * Worker egress.
 */
export function buildDanbooruIdsUrl(ids: number[]): string {
  const params = new URLSearchParams({
    limit: String(ids.length),
    only: DANBOORU_ONLY_FIELDS,
    tags: `id:${ids.join(",")}`,
  })
  return `${PROVIDER_URLS.DANBOORU}/posts.json?${params.toString()}`
}

/**
 * Builds a direct Danbooru `posts.json` URL (bypassing our worker) with the
 * correct tag/order semantics. Seeded random pagination appends a `_seed` param
 * so consecutive pages stay consistent within a session.
 */
export function buildDirectDanbooruUrl(
  query: string,
  page: string,
  order: string,
  randomSeed?: number,
  pageIndex?: number
): string {
  let finalTags: string
  const isRandom = order === "random" || /order:random|random:\d+/i.test(query)

  if (order === "recent") {
    finalTags = query || ""
  } else if (isRandom) {
    const cleanTags = query ? query.replace(/order:random|random:\d+/gi, "").trim() : ""
    finalTags = cleanTags ? `${cleanTags} random:30` : "random:30"
  } else {
    finalTags = query ? `${query} order:rank` : "order:rank"
  }

  const params = new URLSearchParams({
    limit: "30",
    only: DANBOORU_ONLY_FIELDS,
    page,
    tags: finalTags,
  })

  if (isRandom && randomSeed !== undefined && pageIndex !== undefined) {
    params.append("_seed", `${randomSeed}_${pageIndex}`)
  }

  return `${PROVIDER_URLS.DANBOORU}/posts.json?${params.toString()}`
}
