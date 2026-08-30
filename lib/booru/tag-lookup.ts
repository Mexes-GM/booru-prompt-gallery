/**
 * Key normalization for `auto_suggest_tags` lookups.
 *
 * Every consumer of that table matches on `name` with an exact-string PostgREST
 * `in` filter, and `name` holds Danbooru's spelling. Two things make the raw
 * provider tag an unreliable key against it:
 *
 * 1. Separator disagreement. Danbooru writes some tags with a hyphen where
 *    Gelbooru and Rule34 write an underscore, so the exact match silently
 *    misses even though the row exists:
 *
 *      provider          auto_suggest_tags     result
 *      self_upload       self-upload (cat 5)   NOT FOUND -> leaked as content
 *      absurd_res        absurdres   (cat 5)   NOT FOUND
 *      hi_res            highres     (cat 5)   NOT FOUND
 *
 *    There are ~6k hyphenated rows, 25 of them high-volume meta tags
 *    (non-web_source, second-party_source, pixel-perfect_duplicate,
 *    ai-generated, ...) — all invisible to an underscore spelling.
 *
 * 2. HTML entities. Gelbooru and Rule34 serve tag names HTML-escaped
 *    (`hand_on_another&#039;s_head`, `bird&#039;s-eye_view`), so they never match
 *    the apostrophe form the table stores. Providers decode these when building
 *    `tag_string` (see `decodeTagEntities`), but the decode is applied here too
 *    so a caller working from raw provider output cannot reintroduce the miss.
 *
 * The fix is separator-insensitive matching on BOTH sides: candidate spellings
 * are sent to PostgREST (it can only do exact matches), and the rows that come
 * back are re-keyed through `toTagLookupKey` so the caller can resolve a tag
 * regardless of which spelling the row actually used.
 *
 * Deliberately dependency-free: mirrored verbatim into the Cloudflare Worker at
 * workers/booru-image-proxy/src/lib/booru/tag-lookup.ts.
 */

/** Named HTML entities that actually occur in booru tag names. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
}

/**
 * Decodes the HTML entities Gelbooru/Rule34 embed in tag names.
 *
 * Hand-rolled rather than DOM-based because this runs on the Edge runtime and
 * inside a Worker, where there is no `document`. `&amp;` is resolved last so a
 * double-escaped `&amp;#039;` collapses correctly instead of leaving `&#039;`.
 */
export function decodeTagEntities(value: string): string {
  if (!value || !value.includes('&')) return value

  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/&amp;/gi, '&')
}

/**
 * The tag's own spelling, decoded and lowercased, with separators left intact.
 * This is the form `auto_suggest_tags.name` stores, so it is both the exact-match
 * candidate and the key used to decide that an exact row beats a widened one.
 */
export function toProviderSpelling(name: string): string {
  return decodeTagEntities(name).toLowerCase().trim().replace(/\s+/g, '_')
}

/**
 * Separator- and case-insensitive identity for a tag name.
 *
 * Collapses every hyphen, underscore and whitespace run to a single underscore,
 * so `self_upload`, `self-upload` and `self upload` all resolve to one key. Used
 * to key the rows coming back from `auto_suggest_tags` and to look them up.
 */
export function toTagLookupKey(name: string): string {
  return decodeTagEntities(name).toLowerCase().trim().replace(/[-_\s]+/g, '_')
}

/**
 * How many separator-swapped spellings to generate per tag. Every real
 * divergence observed upstream is a single hyphen, almost always in the first
 * position (`non-web_source`, `pixel-perfect_duplicate`, `hashtag-only_commentary`),
 * so per-position swaps plus the all-hyphen form cover them. The cap keeps the
 * PostgREST URL bounded for pathologically long tags instead of growing 2^n.
 */
const MAX_SWAPPED_PARTS = 5

/**
 * Spellings to send to `auto_suggest_tags.name` for one tag.
 *
 * The tag's OWN spelling always comes first, so the widened match is a strict
 * superset of the exact match it replaced — without it, reconstructing from the
 * separator-collapsed key silently dropped rows whose real name has hyphens in
 * several positions (`top-down_bottom-up`, `rx-78-2_gundam`,
 * `spider-man:_into_the_spider-verse`), since only one position is ever flipped
 * at a time.
 *
 * On top of that: the fully-underscored form (what the providers serve), the
 * fully-hyphenated one, and one variant per separator position with just that
 * separator flipped. Deduplicated, so a tag with no separator yields exactly one
 * candidate and costs nothing extra.
 */
export function toTagLookupCandidates(name: string): string[] {
  const asIs = toProviderSpelling(name)
  const key = toTagLookupKey(name)
  if (!key) return []

  const parts = key.split('_')
  if (parts.length === 1) return asIs === key ? [key] : [asIs, key]

  const candidates = new Set<string>([asIs, key, parts.join('-')])

  // Flip one separator at a time. Beyond the cap only the first position is
  // tried, which is where every observed single-hyphen divergence sits.
  const swapLimit = parts.length <= MAX_SWAPPED_PARTS ? parts.length - 1 : 1
  for (let i = 0; i < swapLimit; i++) {
    candidates.add(
      [...parts.slice(0, i), `${parts[i]}-${parts[i + 1]}`, ...parts.slice(i + 2)].join('_')
    )
  }

  return Array.from(candidates)
}

/**
 * Resolves categories for provider tags against `auto_suggest_tags`, tolerating
 * the separator and entity differences described above.
 *
 * `fetchRows` is injected so this stays runtime-agnostic (the Next.js app passes
 * `supabaseAdmin`, the Worker passes its per-request client) and so a failed
 * chunk can be surfaced by the caller rather than decided here.
 *
 * Returns a lookup keyed by `toTagLookupKey`, so callers resolve a tag with
 * `categories.get(toTagLookupKey(tag))` no matter which spelling matched. An
 * exact-spelling row always wins over a separator-swapped one, so widening the
 * match can never reclassify a tag that already resolved correctly.
 */
export async function resolveTagCategories(
  tags: Iterable<string>,
  fetchRows: (names: string[]) => Promise<{ name: string; category: number }[]>,
  chunkSize = 100
): Promise<Map<string, number>> {
  const candidates = new Set<string>()
  const exactSpellings = new Set<string>()

  for (const tag of tags) {
    const key = toTagLookupKey(tag)
    if (!key) continue
    exactSpellings.add(toProviderSpelling(tag))
    for (const candidate of toTagLookupCandidates(tag)) candidates.add(candidate)
  }

  if (candidates.size === 0) return new Map()

  const candidateList = Array.from(candidates)
  const chunks: string[][] = []
  for (let i = 0; i < candidateList.length; i += chunkSize) {
    chunks.push(candidateList.slice(i, i + chunkSize))
  }

  const byKey = new Map<string, number>()
  const exactByKey = new Map<string, number>()

  const results = await Promise.all(chunks.map((chunk) => fetchRows(chunk)))
  for (const rows of results) {
    for (const row of rows) {
      const key = toTagLookupKey(row.name)
      if (!key) continue
      const category = Number(row.category)
      if (Number.isNaN(category)) continue

      if (exactSpellings.has(row.name.toLowerCase())) exactByKey.set(key, category)
      else if (!byKey.has(key)) byKey.set(key, category)
    }
  }

  // Exact-spelling rows override the widened matches.
  for (const [key, category] of exactByKey) byKey.set(key, category)

  return byKey
}
