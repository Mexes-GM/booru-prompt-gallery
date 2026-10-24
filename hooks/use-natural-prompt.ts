import { useEffect, useMemo, useSyncExternalStore } from "react"
import { STORAGE_EVENT_NAME, STORAGE_KEYS, userPreferences } from "@/lib/storage"
import { onSettingsChange } from "@/lib/settings-bridge"
import type { PromptFormat } from "@/lib/prompt/prompt-format"
import type { FormatPromptOptions, FormattedPrompt, NaturalPromptSource } from "@/lib/prompt/natural-format"
import type { NaturalPromptInput } from "@/lib/prompt/natural"
import {
  getCharacterTraits,
  getNaturalPromptResources,
  getNoCharacterTraits,
  getNoProviderSlots,
  getProviderSlots,
  getServerNaturalPromptResources,
  getTagLookups,
  loadCharacterTraits,
  loadNaturalPrompt,
  requestProviderSlots,
  requestTagLookups,
  subscribeCharacterTraits,
  subscribeNaturalPrompt,
  subscribeProviderSlots,
  subscribeTagLookups,
  withBooruSlots,
  withTagLookups,
  type NaturalPromptResources,
} from "@/lib/prompt/natural-prompt-loader"
import { SLOT_PROVIDERS, providerSlotNames } from "@/lib/prompt/provider-slots"

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
const NO_NAMES: string[] = []
const NO_SCENE_OPTIONS: FormatPromptOptions = {}

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

type Engine = NonNullable<NaturalPromptResources["engine"]>

/**
 * The card's overrides plus what was looked up for it: Danbooru classifications
 * for unplaced tags and, on Rule34 cards, Rule34's own slots (which Rule34
 * spells its own way), under the Danbooru taxonomy.
 */
function useCardOverrides(active: boolean, provider: string | undefined, overrides: Record<string, string>) {
  const lookups = useSyncExternalStore(active ? subscribeTagLookups : noSubscription, active ? getTagLookups : getNoLookups, getNoLookups)
  const slotProvider = active && provider && SLOT_PROVIDERS.has(provider) ? provider : null
  const slotsByProvider = useSyncExternalStore(
    slotProvider ? subscribeProviderSlots : noSubscription,
    slotProvider ? getProviderSlots : getNoProviderSlots,
    getNoProviderSlots,
  )
  const slots = slotProvider ? slotsByProvider[slotProvider] : undefined
  return { slotProvider, allOverrides: withBooruSlots(withTagLookups(overrides, lookups), slots) }
}

/** Asks, once per tag, for what the overrides cannot place; the card re-renders when answers arrive. */
function useTagRequests(engine: Engine | null, input: NaturalPromptInput | null, allOverrides: Record<string, string>, slotProvider: string | null) {
  useEffect(() => {
    if (!input || !engine) return
    const missing = engine.unclassifiedTags(input, allOverrides)
    if (missing.length > 0) requestTagLookups(missing)
  }, [input, engine, allOverrides])

  useEffect(() => {
    if (!input || !slotProvider) return
    const names = providerSlotNames(input.general, allOverrides)
    if (names.length > 0) requestProviderSlots(slotProvider, names).catch(() => {})
  }, [input, slotProvider, allOverrides])
}

/**
 * Cards with two or more characters load those characters' trait profiles,
 * so each one's hair, eyes and outfit are described as theirs.
 */
function useCardTraits(engine: Engine | null, input: NaturalPromptInput | null): FormatPromptOptions {
  const names = useMemo(() => (input && engine ? engine.traitNames(input) : NO_NAMES), [input, engine])
  const wantsTraits = names.length > 0
  const traitData = useSyncExternalStore(
    wantsTraits ? subscribeCharacterTraits : noSubscription,
    wantsTraits ? getCharacterTraits : getNoCharacterTraits,
    getNoCharacterTraits,
  )
  useEffect(() => {
    if (wantsTraits) loadCharacterTraits(names).catch(() => {})
  }, [wantsTraits, names])
  return useMemo(
    () => (engine && wantsTraits
      ? { traits: engine.cardTraits(names, traitData.aliases, traitData.profiles), characterAliases: traitData.aliases }
      : NO_SCENE_OPTIONS),
    [engine, wantsTraits, names, traitData],
  )
}

/** A card's prompt in the chosen natural-language format. */
export function useNaturalPrompt({ enabled, format, fullDetail, source, overrides, withAlternate = false }: UseNaturalPromptOptions): NaturalPromptView {
  const active = enabled && format !== "tags"
  const resources = useNaturalPromptResources(active)
  const { prompt, characters, copyrights, rating, provider, handWritten } = source
  const { slotProvider, allOverrides } = useCardOverrides(active, provider, overrides)
  const { engine, phrases } = resources

  const input = useMemo(
    () => (active && engine && prompt
      ? engine.naturalPromptInput({ prompt, characters, copyrights, rating, provider, handWritten }, allOverrides)
      : null),
    [active, engine, prompt, characters, copyrights, rating, provider, handWritten, allOverrides],
  )
  useTagRequests(engine, input, allOverrides, slotProvider)
  const sceneOptions = useCardTraits(engine, input)

  const naturalFormat = format === "tags" ? null : format
  const formatted = useMemo(
    () => (input && engine && naturalFormat ? engine.formatPrompt(naturalFormat, input, allOverrides, { phrases, fullDetail, ...sceneOptions }) : null),
    [input, engine, naturalFormat, allOverrides, phrases, fullDetail, sceneOptions],
  )
  const alternate = useMemo(
    () => (withAlternate && input && engine && naturalFormat
      ? engine.formatPrompt(naturalFormat, input, allOverrides, { phrases, fullDetail: !fullDetail, ...sceneOptions })
      : null),
    [withAlternate, input, engine, naturalFormat, allOverrides, phrases, fullDetail, sceneOptions],
  )

  if (!active) return { status: "off", prompt: null, alternate: null }
  if (resources.status === "error") return { status: "error", prompt: null, alternate: null }
  if (!formatted) return { status: prompt ? "loading" : "ready", prompt: null, alternate: null }
  return { status: "ready", prompt: formatted, alternate }
}
