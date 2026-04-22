import { createClient } from '@/lib/supabase/client'
import { storage, userPreferences, STORAGE_KEYS } from '@/lib/storage'

export interface UserPreferencesData {
  search_tags: string
  is_shuffle: boolean
  smart_tag_exclusion: boolean
  background_mode: string
  simple_background_replacement_tags: string
  rating_filter: string
  booru_provider: string
  minimum_tag_count: string
  remove_lora_tags: boolean
  remove_quality_tags: boolean
}

export class UserPreferencesSync {
  private static supabase = createClient()

  /**
   * Load user preferences from Supabase and sync to localStorage
   */
  static async loadAndSyncPreferences(userId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (error && error.code !== 'PGRST116') {
        // PGRST116 means no rows found, which is fine for first-time users
        console.error('Error loading user preferences:', error)
        return
      }

      if (data) {
        // Sync each preference to localStorage
        // Note: search_tags are explicitly excluded from cloud sync to allow cross-tab independence
        if (data.is_shuffle !== null) storage.set(STORAGE_KEYS.IS_SHUFFLE, data.is_shuffle)
        if (data.smart_tag_exclusion !== null) storage.set(STORAGE_KEYS.SMART_TAG_EXCLUSION, data.smart_tag_exclusion)
        if (data.background_mode) storage.set(STORAGE_KEYS.BACKGROUND_MODE, data.background_mode)
        if (data.simple_background_replacement_tags) storage.set(STORAGE_KEYS.SIMPLE_BACKGROUND_REPLACEMENT_TAGS, data.simple_background_replacement_tags)
        if (data.rating_filter) storage.set(STORAGE_KEYS.RATING_FILTER, data.rating_filter)
        if (data.booru_provider) storage.set(STORAGE_KEYS.BOORU_PROVIDER, data.booru_provider)
        if (data.minimum_tag_count) storage.set(STORAGE_KEYS.MINIMUM_TAG_COUNT, data.minimum_tag_count)
        if (data.remove_lora_tags !== null) storage.set(STORAGE_KEYS.REMOVE_LORA_TAGS, data.remove_lora_tags)
        if (data.remove_quality_tags !== null) storage.set(STORAGE_KEYS.REMOVE_QUALITY_TAGS, data.remove_quality_tags)

        console.log('✓ User preferences synchronized from Supabase')
      }
    } catch (error) {
      console.error('Failed to load user preferences:', error)
    }
  }

  /**
   * Create or update user preferences in Supabase
   */
  static async savePreferences(userId: string, preferences: Partial<UserPreferencesData>): Promise<void> {
    try {
      const { error: upsertError } = await this.supabase
        .from('user_preferences')
        .upsert(
          {
            user_id: userId,
            ...preferences,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )

      if (upsertError) {
        console.error('Error saving user preferences:', upsertError)
        return
      }

      console.log('✓ Preferences saved to Supabase')
    } catch (error) {
      console.error('Failed to save user preferences:', error)
    }
  }

  /**
   * Save individual preference fields
   */
  static async updatePreference(userId: string, key: keyof UserPreferencesData, value: any): Promise<void> {
    try {
      const updateData: Record<string, any> = {
        [key]: value,
        updated_at: new Date().toISOString(),
      }

      const { error } = await this.supabase
        .from('user_preferences')
        .update(updateData)
        .eq('user_id', userId)

      if (error) {
        console.error(`Error updating preference ${key}:`, error)
        return
      }
    } catch (error) {
      console.error(`Failed to update preference ${key}:`, error)
    }
  }

  /**
   * Get current preferences from localStorage formatted for Supabase
   */
  static getLocalPreferences(): Partial<UserPreferencesData> {
    return {
      is_shuffle: storage.get(STORAGE_KEYS.IS_SHUFFLE, false),
      smart_tag_exclusion: storage.get(STORAGE_KEYS.SMART_TAG_EXCLUSION, true),
      background_mode: storage.get(STORAGE_KEYS.BACKGROUND_MODE, 'none'),
      simple_background_replacement_tags: storage.get(STORAGE_KEYS.SIMPLE_BACKGROUND_REPLACEMENT_TAGS, ''),
      rating_filter: storage.get(STORAGE_KEYS.RATING_FILTER, 'rating:general'),
      booru_provider: storage.get(STORAGE_KEYS.BOORU_PROVIDER, 'danbooru'),
      minimum_tag_count: storage.get(STORAGE_KEYS.MINIMUM_TAG_COUNT, '5'),
      remove_lora_tags: storage.get(STORAGE_KEYS.REMOVE_LORA_TAGS, false),
      remove_quality_tags: storage.get(STORAGE_KEYS.REMOVE_QUALITY_TAGS, false),
    }
  }

  /**
   * Subscribe to real-time preference changes (for sync across tabs)
   */
  static subscribeToPreferences(userId: string, callback: (data: UserPreferencesData) => void) {
    return this.supabase
      .from(`user_preferences:user_id=eq.${userId}`)
      .on('*', (payload) => {
        callback(payload.new as UserPreferencesData)
      })
      .subscribe()
  }
}
