import { useEffect, useMemo, useRef } from "react"
import { useUser } from "@/hooks/use-user"
import { storage, STORAGE_KEYS, STORAGE_EVENT_NAME } from "@/lib/storage"
import { createClient } from "@/lib/supabase/client"
import { reportMessage } from "@/lib/error-reporting"

/** When true, suppresses PUSH-to-cloud during the initial PULL. */
let _cloudSyncInProgress = false

/**
 * Keys that must never be synced through the generic cloud-preferences blob.
 * - SEARCH_TAGS: transient per-session query state, not a preference.
 * - SAVED_ARTISTS: has its own dedicated Supabase table + migration flow
 *   (use-saved-artists.ts); double-syncing it through the generic blob makes
 *   deleted artists resurrect on next login.
 * - HISTORY: merged by id + reordered by the generic sync, so items deleted
 *   on one device reappear from another device's blob. It also embeds
 *   full BooruPost snapshots, which bloats every sync payload.
 * - PACK_LEARNING_MODEL: documented in lib/storage.ts as strictly local to
 *   this browser, never synced or shared.
 */
const EXCLUDED_FROM_CLOUD_SYNC: ReadonlySet<string> = new Set([
  STORAGE_KEYS.SEARCH_TAGS,
  STORAGE_KEYS.SAVED_ARTISTS,
  STORAGE_KEYS.HISTORY,
  STORAGE_KEYS.PACK_LEARNING_MODEL,
])

const SYNCED_KEYS: readonly string[] = Object.values(STORAGE_KEYS).filter(
  (key) => !EXCLUDED_FROM_CLOUD_SYNC.has(key)
)

/**
 * Which account the synced keys in this browser belong to. Written after
 * every successful PULL; deliberately outside STORAGE_KEYS so it never syncs.
 *  - absent        → local values are this device's own (anonymous use): the
 *                    first sign-in merges them into the account.
 *  - === user.id   → local values mirror this account's cloud blob: cloud wins,
 *                    so a value removed on another device stays removed.
 *  - !== user.id   → another account's leftovers: discarded, never merged.
 */
const PREFS_OWNER_KEY = "prefs-cloud-owner"

/**
 * Upper bound for the serialized blob. Mirrors the CHECK constraint on
 * profiles.preferences (supabase/migrations/20260928000000_user_data_hardening.sql)
 * so an oversized write is skipped here instead of failing server-side.
 */
const MAX_PREFERENCES_BYTES = 128 * 1024

function readOwner(): string | null {
  try {
    return localStorage.getItem(PREFS_OWNER_KEY)
  } catch {
    return null
  }
}

function writeOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(PREFS_OWNER_KEY, userId)
    else localStorage.removeItem(PREFS_OWNER_KEY)
  } catch {
    // Storage unavailable — the next PULL just treats local values as unowned.
  }
}

/**
 * Remove every cloud-synced preference from this browser. Called on explicit
 * sign-out so the next person on a shared device neither sees the previous
 * account's settings nor gets them merged into their own account. The cloud
 * copy is untouched and comes back on the next sign-in.
 */
export function clearCloudSyncedPreferences() {
  _cloudSyncInProgress = true
  try {
    for (const key of SYNCED_KEYS) storage.remove(key)
    writeOwner(null)
  } finally {
    _cloudSyncInProgress = false
  }
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && value !== null && Object.keys(value).length === 0)
}

/**
 * First-sign-in merge on a device that has its own anonymous values: union
 * arrays / objects so nothing the user set up before signing in is lost.
 */
function mergeFirstSync(cloudValue: unknown, localValue: unknown): unknown {
  const isCloudEmpty = isEmptyValue(cloudValue)
  const isLocalEmpty = isEmptyValue(localValue)

  if (!isCloudEmpty && isLocalEmpty) return cloudValue
  if (isCloudEmpty) return localValue
  if (Array.isArray(cloudValue) && Array.isArray(localValue)) {
    if (typeof cloudValue[0] === "string" || typeof localValue[0] === "string") {
      return Array.from(new Set([...cloudValue, ...localValue]))
    }
    const map = new Map()
    for (const item of cloudValue) if (item && item.id) map.set(item.id, item)
    for (const item of localValue) if (item && item.id && !map.has(item.id)) map.set(item.id, item)
    const merged = Array.from(map.values()) as Array<Record<string, unknown>>
    if (merged.length > 0 && typeof merged[0] === "object" && merged[0] !== null && "timestamp" in merged[0]) {
      merged.sort((a, b) => {
        const aTime = typeof a.timestamp === "number" ? a.timestamp : 0
        const bTime = typeof b.timestamp === "number" ? b.timestamp : 0
        return bTime - aTime
      })
    }
    return merged
  }
  if (typeof cloudValue === "object" && cloudValue !== null && typeof localValue === "object" && localValue !== null) {
    return { ...cloudValue, ...localValue }
  }
  return cloudValue
}

function collectLocalPreferences(): Record<string, unknown> {
  const prefs: Record<string, unknown> = {}
  for (const key of SYNCED_KEYS) {
    const val = storage.get<unknown>(key, undefined)
    if (val !== undefined) prefs[key] = val
  }
  return prefs
}

function fitsSizeLimit(prefs: Record<string, unknown>): boolean {
  const bytes = new TextEncoder().encode(JSON.stringify(prefs)).length
  if (bytes <= MAX_PREFERENCES_BYTES) return true
  reportMessage(`Cloud preferences too large to sync (${bytes} bytes)`, {
    level: "warning",
    tags: { context: "use-preferences-sync", action: "size_limit" },
  })
  return false
}

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
    let cloudSyncFlagTimer: ReturnType<typeof setTimeout> | undefined

    async function loadCloudPreferences() {
      const { data, error } = await supabase
        .from("profiles")
        .select("preferences")
        .eq("id", user!.id)
        .maybeSingle()

      if (!isSubscribed) return

      if (error) {
        console.error("Failed to load cloud preferences:", error.message || error, error.details || "")
        return
      }

      // Mark as synced BEFORE applying changes to prevent re-entry
      hasSyncedRef.current = true

      const owner = readOwner()
      const cloudPrefs = (data?.preferences ?? {}) as Record<string, unknown>
      const pendingUpdates: Array<{ key: string; value: unknown }> = []
      const pendingRemovals: string[] = []
      const nextCloud: Record<string, unknown> = {}
      let needsCloudUpdate = false

      for (const key of SYNCED_KEYS) {
        const localValue = storage.get<unknown>(key, undefined)
        const cloudValue = cloudPrefs[key]
        let value: unknown

        if (owner && owner !== user!.id) {
          // Another account's leftovers: never let them reach this account.
          value = cloudValue
          if (value === undefined && localValue !== undefined) pendingRemovals.push(key)
        } else if (owner === user!.id) {
          // Returning device: cloud is authoritative. Only keys the cloud has
          // never seen (e.g. a preference added in a newer app version) are
          // seeded from local.
          value = cloudValue !== undefined ? cloudValue : localValue
          if (cloudValue === undefined && localValue !== undefined) needsCloudUpdate = true
        } else {
          value = mergeFirstSync(cloudValue, localValue)
          if (value !== undefined && JSON.stringify(value) !== JSON.stringify(cloudValue)) needsCloudUpdate = true
        }

        if (value !== undefined) {
          nextCloud[key] = value
          if (JSON.stringify(localValue) !== JSON.stringify(value)) pendingUpdates.push({ key, value })
        }
      }

      // Apply all local storage updates in a batch with sync flag to prevent event cascades
      if (pendingUpdates.length > 0 || pendingRemovals.length > 0) {
        _cloudSyncInProgress = true
        try {
          for (const { key, value } of pendingUpdates) storage.set(key, value)
          for (const key of pendingRemovals) storage.remove(key)
        } finally {
          // Use a small delay to let any queued microtasks settle before unblocking
          cloudSyncFlagTimer = setTimeout(() => {
            _cloudSyncInProgress = false
          }, 50)
        }
      }

      writeOwner(user!.id)

      if (needsCloudUpdate && isSubscribed && fitsSizeLimit(nextCloud)) {
        supabase.from("profiles").update({ preferences: nextCloud }).eq("id", user!.id).then()
      }
    }

    loadCloudPreferences()

    return () => {
      isSubscribed = false
      if (cloudSyncFlagTimer) clearTimeout(cloudSyncFlagTimer)
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
      if (!SYNCED_KEYS.includes(key)) return

      clearTimeout(saveTimer)
      saveTimer = setTimeout(async () => {
        if (!isSubscribed) return
        // Local values belong to another account until the PULL has run.
        if (readOwner() !== user.id) return

        const currentPrefs = collectLocalPreferences()
        if (!fitsSizeLimit(currentPrefs)) return

        const { error } = await supabase
          .from("profiles")
          .update({ preferences: currentPrefs })
          .eq("id", user.id)

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
