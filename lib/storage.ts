// Utility functions for localStorage persistence
import { DEFAULT_BLACKLIST } from '@/lib/constants'
import { generateId } from '@/lib/utils/id-generator'

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
  ORDER: 'order',
  HISTORY: 'prompt-history',
  ADD_TAGS_PRESETS: 'add-tags-presets',
  MINIMUM_TAG_COUNT: 'minimum-tag-count',
  MINIMUM_CHARACTER_COUNT: 'minimum-character-count',
  BLACKLIST: 'blacklist',
  GLOBAL_WEIGHTS: 'global-weights',
  GLOBAL_WEIGHTS_ENABLED: 'global-weights-enabled',
  // New keys for audit fix
  ADD_TAGS: 'add-tags-input',
  EXCLUDE_TAGS: 'exclude-tags-input',
  PROMPT_OPTIONS: 'prompt-options',
  VIEW_MODE: 'view-mode',
  CARD_SCALE: 'card-scale',
  BACKGROUND_MODE: 'background-mode',
  SIMPLE_BACKGROUND_REPLACEMENT_TAGS: 'simple-background-replacement-tags',
  SMART_TAG_EXCLUSION: 'smart-tag-exclusion',
  RANDOM_BACKGROUND_PATTERNS: 'random-background-patterns',

  // Search and filter preferences
  SEARCH_TAGS: 'search-tags',
  IS_SHUFFLE: 'is-shuffle',
  HAS_PROMPT_FILTER: 'has-prompt-filter',
  // Saved Artists (local fallback when not authenticated)
  SAVED_ARTISTS: 'booru-saved-artists'
} as const

export interface HistoryItem {
  id: string
  content: string
  timestamp: number
  postId?: number
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
}

// Type-safe getters and setters for specific preferences
export const userPreferences = {
  getPromptOptions: (): PromptOptions =>
    storage.get(STORAGE_KEYS.PROMPT_OPTIONS, { includeCharacters: true, optimizeTags: true, smartTagExclusion: true }),

  setPromptOptions: (options: PromptOptions) =>
    storage.set(STORAGE_KEYS.PROMPT_OPTIONS, options),

  getBooruProvider: (): 'danbooru' | 'aibooru' | 'rule34' | 'e621' | 'gelbooru' =>
    storage.get(STORAGE_KEYS.BOORU_PROVIDER, 'danbooru'),

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

  getMinimumCharacterCount: (): string =>
    storage.get(STORAGE_KEYS.MINIMUM_CHARACTER_COUNT, "0"),

  setMinimumCharacterCount: (count: string) =>
    storage.set(STORAGE_KEYS.MINIMUM_CHARACTER_COUNT, count),

  getOrder: (): 'popular' | 'recent' | 'random' =>
    storage.get(STORAGE_KEYS.ORDER, 'popular'),

  setOrder: (order: 'popular' | 'recent' | 'random') =>
    storage.set(STORAGE_KEYS.ORDER, order),

  getHistory: (): HistoryItem[] =>
    storage.get(STORAGE_KEYS.HISTORY, []),

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
    // Add to beginning, limit to last 100 items
    const newHistory = [newItem, ...history].slice(0, 100)
    storage.set(STORAGE_KEYS.HISTORY, newHistory)
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
    // For now, let's just support the new key.
    return storage.get(STORAGE_KEYS.ADD_TAGS, "")
  },

  setAddTagsInput: (value: string) =>
    storage.set(STORAGE_KEYS.ADD_TAGS, value),

  getExcludeTagsInput: (): string =>
    storage.get(STORAGE_KEYS.EXCLUDE_TAGS, ""),

  setExcludeTagsInput: (value: string) =>
    storage.set(STORAGE_KEYS.EXCLUDE_TAGS, value),

  getViewMode: (): 'grid' | 'list' =>
    storage.get(STORAGE_KEYS.VIEW_MODE, 'grid'),

  setViewMode: (mode: 'grid' | 'list') =>
    storage.set(STORAGE_KEYS.VIEW_MODE, mode),

  getCardScale: (): 'small' | 'medium' | 'large' =>
    storage.get(STORAGE_KEYS.CARD_SCALE, 'medium'),

  setCardScale: (scale: 'small' | 'medium' | 'large') =>
    storage.set(STORAGE_KEYS.CARD_SCALE, scale),

  getBackgroundMode: (): 'keep' | 'remove_all' | 'force_simple' | 'random' =>
    storage.get(STORAGE_KEYS.BACKGROUND_MODE, 'keep'),

  setBackgroundMode: (mode: 'keep' | 'remove_all' | 'force_simple' | 'random') =>
    storage.set(STORAGE_KEYS.BACKGROUND_MODE, mode),

  getRandomBackgroundPatterns: (): boolean =>
    storage.get(STORAGE_KEYS.RANDOM_BACKGROUND_PATTERNS, true),

  setRandomBackgroundPatterns: (enabled: boolean) =>
    storage.set(STORAGE_KEYS.RANDOM_BACKGROUND_PATTERNS, enabled),

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
    storage.remove(STORAGE_KEYS.SAVED_ARTISTS)
}

export interface SavedArtist {
  provider: string
  artistTag: string
  thumbnailUrl: string | null
  thumbnailPostId: number | null
  timestamp: number
}