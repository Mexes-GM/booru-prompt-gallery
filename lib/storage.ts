// Utility functions for localStorage persistence

// Safe localStorage wrapper that handles SSR and errors
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
    } catch (error) {
      console.warn(`Error writing to localStorage key "${key}":`, error)
    }
  },

  remove: (key: string): void => {
    if (typeof window === 'undefined') return
    
    try {
      localStorage.removeItem(key)
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
  HISTORY: 'prompt-history'
} as const

export interface HistoryItem {
  id: string
  content: string
  timestamp: number
  postId?: number
  thumbnailUrl?: string
}

// Type-safe getters and setters for specific preferences
export const userPreferences = {
  getBooruProvider: (): 'danbooru' | 'aibooru' | 'rule34' => 
    storage.get(STORAGE_KEYS.BOORU_PROVIDER, 'danbooru'),
  
  setBooruProvider: (provider: 'danbooru' | 'aibooru' | 'rule34') => 
    storage.set(STORAGE_KEYS.BOORU_PROVIDER, provider),
  
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

  getOrder: (): 'popular' | 'recent' | 'random' => 
    storage.get(STORAGE_KEYS.ORDER, 'popular'),
  
  setOrder: (order: 'popular' | 'recent' | 'random') => 
    storage.set(STORAGE_KEYS.ORDER, order),

  getHistory: (): HistoryItem[] => 
    storage.get(STORAGE_KEYS.HISTORY, []),

  addToHistory: (item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
    const history = storage.get<HistoryItem[]>(STORAGE_KEYS.HISTORY, [])
    const newItem: HistoryItem = {
      ...item,
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString() + Math.random().toString(36).substring(2),
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
  }
}