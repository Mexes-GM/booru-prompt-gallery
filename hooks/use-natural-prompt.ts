import { useEffect, useMemo, useSyncExternalStore } from "react"
import { STORAGE_EVENT_NAME, STORAGE_KEYS, userPreferences } from "@/lib/storage"
import { onSettingsChange } from "@/lib/settings-bridge"
import type { PromptFormat } from "@/lib/prompt/prompt-format"
import type { FormattedPrompt, NaturalPromptSource } from "@/lib/prompt/natural-format"
import {
  getNaturalPromptResources,
  getServerNaturalPromptResources,
  getTagLookups,
  loadNaturalPrompt,
  requestTagLookups,
  subscribeNaturalPrompt,
  subscribeTagLookups,
  withTagLookups,
  type NaturalPromptResources,
} from "@/lib/prompt/natural-prompt-loader"

const FORMAT_KEYS: ReadonlySet<string> = new Set([STORAGE_KEYS.PROMPT_FORMAT, STORAGE_KEYS.PROMPT_FULL_DETAIL])

/** Same-tab writes, other tabs, and the extension's settings bridge. */
function subscribeFormatSettings(onChange: () => void): () => void {
  const onLocal = (e: Event) => {
    if (FORMAT_KEYS.has((e as CustomEvent<{ key?: string }>).detail?.key ?? "")) onChange()
  }
  const onOtherTab = (e: StorageEvent) => {
    if (e.key && FORMAT_KEYS.has(e.key)) onChange()
  }
  window.addEventListener(STORAGE_EVENT_NAME, onLocal)
  window.addEventListener("storage", onOtherTab)
  const offBridge = onSettingsChange((key) => {
    if (FORMAT_KEYS.has(key)) onChange()
  })
  return () => {
    window.removeEventListener(STORAGE_EVENT_NAME, onLocal)
    window.removeEventListener("storage", onOtherTab)
    offBridge()
  }
}

const serverFormat = (): PromptFormat => "tags"
const serverFullDetail = () => false

/** The remembered prompt format and length, shared by every card and the settings. */
export function usePromptFormat() {
  const format = useSyncExternalStore(subscribeFormatSettings, userPreferences.getPromptFormat, serverFormat)
  const fullDetail = useSyncExternalStore(subscribeFormatSettings, userPreferences.getPromptFullDetail, serverFullDetail)
  return { format, fullDetail, setFormat: userPreferences.setPromptFormat, setFullDetail: userPreferences.setPromptFullDetail }
}

const noSubscription = () => () => {}
const NO_LOOKUPS: Record<string, string> = {}
const getNoLookups = () => NO_LOOKUPS

/**
 * Converter state. Starts the download when `enabled`; while disabled the
 * caller does not even subscribe, so cards in the tag format never re-render
 * because of it.
 */
export function useNaturalPromptResources(enabled: boolean): NaturalPromptResources {
  const resources = useSyncExternalStore(
    enabled ? subscribeNaturalPrompt : noSubscription,
    enabled ? getNaturalPromptResources : getServerNaturalPromptResources,
    getServerNaturalPromptResources,
  )
  useEffect(() => {
    if (enabled) loadNaturalPrompt().catch(() => {})
  }, [enabled])
  return resources
}

export interface NaturalPromptView {
  /** "off" for the tag format; "error" when the converter could not load (show tags instead). */
  status: "off" | "loading" | "ready" | "error"
  prompt: FormattedPrompt | null
  /** The other length (full when short is shown, and the reverse); only when asked for. */
  alternate: FormattedPrompt | null
}

interface UseNaturalPromptOptions {
  /** False keeps the card on tags (Merge, Pack and AI modes work on tags). */
  enabled: boolean
  format: PromptFormat
  fullDetail: boolean
  source: NaturalPromptSource
  overrides: Record<string, string>
  /** Also render the other length, for the expanded card's details line. */
  withAlternate?: boolean
}

/** A card's prompt in the chosen natural-language format. */
export function useNaturalPrompt({ enabled, format, fullDetail, source, overrides, withAlternate = false }: UseNaturalPromptOptions): NaturalPromptView {
  const active = enabled && format !== "tags"
  const resources = useNaturalPromptResources(active)
  const lookups = useSyncExternalStore(active ? subscribeTagLookups : noSubscription, active ? getTagLookups : getNoLookups, getNoLookups)
  const allOverrides = withTagLookups(overrides, lookups)
  const { engine, phrases } = resources
  const { prompt, characters, copyrights, rating, provider, handWritten } = source

  const input = useMemo(
    () => (active && engine && prompt
      ? engine.naturalPromptInput({ prompt, characters, copyrights, rating, provider, handWritten }, allOverrides)
      : null),
    [active, engine, prompt, characters, copyrights, rating, provider, handWritten, allOverrides],
  )

  // Tags the static snapshot does not know get looked up once; the card re-renders when they arrive.
  useEffect(() => {
    if (!input || !engine) return
    const missing = engine.unclassifiedTags(input, allOverrides)
    if (missing.length > 0) requestTagLookups(missing)
  }, [input, engine, allOverrides])

  const naturalFormat = format === "tags" ? null : format
  const formatted = useMemo(
    () => (input && engine && naturalFormat ? engine.formatPrompt(naturalFormat, input, allOverrides, { phrases, fullDetail }) : null),
    [input, engine, naturalFormat, allOverrides, phrases, fullDetail],
  )
  const alternate = useMemo(
    () => (withAlternate && input && engine && naturalFormat ? engine.formatPrompt(naturalFormat, input, allOverrides, { phrases, fullDetail: !fullDetail }) : null),
    [withAlternate, input, engine, naturalFormat, allOverrides, phrases, fullDetail],
  )

  if (!active) return { status: "off", prompt: null, alternate: null }
  if (resources.status === "error") return { status: "error", prompt: null, alternate: null }
  if (!formatted) return { status: prompt ? "loading" : "ready", prompt: null, alternate: null }
  return { status: "ready", prompt: formatted, alternate }
}
