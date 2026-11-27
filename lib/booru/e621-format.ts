/**
 * Reads post JSON from the e621 engine (e621.net, floofgens.net and other sites
 * running it) in both of the formats it serves.
 *
 * Legacy format (the default until 2026-11, now opt-in with `v1=true`):
 *   `{ posts: [...] }` (`{ post }` for /posts/<id>.json), each post with
 *   `file` / `sample` / `preview` objects holding a `url`, `score.total`, and
 *   `tags` grouped by category.
 *
 * Current format: a bare array (a bare post for /posts/<id>.json), each post
 *   with `files.{meta,original,sample,preview}` (sample and preview expose
 *   `jpg` and `webp` URLs), `stats.score.total`, and `tags` as one flat list.
 *   Requests that pass `mode=extended` (E621_POSTS_MODE) get `tags` grouped by
 *   category again, which is what prompt cleaning and character detection need:
 *   without categories, artist names and meta tags such as `hi_res` cannot be
 *   told apart from content tags.
 *
 * Both formats map to the same fields. A flat tag list (the mode ignored) still
 * parses: every tag lands in `tag_string` and the category fields stay empty.
 *
 * Twin of workers/booru-image-proxy/src/lib/booru/providers/e621-format.ts
 * (the Worker cannot import from the app). Keep both identical;
 * __tests__/e621-format.verify.ts checks that they give the same output.
 */

/** `mode` query parameter for e621-engine post requests: tags grouped by category. */
export const E621_POSTS_MODE = 'extended'

/**
 * Categories whose tags describe the image. `meta`, `invalid` and
 * `contributor` are left out of `tag_string`. e6ai.net (retired) called its
 * artist category "director" and its copyright category "franchise"; both
 * spellings are still read.
 */
const CONTENT_CATEGORIES = ['general', 'species', 'character', 'copyright', 'franchise', 'artist', 'director', 'lore']

export interface E621ParsedPost {
  id: number
  file_url: string
  large_file_url: string
  preview_file_url: string
  tag_string: string
  tag_string_artist: string
  tag_string_character: string
  tag_string_copyright: string
  rating: string
  score: number
  width: number
  height: number
  source: string
}

type JsonObject = Record<string, unknown>

const asObject = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : []

/** The raw posts of a posts.json or posts/<id>.json response, in either format. */
export function extractE621Posts(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  const body = asObject(data)
  if (Array.isArray(body.posts)) return body.posts
  if (body.post && typeof body.post === 'object') return [body.post]
  if (body.id !== undefined && (body.files || body.file)) return [data]
  return []
}

/** One raw post in either format, or null when it is deleted or has no file. */
export function parseE621Post(raw: unknown): E621ParsedPost | null {
  const post = asObject(raw)
  const id = asNumber(post.id)
  if (!id) return null
  if (asObject(post.flags).deleted === true) return null

  let fileUrl: string
  let sampleUrl: string
  let previewUrl: string
  let width: number
  let height: number
  if (post.files) {
    const files = asObject(post.files)
    const original = asObject(files.original)
    const sample = asObject(files.sample)
    const preview = asObject(files.preview)
    fileUrl = asString(original.url)
    sampleUrl = asObject(files.meta).has_sample === false ? '' : asString(sample.jpg) || asString(sample.webp)
    previewUrl = asString(preview.jpg) || asString(preview.webp)
    width = asNumber(original.width)
    height = asNumber(original.height)
  } else {
    const file = asObject(post.file)
    fileUrl = asString(file.url)
    sampleUrl = asString(asObject(post.sample).url)
    previewUrl = asString(asObject(post.preview).url)
    width = asNumber(file.width)
    height = asNumber(file.height)
  }
  if (!fileUrl) return null

  let tags: string[]
  let artists: string[] = []
  let characters: string[] = []
  let copyrights: string[] = []
  if (Array.isArray(post.tags)) {
    tags = asStrings(post.tags)
  } else {
    const groups = asObject(post.tags)
    tags = CONTENT_CATEGORIES.flatMap((category) => asStrings(groups[category]))
    artists = [...asStrings(groups.artist), ...asStrings(groups.director)]
    characters = asStrings(groups.character)
    copyrights = [...asStrings(groups.copyright), ...asStrings(groups.franchise)]
  }

  const score = post.stats ? asObject(asObject(post.stats).score) : asObject(post.score)

  return {
    id,
    file_url: fileUrl,
    large_file_url: sampleUrl || fileUrl,
    preview_file_url: previewUrl || fileUrl,
    tag_string: tags.join(' '),
    tag_string_artist: artists.join(' '),
    tag_string_character: characters.join(' '),
    tag_string_copyright: copyrights.join(' '),
    rating: asString(post.rating),
    score: asNumber(score.total),
    width,
    height,
    source: asStrings(post.sources)[0] || '',
  }
}
