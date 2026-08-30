/**
 * Write guard for `public.tags`, the category-override table.
 *
 * `tags` is meant to hold ONLY descriptive vocabulary: what is in the image.
 * Both writers (the user-facing Teach flow in `app/actions/suggestions.ts` and
 * the admin mining flow in `app/actions/auto-suggestions.ts`) used to insert
 * every tag they were handed, and a booru `tag_string` is not just descriptive
 * tags — it carries artist names, copyright/series names, character names and
 * Danbooru housekeeping meta. That is how the table ended up with 492 artist
 * names and 178 meta tags out of 2191 rows (~31%), all of them inert as
 * category overrides: an artist name can never improve a prompt, and meta tags
 * are stripped by `cleanPrompt` long before classification runs.
 *
 * The guard uses Danbooru's own taxonomy (`auto_suggest_tags.category`) as the
 * authority rather than a hand-maintained blocklist, so it stays correct as new
 * artists and meta tags appear upstream.
 *
 * It also normalizes names to ONE storage convention. The two writers disagreed
 * before: the mining flow stored `normalize()`d space-form names while the Teach
 * flow inserted whatever the client sent (underscored, straight off the booru),
 * producing 43 duplicate pairs like `arm warmers` / `arm_warmers` — three of
 * which even disagreed on category. Space form is the correct target: it is what
 * `classifyTag` looks up first, and the only form its suffix-derivation path
 * (resolving "blue skirt" via "skirt") can ever match.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalize } from '@/lib/cleanPrompt'
import { resolveTagCategories, toTagLookupKey } from '@/lib/booru/tag-lookup'

/**
 * Danbooru tag categories that must never become rows in `tags`:
 * 1 = artist, 3 = copyright, 4 = character, 5 = meta.
 *
 * Character and copyright tags are excluded too, not just as noise: they are
 * already handled upstream on their own axes (`classifyTags` force-routes known
 * character tags to `appearance` via `knownCharacterTags`), so an override row
 * for them is redundant at best and contradicts that routing at worst.
 */
export const REJECTED_DANBOORU_CATEGORIES = [1, 3, 4, 5] as const

export type TagRejectionReason = 'artist' | 'copyright' | 'character' | 'meta'

const REASON_BY_CATEGORY: Record<number, TagRejectionReason> = {
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
}

export interface RejectedTag {
  /** The name as it was submitted. */
  name: string
  reason: TagRejectionReason
}

export interface TagWriteFilterResult {
  /** Submitted names that may be written, normalized to the storage convention. */
  writable: string[]
  /** Map from the submitted name to its normalized form, for callers that need
   *  to correlate their own payload with what actually gets stored. */
  normalizedByInput: Map<string, string>
  rejected: RejectedTag[]
  /**
   * True when the taxonomy lookup itself failed, so `rejected` is not
   * authoritative. Callers decide what that means: the user-facing path lets the
   * write through (a transient Supabase error should not swallow someone's
   * contribution), while the bulk mining path skips the batch, since it is
   * automated, repeatable, and the main historical source of pollution.
   */
  lookupFailed: boolean
}

/**
 * `auto_suggest_tags.name` is always underscored; our storage form is not.
 *
 * Separator-insensitive on purpose (see lib/booru/tag-lookup.ts): Danbooru writes
 * some tags with a hyphen where the other providers — and the users typing into
 * the Teach flow — use an underscore or a space, so keying on the literal
 * spelling let artist and meta names through the guard just because the
 * separators disagreed.
 */
const toLookupKey = (name: string) => toTagLookupKey(normalize(name))

/** PostgREST `in` filters go into the URL, so chunk to keep it a sane length.
 *  Same size `BaseBooruProvider.enrichPostsWithCategories` already uses. */
const CHUNK_SIZE = 100

/**
 * Splits submitted tag names into the ones that may be stored and the ones that
 * are not descriptive vocabulary, according to Danbooru's own categories.
 *
 * Names unknown to `auto_suggest_tags` are treated as WRITABLE on purpose: the
 * table only covers Danbooru, and the app also serves e621, Rule34 and Gelbooru,
 * whose vocabulary (`anthro`, `pokemorph`, `1futa`, `bubble butt`, ...) is
 * legitimately absent from it. Rejecting unknown names would have discarded 127
 * valid rows in this project's own data.
 */
export async function filterWritableTagNames(
  client: SupabaseClient,
  names: string[]
): Promise<TagWriteFilterResult> {
  const normalizedByInput = new Map<string, string>()
  for (const name of names) {
    const normalized = normalize(name)
    if (normalized) normalizedByInput.set(name, normalized)
  }

  const inputNames = Array.from(normalizedByInput.keys())
  if (inputNames.length === 0) {
    return { writable: [], normalizedByInput, rejected: [], lookupFailed: false }
  }

  let lookupFailed = false

  // Keyed by `toTagLookupKey`, so `toLookupKey(input)` below resolves a row no
  // matter which separator spelling it used. The previous version keyed the map
  // by the raw `row.name` while reading it with an underscored key, so anything
  // stored with a hyphen was never found and passed the guard.
  const categoryByKey = await resolveTagCategories(
    // Underscored form, matching how `auto_suggest_tags.name` is stored, so an
    // exact-spelling row still wins over a separator-swapped candidate.
    inputNames.map((name) => toLookupKey(name)),
    async (lookupNames) => {
      const { data, error } = await client
        .from('auto_suggest_tags')
        .select('name, category')
        .in('name', lookupNames)

      if (error) {
        console.error('[tag-write-guard] auto_suggest_tags lookup failed:', error.message)
        lookupFailed = true
        return []
      }
      return (data ?? []) as { name: string; category: number }[]
    },
    CHUNK_SIZE
  )

  const writable: string[] = []
  const rejected: RejectedTag[] = []
  const seenWritable = new Set<string>()

  for (const [input, normalized] of normalizedByInput) {
    const category = categoryByKey.get(toLookupKey(input))
    const reason = category !== undefined ? REASON_BY_CATEGORY[category] : undefined

    if (reason && !lookupFailed) {
      rejected.push({ name: input, reason })
      continue
    }
    if (!seenWritable.has(normalized)) {
      seenWritable.add(normalized)
      writable.push(normalized)
    }
  }

  return { writable, normalizedByInput, rejected, lookupFailed }
}

/** Storage form for a tag name: lowercase, spaces (never underscores). */
export function toStorageTagName(name: string): string {
  return normalize(name)
}
