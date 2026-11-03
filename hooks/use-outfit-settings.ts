import { useEffect, useMemo, useState } from "react"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { userPreferences, STORAGE_KEYS } from "@/lib/storage"
import {
  DEFAULT_OUTFIT_STYLES,
  OUTFIT_STYLES,
  parseOutfitLibrary,
  type Outfit,
  type OutfitDetail,
  type OutfitMode,
  type OutfitSettings,
  type OutfitStyle,
} from "@/lib/outfit-swap"

const EMPTY: readonly Outfit[] = []
const MAX_LOAD_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1000

/**
 * Shared, process-wide load of /outfits.json (same pattern as
 * loadDetailedBackgrounds: one request per page, cleared on failure so a
 * retry starts fresh). Until it lands, pickOutfit has an empty library and
 * cards simply keep their own clothes.
 */
let pendingLoad: Promise<Outfit[]> | null = null

function loadOutfitLibrary(): Promise<Outfit[]> {
  if (!pendingLoad) {
    pendingLoad = fetch("/outfits.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching outfits.json`)
        return res.json()
      })
      .then(parseOutfitLibrary)
      .catch((err) => {
        pendingLoad = null
        throw err
      })
  }
  return pendingLoad
}

function useOutfitLibrary(enabled: boolean): readonly Outfit[] {
  const [library, setLibrary] = useState<readonly Outfit[]>(EMPTY)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    loadOutfitLibrary()
      .then((data) => {
        if (active) setLibrary(data)
      })
      .catch((err) => {
        if (!active) return
        console.error("Failed to load the outfit library:", err)
        if (attempt < MAX_LOAD_ATTEMPTS - 1) {
          retryTimer = setTimeout(() => setAttempt((prev) => prev + 1), RETRY_BASE_DELAY_MS * 2 ** attempt)
        }
      })
    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [enabled, attempt])

  return library
}

const isStyle = (s: string): s is OutfitStyle => (OUTFIT_STYLES as readonly string[]).includes(s)

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

  const library = useOutfitLibrary(outfitMode === "random")

  const outfitSettings = useMemo<OutfitSettings | undefined>(
    () =>
      outfitMode === "random" && library.length > 0
        ? { mode: outfitMode, styles: outfitStyles, detail: outfitDetail, library }
        : undefined,
    [outfitMode, outfitStyles, outfitDetail, library]
  )

  return {
    outfitMode,
    setOutfitMode,
    outfitStyles,
    setOutfitStyles,
    outfitDetail,
    setOutfitDetail,
    outfitSettings,
  }
}
