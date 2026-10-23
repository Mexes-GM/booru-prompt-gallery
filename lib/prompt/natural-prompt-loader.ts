/**
 * On-demand resources for the natural-language prompt formats, shared by every
 * card through small external stores (read with useSyncExternalStore):
 *
 * - The converter code and the phrase dictionary (public/natural-prompt-phrases.json)
 *   load together, once per page, the first time a natural format is used. If
 *   only the dictionary fails, cards still convert with the built-in wording.
 * - Tags missing from the static taxonomy snapshot (tags-core.json) are looked up
 *   in batches; until an answer arrives, or if it never does, the snapshot is used.
 */
import { fetchTagOverridesForNames } from "@/lib/supabase/client-queries"
import type { PhraseDictionary } from "@/lib/prompt/natural"
import type { FormattedPrompt, NaturalPromptSource } from "@/lib/prompt/natural-format"
import type { NaturalPromptFormat } from "@/lib/prompt/prompt-format"

type NaturalFormatModule = typeof import("@/lib/prompt/natural-format")

export interface NaturalPromptResources {
  /** "loading" until the converter is ready; "error" only if the converter itself failed. */
  status: "idle" | "loading" | "ready" | "error"
  engine: NaturalFormatModule | null
  phrases: PhraseDictionary
  /** The converter works but without the phrase dictionary (simpler wording). */
  phrasesFailed: boolean
}

const PHRASES_URL = "/natural-prompt-phrases.json"
const NO_PHRASES: PhraseDictionary = {}
const IDLE: NaturalPromptResources = { status: "idle", engine: null, phrases: NO_PHRASES, phrasesFailed: false }

let resources = IDLE
let pending: Promise<NaturalPromptResources> | null = null
const resourceListeners = new Set<() => void>()

function setResources(next: NaturalPromptResources) {
  resources = next
  resourceListeners.forEach((listener) => listener())
}

async function fetchPhrases(): Promise<PhraseDictionary> {
  const res = await fetch(PHRASES_URL)
  if (!res.ok) throw new Error(`Phrase dictionary request failed (${res.status})`)
  return res.json()
}

/** Loads whatever is missing: the converter, the dictionary, or both. */
function start(): Promise<NaturalPromptResources> {
  const hasPhrases = resources.status === "ready" && !resources.phrasesFailed
  const tasks = [
    resources.engine ? Promise.resolve(resources.engine) : import("@/lib/prompt/natural-format"),
    hasPhrases ? Promise.resolve(resources.phrases) : fetchPhrases(),
  ] as const
  setResources({ ...resources, status: resources.engine ? "ready" : "loading", phrasesFailed: false })
  pending = Promise.allSettled(tasks).then(([engine, phrases]) => {
    pending = null
    if (engine.status === "rejected") {
      setResources({ ...IDLE, status: "error" })
      throw engine.reason
    }
    setResources({
      status: "ready",
      engine: engine.value,
      phrases: phrases.status === "fulfilled" ? phrases.value : NO_PHRASES,
      phrasesFailed: phrases.status === "rejected",
    })
    return resources
  })
  return pending
}

/**
 * Starts loading once and resolves when the converter is usable. Safe to call
 * from every card: after a failure it does not retry on its own (see
 * retryNaturalPrompt), so scrolling never repeats a failing download.
 */
export function loadNaturalPrompt(): Promise<NaturalPromptResources> {
  if (pending) return pending
  if (resources.status === "ready") return Promise.resolve(resources)
  if (resources.status === "error") return Promise.reject(new Error("The prompt converter could not be loaded"))
  return start()
}

/** Tries the failed parts again (the converter, the dictionary, or both). */
export function retryNaturalPrompt(): Promise<NaturalPromptResources> {
  return pending ?? start()
}

/**
 * One conversion outside the card's own format ("Copy as"). Loads the converter
 * first if needed, and tries again if an earlier load failed.
 */
export async function convertPromptOnce(
  format: NaturalPromptFormat,
  source: NaturalPromptSource,
  overrides: Record<string, string>,
  fullDetail: boolean,
): Promise<FormattedPrompt> {
  const { engine, phrases } = resources.status === "error" ? await retryNaturalPrompt() : await loadNaturalPrompt()
  if (!engine) throw new Error("The prompt converter could not be loaded")
  const all = withTagLookups(overrides, lookedUp)
  return engine.formatPrompt(format, engine.naturalPromptInput(source, all), all, { phrases, fullDetail })
}

/** Warm-up on intent (opening the format menu): starts the download, ignores errors. */
export function preloadNaturalPrompt(): void {
  loadNaturalPrompt().catch(() => {})
}

export function subscribeNaturalPrompt(listener: () => void): () => void {
  resourceListeners.add(listener)
  return () => resourceListeners.delete(listener)
}

export const getNaturalPromptResources = () => resources
export const getServerNaturalPromptResources = () => IDLE

// --- Tag classification lookups -------------------------------------------

/** How long cards that mount together get to add their tags to one request. */
const LOOKUP_DELAY_MS = 250

/** Tags already asked for (answered or not), so each one is requested once per page. */
const requested = new Set<string>()
const queued = new Set<string>()
let lookupTimer: ReturnType<typeof setTimeout> | null = null
const NO_LOOKUPS: Record<string, string> = {}
let lookedUp = NO_LOOKUPS
const lookupListeners = new Set<() => void>()

async function flushLookups() {
  lookupTimer = null
  const names = [...queued]
  queued.clear()
  try {
    const found = await fetchTagOverridesForNames(names)
    if (Object.keys(found).length === 0) return
    lookedUp = { ...lookedUp, ...found }
    lookupListeners.forEach((listener) => listener())
  } catch {
    // The snapshot classification stays in use for these tags.
  }
}

/** Queues tags (lowercase, spaces) for classification; repeated tags are ignored. */
export function requestTagLookups(tags: string[]): void {
  for (const tag of tags) {
    if (requested.has(tag)) continue
    requested.add(tag)
    queued.add(tag)
  }
  if (queued.size > 0 && !lookupTimer) lookupTimer = setTimeout(flushLookups, LOOKUP_DELAY_MS)
}

export function subscribeTagLookups(listener: () => void): () => void {
  lookupListeners.add(listener)
  return () => lookupListeners.delete(listener)
}

export const getTagLookups = () => lookedUp

let merged: { base: Record<string, string>; extra: Record<string, string>; result: Record<string, string> } | null = null

/** The card's overrides plus every looked-up tag, rebuilt only when either side changes. */
export function withTagLookups(base: Record<string, string>, extra: Record<string, string>): Record<string, string> {
  if (extra === NO_LOOKUPS) return base
  if (merged && merged.base === base && merged.extra === extra) return merged.result
  merged = { base, extra, result: { ...extra, ...base } }
  return merged.result
}
