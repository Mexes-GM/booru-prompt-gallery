// Utility functions for localStorage persistence
import { DEFAULT_BLACKLIST } from '@/lib/constants'
import { generateId } from '@/lib/utils/id-generator'
import { broadcastSettingChange } from '@/lib/settings-bridge'
import type { TagAppendRule } from '@/lib/cleanPrompt'
import type { BooruProvider, BooruPost } from '@/lib/booru/types'
import type { TagCategory } from '@/lib/tag-classifier'
import type { PackLearningModel } from '@/lib/pack/pack-learning'
import type { AxisTagMode } from '@/lib/pack/pack-generator'

// Safe localStorage wrapper that handles SSR and errors
export const STORAGE_EVENT_NAME = 'booru-storage-update'

export const storage = {
  get: <T>(key: string, defaultValue: T): T => {
    if (typeof window === 'undefined') return defaultValue

    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue
    } catch (error) {
      console.warn(`Error reading from localStorage key "${key}":`, error)
      return defaultValue
    }
  },

  set: <T>(key: string, value: T): void => {
    if (typeof window === 'undefined') return

    try {
      localStorage.setItem(key, JSON.stringify(value))
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME, { detail: { key, value } }))
        // Also broadcast for cross-context sync (web app ↔ extension iframe)
        broadcastSettingChange(key, value)
      }
    } catch (error) {
      console.warn(`Error writing to localStorage key "${key}":`, error)
    }
  },

  remove: (key: string): void => {
    if (typeof window === 'undefined') return

    try {
      localStorage.removeItem(key)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME, { detail: { key, value: null } }))
        // Also broadcast for cross-context sync (web app ↔ extension iframe) so
        // deletions (e.g. clearHistory) propagate just like writes do.
        broadcastSettingChange(key, null)
      }
    } catch (error) {
      console.warn(`Error removing localStorage key "${key}":`, error)
    }
  }
}

// Storage keys for user preferences
export const STORAGE_KEYS = {
  BOORU_PROVIDER: 'booru-provider',
  REMOVE_LORA_TAGS: 'remove-lora-tags',
  REMOVE_QUALITY_TAGS: 'remove-quality-tags',
  RATING_FILTER: 'rating-filter',
  HISTORY: 'prompt-history',
  ADD_TAGS_PRESETS: 'add-tags-presets',
  MINIMUM_TAG_COUNT: 'minimum-tag-count',
  SCORE_TIER: 'scoreTier',
  MINIMUM_CHARACTER_COUNT: 'minimum-character-count',
  BLACKLIST: 'blacklist',
  GLOBAL_WEIGHTS: 'global-weights',
  GLOBAL_WEIGHTS_ENABLED: 'global-weights-enabled',
  // New keys for audit fix
  ADD_TAGS: 'add-tags-input',
  EXCLUDE_TAGS: 'exclude-tags-input',
  FIND_REPLACE_FIND: 'find-replace-find-input',
  FIND_REPLACE_REPLACE: 'find-replace-replace-input',
  TAG_APPEND_RULES: 'tag-append-rules',
  PROMPT_OPTIONS: 'prompt-options',
  CARD_SCALE: 'card-scale',
  BACKGROUND_MODE: 'background-mode',
  SIMPLE_BACKGROUND_REPLACEMENT_TAGS: 'simple-background-replacement-tags',
  SMART_TAG_EXCLUSION: 'smart-tag-exclusion',
  RANDOM_BACKGROUND_PATTERNS: 'random-background-patterns',
  RANDOM_BACKGROUND_INCLUDE_GRADIENTS: 'random-background-include-gradients',
  BACKGROUND_MATCH_STRICTNESS: 'background-match-strictness',

  // Search and filter preferences
  SEARCH_TAGS: 'search-tags',
  IS_SHUFFLE: 'is-shuffle',
  HAS_PROMPT_FILTER: 'has-prompt-filter',
  // Saved Artists (local fallback when not authenticated)
  SAVED_ARTISTS: 'booru-saved-artists',

  SHOW_CATEGORY_BADGES: 'booru_gallery_show_category_badges',

  // NSFW consent friction (see lib/nsfw-consent.ts): once the user confirms
  // enabling NSFW / entering Rule34 the first time, we remember it so we don't
  // nag on every subsequent toggle/switch.
  NSFW_ACKNOWLEDGED: 'nsfw-acknowledged',
  RULE34_ACKNOWLEDGED: 'rule34-acknowledged',

  // Extension "Match image resolution" toggle (see docs/extension-configurable-targets-plan.md):
  // when enabled, the Pocket computes a generation width/height from the source
  // post's aspect ratio (capped at MATCH_RESOLUTION_MAX_LONG_SIDE) and sends it
  // alongside the prompt in INJECT_PROMPT.
  MATCH_RESOLUTION_ENABLED: 'extension-match-resolution-enabled',
  MATCH_RESOLUTION_MAX_LONG_SIDE: 'extension-match-resolution-max-long-side',
  // When true, MATCH_RESOLUTION_MAX_LONG_SIDE is a hard per-side cap (classic
  // behavior: max(width, height) never exceeds it) instead of the side of an
  // equivalent total-pixel-area budget (see lib/extension/generation-resolution.ts).
  MATCH_RESOLUTION_STRICT_CAP: 'extension-match-resolution-strict-cap',
  // When true, the computed resolution snaps to the closest curated "bucket"
  // aspect ratio (1:1, 2:3/3:2, 3:4/4:3, 9:16/16:9 — see
  // SUPPORTED_BUCKET_RESOLUTIONS in lib/extension/generation-resolution.ts)
  // instead of preserving the source post's raw, often-unusual aspect ratio.
  MATCH_RESOLUTION_SNAP_TO_BUCKET: 'extension-match-resolution-snap-to-bucket',

  // Extension "Bulk Send" mode toggle (real posts vs. synthetic/pack variations).
  BULK_SEND_MODE: 'extension-bulk-send-mode',

  // Pack Mode (Image Pack Builder) — remembered builder configuration, keyed
  // by packKind (character/clothing/custom) so switching kinds doesn't clobber
  // each other's setup. Does NOT persist baseCard or the sampled axisValues —
  // those are derived from whatever search results are currently loaded and
  // would go stale the moment they're rehydrated into a different session.
  PACK_MODE_CONFIG: 'pack-mode-config',
  // Which packKind tab was last selected — separate from PACK_MODE_CONFIG
  // (which is keyed BY packKind, one bucket per kind) since this is a
  // single scalar, not one of those buckets. Without this, usePackMode
  // always restarted on 'character' every session regardless of which kind
  // the user actually left off on.
  PACK_MODE_LAST_KIND: 'pack-mode-last-kind',

  // Pack Mode simplification (docs/superpowers/specs/2026-09-27-pack-mode-simplification-design.md):
  // a single config replaces the per-archetype PACK_MODE_CONFIG map above.
  // V1 keys are kept (read-only) so migratePackConfig can still translate them.
  PACK_MODE_CONFIG_V2: 'pack-mode-config-v2',
  // Last-used "source of variations" answers (rating/solo/tags/provider),
  // reused as the popover's default and to detect first use.
  PACK_SOURCE_ANSWERS: 'pack-source-answers',
  // Last prompt pasted in "From my prompt", restored as the textarea's value.
  PACK_LAST_BASE_PROMPT: 'pack-last-base-prompt',

  // Pack Mode local learning model (docs/pack-mode-learning-plan.md §7) —
  // strictly local to this browser, never synced or shared (see §10 of that
  // plan). Separate key from PACK_MODE_CONFIG since this grows independently
  // and is pruned on its own budget (see pruneModel in lib/pack/pack-learning.ts).
  PACK_LEARNING_MODEL: 'pack-learning-model',
  // Explore/Exploit slider (§7.8) — user-facing control over
  // weightTemperature, persisted separately from the model itself so
  // resetting the LEARNING data (Reset learning button) doesn't also reset
  // this preference.
  PACK_LEARNING_TEMPERATURE: 'pack-learning-temperature',

  // One-time donation appeal (see lib/support-prompt.ts): running count of
  // copies, the distinct days on which the user copied something, and a flag
  // set the moment the modal is shown so it never repeats.
  SUPPORT_COPY_COUNT: 'support-copy-count',
  SUPPORT_ACTIVE_DAYS: 'support-active-days',
  SUPPORT_MODAL_SEEN: 'support-modal-seen',
} as const

export interface HistoryItem {
  id: string
  postId: number
  provider: BooruProvider
  timestamp: number
  // Self-contained snapshot of the copied post, captured at copy time from the
  // card the user was looking at. History renders straight from this WITHOUT any
  // network hydration, which makes the History view immune to transient booru/API
  // failures (rate limits, 5xx, timeouts). Optional because legacy entries (and
  // any item whose snapshot was dropped to fit the storage budget) don't have it —
  // those fall back to on-demand network hydration via useHistoryPosts.
  post?: BooruPost
  // Kept as optional read-only fallbacks for items written before the
  // provider field existed. Never written by addToHistory anymore.
  content?: string
  thumbnailUrl?: string
}

export interface TagPreset {
  id: string
  name: string
  content: string
  timestamp: number
}

export interface PromptOptions {
  includeCharacters: boolean
  optimizeTags: boolean
  smartTagExclusion: boolean
  /**
   * Prepends the post's first artist tag as "@artist," at the start of the
   * prompt. Only meaningful for the Anima Pencil-XL checkpoint family, which
   * recognizes learned artist styles via the "@" invocation syntax — other
   * checkpoints will just see it as a literal, meaningless tag.
   */
  prependAnimaArtist?: boolean
  /**
   * Whether tags typed in the search bar but missing from a post's own
   * prompt get silently appended to the final prompt. Defaults to true
   * (preserves the historical behavior) — exposed as a real switch so this
   * is no longer an invisible always-on transformation (plan task 2.5 / E3).
   */
  autoAppendSearchTags?: boolean
}

// History entries embed a self-contained snapshot of the copied post
// (HistoryItem.post) so the History view renders straight from localStorage with
// zero network hydration. To stay within the localStorage quota, cap the total
// serialized size of the persisted history: snapshots are kept for the NEWEST
// items first (the ones a user is most likely to revisit) and dropped from the
// oldest once the budget is hit. A snapshot-less item still keeps its
// {postId, provider} pointer and falls back to on-demand network hydration.
const HISTORY_SNAPSHOT_BUDGET_BYTES = 1_500_000
function fitHistoryToStorageBudget(items: HistoryItem[]): HistoryItem[] {
  // Fast path: if everything (snapshots included) already fits, keep it as-is.
  if (JSON.stringify(items).length <= HISTORY_SNAPSHOT_BUDGET_BYTES) return items
  let used = 0
  return items.map(item => {
    if (!item.post) {
      used += JSON.stringify(item).length
      return item
    }
    const fullSize = JSON.stringify(item).length
    if (used + fullSize <= HISTORY_SNAPSHOT_BUDGET_BYTES) {
      used += fullSize
      return item
    }
    // Over budget → drop this (older) item's snapshot, keep the pointer.
    const pruned: HistoryItem = { ...item }
    delete pruned.post
    used += JSON.stringify(pruned).length
    return pruned
  })
}

function normalizeTagAppendRules(value: unknown): TagAppendRule[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((rule) => {
    if (!rule || typeof rule !== 'object') return []
    const candidate = rule as Partial<TagAppendRule>
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.find !== 'string' ||
      !Array.isArray(candidate.append) ||
      !candidate.append.every((tag) => typeof tag === 'string')
    ) {
      return []
    }
    return [{ id: candidate.id, find: candidate.find, append: candidate.append }]
  })
}

export function createTagAppendRule(): TagAppendRule {
  return { id: generateId(), find: '', append: [] }
}

// Type-safe getters and setters for specific preferences
export const userPreferences = {
  getPromptOptions: (): PromptOptions =>
    storage.get(STORAGE_KEYS.PROMPT_OPTIONS, { includeCharacters: true, optimizeTags: true, smartTagExclusion: true, prependAnimaArtist: false, autoAppendSearchTags: true }),

  setPromptOptions: (options: PromptOptions) =>
    storage.set(STORAGE_KEYS.PROMPT_OPTIONS, options),

  getBooruProvider: (): 'danbooru' | 'aibooru' | 'rule34' | 'e621' | 'gelbooru' =>
    storage.get(STORAGE_KEYS.BOORU_PROVIDER, 'gelbooru'),

  setBooruProvider: (provider: 'danbooru' | 'aibooru' | 'rule34' | 'e621' | 'gelbooru') =>
    storage.set(STORAGE_KEYS.BOORU_PROVIDER, provider),

  getBlacklist: (): string[] =>
    storage.get(STORAGE_KEYS.BLACKLIST, [...DEFAULT_BLACKLIST]),

  setBlacklist: (tags: string[]) =>
    storage.set(STORAGE_KEYS.BLACKLIST, tags),

  addBlacklistTag: (tag: string) => {
    const current = storage.get<string[]>(STORAGE_KEYS.BLACKLIST, [...DEFAULT_BLACKLIST])
    if (!current.includes(tag)) {
      const updated = [...current, tag]
      storage.set(STORAGE_KEYS.BLACKLIST, updated)
      return updated
    }
    return current
  },

  removeBlacklistTag: (tag: string) => {
    const current = storage.get<string[]>(STORAGE_KEYS.BLACKLIST, [...DEFAULT_BLACKLIST])
    const updated = current.filter(t => t !== tag)
    storage.set(STORAGE_KEYS.BLACKLIST, updated)
    return updated
  },

  getRemoveLoRaTags: (): boolean =>
    storage.get(STORAGE_KEYS.REMOVE_LORA_TAGS, false),

  setRemoveLoRaTags: (enabled: boolean) =>
    storage.set(STORAGE_KEYS.REMOVE_LORA_TAGS, enabled),

  getRemoveQualityTags: (): boolean =>
    storage.get(STORAGE_KEYS.REMOVE_QUALITY_TAGS, false),

  setRemoveQualityTags: (enabled: boolean) =>
    storage.set(STORAGE_KEYS.REMOVE_QUALITY_TAGS, enabled),

  getRatingFilter: (): string =>
    storage.get(STORAGE_KEYS.RATING_FILTER, 'rating:general'),

  setRatingFilter: (rating: string) =>
    storage.set(STORAGE_KEYS.RATING_FILTER, rating),

  getMinimumTagCount: (): string =>
    storage.get(STORAGE_KEYS.MINIMUM_TAG_COUNT, "5"),

  setMinimumTagCount: (count: string) =>
    storage.set(STORAGE_KEYS.MINIMUM_TAG_COUNT, count),

  // Quality floor (Palanca 1, docs/prompt-genericness-mitigation-plan.md §7-§8): score:>=N
  // tier, off by default. Imitates getMinimumTagCount/setMinimumTagCount exactly.
  getScoreTier: (): 'off' | 'good' | 'great' | 'best' =>
    storage.get(STORAGE_KEYS.SCORE_TIER, 'off'),

  setScoreTier: (tier: 'off' | 'good' | 'great' | 'best') =>
    storage.set(STORAGE_KEYS.SCORE_TIER, tier),

  getMinimumCharacterCount: (): string =>
    storage.get(STORAGE_KEYS.MINIMUM_CHARACTER_COUNT, "0"),

  setMinimumCharacterCount: (count: string) =>
    storage.set(STORAGE_KEYS.MINIMUM_CHARACTER_COUNT, count),

  // Reads history and, on the first read after this change, migrates it in
  // place: legacy items (pre-`provider` field) that cannot be reconstructed
  // are silently dropped — same pattern used by Favorites for corrupt/legacy
  // data (see use-favorites-core.ts migrateFromLocalStorage / favorites-logic.ts
  // favKey parsing). Never guesses a provider. The normalized result is
  // persisted back so this filter only runs once per user.
  getHistory: (): HistoryItem[] => {
    const raw = storage.get<HistoryItem[]>(STORAGE_KEYS.HISTORY, [])
    const hasLegacyItems = raw.some(item => !item.provider)
    if (!hasLegacyItems) return raw

    const migrated = raw.filter(
      (item): item is HistoryItem => typeof item.provider === 'string' && item.provider.length > 0
    )
    storage.set(STORAGE_KEYS.HISTORY, migrated)
    return migrated
  },

  getAddTagsPresets: (): TagPreset[] =>
    storage.get(STORAGE_KEYS.ADD_TAGS_PRESETS, []),

  addAddTagsPreset: (preset: Omit<TagPreset, 'id' | 'timestamp'>) => {
    const presets = storage.get<TagPreset[]>(STORAGE_KEYS.ADD_TAGS_PRESETS, [])
    const newPreset: TagPreset = {
      ...preset,
      id: generateId(),
      timestamp: Date.now()
    }
    const newPresets = [newPreset, ...presets]
    storage.set(STORAGE_KEYS.ADD_TAGS_PRESETS, newPresets)
    return newPresets
  },

  removeAddTagsPreset: (id: string) => {
    const presets = storage.get<TagPreset[]>(STORAGE_KEYS.ADD_TAGS_PRESETS, [])
    const newPresets = presets.filter(p => p.id !== id)
    storage.set(STORAGE_KEYS.ADD_TAGS_PRESETS, newPresets)
    return newPresets
  },

  addToHistory: (item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
    const history = storage.get<HistoryItem[]>(STORAGE_KEYS.HISTORY, [])
    const newItem: HistoryItem = {
      ...item,
      id: generateId(),
      timestamp: Date.now()
    }
    // Add to beginning, limit to last 500 items (raised from 100 now that
    // History is a full navigable page split across provider tabs, not just
    // a quick sidebar sheet). Then trim embedded post snapshots so the whole
    // history stays within the localStorage budget (snapshots kept for the
    // newest items first — see fitHistoryToStorageBudget).
    const newHistory = fitHistoryToStorageBudget([newItem, ...history].slice(0, 500))
    storage.set(STORAGE_KEYS.HISTORY, newHistory)
    return newHistory
  },

  clearHistory: () =>
    storage.remove(STORAGE_KEYS.HISTORY),

  removeFromHistory: (id: string) => {
    const history = storage.get<HistoryItem[]>(STORAGE_KEYS.HISTORY, [])
    const newHistory = history.filter(item => item.id !== id)
    storage.set(STORAGE_KEYS.HISTORY, newHistory)
  },

  getGlobalWeights: (): Record<string, number> =>
    storage.get(STORAGE_KEYS.GLOBAL_WEIGHTS, {}),

  getSmartTagExclusion: (): boolean =>
    storage.get(STORAGE_KEYS.SMART_TAG_EXCLUSION, true),

  setSmartTagExclusion: (enabled: boolean) =>
    storage.set(STORAGE_KEYS.SMART_TAG_EXCLUSION, enabled),

  setGlobalWeights: (weights: Record<string, number>) =>
    storage.set(STORAGE_KEYS.GLOBAL_WEIGHTS, weights),

  getGlobalWeightsEnabled: (): boolean =>
    storage.get(STORAGE_KEYS.GLOBAL_WEIGHTS_ENABLED, false),

  setGlobalWeightsEnabled: (enabled: boolean) =>
    storage.set(STORAGE_KEYS.GLOBAL_WEIGHTS_ENABLED, enabled),

  // Audit Fix: Persistent Inputs
  getAddTagsInput: (): string => {
    // Migration check: check old key if new one is empty?
    // Use the new key directly.
    return storage.get(STORAGE_KEYS.ADD_TAGS, "")
  },

  setAddTagsInput: (value: string) =>
    storage.set(STORAGE_KEYS.ADD_TAGS, value),

  getExcludeTagsInput: (): string =>
    storage.get(STORAGE_KEYS.EXCLUDE_TAGS, ""),

  setExcludeTagsInput: (value: string) =>
    storage.set(STORAGE_KEYS.EXCLUDE_TAGS, value),

  // Find & Replace: two comma-separated lists paired by index (find[i] -> replace[i]).
  // See lib/cleanPrompt.ts applyWordReplacements for the matching rule
  // (exact match against the parenthesized content of a tag only).
  getFindReplaceFindInput: (): string =>
    storage.get(STORAGE_KEYS.FIND_REPLACE_FIND, ""),

  setFindReplaceFindInput: (value: string) =>
    storage.set(STORAGE_KEYS.FIND_REPLACE_FIND, value),

  getFindReplaceReplaceInput: (): string =>
    storage.get(STORAGE_KEYS.FIND_REPLACE_REPLACE, ""),

  setFindReplaceReplaceInput: (value: string) =>
    storage.set(STORAGE_KEYS.FIND_REPLACE_REPLACE, value),

  getTagAppendRules: (): TagAppendRule[] =>
    normalizeTagAppendRules(storage.get<unknown>(STORAGE_KEYS.TAG_APPEND_RULES, [])),

  setTagAppendRules: (rules: TagAppendRule[]) =>
    storage.set(STORAGE_KEYS.TAG_APPEND_RULES, rules),

  getCardScale: (): 'small' | 'medium' | 'large' =>
    storage.get(STORAGE_KEYS.CARD_SCALE, 'medium'),

  setCardScale: (scale: 'small' | 'medium' | 'large') =>
    storage.set(STORAGE_KEYS.CARD_SCALE, scale),

  getBackgroundMode: (): 'keep' | 'remove_all' | 'force_simple' | 'random' | 'detailed_random' =>
    storage.get(STORAGE_KEYS.BACKGROUND_MODE, 'keep'),

  setBackgroundMode: (mode: 'keep' | 'remove_all' | 'force_simple' | 'random' | 'detailed_random') =>
    storage.set(STORAGE_KEYS.BACKGROUND_MODE, mode),

  getRandomBackgroundPatterns: (): boolean =>
    storage.get(STORAGE_KEYS.RANDOM_BACKGROUND_PATTERNS, true),

  setRandomBackgroundPatterns: (enabled: boolean) =>
    storage.set(STORAGE_KEYS.RANDOM_BACKGROUND_PATTERNS, enabled),

  getRandomBackgroundIncludeGradients: (): boolean =>
    storage.get(STORAGE_KEYS.RANDOM_BACKGROUND_INCLUDE_GRADIENTS, true),

  setRandomBackgroundIncludeGradients: (enabled: boolean) =>
    storage.set(STORAGE_KEYS.RANDOM_BACKGROUND_INCLUDE_GRADIENTS, enabled),

  /**
   * How strictly "Detailed Random" gates its location pick against the
   * post's own explicitness/scenery — see lib/background-context.ts for the
   * three levels. Defaults to 'balanced'. Kept as an inline union (matching
   * getBackgroundMode above) instead of importing MatchStrictness, so this
   * module doesn't pull in the background-context -> background-locations
   * import chain just for a type.
   */
  getBackgroundMatchStrictness: (): 'strict' | 'balanced' | 'free' =>
    storage.get(STORAGE_KEYS.BACKGROUND_MATCH_STRICTNESS, 'balanced'),

  setBackgroundMatchStrictness: (strictness: 'strict' | 'balanced' | 'free') =>
    storage.set(STORAGE_KEYS.BACKGROUND_MATCH_STRICTNESS, strictness),

  getSimpleBackgroundReplacementTags: (): string =>
    storage.get(STORAGE_KEYS.SIMPLE_BACKGROUND_REPLACEMENT_TAGS, 'simple background, white background'),

  setSimpleBackgroundReplacementTags: (tags: string) =>
    storage.set(STORAGE_KEYS.SIMPLE_BACKGROUND_REPLACEMENT_TAGS, tags),

  // Search and filter preferences
  getSearchTags: (): string => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(STORAGE_KEYS.SEARCH_TAGS) || ''
    }
    return ''
  },

  setSearchTags: (tags: string) => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEYS.SEARCH_TAGS, tags)
    }
  },

  getIsShuffle: (): boolean =>
    storage.get(STORAGE_KEYS.IS_SHUFFLE, false),

  setIsShuffle: (shuffle: boolean) =>
    storage.set(STORAGE_KEYS.IS_SHUFFLE, shuffle),

  getHasPromptFilter: (): boolean =>
    storage.get(STORAGE_KEYS.HAS_PROMPT_FILTER, false),

  setHasPromptFilter: (hasPrompt: boolean) =>
    storage.set(STORAGE_KEYS.HAS_PROMPT_FILTER, hasPrompt),

  // Saved Artists (local fallback when not authenticated)
  getSavedArtists: (): SavedArtist[] =>
    storage.get<SavedArtist[]>(STORAGE_KEYS.SAVED_ARTISTS, []),

  setSavedArtists: (artists: SavedArtist[]) =>
    storage.set(STORAGE_KEYS.SAVED_ARTISTS, artists),

  addSavedArtist: (artist: Omit<SavedArtist, 'timestamp'>): SavedArtist[] => {
    const current = storage.get<SavedArtist[]>(STORAGE_KEYS.SAVED_ARTISTS, [])
    // Dedupe by (provider, artistTag)
    const exists = current.some(a => a.provider === artist.provider && a.artistTag === artist.artistTag)
    if (exists) return current
    const newArtist: SavedArtist = { ...artist, timestamp: Date.now() }
    const updated = [newArtist, ...current]
    storage.set(STORAGE_KEYS.SAVED_ARTISTS, updated)
    return updated
  },

  removeSavedArtist: (provider: string, artistTag: string): SavedArtist[] => {
    const current = storage.get<SavedArtist[]>(STORAGE_KEYS.SAVED_ARTISTS, [])
    const updated = current.filter(a => !(a.provider === provider && a.artistTag === artistTag))
    storage.set(STORAGE_KEYS.SAVED_ARTISTS, updated)
    return updated
  },

  clearSavedArtists: () =>
    storage.remove(STORAGE_KEYS.SAVED_ARTISTS),

  getShowCategoryTagBadges: (): boolean =>
    storage.get(STORAGE_KEYS.SHOW_CATEGORY_BADGES, true),

  setShowCategoryTagBadges: (val: boolean) =>
    storage.set(STORAGE_KEYS.SHOW_CATEGORY_BADGES, val),

  // NSFW consent acknowledgments (see lib/nsfw-consent.ts)
  getNsfwAcknowledged: (): boolean =>
    storage.get(STORAGE_KEYS.NSFW_ACKNOWLEDGED, false),

  setNsfwAcknowledged: (val: boolean) =>
    storage.set(STORAGE_KEYS.NSFW_ACKNOWLEDGED, val),

  getRule34Acknowledged: (): boolean =>
    storage.get(STORAGE_KEYS.RULE34_ACKNOWLEDGED, false),

  setRule34Acknowledged: (val: boolean) =>
    storage.set(STORAGE_KEYS.RULE34_ACKNOWLEDGED, val),

  // Extension "Match image resolution" toggle
  getMatchResolutionEnabled: (): boolean =>
    storage.get(STORAGE_KEYS.MATCH_RESOLUTION_ENABLED, false),

  setMatchResolutionEnabled: (val: boolean) =>
    storage.set(STORAGE_KEYS.MATCH_RESOLUTION_ENABLED, val),

  getMatchResolutionMaxLongSide: (): number =>
    storage.get(STORAGE_KEYS.MATCH_RESOLUTION_MAX_LONG_SIDE, 1536),

  setMatchResolutionMaxLongSide: (val: number) =>
    storage.set(STORAGE_KEYS.MATCH_RESOLUTION_MAX_LONG_SIDE, val),

  getMatchResolutionStrictCap: (): boolean =>
    storage.get(STORAGE_KEYS.MATCH_RESOLUTION_STRICT_CAP, false),

  setMatchResolutionStrictCap: (val: boolean) =>
    storage.set(STORAGE_KEYS.MATCH_RESOLUTION_STRICT_CAP, val),

  getMatchResolutionSnapToBucket: (): boolean =>
    storage.get(STORAGE_KEYS.MATCH_RESOLUTION_SNAP_TO_BUCKET, false),

  setMatchResolutionSnapToBucket: (val: boolean) =>
    storage.set(STORAGE_KEYS.MATCH_RESOLUTION_SNAP_TO_BUCKET, val),

  // Extension "Bulk Send" mode toggle
  getBulkSendMode: (): string =>
    storage.get(STORAGE_KEYS.BULK_SEND_MODE, "real"),

  setBulkSendMode: (val: string) =>
    storage.set(STORAGE_KEYS.BULK_SEND_MODE, val),

  // Pack Mode builder config, keyed by packKind. See PackModeStoredConfig
  // below for exactly what is (and deliberately isn't) persisted.
  getPackModeConfig: (): PackModeConfigByKind =>
    storage.get(STORAGE_KEYS.PACK_MODE_CONFIG, {}),

  setPackModeConfig: (config: PackModeConfigByKind) =>
    storage.set(STORAGE_KEYS.PACK_MODE_CONFIG, config),

  // Which pack archetype was last selected. Validated against the known
  // literal union on read so a corrupted/stale value falls back to the
  // default; the legacy 'clothing' value maps to its successor 'wardrobe'.
  getPackModeLastKind: (): PackModeKind => {
    const stored = storage.get<string>(STORAGE_KEYS.PACK_MODE_LAST_KIND, 'character')
    if (stored === 'clothing') return 'wardrobe'
    return (PACK_MODE_KINDS as readonly string[]).includes(stored) ? (stored as PackModeKind) : 'character'
  },

  setPackModeLastKind: (kind: PackModeKind) =>
    storage.set(STORAGE_KEYS.PACK_MODE_LAST_KIND, kind),

  // Pack Mode local learning model (see lib/pack/pack-learning.ts). The
  // getter validates the stored shape itself (version + contexts object)
  // rather than importing createEmptyModel from that module at runtime —
  // storage.ts stays a leaf dependency with no imports from lib/pack/, and
  // this mirrors the same "migrate/drop silently on corruption" criterion
  // getHistory and Favorites already use for legacy/malformed data (plan §9.5).
  getPackLearningModel: (): PackLearningModel => {
    const stored = storage.get<PackLearningModel | null>(STORAGE_KEYS.PACK_LEARNING_MODEL, null)
    if (
      stored &&
      typeof stored === 'object' &&
      stored.version === 1 &&
      stored.contexts &&
      typeof stored.contexts === 'object' &&
      !Array.isArray(stored.contexts)
    ) {
      return stored
    }
    return { version: 1, contexts: {} }
  },

  setPackLearningModel: (model: PackLearningModel) =>
    storage.set(STORAGE_KEYS.PACK_LEARNING_MODEL, model),

  // Explore/Exploit control (§7.8) — maps directly to generatePackPrompts'
  // weightTemperature. 1 = as-learned, >1 flattens toward uniform sampling.
  getPackLearningTemperature: (): number => {
    const stored = storage.get<number>(STORAGE_KEYS.PACK_LEARNING_TEMPERATURE, 1)
    return typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : 1
  },

  setPackLearningTemperature: (temperature: number) =>
    storage.set(STORAGE_KEYS.PACK_LEARNING_TEMPERATURE, temperature),

  // Pack Mode simplification (§7): single config replacing the per-archetype
  // map. Validated on read — a corrupted/legacy-shaped value reads back as
  // null so migratePackConfig falls through to the V1 migration path.
  getPackModeConfigV2: (): PackModeConfigV2 | null => {
    const stored = storage.get<unknown>(STORAGE_KEYS.PACK_MODE_CONFIG_V2, null)
    return isPackModeConfigV2(stored) ? stored : null
  },

  setPackModeConfigV2: (config: PackModeConfigV2) =>
    storage.set(STORAGE_KEYS.PACK_MODE_CONFIG_V2, config),

  getPackSourceAnswers: (): StoredPackSourceAnswers | null => {
    const stored = storage.get<unknown>(STORAGE_KEYS.PACK_SOURCE_ANSWERS, null)
    return isStoredPackSourceAnswers(stored) ? stored : null
  },

  setPackSourceAnswers: (answers: StoredPackSourceAnswers) =>
    storage.set(STORAGE_KEYS.PACK_SOURCE_ANSWERS, answers),

  getLastPackBasePrompt: (): string =>
    storage.get(STORAGE_KEYS.PACK_LAST_BASE_PROMPT, ''),

  setLastPackBasePrompt: (prompt: string) =>
    storage.set(STORAGE_KEYS.PACK_LAST_BASE_PROMPT, prompt),
}

/**
 * Remembered Pack Mode builder setup for ONE packKind ('character' |
 * 'clothing' | 'custom'). Deliberately excludes `baseCard` and the sampled
 * `axisValues` pools — both are derived from whichever search results happen
 * to be loaded in the current session and would be stale (or outright invalid
 * — a value from a post that no longer exists in the new session's pool) the
 * moment they were rehydrated into a different one. `manualAxisValues` is the
 * one exception: values the user typed in by hand (via the axis editor's
 * "Add" input) aren't sampled from search results at all, so they're worth
 * keeping across sessions the same way lockedCategories/axisMinCounts are.
 */
export interface PackModeConfig {
  lockedCategories: TagCategory[]
  axisMinCounts: Partial<Record<TagCategory, number>>
  promptCount: number
  manualAxisValues: Partial<Record<TagCategory, string[]>>
  axisTagModes?: Partial<Record<TagCategory, AxisTagMode>>
  /** Slots locked inside a partially locked category ("category:subcategory"). */
  lockedSlots?: string[]
  /** Slots switched off in a varying category. */
  mutedSlots?: string[]
}

// Mirrors PackArchetypeId in lib/tag-taxonomy.ts (kept literal so storage stays a leaf module).
export const PACK_MODE_KINDS = ['character', 'wardrobe', 'expressions', 'atmosphere', 'custom'] as const
export type PackModeKind = (typeof PACK_MODE_KINDS)[number]

export type PackModeConfigByKind = Partial<Record<PackModeKind | 'clothing' | string, PackModeConfig>>

/**
 * Single Pack Mode builder config (Pack Mode simplification, see
 * docs/superpowers/specs/2026-09-27-pack-mode-simplification-design.md §7.1).
 * Replaces the per-archetype `PackModeConfigByKind` map above: archetypes are
 * gone, so there is exactly one config, not one per kind. Same exclusions as
 * `PackModeConfig` (no baseCard, no sampled axisValues — only
 * `manualAxisValues` survives a session).
 */
export interface PackModeConfigV2 {
  lockedCategories: TagCategory[]
  lockedSlots: string[]
  mutedSlots: string[]
  varietyLevel: 1 | 2 | 3 | 4 | 5 | 'custom'
  /** Only meaningful when varietyLevel === 'custom'. */
  axisTagModes: Partial<Record<TagCategory, AxisTagMode>>
  /** Only meaningful when varietyLevel === 'custom'. */
  axisMinCounts: Partial<Record<TagCategory, number>>
  promptCount: number
  manualAxisValues: Partial<Record<TagCategory, string[]>>
}

function isPackModeConfigV2(value: unknown): value is PackModeConfigV2 {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<PackModeConfigV2>
  return (
    Array.isArray(v.lockedCategories) &&
    Array.isArray(v.lockedSlots) &&
    Array.isArray(v.mutedSlots) &&
    (v.varietyLevel === 'custom' || (typeof v.varietyLevel === 'number' && v.varietyLevel >= 1 && v.varietyLevel <= 5)) &&
    typeof v.axisTagModes === 'object' && v.axisTagModes !== null &&
    typeof v.axisMinCounts === 'object' && v.axisMinCounts !== null &&
    typeof v.promptCount === 'number' &&
    typeof v.manualAxisValues === 'object' && v.manualAxisValues !== null
  )
}

/**
 * Same fields as `PackSetupAnswers` (components/prompt-gallery/pack-setup-modal.tsx),
 * duplicated here with local literal types so storage.ts stays a leaf module
 * (no import from components/). "packSourceChosen" (§7.2) is implicit: a
 * non-null value read back from storage means the user already answered once.
 */
export interface StoredPackSourceAnswers {
  ratingMode: 'sfw' | 'questionable' | 'explicit' | 'both'
  soloOnly: boolean
  tagsSource: 'current' | 'custom' | 'empty'
  searchTags: string
  booruProvider: BooruProvider
}

function isStoredPackSourceAnswers(value: unknown): value is StoredPackSourceAnswers {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<StoredPackSourceAnswers>
  return (
    (['sfw', 'questionable', 'explicit', 'both'] as const).includes(v.ratingMode as 'sfw') &&
    typeof v.soloOnly === 'boolean' &&
    (['current', 'custom', 'empty'] as const).includes(v.tagsSource as 'current') &&
    typeof v.searchTags === 'string' &&
    typeof v.booruProvider === 'string'
  )
}

export interface SavedArtist {
  provider: string
  artistTag: string
  thumbnailUrl: string | null
  thumbnailPostId: number | null
  timestamp: number
}