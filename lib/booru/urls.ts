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

const DANBOORU_ONLY_FIELDS =
  "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,tag_string_meta,rating,image_width,image_height"

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
