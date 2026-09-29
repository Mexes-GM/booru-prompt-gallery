import { BooruPost, SearchOptions } from './types'
import { USER_AGENT } from '../constants'
import { fetchUpstream, UpstreamError } from '../upstream'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../../logger'
import { resolveTagCategories, toTagLookupKey } from './tag-lookup'

// ---------------------------------------------------------------------------
// Per-isolate tag-category cache.
//
// A 100-post Gelbooru/Rule34 page carries ~1-2k distinct tags; resolving them
// cold is dozens of PostgREST requests (3+ spellings per tag, 100 per chunk,
// two tables). Tag categories practically never change, and consecutive pages
// share most of their tags, so remembering each tag's resolution — including
// "no row" — for an hour removes nearly all of those queries on warm isolates.
// ---------------------------------------------------------------------------
const CATEGORY_CACHE_TTL_MS = 60 * 60 * 1000
const CATEGORY_CACHE_MAX = 50_000
const categoryCache = new Map<string, { category: number | null; at: number }>()

// ---------------------------------------------------------------------------
// Subrequest budget.
//
// Cloudflare caps each Worker invocation at 50 subrequests (free plan), and
// every Supabase/Upstash/provider call counts. Classifying a page is done with
// ONE `lookup_tag_categories` RPC per table (migration 20260930000100). Until
// that migration is applied, the legacy chunked GET path is used, but capped
// at LEGACY_MAX_CHUNKS per table — unresolved tags simply stay unclassified
// (and are not cached as "no category") instead of the whole request failing
// with "Too many subrequests".
// ---------------------------------------------------------------------------
const LEGACY_CHUNK_SIZE = 100
const LEGACY_MAX_CHUNKS = 8
let rpcAvailable = true

interface CategoryLookup {
  rows: TagCategoryRow[]
  /** false when the legacy path hit its chunk budget and skipped names. */
  complete: boolean
}

async function lookupCategories(
  supabase: SupabaseClient,
  names: string[],
  provider: string | null
): Promise<CategoryLookup> {
  if (rpcAvailable) {
    const { data, error } = await supabase.rpc('lookup_tag_categories', {
      p_names: names,
      p_provider: provider,
    })
    if (!error) return { rows: (data ?? []) as TagCategoryRow[], complete: true }
    // PGRST202 / 42883: function not deployed yet → fall back for this isolate.
    if (error.code !== 'PGRST202' && error.code !== '42883') throw error
    rpcAvailable = false
    logger.warn('lookup_tag_categories_missing', { hint: 'apply migration 20260930000100' })
  }

  const chunks: string[][] = []
  for (let i = 0; i < names.length; i += LEGACY_CHUNK_SIZE) chunks.push(names.slice(i, i + LEGACY_CHUNK_SIZE))
  const budgeted = chunks.slice(0, LEGACY_MAX_CHUNKS)

  const results = await Promise.all(
    budgeted.map(async (chunk) => {
      let query = provider
        ? supabase
            .from('provider_tag_categories')
            .select('name, category')
            .eq('provider', provider)
            .eq('status', 'approved')
            .neq('category', 0)
        : supabase.from('auto_suggest_tags').select('name, category')
      query = query.in('name', chunk)
      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as TagCategoryRow[]
    })
  )
  return { rows: results.flat(), complete: budgeted.length === chunks.length }
}

/**
 * Resolve categories for `tags` against one table (provider = null →
 * auto_suggest_tags), consulting the per-isolate cache first. A failed lookup
 * throws, so it is never cached as "no category"; an incomplete (budgeted)
 * lookup only caches the tags it actually found.
 */
async function resolveTagCategoriesCached(
  supabase: SupabaseClient,
  tags: Iterable<string>,
  provider: string | null
): Promise<Map<string, number>> {
  const namespace = provider ? `provider_tag_categories:${provider}` : 'auto_suggest_tags'
  const now = Date.now()
  const resolved = new Map<string, number>()
  const missing: string[] = []

  for (const tag of tags) {
    const key = toTagLookupKey(tag)
    if (!key) continue
    const entry = categoryCache.get(`${namespace}:${key}`)
    if (entry && now - entry.at < CATEGORY_CACHE_TTL_MS) {
      if (entry.category !== null) resolved.set(key, entry.category)
    } else {
      missing.push(tag)
    }
  }

  if (missing.length > 0) {
    let complete = true
    // One fetchRows call for every candidate spelling (chunking happens inside
    // lookupCategories), so the RPC path costs a single subrequest.
    const fetched = await resolveTagCategories(
      missing,
      async (names) => {
        const lookup = await lookupCategories(supabase, names, provider)
        complete = lookup.complete
        return lookup.rows
      },
      Number.MAX_SAFE_INTEGER
    )
    for (const tag of missing) {
      const key = toTagLookupKey(tag)
      const category = fetched.get(key)
      if (category !== undefined) resolved.set(key, category)
      else if (!complete) continue
      const cacheKey = `${namespace}:${key}`
      categoryCache.delete(cacheKey) // re-insert at the end so eviction stays oldest-first
      categoryCache.set(cacheKey, { category: category ?? null, at: now })
    }
    // Map iterates in insertion order, so this evicts the oldest entries.
    if (categoryCache.size > CATEGORY_CACHE_MAX) {
      let excess = categoryCache.size - CATEGORY_CACHE_MAX
      for (const cacheKey of categoryCache.keys()) {
        if (excess-- <= 0) break
        categoryCache.delete(cacheKey)
      }
    }
  }

  return resolved
}

interface TagCategoryRow {
  name: string
  category: number
}

export abstract class BaseBooruProvider {
  protected abstract baseUrl: string
  protected abstract defaultParams: Record<string, string>

  abstract search(options: SearchOptions): Promise<BooruPost[]>

  /** Providers with categorized tags (Danbooru-family, e621) need nothing. */
  async enrich(posts: BooruPost[]): Promise<BooruPost[]> {
    return posts
  }

  /**
   * GET a provider JSON endpoint. Retries/timeouts live in fetchUpstream (the
   * single retry layer); failures surface as UpstreamError with the status.
   */
  protected async fetchJson<T>(
    url: string,
    params: URLSearchParams,
    headers: Record<string, string> = {}
  ): Promise<T> {
    const finalUrl = new URL(url)
    finalUrl.search = params.toString()

    const response = await fetchUpstream(finalUrl.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
    })

    const text = await response.text()
    if (!text || text.trim().length === 0) {
      return [] as unknown as T
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new UpstreamError('Invalid JSON response from provider', 502)
    }
  }

  protected filterValidPosts<T>(posts: T[]): T[] {
    return posts.filter((post) => {
      if (!post || typeof post !== 'object') return false
      const p = post as Record<string, unknown>
      const fileUrl = p.file_url || p.sample_url || ''
      const tagString = p.tag_string || p.tags || ''
      return (
        fileUrl &&
        typeof fileUrl === 'string' &&
        !fileUrl.includes('deleted') &&
        p.id &&
        tagString &&
        !(typeof fileUrl === 'string' && fileUrl.match(/\.(mp4|webm|avi|mov|mkv)$/i))
      )
    })
  }

  /**
   * @param provider When set, tags `auto_suggest_tags` does not know are also
   *   resolved against `provider_tag_categories` (precomputed offline by
   *   scripts/classify-rule34-tags.ts). Danbooru's category always wins.
   */
  protected async enrichPostsWithCategories(
    posts: BooruPost[],
    supabase: SupabaseClient | null,
    provider?: string
  ): Promise<BooruPost[]> {
    if (!posts || posts.length === 0) return posts
    if (!supabase) return posts

    const allTags = new Set<string>()
    posts.forEach((p) => {
      if (p.tag_string) {
        p.tag_string.split(/\s+/).forEach((t) => {
          if (t) allTags.add(t)
        })
      }
    })

    if (allTags.size === 0) return posts

    try {
      // Keyed by `toTagLookupKey`: Gelbooru/Rule34 do not spell tags the way
      // `auto_suggest_tags` (Danbooru) does — `self_upload` vs `self-upload`,
      // `absurd_res` vs `absurdres` — and the previous exact `in('name', tags)`
      // silently missed those, so the tag was never classified as meta and
      // reached the prompt as content. See ./tag-lookup.ts.
      // Both lookups run concurrently so the provider table adds no latency.
      const [tagMap, providerTagMap] = await Promise.all([
        resolveTagCategoriesCached(supabase, allTags, null),
        provider
          ? resolveTagCategoriesCached(supabase, allTags, provider)
          : Promise.resolve(new Map<string, number>()),
      ])
      for (const [key, category] of providerTagMap) {
        if (!tagMap.has(key)) tagMap.set(key, category)
      }

      return posts.map((post) => {
        if (!post.tag_string) return post

        const tags = post.tag_string.split(/\s+/).filter(Boolean)
        const artistTags: string[] = []
        const characterTags: string[] = []
        const copyrightTags: string[] = []
        const metaTags: string[] = []

        tags.forEach((t) => {
          const category = tagMap.get(toTagLookupKey(t))
          if (category === 1) artistTags.push(t)
          else if (category === 3) copyrightTags.push(t)
          else if (category === 4) characterTags.push(t)
          else if (category === 5) metaTags.push(t)
        })

        return {
          ...post,
          tag_string_artist: artistTags.length > 0 ? artistTags.join(' ') : post.tag_string_artist,
          tag_string_character:
            characterTags.length > 0 ? characterTags.join(' ') : post.tag_string_character,
          tag_string_copyright:
            copyrightTags.length > 0 ? copyrightTags.join(' ') : post.tag_string_copyright,
          tag_string_meta: metaTags.length > 0 ? metaTags.join(' ') : post.tag_string_meta,
        }
      })
    } catch (e) {
      logger.warn('booru_enrich_error', {
        error: e instanceof Error ? e.message : String(e),
      })
      return posts
    }
  }
}
