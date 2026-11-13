"use client"

/**
 * A named character's usual look (hair, eyes, signature accessories) read from
 * posts that show them alone, apart from the pack's pool: once a pack asks for a
 * pose, its scenes come from other people's posts, and the pool no longer says what
 * the character looks like.
 *
 * Same read as the cast's looks in usePackMode: the same request (fetchSoloPosts,
 * one retry after a pause) and the same reading of the posts (typicalLook,
 * typicalSubject, with the tag slots enriched first).
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { fetchPostsPage } from "@/lib/api-client"
import type { BooruPost, BooruProvider } from "@/lib/booru/types"
import { typicalLook, typicalSubject } from "@/lib/pack/character-identity"
import { normalizeTagForPack } from "@/lib/pack/pack-generator"
import { loadPackVocabulary, tagBaselineOf, type TagBaseline } from "@/lib/pack/pack-vocabulary"
import type { AppearanceSearch } from "@/lib/pack/source-plan"
import { splitTags } from "@/lib/utils/tag-utils"

/** Waits before asking a second time for a character's solo posts. */
export const SOLO_RETRY_MS = 4000

/** General + character tags of the given posts, display-normalized and deduped. */
export function collectPostTags(posts: BooruPost[]): string[] {
  const out = new Set<string>()
  for (const post of posts) {
    for (const raw of [post.tag_string, post.tag_string_character]) {
      if (!raw) continue
      for (const tag of splitTags(raw)) {
        const norm = normalizeTagForPack(tag)
        if (norm) out.add(norm)
      }
    }
  }
  return Array.from(out)
}

/**
 * One page of a character's most-liked posts for `tags` (their solo search). A failed
 * request is tried once more after SOLO_RETRY_MS: several characters' requests at once
 * can meet the booru's rate limit.
 */
export function fetchSoloPosts({ tags, ratingFilter, provider }: { tags: string; ratingFilter: string; provider: BooruProvider }): Promise<BooruPost[]> {
  const fetchOnce = () => fetchPostsPage({
    tags,
    ratingFilter,
    order: 'popular',
    provider,
    hasPrompt: false,
    scoreTier: 'off',
  })
  return fetchOnce()
    .catch(() => new Promise<BooruPost[]>((resolve, reject) => setTimeout(() => fetchOnce().then(resolve, reject), SOLO_RETRY_MS)))
}

export interface CharacterLook {
  /** 'none': the posts failed or too few show the character alone; fall back to their trait profile. */
  status: 'loading' | 'ready' | 'none'
  /** Their usual look tags, when ready. */
  look: string[] | null
  /** Subject tags their solo posts agree on ("1girl"), when ready. */
  subject: string[]
}

export interface UseCharacterLooksArgs {
  /** SourcePlan.appearance. */
  searches: readonly AppearanceSearch[]
  provider: BooruProvider
  /** The tag slots in use (usePackMode's effectiveTagOverrides). */
  overrides: Record<string, string>
  /** Fetches slots for tags the overrides don't cover (usePackMode's enrichTagSlots). */
  enrichTagSlots: (tags: string[]) => Promise<boolean>
}

interface Entry { posts: BooruPost[] | null; enriched: boolean; failed: boolean }

/**
 * Each search's character's look, keyed by character (as the plan spells them).
 * Every search is fetched once per hook life: a search that leaves the plan and
 * comes back is not fetched again. The look is recomputed when the overrides change.
 */
export function useCharacterLooks({ searches, provider, overrides, enrichTagSlots }: UseCharacterLooksArgs): Record<string, CharacterLook> {
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [baseline, setBaseline] = useState<{ ready: boolean; value: TagBaseline | null }>({ ready: false, value: null })
  const requestedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void loadPackVocabulary()
      .then((vocabulary) => { if (!cancelled) setBaseline({ ready: true, value: tagBaselineOf(vocabulary) }) })
      .catch(() => { if (!cancelled) setBaseline({ ready: true, value: null }) })
    return () => { cancelled = true }
  }, [])

  const enrichRef = useRef(enrichTagSlots)
  useEffect(() => { enrichRef.current = enrichTagSlots }, [enrichTagSlots])

  const searchKey = searches.map((s) => s.id).join("||")
  useEffect(() => {
    for (const search of searches) {
      if (requestedRef.current.has(search.id)) continue
      requestedRef.current.add(search.id)
      const set = (entry: Partial<Entry>) =>
        setEntries((prev) => ({ ...prev, [search.id]: { ...(prev[search.id] ?? { posts: null, enriched: false, failed: false }), ...entry } }))
      void fetchSoloPosts({ tags: search.query, ratingFilter: search.ratingFilter, provider })
        .then(async (posts) => {
          set({ posts })
          // Best-effort, as in usePackMode: a tag without a slot is still read by the heuristics.
          await enrichRef.current(collectPostTags(posts)).catch(() => false)
          set({ enriched: true })
        })
        .catch(() => set({ failed: true }))
    }
    // The ids carry every field of a search but the character, which the query names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, provider])

  return useMemo(() => {
    const out: Record<string, CharacterLook> = {}
    for (const search of searches) {
      const entry = entries[search.id]
      if (entry?.failed) { out[search.character] = { status: 'none', look: null, subject: [] }; continue }
      if (!entry?.posts || !entry.enriched || !baseline.ready) { out[search.character] = { status: 'loading', look: null, subject: [] }; continue }
      const look = typicalLook(entry.posts, search.character, overrides, baseline.value)
      out[search.character] = look?.length
        ? { status: 'ready', look, subject: typicalSubject(entry.posts, search.character, overrides) ?? [] }
        : { status: 'none', look: null, subject: [] }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, entries, overrides, baseline])
}
