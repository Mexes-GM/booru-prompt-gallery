import { useEffect } from 'react'
import { useUser } from '@/hooks/use-user'
import { UserPreferencesSync } from '@/lib/user-preferences-sync'
import { storage, STORAGE_KEYS } from '@/lib/storage'

/**
 * Hook that syncs user preferences with Supabase when user is authenticated
 * Automatically loads preferences on mount and saves changes
 */
export function useAutoSyncPreferences() {
  const { user, loading } = useUser()

  // Load preferences when user logs in
  useEffect(() => {
    if (user && !loading) {
      UserPreferencesSync.loadAndSyncPreferences(user.id)
    }
  }, [user?.id, loading])

  // Listen to localStorage changes and sync to Supabase
  useEffect(() => {
    if (!user) return

    const handleStorageChange = (event: CustomEvent<{ key: string; value: any }>) => {
      const { key, value } = event.detail

      // Map localStorage keys to database columns
      const preferencesMap: Record<string, keyof typeof UserPreferencesSync.prototype> = {
        [STORAGE_KEYS.SEARCH_TAGS]: 'search_tags',
        [STORAGE_KEYS.IS_SHUFFLE]: 'is_shuffle',
        [STORAGE_KEYS.SMART_TAG_EXCLUSION]: 'smart_tag_exclusion',
        [STORAGE_KEYS.BACKGROUND_MODE]: 'background_mode',
        [STORAGE_KEYS.SIMPLE_BACKGROUND_REPLACEMENT_TAGS]: 'simple_background_replacement_tags',
        [STORAGE_KEYS.RATING_FILTER]: 'rating_filter',
        [STORAGE_KEYS.BOORU_PROVIDER]: 'booru_provider',
        [STORAGE_KEYS.MINIMUM_TAG_COUNT]: 'minimum_tag_count',
        [STORAGE_KEYS.REMOVE_LORA_TAGS]: 'remove_lora_tags',
        [STORAGE_KEYS.REMOVE_QUALITY_TAGS]: 'remove_quality_tags',
      }

      if (key in preferencesMap) {
        const dbKey = preferencesMap[key] as any
        UserPreferencesSync.updatePreference(user.id, dbKey, value)
      }
    }

    // Listen to our custom storage event
    window.addEventListener('booru-storage-update', handleStorageChange as EventListener)

    return () => {
      window.removeEventListener('booru-storage-update', handleStorageChange as EventListener)
    }
  }, [user?.id])
}

/**
 * Alternative hook for syncing a specific preference value
 * Syncs both ways: localStorage -> Supabase and Supabase -> localStorage
 */
export function useSyncedPreference<T>(
  storageKey: string,
  defaultValue: T,
  getter: () => T,
  setter: (value: T) => void
): { value: T; setValue: (value: T) => void } {
  const { user } = useUser()

  // Sync from Supabase to localStorage on mount
  useEffect(() => {
    if (!user) return

    // Try to load from Supabase
    UserPreferencesSync.loadAndSyncPreferences(user.id)
  }, [user?.id])

  // Sync from localStorage to Supabase on change
  useEffect(() => {
    if (!user) return

    const handleStorageChange = (event: CustomEvent<{ key: string; value: T }>) => {
      if (event.detail.key === storageKey && event.detail.value !== undefined) {
        const dbKey = storageKey.replace(/-/g, '_') as any
        UserPreferencesSync.updatePreference(user.id, dbKey, event.detail.value)
      }
    }

    window.addEventListener('booru-storage-update', handleStorageChange as EventListener)

    return () => {
      window.removeEventListener('booru-storage-update', handleStorageChange as EventListener)
    }
  }, [user?.id, storageKey])

  const value = getter()
  const setValue = (newValue: T) => {
    setter(newValue)
  }

  return { value, setValue }
}
