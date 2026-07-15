// Pure, dependency-free tag-limit logic for booru API providers.
// Extracted from lib/api-client.ts so it can be unit-tested without pulling in
// React/Next/Supabase — see __tests__/tag-limits.verify.ts.

export type BooruProvider = 'danbooru' | 'aibooru' | 'rule34' | 'e621' | 'gelbooru'

// Per-provider fixed tag search limits, confirmed against each API's official docs
// and empirically (curl) as of 2026-07:
// - Danbooru: help:users → "Max tags per search" = 2 for No Account/Member (our anonymous API usage).
//   Confirmed: 2 normal tags + order:rank => HTTP 422 PostQuery::TagLimitError.
// - Aibooru: same Rails/PostQuery engine as Danbooru (identical error class), but its own
//   configured limit is 4, not 2. Confirmed: 4 normal tags OK, 5 => 422.
// - e621: help/cheatsheet → "up to 40 tags in a single search". Confirmed: 40 terms OK, 41 => 422.
// - Gelbooru / Rule34: official docs state no tag-count limit ("Any tag combination that works
//   on the web site will work here"). Confirmed empirically (with real API credentials) up to
//   60 simultaneous tags with no rejection. The only hard requirement is authentication
//   (api_key + user_id) — unrelated to tag count.
export const PROVIDER_TAG_LIMITS: Record<BooruProvider, number> = {
  danbooru: 2,
  aibooru: 4,
  e621: 40,
  gelbooru: Infinity,
  rule34: Infinity,
}

// Metatags whose engines confirmed as NOT counting towards the tag limit
// (Danbooru/Aibooru: rating: and tagcount: are free. e621: rating: is free too,
// despite e621's own docs saying "metatags count" — verified empirically as an exception.)
const FREE_META_TAG_PATTERNS = [
  /^tagcount:/i,
  /^rating:/i,
  /^limit:/i,
  /^status:/i,
  /^user:/i,
  /^approver:/i,
  /^id:/i,
  /^width:/i,
  /^height:/i,
  /^mpixels:/i,
  /^score:/i,
  /^favcount:/i,
  /^date:/i,
  /^source:/i,
  /^pool:/i,
  /^parent:/i,
  /^md5:/i,
  /^filetype:/i,
]

// Metatags confirmed to consume one slot of the tag limit, same as a normal tag
// (Danbooru/Aibooru/e621: order:, sort:, random: all count as 1 tag each.)
// Not filtered separately below — they simply fall through to "counted" like any
// other non-free tag, which is what makes them consume a slot.

// rating:general is the app's internal/default value (Danbooru & Aibooru vocabulary:
// general/sensitive/questionable/explicit). It is NOT valid on every provider — confirmed
// empirically (curl, 2026-07):
// - Danbooru/Aibooru: rating:general is correct and filters as expected.
// - e621: has no "general" rating tier (only safe/questionable/explicit). rating:general is
//   an unrecognized value and is SILENTLY IGNORED — a query for "rating:general" on e621
//   returns posts of every rating (confirmed: e, q, and e in a 5-post sample). The correct
//   equivalent is rating:safe.
// - Gelbooru/Rule34 (Gelbooru 0.2 engine): rating:general IS a valid, working value (confirmed:
//   3.4M matching posts) — Gelbooru's official howto:search wiki also confirms it supports the
//   full 4-tier vocabulary (general/sensitive/questionable/explicit), same as modern Danbooru.
//   Note rating:general is unrelated to the legacy "rating:safe" value, which historically meant
//   something else and returns basically no matches on Gelbooru today (confirmed: only 4 posts,
//   i.e. not a working rating alias there).
// This map translates the app's canonical 'general' rating value to what each provider
// actually expects; providers not listed use the value as-is.
const RATING_GENERAL_OVERRIDE: Partial<Record<BooruProvider, string>> = {
  e621: 'rating:safe',
}

export const mapRatingForProvider = (ratingFilter: string, provider: BooruProvider): string => {
  if (ratingFilter === 'rating:general' && RATING_GENERAL_OVERRIDE[provider]) {
    return RATING_GENERAL_OVERRIDE[provider]!
  }
  return ratingFilter
}

// Providers confirmed (via official docs / empirical curl tests) to support the tagcount:
// metatag with range syntax (tagcount:>=N). Gelbooru/Rule34 (Gelbooru 0.2 engine) do NOT —
// confirmed empirically: tagcount:>=20 matches 0 posts on both.
//
// INVESTIGATED (2026-07): is there a server-side equivalent for Gelbooru/Rule34?
// - No metatag alternative exists. Checked Gelbooru's official wiki (howto:api, howto:search,
//   howto:cheatsheet) — no tag-count metatag is documented, and none of the common candidates
//   (tagcount:, tag_count:, count:) return filtered results.
// - A CLIENT-SIDE alternative IS technically possible: Gelbooru/Rule34 posts already include
//   the full `tags` string in the JSON response, so `tags.split(' ').length` could be used to
//   filter posts after fetching, mimicking tagcount:>=N locally.
// - Deliberately NOT implemented: doing so would filter posts *after* the API has already
//   paginated its response, so a page could come back visibly shorter than expected whenever
//   many of its posts fall under the minimum — unlike Danbooru/Aibooru/e621, where the API
//   itself excludes those posts before paginating, so every page is always "full". Fixing that
//   properly would require restructuring pagination (over-fetching + client-side padding),
//   which was out of scope here. Documented as a known limitation instead of half-implemented.
const TAGCOUNT_SUPPORTED_PROVIDERS = new Set<BooruProvider>(['danbooru', 'aibooru', 'e621'])

export const isTagCountSupportedProvider = (provider: BooruProvider): boolean => TAGCOUNT_SUPPORTED_PROVIDERS.has(provider)

// Palanca 1 (docs/prompt-genericness-mitigation-plan.md §7-§8): quality floor via score:>=N.
// Confirmed empirically (§7.2) that score: filters posts and is free (doesn't consume a tag
// slot) on ALL 5 providers — unlike tagcount:, which Gelbooru/Rule34 don't support at all.
// Score scales differ wildly by provider (§7.3 percentile sampling), so tiers map to different
// raw numbers per provider instead of one global threshold.
export type ScoreTier = 'off' | 'good' | 'great' | 'best'

// score:>=N per provider/tier, calibrated from a random-sample percentile distribution
// (roughly p50/p75/p90 — see §7.3 table). 'off' has no entry: no floor is applied.
export const SCORE_FLOOR_BY_PROVIDER: Record<BooruProvider, Record<Exclude<ScoreTier, 'off'>, number>> = {
  danbooru: { good: 8, great: 15, best: 25 },
  aibooru: { good: 7, great: 12, best: 20 },
  e621: { good: 50, great: 130, best: 300 },
  gelbooru: { good: 5, great: 18, best: 50 },
  rule34: { good: 35, great: 90, best: 180 },
}

// Returns the score:>= threshold to apply for a given provider/tier, or null when the floor
// is off (or the provider/tier combination is unknown).
export const getScoreFloor = (provider: BooruProvider, tier: ScoreTier): number | null => {
  if (tier === 'off') return null
  return SCORE_FLOOR_BY_PROVIDER[provider]?.[tier] ?? null
}

// Fase 3 (§8 of docs/prompt-genericness-mitigation-plan.md): niche-tag fallback. When a
// quality-floor tier makes a page come back nearly empty (a niche tag simply doesn't have
// enough posts clearing the threshold), relax one tier and retry once instead of showing a
// half-empty page. best -> great -> good -> off (fully removes the floor).
const TIER_RELAX_ORDER: ScoreTier[] = ['best', 'great', 'good', 'off']

// Returns the next-weaker tier, or null if `tier` is already 'off' (nothing left to relax).
export const relaxScoreTier = (tier: ScoreTier): ScoreTier | null => {
  const index = TIER_RELAX_ORDER.indexOf(tier)
  if (index === -1 || index === TIER_RELAX_ORDER.length - 1) return null
  return TIER_RELAX_ORDER[index + 1]
}

// Replaces the score:>=N (or its URL-encoded form) belonging to `fromTier` inside a query
// string / URL with the threshold for `toTier` (or removes it entirely when toTier is 'off').
// Used by the fetcher (lib/api-client.ts) to retry a nearly-empty page with a relaxed floor
// without rebuilding the whole query from scratch. Pure string replacement — safe even if the
// exact numeric floor appears nowhere else, since SCORE_FLOOR_BY_PROVIDER values are looked up
// directly rather than guessed from the URL.
export const relaxScoreFloorInUrl = (url: string, provider: BooruProvider, fromTier: ScoreTier): string | null => {
  const fromFloor = getScoreFloor(provider, fromTier)
  if (fromFloor == null) return null

  const toTier = relaxScoreTier(fromTier)
  if (toTier == null) return null

  const toFloor = getScoreFloor(provider, toTier)
  // Match score:>=N in both raw and URL-encoded (score%3A%3E%3D or score:%3E%3D) forms, with
  // the exact fromFloor value, followed by a boundary (space, encoded space, query separator,
  // or end of string).
  const rawPattern = new RegExp(`score:>=${fromFloor}(?=[\\s+&]|%20|$)`, 'i')
  const encodedPattern = new RegExp(`score(?:%3A|:)(?:%3E%3D|>=|%3E=|>%3D)${fromFloor}(?=[\\s+&]|%20|$)`, 'i')

  const replacement = toFloor != null ? `score:>=${toFloor}` : ''
  const encodedReplacement = toFloor != null ? `score%3A%3E%3D${toFloor}` : ''

  if (rawPattern.test(url)) {
    return url.replace(rawPattern, replacement).replace(/\+{2,}|\s{2,}/g, ' ').trim()
  }
  if (encodedPattern.test(url)) {
    return url.replace(encodedPattern, encodedReplacement).replace(/(%20|\+){2,}/g, '%20')
  }
  return null
}

const splitRawTags = (tags: string): string[] =>
  tags
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0)
    .map(tag => tag.replace(/\s+/g, '_'))

// Processes user input tags against a provider's fixed tag-count limit.
// Free metatags (rating:, tagcount:, etc.) never get trimmed. Counted metatags
// (order:/sort:/random:) consume one slot out of the limit, same as normal tags —
// exclusions (-tag) are treated as normal tags since they count identically.
export const processTagsForAPI = (tags: string, provider: BooruProvider = 'danbooru', extraTagsCount: number = 0): string => {
  if (!tags.trim()) return ''

  const rawTags = splitRawTags(tags)

  const freeTags: string[] = []
  const countedTags: string[] = [] // normal tags + exclusions + order/sort/random

  rawTags.forEach(tag => {
    if (FREE_META_TAG_PATTERNS.some(pattern => pattern.test(tag))) {
      freeTags.push(tag)
    } else {
      countedTags.push(tag)
    }
  })

  const limit = PROVIDER_TAG_LIMITS[provider] ?? PROVIDER_TAG_LIMITS.danbooru
  const maxCountedTags = limit === Infinity ? Infinity : Math.max(0, limit - extraTagsCount)

  const allowedCountedTags = maxCountedTags === Infinity ? countedTags : countedTags.slice(0, maxCountedTags)

  return [...allowedCountedTags, ...freeTags].join(' ')
}

// Checks if user entered more tags than the provider's fixed limit allows.
// Providers with no documented limit (Gelbooru, Rule34) never trigger this.
export const hasMultipleTags = (tags: string, provider: BooruProvider = 'danbooru', extraTagsCount: number = 0): boolean => {
  if (!tags.trim()) return false

  const limit = PROVIDER_TAG_LIMITS[provider] ?? PROVIDER_TAG_LIMITS.danbooru
  if (limit === Infinity) return false

  const rawTags = splitRawTags(tags)
  const countedCount = rawTags.filter(tag => !FREE_META_TAG_PATTERNS.some(pattern => pattern.test(tag))).length

  const maxCountedTags = Math.max(0, limit - extraTagsCount)

  return countedCount > maxCountedTags
}

// Returns the exact tag limit configured for a provider (Infinity = no limit), for UI display.
export const getProviderTagLimit = (provider: BooruProvider): number => PROVIDER_TAG_LIMITS[provider] ?? PROVIDER_TAG_LIMITS.danbooru

// Builds the final list of query tags sent to the selected booru API: rating filter,
// tag-count filter, order/random metatag, and the user's own tags — trimmed to respect
// the provider's fixed tag-count limit (order/random consume one of the limited slots).
export const getFinalQueryTags = (userTags: string, ratingFilter: string, order: string, tagCountFilter?: string, provider: BooruProvider = 'danbooru', scoreTier: ScoreTier = 'off'): string[] =>
  getFinalQueryTagsWithMeta(userTags, ratingFilter, order, tagCountFilter, provider, scoreTier).tags
    .filter(t => !t.dropped)
    .map(t => t.value)

export interface QueryTagMeta {
  value: string
  /** true if this tag consumes one of the provider's limited tag slots */
  countsTowardsLimit: boolean
  /** true if this tag was dropped from the query because the limit was already reached */
  dropped: boolean
}

export interface FinalQueryTagsResult {
  tags: QueryTagMeta[]
  /** How many of the provider's limited slots are currently used (kept tags only) */
  slotsUsed: number
  /** The provider's fixed tag limit (Infinity = no limit) */
  slotLimit: number
  /** User-entered tags that got dropped because the limit was exceeded */
  droppedUserTags: string[]
}

// Same as getFinalQueryTags, but returns per-tag metadata (free vs. limit-consuming,
// kept vs. dropped) plus a slots-used/limit summary — used to power the "Active Query"
// panel so users can see exactly how many of the provider's tag slots they're using.
export const getFinalQueryTagsWithMeta = (userTags: string, ratingFilter: string, order: string, tagCountFilter?: string, provider: BooruProvider = 'danbooru', scoreTier: ScoreTier = 'off'): FinalQueryTagsResult => {
  const tags: QueryTagMeta[] = []
  const limit = PROVIDER_TAG_LIMITS[provider] ?? PROVIDER_TAG_LIMITS.danbooru

  // Rating filter — free (doesn't count towards the limit) on Danbooru, Aibooru and e621.
  // Mapped per-provider (see RATING_GENERAL_OVERRIDE) so the value shown here always matches
  // what's actually sent to the API — e.g. rating:general becomes rating:safe on e621.
  if (ratingFilter && ratingFilter !== 'all') {
    tags.push({ value: mapRatingForProvider(ratingFilter, provider), countsTowardsLimit: false, dropped: false })
  }

  // Tag count filter — confirmed supported (with identical >= range syntax) on Danbooru,
  // Aibooru and e621. Confirmed NOT supported on Gelbooru/Rule34 (curl: tagcount:>=20 matches
  // 0 posts on both — the Gelbooru 0.2 engine has no such metatag).
  if (tagCountFilter && isTagCountSupportedProvider(provider)) {
    tags.push({ value: `tagcount:>=${tagCountFilter.replace(/\D/g, '')}`, countsTowardsLimit: false, dropped: false })
  }

  // Quality floor (Palanca 1, §7-§8 of docs/prompt-genericness-mitigation-plan.md) — score:>=N,
  // free on all 5 providers (confirmed §7.2). Applied right after tagcount:, same free-metatag
  // treatment. Off by default; a no-op when scoreTier === 'off'.
  const scoreFloor = getScoreFloor(provider, scoreTier)
  if (scoreFloor != null) {
    tags.push({ value: `score:>=${scoreFloor}`, countsTowardsLimit: false, dropped: false })
  }

  // Order/random metatag — confirmed to consume one slot of the limit, same as a normal tag.
  // Syntax differs by provider (confirmed empirically):
  // - Danbooru/Aibooru/e621: order:rank (or order:score on e621) / random:N.
  // - Gelbooru/Rule34 (Gelbooru 0.2 engine): order:* is NOT recognized (curl: order:score
  //   matches 0 posts); the correct metatag is sort:score / sort:random instead.
  let systemOrderTagCount = 0
  const usesSortSyntax = provider === 'gelbooru' || provider === 'rule34'
  if (order === 'popular') {
    tags.push({ value: usesSortSyntax ? 'sort:score' : 'order:rank', countsTowardsLimit: true, dropped: false })
    systemOrderTagCount = 1
  } else if (order === 'random') {
    tags.push({ value: usesSortSyntax ? 'sort:random' : 'random:60', countsTowardsLimit: true, dropped: false })
    systemOrderTagCount = 1
  }

  // User tags: split into free metatags and limit-consuming tags (normal tags, exclusions,
  // and any order:/sort:/random: the user typed manually), same rules as processTagsForAPI.
  const rawTags = splitRawTags(userTags)
  const userFreeTags: string[] = []
  const userCountedTags: string[] = []
  rawTags.forEach(tag => {
    if (FREE_META_TAG_PATTERNS.some(pattern => pattern.test(tag))) {
      userFreeTags.push(tag)
    } else {
      userCountedTags.push(tag)
    }
  })

  const maxCountedTags = limit === Infinity ? Infinity : Math.max(0, limit - systemOrderTagCount)
  const keptCountedTags = maxCountedTags === Infinity ? userCountedTags : userCountedTags.slice(0, maxCountedTags)
  const droppedUserTags = maxCountedTags === Infinity ? [] : userCountedTags.slice(maxCountedTags)

  keptCountedTags.forEach(value => tags.push({ value, countsTowardsLimit: true, dropped: false }))
  userFreeTags.forEach(value => tags.push({ value, countsTowardsLimit: false, dropped: false }))
  droppedUserTags.forEach(value => tags.push({ value, countsTowardsLimit: true, dropped: true }))

  const slotsUsed = systemOrderTagCount + keptCountedTags.length

  return { tags, slotsUsed, slotLimit: limit, droppedUserTags }
}

export interface MisusedMetatagWarning {
  /** The exact tag the user typed, e.g. "order:score" */
  tag: string
  /** Short human-readable explanation of the problem */
  message: string
  /** Suggested fix, if any (a corrected tag string, or a UI control to use instead) */
  suggestion?: string
}

// Detects metatags the user typed manually into the free-text search box that are invalid,
// silently ignored, or misleading on the currently selected provider — the kind of thing only
// advanced users who know booru metatag syntax would type (average users never need to, since
// rating/order/tag-count already have dedicated UI controls that handle all of this correctly).
// This does NOT flag anything the app itself generates (order:rank from the sort dropdown,
// rating:general from the Safe/NSFW toggle, etc.) — only what's present in the raw `userTags`
// string — so it only ever surfaces for users who bypass those controls and type metatags by hand.
export const detectMisusedMetatags = (userTags: string, provider: BooruProvider): MisusedMetatagWarning[] => {
  if (!userTags.trim()) return []

  const warnings: MisusedMetatagWarning[] = []
  const rawTags = splitRawTags(userTags)
  const usesSortSyntax = provider === 'gelbooru' || provider === 'rule34'
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1)

  rawTags.forEach(tag => {
    const lower = tag.toLowerCase()

    // order:/random: typed on Gelbooru/Rule34 — confirmed unrecognized (0 matching posts).
    if (usesSortSyntax && /^order:/i.test(lower)) {
      const value = lower.replace(/^order:/i, '')
      warnings.push({
        tag,
        message: `${providerLabel} doesn't recognize order: — this tag will match nothing.`,
        suggestion: `sort:${value}`,
      })
    } else if (usesSortSyntax && /^random:\d+$/i.test(lower)) {
      warnings.push({
        tag,
        message: `${providerLabel} doesn't recognize random: — this tag will match nothing.`,
        suggestion: 'sort:random',
      })
    }
    // sort: typed on Danbooru/Aibooru/e621 — those use order:/random: instead.
    else if (!usesSortSyntax && /^sort:/i.test(lower)) {
      const value = lower.replace(/^sort:/i, '')
      const suggestion = value === 'random' ? 'random:N' : `order:${value}`
      warnings.push({
        tag,
        message: `${providerLabel} doesn't recognize sort: — this tag will match nothing.`,
        suggestion,
      })
    }

    // tagcount: typed on Gelbooru/Rule34 — confirmed unsupported, no server-side equivalent.
    if (/^tagcount:/i.test(lower) && !isTagCountSupportedProvider(provider)) {
      warnings.push({
        tag,
        message: `${providerLabel} has no tagcount: metatag — this tag will match nothing.`,
      })
    }

    // rating:general typed on e621 — silently ignored there (no "general" tier).
    if (/^rating:general$/i.test(lower) && provider === 'e621') {
      warnings.push({
        tag,
        message: 'e621 has no "general" rating — this tag is silently ignored (matches every rating).',
        suggestion: 'rating:safe',
      })
    }

    // rating:safe typed on Danbooru/Aibooru — not an error, but NOT a synonym for rating:general;
    // it now maps to the "sensitive" tier (post-2022 4-tier rating system), which surprises users
    // expecting the old 3-tier meaning of "safe".
    if (/^rating:safe$/i.test(lower) && (provider === 'danbooru' || provider === 'aibooru')) {
      warnings.push({
        tag,
        message: `On ${providerLabel}, rating:safe means "sensitive" (mildly NSFW), not "general" (fully SFW).`,
        suggestion: 'rating:general',
      })
    }
  })

  return warnings
}
