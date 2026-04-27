import { useEffect, useMemo, useRef } from "react"
import { useUser } from "@/hooks/use-user"
import { storage, STORAGE_KEYS, STORAGE_EVENT_NAME } from "@/lib/storage"
import { createClient } from "@/lib/supabase/client"

/** When true, suppresses PUSH-to-cloud during the initial PULL. */
let _cloudSyncInProgress = false

/**
 * Hook to sync local preferences with Supabase cloud storage.
 * It does two things:
 * 1. PULL: On login/mount, fetches preferences from Supabase and updates local storage.
 * 2. PUSH: Listens for local storage changes and updates Supabase.
 */
export function usePreferencesSync() {
  const { user } = useUser()
  const supabase = useMemo(() => createClient(), [])
  const hasSyncedRef = useRef(false)

  // 1. PULL from Supabase on login
  useEffect(() => {
    if (!user) {
      hasSyncedRef.current = false
      return
    }

    // Only sync once per session to prevent repeated merge loops
    if (hasSyncedRef.current) return

    let isSubscribed = true

    async function loadCloudPreferences() {
      const { data, error } = await supabase
        .from('profiles')
        .select('preferences')
        .eq('id', user!.id)
        .maybeSingle()

      if (!isSubscribed) return

      if (error) {
        console.error("Failed to load cloud preferences:", error.message || error, error.details || "")
        return
      }

      // Mark as synced BEFORE applying changes to prevent re-entry
      hasSyncedRef.current = true

      if (data?.preferences) {
        const cloudPrefs = data.preferences as Record<string, unknown>
        let needsCloudUpdate = false
        const currentPrefs: Record<string, unknown> = {}

        // Collect all changes first, then apply in batch
        const pendingUpdates: Array<{ key: string; value: unknown }> = []

        Object.values(STORAGE_KEYS).forEach(key => {
          if (key === STORAGE_KEYS.SEARCH_TAGS) return

          const localValue = storage.get<unknown>(key, undefined)
          const cloudValue = cloudPrefs[key]

          let mergedValue: unknown = localValue

          const isCloudEmpty = cloudValue === undefined ||
            (Array.isArray(cloudValue) && cloudValue.length === 0) ||
            (typeof cloudValue === 'object' && cloudValue !== null && Object.keys(cloudValue).length === 0)

          const isLocalEmpty = localValue === undefined ||
            (Array.isArray(localValue) && localValue.length === 0) ||
            (typeof localValue === 'object' && localValue !== null && Object.keys(localValue).length === 0)

          if (!isCloudEmpty && isLocalEmpty) {
            mergedValue = cloudValue
          } else if (isCloudEmpty && !isLocalEmpty) {
            mergedValue = localValue
            needsCloudUpdate = true
          } else if (!isCloudEmpty && !isLocalEmpty) {
            if (Array.isArray(cloudValue) && Array.isArray(localValue)) {
              if (typeof cloudValue[0] === 'string' || typeof localValue[0] === 'string') {
                mergedValue = Array.from(new Set([...cloudValue, ...localValue]))
              } else {
                 const map = new Map()
                 for (const item of cloudValue) if (item && item.id) map.set(item.id, item)
                 for (const item of localValue) if (item && item.id && !map.has(item.id)) map.set(item.id, item)
                 mergedValue = Array.from(map.values())
                 if (Array.isArray(mergedValue) && mergedValue.length > 0 && typeof mergedValue[0] === 'object' && mergedValue[0] !== null && 'timestamp' in mergedValue[0]) {
                   (mergedValue as Array<Record<string, unknown>>).sort((a, b) => {
                     const aTime = typeof a.timestamp === 'number' ? a.timestamp : 0
                     const bTime = typeof b.timestamp === 'number' ? b.timestamp : 0
                     return bTime - aTime
                   })
                 }
              }
              if (JSON.stringify(mergedValue) !== JSON.stringify(cloudValue)) {
                needsCloudUpdate = true
              }
            } else if (typeof cloudValue === 'object' && cloudValue !== null && typeof localValue === 'object' && localValue !== null) {
              mergedValue = { ...cloudValue, ...localValue }
              if (JSON.stringify(mergedValue) !== JSON.stringify(cloudValue)) {
                needsCloudUpdate = true
              }
            } else {
              mergedValue = cloudValue
            }
          }

          if (mergedValue !== undefined) {
            currentPrefs[key] = mergedValue
          }

          if (mergedValue !== undefined && JSON.stringify(localValue) !== JSON.stringify(mergedValue)) {
            pendingUpdates.push({ key, value: mergedValue })
          }
        })

        // Apply all local storage updates in a batch with sync flag to prevent event cascades
        if (pendingUpdates.length > 0) {
          _cloudSyncInProgress = true
          try {
            for (const { key, value } of pendingUpdates) {
              storage.set(key, value)
            }
          } finally {
            // Use a small delay to let any queued microtasks settle before unblocking
            setTimeout(() => {
              _cloudSyncInProgress = false
            }, 50)
          }
        }

        if (needsCloudUpdate && isSubscribed) {
          supabase.from('profiles').update({ preferences: currentPrefs }).eq('id', user!.id).then()
        }
      } else {
        const currentPrefs: Record<string, any> = {}
        let hasData = false
        Object.values(STORAGE_KEYS).forEach(key => {
          if (key === STORAGE_KEYS.SEARCH_TAGS) return

          const val = storage.get<any>(key, undefined)
          if (val !== undefined) {
            currentPrefs[key] = val
            hasData = true
          }
        })

        if (hasData && isSubscribed) {
          supabase.from('profiles').update({ preferences: currentPrefs }).eq('id', user!.id).then()
        }
      }
    }

    loadCloudPreferences()

    return () => {
      isSubscribed = false
    }
  }, [user, supabase])

  // 2. PUSH to Supabase on local change
  useEffect(() => {
    if (!user) return

    let saveTimer: NodeJS.Timeout
    let isSubscribed = true

    const handleStorageChange = (e: Event) => {
      if (!isSubscribed) return

      // Don't push to cloud during the initial cloud sync pull
      if (_cloudSyncInProgress) return

      const customEvent = e as CustomEvent
      const key = customEvent.detail?.key
      if (!Object.values(STORAGE_KEYS).includes(key) || key === STORAGE_KEYS.SEARCH_TAGS) return

      clearTimeout(saveTimer)
      saveTimer = setTimeout(async () => {
        if (!isSubscribed) return

        const currentPrefs: Record<string, any> = {}
        Object.values(STORAGE_KEYS).forEach(k => {
          if (k === STORAGE_KEYS.SEARCH_TAGS) return

          const val = storage.get(k, undefined)
          if (val !== undefined) {
            currentPrefs[k] = val
          }
        })

        const { error } = await supabase
          .from('profiles')
          .update({ preferences: currentPrefs })
          .eq('id', user.id)

        if (error) {
          console.error("Failed to save preferences to cloud:", error.message || error, error.details || "")
        }
      }, 2000)
    }

    window.addEventListener(STORAGE_EVENT_NAME, handleStorageChange)

    return () => {
      isSubscribed = false
      window.removeEventListener(STORAGE_EVENT_NAME, handleStorageChange)
      clearTimeout(saveTimer)
    }
  }, [user, supabase])
}
