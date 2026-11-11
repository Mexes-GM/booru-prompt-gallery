import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BooruPost } from '@/lib/booru/types'
import type { PackPrompt } from '@/lib/pack/pack-generator'
import { normalizeTagForPack } from '@/lib/pack/pack-generator'
import { cleanSyntheticPrompt, type BulkSendCleanOptions } from '@/lib/pack/bulk-send'
import { createPermanence, type PermanenceData } from '@/lib/pack/scene/permanence'
import { buildScenePool, type PackPeople, type ScenePool } from '@/lib/pack/scene/scene-pool'
import {
  defaultComposition,
  enabledSceneCount,
  generateScenePack,
  postsForRating,
  rerollScenePrompt,
  splitSceneIdentity,
  subjectOfTags,
  tagKindsFromPosts,
  type LibraryOutfit,
  type ScenePackArgs,
  type ScenePackSettings,
} from '@/lib/pack/scene-pack'
import { packNaturalSource } from '@/lib/pack/pack-natural'
import type { NaturalPromptSource } from '@/lib/prompt/natural-format'
import type { PackRatingMode } from '@/hooks/use-pack-seed-search'
import { resolutionForAspect } from '@/lib/pack/prompt-resolution'
import { clampMaxLongSide } from '@/lib/extension/generation-resolution'
import { userPreferences } from '@/lib/storage'
import { useOutfitDescriptions, useOutfitLibrary } from '@/hooks/use-outfit-settings'
import { usePromptFormat } from '@/hooks/use-natural-prompt'
import { ADULT_OUTFIT_STYLES, outfitPackDraw, type Outfit, type OutfitDetail, type OutfitStyle } from '@/lib/outfit-swap'

/** Library outfits drawn for one pack. */
const LIBRARY_DRAW_SIZE = 60
const EMPTY_POSTS: BooruPost[] = []
const EMPTY_PROMPTS: PackPrompt[] = []
const NO_COMPOSITIONS: PackSceneComposition[] = []

export interface UsePackScenesArgs {
  /** Pack Mode is on, with a base, on the scenes engine. Nothing is loaded or built otherwise. */
  enabled: boolean
  /** The source's posts (the same pool the classic engine samples). */
  posts: BooruPost[]
  /** tag -> "category:subcategory", including the slots fetched for this pool. */
  overrides: Record<string, string>
  /** The character's identity as kept by the user (usePackMode's sceneIdentityTags). */
  identityTags: string[]
  alwaysAdd: string[]
  /** Character tags the cleaner sees (Include characters). */
  characterTags: string[]
  contentRating: PackRatingMode | null
  settings: ScenePackSettings
  promptCount: number
  cleanOptions: Pick<
    BulkSendCleanOptions,
    'excludeInput' | 'addInput' | 'findInput' | 'replaceInput' | 'includeCharacters' | 'optimizeTags' | 'smartTagExclusion' | 'experimentalPromptRules'
  >
  globalWeights: Record<string, number>
  isGlobalWeightsEnabled: boolean
  /** Styles and detail of the Outfit option, for library clothing. */
  outfitOptions: { styles: readonly OutfitStyle[]; detail: OutfitDetail }
  /** What the natural-language formats need besides the prompt. */
  natural: { provider?: string; character: string | null; copyrights?: string; baseRating?: string }
  /** Changes with the base: the generated prompts belong to it. */
  baseKey: string
  /** Changes with the source: switched-off situations and the picked composition belong to it. */
  sourceKey: string
}

export interface PackSceneComposition {
  people: PackPeople
  scenes: number
}

export interface UsePackScenesResult {
  /** The permanence data has loaded, so scenes can be built. */
  ready: boolean
  /** Scenes of the pool for the chosen composition, or null until it can be built. */
  pool: ScenePool | null
  /** The identity the scenes are transplanted onto, and the base tags each scene sets instead. */
  identity: { kept: string[]; fromScene: string[] }
  compositions: PackSceneComposition[]
  /** Composition in use (the pick, or the default). */
  people: PackPeople | null
  setPeople: (people: PackPeople) => void
  disabledSituations: string[]
  toggleSituation: (id: string) => void
  enableAllSituations: () => void
  /** Scenes in the enabled situations. */
  enabledScenes: number
  /** Posts of the source left out for having another content rating. */
  otherRatingPosts: number
  /** Library outfits in the chosen styles; null until the library loads (or when it isn't used). */
  libraryOutfitCount: number | null
  prompts: PackPrompt[]
  /** Prompts the last Generate could not make. */
  shortBy: number
  generate: () => void
  /** Replaces one prompt with a scene the pack doesn't use yet. False when there is none. */
  reroll: (index: number) => boolean
  naturalSourceOf: (prompt: PackPrompt) => NaturalPromptSource
}

function sizePrefs() {
  try {
    return {
      maxLongSide: clampMaxLongSide(userPreferences.getMatchResolutionMaxLongSide()),
      strictCap: userPreferences.getMatchResolutionStrictCap(),
    }
  } catch {
    return { maxLongSide: 1536, strictCap: false }
  }
}

const peopleKeyOf = (people: PackPeople | null | undefined) => (people ? `${people.girls}/${people.boys}` : '')

/**
 * Pack Mode's scenes engine: each prompt is a real post's scene transplanted
 * onto the pack's character (lib/pack/scene/, lib/pack/scene-pack.ts). Owns
 * the scene pool, the user's picks over it (composition, situations) and the
 * generated prompts, which have the same shape as the classic engine's so the
 * results list, Copy all and the prompt formats work unchanged.
 *
 * The pool is rebuilt only when its inputs change (posts, slots, rating,
 * composition, the character's gender), never on render; prompts are built
 * only on Generate.
 */
export function usePackScenes(args: UsePackScenesArgs): UsePackScenesResult {
  const {
    enabled, posts, overrides, identityTags, alwaysAdd, characterTags, contentRating, settings, promptCount,
    cleanOptions, globalWeights, isGlobalWeightsEnabled, outfitOptions, natural, baseKey, sourceKey,
  } = args

  // Permanence data (which tags are who the character is), fetched once while enabled.
  const [permanenceData, setPermanenceData] = useState<PermanenceData | null>(null)
  const loadedRef = useRef(false)
  useEffect(() => {
    if (!enabled || loadedRef.current) return
    loadedRef.current = true
    const controller = new AbortController()
    fetch('/tag-permanence.json', { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (!data || typeof data !== 'object' || !Array.isArray(data.state)) {
          throw new Error('Invalid tag-permanence.json format')
        }
        setPermanenceData(data as PermanenceData)
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          loadedRef.current = false // allow retry after a failure
          console.error('Failed to load tag permanence:', err)
        }
      })
    return () => controller.abort()
  }, [enabled])

  const permanence = useMemo(
    () => (permanenceData ? createPermanence(permanenceData, overrides) : null),
    [permanenceData, overrides]
  )

  // Per-source picks; per-base prompts. Reset during render when their key changes.
  const [pickedPeople, setPickedPeople] = useState<PackPeople | null>(null)
  const [disabledSituations, setDisabledSituations] = useState<string[]>([])
  const [prompts, setPrompts] = useState<PackPrompt[]>(EMPTY_PROMPTS)
  const [shortBy, setShortBy] = useState(0)
  const [prevSourceKey, setPrevSourceKey] = useState(sourceKey)
  if (sourceKey !== prevSourceKey) {
    setPrevSourceKey(sourceKey)
    setPickedPeople(null)
    setDisabledSituations([])
  }
  const [prevBaseKey, setPrevBaseKey] = useState(baseKey)
  if (baseKey !== prevBaseKey) {
    setPrevBaseKey(baseKey)
    setPrompts(EMPTY_PROMPTS)
    setShortBy(0)
  }

  const subject = useMemo(() => subjectOfTags(identityTags), [identityTags])
  const identity = useMemo(() => {
    // Until the permanence data loads, only the people counts are known to come from the scene.
    const split = splitSceneIdentity(identityTags, permanence ?? (() => 'identity'), overrides)
    return { kept: split.identity, fromScene: split.fromScene }
  }, [identityTags, permanence, overrides])

  const rated = useMemo(
    () => (enabled ? postsForRating(posts, contentRating) : EMPTY_POSTS),
    [enabled, posts, contentRating]
  )
  const tagKinds = useMemo(() => tagKindsFromPosts(rated), [rated])

  // Built once without a composition: lists the compositions and covers the default case.
  const basePool = useMemo(() => {
    if (!enabled || !permanence) return null
    return buildScenePool(rated, { overrides, permanence, subject, tagKind: (tag) => tagKinds.get(tag) })
  }, [enabled, permanence, rated, overrides, subject, tagKinds])

  const compositions = basePool?.stats.compositions ?? NO_COMPOSITIONS
  const people = basePool ? defaultComposition(compositions, subject, pickedPeople) : null
  const peopleKey = peopleKeyOf(people)
  const pool = useMemo(() => {
    if (!basePool || !permanence) return null
    if (!peopleKey || peopleKey === peopleKeyOf(basePool.stats.composition)) return basePool
    const [girls, boys] = peopleKey.split('/').map(Number)
    return buildScenePool(rated, { overrides, permanence, subject, tagKind: (tag) => tagKinds.get(tag), people: { girls, boys } })
  }, [basePool, permanence, peopleKey, rated, overrides, subject, tagKinds])

  const setPeople = useCallback((next: PackPeople) => setPickedPeople(next), [])
  const toggleSituation = useCallback((id: string) => {
    setDisabledSituations((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])
  const enableAllSituations = useCallback(() => setDisabledSituations([]), [])
  const enabledScenes = useMemo(() => (pool ? enabledSceneCount(pool, disabledSituations) : 0), [pool, disabledSituations])

  // Library clothing: whole outfits in the styles of the Outfit option (adult styles never in a safe pack).
  const useLibrary = enabled && settings.clothing === 'library'
  const outfitLibrary = useOutfitLibrary(useLibrary)
  const libraryStyles = useMemo(
    () => (contentRating === 'sfw' ? outfitOptions.styles.filter((s) => !ADULT_OUTFIT_STYLES.includes(s)) : outfitOptions.styles),
    [contentRating, outfitOptions.styles]
  )
  const libraryOutfitCount = useMemo(() => {
    if (!useLibrary || outfitLibrary.length === 0) return null
    const styles = new Set(libraryStyles)
    return outfitLibrary.filter((o) => styles.has(o.style)).length
  }, [useLibrary, outfitLibrary, libraryStyles])

  const packArgs = useCallback((seed: number): ScenePackArgs => {
    const library: LibraryOutfit[] | undefined = useLibrary && outfitLibrary.length > 0
      ? outfitPackDraw(outfitLibrary, libraryStyles, outfitOptions.detail, seed, LIBRARY_DRAW_SIZE)
          .map(({ outfit, tags }) => ({ outfitId: outfit.id, tags: tags.map(normalizeTagForPack) }))
      : undefined
    const prefs = sizePrefs()
    return {
      identity: identity.kept,
      alwaysAdd,
      subject,
      settings,
      count: promptCount,
      seed,
      disabledSituations,
      overrides,
      library,
      clean: (tags, locked) => cleanSyntheticPrompt(
        tags,
        characterTags,
        { ...cleanOptions, tagOverrides: overrides, globalWeights, isGlobalWeightsEnabled, lockedTags: locked },
        locked
      ),
      resolution: (aspect) => resolutionForAspect(aspect, prefs),
    }
  }, [
    useLibrary, outfitLibrary, libraryStyles, outfitOptions.detail, identity, alwaysAdd, subject, settings, promptCount,
    disabledSituations, overrides, characterTags, cleanOptions, globalWeights, isGlobalWeightsEnabled,
  ])

  const generate = useCallback(() => {
    if (!pool) {
      setPrompts(EMPTY_PROMPTS)
      setShortBy(0)
      return
    }
    const result = generateScenePack(pool, packArgs(Math.floor(Math.random() * 1e9)))
    setPrompts(result.prompts)
    setShortBy(result.shortBy)
  }, [pool, packArgs])

  const reroll = useCallback((index: number): boolean => {
    if (!pool || index < 0 || index >= prompts.length) return false
    const replacement = rerollScenePrompt(pool, prompts, index, packArgs(Math.floor(Math.random() * 1e9)))
    if (!replacement) return false
    setPrompts((prev) => prev.map((p, i) => (i === index ? replacement : p)))
    return true
  }, [pool, prompts, packArgs])

  // Outfit sentences only matter to the natural-language formats.
  const { format: promptFormat } = usePromptFormat()
  const outfitDescriptions = useOutfitDescriptions(useLibrary && promptFormat !== 'tags' && outfitLibrary.length > 0)
  const outfitsById = useMemo(() => new Map<number, Outfit>(outfitLibrary.map((o) => [o.id, o])), [outfitLibrary])
  const naturalSourceOf = useCallback(
    (prompt: PackPrompt) => packNaturalSource(prompt, {
      provider: natural.provider,
      character: natural.character,
      copyrights: natural.copyrights,
      contentRating,
      baseRating: natural.baseRating,
      outfits: outfitsById,
      descriptions: outfitDescriptions,
    }),
    [natural, contentRating, outfitsById, outfitDescriptions]
  )

  return useMemo(() => ({
    ready: !!permanence,
    pool,
    identity,
    compositions,
    people,
    setPeople,
    disabledSituations,
    toggleSituation,
    enableAllSituations,
    enabledScenes,
    otherRatingPosts: enabled ? posts.length - rated.length : 0,
    libraryOutfitCount,
    prompts,
    shortBy,
    generate,
    reroll,
    naturalSourceOf,
  }), [permanence, pool, identity, compositions, people, setPeople, disabledSituations, toggleSituation, enableAllSituations, enabledScenes, enabled, posts.length, rated.length, libraryOutfitCount, prompts, shortBy, generate, reroll, naturalSourceOf])
}

