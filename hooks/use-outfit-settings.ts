import { useEffect, useMemo, useState } from "react"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import {
  DEFAULT_OUTFIT_STYLES,
  OUTFIT_STYLES,
  parseOutfitDescriptions,
  parseOutfitLibrary,
  type Outfit,
  type OutfitDetail,
  type OutfitMode,
  type OutfitSettings,
  type OutfitStyle,
} from "@/lib/outfit-swap"

const EMPTY: Outfit[] = []
const NO_DESCRIPTIONS: string[] = []
const MAX_LOAD_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1000

/**
 * Shared, process-wide loads of the static outfit files (same pattern as
 * loadDetailedBackgrounds: one request per page, cleared on failure so a
 * retry starts fresh). Until the library lands, cards keep their own clothes.
 */
const pendingLoads = new Map<string, Promise<unknown>>()

function loadOnce<T>(url: string, parse: (raw: unknown) => T): Promise<T> {
  let pending = pendingLoads.get(url) as Promise<T> | undefined
  if (!pending) {
    pending = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
        return res.json()
      })
      .then(parse)
      .catch((err) => {
        pendingLoads.delete(url)
        throw err
      })
    pendingLoads.set(url, pending)
  }
  return pending
}

/** Loads a static outfit file once `enabled` is true, retrying a failed load a few times. */
function useOutfitFile<T>(url: string, parse: (raw: unknown) => T, empty: T, enabled: boolean): T {
  const [data, setData] = useState<T>(empty)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    loadOnce(url, parse)
      .then((loaded) => {
        if (active) setData(loaded)
      })
      .catch((err) => {
        if (!active) return
        console.error(`Failed to load ${url}:`, err)
        if (attempt < MAX_LOAD_ATTEMPTS - 1) {
          retryTimer = setTimeout(() => setAttempt((prev) => prev + 1), RETRY_BASE_DELAY_MS * 2 ** attempt)
        }
      })
    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [url, parse, enabled, attempt])

  return data
}

/** The outfit library, loaded once `enabled` turns true (Random outfit, or Pack Mode's clothing). */
export function useOutfitLibrary(enabled: boolean): readonly Outfit[] {
  return useOutfitFile("/outfits.json", parseOutfitLibrary, EMPTY, enabled)
}

const isStyle =(s: string): s is OutfitStyle => (OUTFIT_STYLES as readonly string[]).includes(s)

/**
 * "Random outfit" settings, persisted and synced like the background ones.
 * `outfitSettings` is the bundle the prompt pipeline takes: undefined while
 * the mode is "keep", so cards don't re-derive for a library they don't use.
 */
export function useOutfitSettings() {
  const [outfitMode, setOutfitMode] = usePersistentState<OutfitMode>(
    "keep",
    userPreferences.getOutfitMode,
    userPreferences.setOutfitMode,
    "outfitMode",
    STORAGE_KEYS.OUTFIT_MODE
  )
  const [storedStyles, setStoredStyles] = usePersistentState<string[] | null>(
    null,
    userPreferences.getOutfitStyles,
    userPreferences.setOutfitStyles as (styles: string[] | null) => void,
    "outfitStyles",
    STORAGE_KEYS.OUTFIT_STYLES
  )
  const [outfitDetail, setOutfitDetail] = usePersistentState<OutfitDetail>(
    "simple",
    userPreferences.getOutfitDetail,
    userPreferences.setOutfitDetail,
    "outfitDetail",
    STORAGE_KEYS.OUTFIT_DETAIL
  )

  const outfitStyles = useMemo<OutfitStyle[]>(
    () => (storedStyles ? storedStyles.filter(isStyle) : DEFAULT_OUTFIT_STYLES),
    [storedStyles]
  )
  const setOutfitStyles = (styles: OutfitStyle[]) => setStoredStyles(styles)

  const isRandom = outfitMode === "random"
  const library = useOutfitLibrary(isRandom)
  // The sentences only matter to the natural-language formats, so they load
  // after the tags and cards fall back to the tag-built outfit until then.
  const descriptions = useOutfitFile("/outfit-descriptions.json", parseOutfitDescriptions, NO_DESCRIPTIONS, isRandom && library.length > 0)

  const outfitSettings = useMemo<OutfitSettings | undefined>(
    () =>
      isRandom && library.length > 0
        ? { mode: outfitMode, styles: outfitStyles, detail: outfitDetail, library, ...(descriptions.length ? { descriptions } : {}) }
        : undefined,
    [isRandom, outfitMode, outfitStyles, outfitDetail, library, descriptions]
  )

  const outfitCount = useMemo(
    () => (library.length > 0 ? library.filter((o) => outfitStyles.includes(o.style)).length : null),
    [library, outfitStyles]
  )

  return {
    outfitCount,
    outfitMode,
    setOutfitMode,
    outfitStyles,
    setOutfitStyles,
    outfitDetail,
    setOutfitDetail,
    outfitSettings,
  }
}
