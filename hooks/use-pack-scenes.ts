import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BooruPost } from '@/lib/booru/types'
import type { PackPrompt } from '@/lib/pack/pack-generator'
import { normalizeTagForPack } from '@/lib/pack/pack-generator'
import { cleanSyntheticPrompt, type BulkSendCleanOptions } from '@/lib/pack/bulk-send'
import { createPermanence, isCompositionPattern, type PermanenceData } from '@/lib/pack/scene/permanence'
import { buildScenePool, compositionOfIdentity, type PackPeople, type ScenePool } from '@/lib/pack/scene/scene-pool'
import { castPeople, holdsCast, type CastRole } from '@/lib/pack/scene/cast'
import {
  alwaysAddOmitted,
  castComposition,
  defaultComposition,
  enabledSceneCount,
  generateScenePackAsync,
  postsForRating,
  rerollScenePrompt,
  sceneChips,
  subjectOfTags,
  tagKindsFromPosts,
  type ChipState,
  type LibraryOutfit,
  type SceneChip,
  type ScenePackArgs,
  type ScenePackSettings,
} from '@/lib/pack/scene-pack'
import { packNaturalSource } from '@/lib/pack/pack-natural'
import type { NaturalPromptSource } from '@/lib/prompt/natural-format'
import type { PackRatingMode } from '@/hooks/use-pack-seed-search'
import { resolutionForAspect } from '@/lib/pack/prompt-resolution'
import { clampMaxLongSide } from '@/lib/extension/generation-resolution'
import { userPreferences } from '@/lib/storage'
import { splitCommaSeparatedTags } from '@/lib/utils/tag-utils'
import { useOutfitDescriptions, useOutfitLibrary } from '@/hooks/use-outfit-settings'
import { usePromptFormat } from '@/hooks/use-natural-prompt'
import { ADULT_OUTFIT_STYLES, outfitPackDraw, type Outfit, type OutfitDetail, type OutfitStyle } from '@/lib/outfit-swap'

/** Library outfits drawn for one pack. */
const LIBRARY_DRAW_SIZE = 60
const EMPTY_POSTS: BooruPost[] = []
const EMPTY_PROMPTS: PackPrompt[] = []
const NO_COMPOSITIONS: PackSceneComposition[] = []
const NO_TAGS: string[] = []

export interface UsePackScenesArgs {
  /** Pack Mode is on, with a base, on the scenes engine. Nothing is loaded or built otherwise. */
  enabled: boolean
  /** The source's posts, the same ones the header counts. */
  posts: BooruPost[]
  /** tag -> "category:subcategory", including the slots fetched for this pool. */
  overrides: Record<string, string>
  /**
   * The characters the pack names, the base character first (usePackMode's sceneCast).
   * Each has a name, a look and a role (null until something or someone says it).
   */
  members: ReadonlyArray<{ character: string; candidates: string[]; role: CastRole | null }>
  /** The rest of a card's or pasted prompt's look and clothing. */
  baseExtras: string[]
  /** A pasted prompt's typed tags outside every category: always kept. */
  baseFixed: string[]
  /** The base's clothing, for "From the base". */
  baseClothing: string[]
  /** Tags the user removed from the base (usePackMode's excludedBaseTags). */
  removedTags: ReadonlySet<string>
  /** The base is a character chosen by name, with no card. */
  baseFromCharacter: boolean
  /** "Always add", as typed. */
  alwaysAdd: string[]
  /** "Never include", as typed. */
  neverIncludeText: string
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
  /** Changes with the base: prompts, chip choices and added tags belong to it. */
  baseKey: string
  /** Changes with the source: prompts, switched-off situations and the picked composition belong to it. */
  sourceKey: string
}

export interface SceneCharacterBlock {
  character: string
  role: CastRole | null
  chips: SceneChip[]
  /** Chips the user removed (they never appear). */
  removed: string[]
}

export interface PackSceneComposition {
  people: PackPeople
  scenes: number
}

export interface UsePackScenesResult {
  /** The permanence data has loaded, so scenes can be built. */
  ready: boolean
  /** Loading the permanence data failed; `retryLoad` tries again. */
  loadFailed: boolean
  retryLoad: () => void
  /** Scenes of the pool for the chosen composition, or null until it can be built. */
  pool: ScenePool | null
  /** One block of Character chips per character, in cast order: pinned (every prompt) or from the scene. */
  blocks: SceneCharacterBlock[]
  /** The tags every prompt keeps, in order: each character's pinned chips, block by block. */
  pinnedTags: string[]
  /** Switches a chip of a character between pinned and from the scene. */
  toggleChip: (character: string, tag: string) => void
  /** Forgets a chip's pinned/scene choice (it goes back to its default, e.g. when it's removed). */
  resetChip: (character: string, tag: string) => void
  /** Adds traits to a character by hand. Returns the people-count tags it refused (those belong to the composition). */
  addTraits: (character: string, text: string) => string[]
  /** Characters the pack names (1 to 3). */
  castSize: number
  /** Characters whose role (girl or boy) nobody has said yet: a cast can't be placed until it is. */
  missingRoles: string[]
  /** The cast has no room in any composition of the pool (a pair in a pool of solo pictures). */
  castHasNoScenes: boolean
  /** The base has clothing, so "From the base" can be offered. */
  hasBaseClothing: boolean
  /** "Always add" tags left out because they contradict who's in the picture ("solo" with two people). */
  alwaysAddOmitted: string[]
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
  /** A pack is being generated (the page stays responsive meanwhile). */
  isGenerating: boolean
  /** Builds a new pack. Pressing it again, or changing the source or base, replaces the running one. */
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

/** Lets the browser paint and handle input before the next slice of work. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0))
    else setTimeout(resolve, 0)
  })

/**
 * Pack Mode's scenes engine: each prompt is a real post's scene transplanted
 * onto the pack's character (lib/pack/scene/, lib/pack/scene-pack.ts). Owns
 * the scene pool, the user's picks over it (Character chips, composition,
 * situations) and the generated prompts, which have the same shape as the
 * classic engine's so the results list, Copy all and the prompt formats work
 * unchanged.
 *
 * The pool is rebuilt only when its inputs change (posts, slots, rating,
 * composition, the character's gender), never on render; prompts are built
 * only on Generate, in slices that keep the page responsive.
 */
export function usePackScenes(args: UsePackScenesArgs): UsePackScenesResult {
  const {
    enabled, posts, overrides, members, baseExtras, baseFixed, baseClothing, removedTags, baseFromCharacter,
    alwaysAdd, neverIncludeText, characterTags, contentRating, settings, promptCount, cleanOptions, globalWeights,
    isGlobalWeightsEnabled, outfitOptions, natural, baseKey, sourceKey,
  } = args

  // Permanence data (which tags are who the character is), fetched while enabled until it loads.
  const [permanenceData, setPermanenceData] = useState<PermanenceData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  useEffect(() => {
    if (!enabled || permanenceData) return
    const controller = new AbortController()
    fetch('/tag-permanence.json', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`tag-permanence.json: HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (!data || typeof data !== 'object' || !Array.isArray(data.state)) {
          throw new Error('Invalid tag-permanence.json format')
        }
        setPermanenceData(data as PermanenceData)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        console.error('Failed to load tag permanence:', err)
        setLoadFailed(true)
      })
    return () => controller.abort()
  }, [enabled, permanenceData, loadAttempt])
  const retryLoad = useCallback(() => {
    setLoadFailed(false)
    setLoadAttempt((n) => n + 1)
  }, [])

  const permanence = useMemo(
    () => (permanenceData ? createPermanence(permanenceData, overrides) : null),
    [permanenceData, overrides]
  )

  // Per-source picks; per-base chips. Prompts belong to both. Reset during render when a key changes.
  const [pickedPeople, setPickedPeople] = useState<PackPeople | null>(null)
  const [disabledSituations, setDisabledSituations] = useState<string[]>([])
  // Chip choices and added tags per character ("<character>\u0000<tag>" and character -> tags).
  const [choices, setChoices] = useState<ReadonlyMap<string, ChipState>>(() => new Map())
  const [added, setAdded] = useState<ReadonlyMap<string, string[]>>(() => new Map())
  const [prompts, setPrompts] = useState<PackPrompt[]>(EMPTY_PROMPTS)
  const [shortBy, setShortBy] = useState(0)
  const [isGenerating, setIsGenerating] = useState(false)
  const [prevSourceKey, setPrevSourceKey] = useState(sourceKey)
  if (sourceKey !== prevSourceKey) {
    setPrevSourceKey(sourceKey)
    setPickedPeople(null)
    setDisabledSituations([])
    setPrompts(EMPTY_PROMPTS)
    setShortBy(0)
  }
  const [prevBaseKey, setPrevBaseKey] = useState(baseKey)
  if (baseKey !== prevBaseKey) {
    setPrevBaseKey(baseKey)
    setChoices(new Map())
    setAdded(new Map())
    setPrompts(EMPTY_PROMPTS)
    setShortBy(0)
  }
  // Another cast (someone added, removed or given a role) makes other prompts and compositions.
  const castKey = members.map((m) => `${m.character}:${m.role ?? '?'}`).join('|')
  const [prevCastKey, setPrevCastKey] = useState(castKey)
  if (castKey !== prevCastKey) {
    setPrevCastKey(castKey)
    setPickedPeople(null)
    setPrompts(EMPTY_PROMPTS)
    setShortBy(0)
  }

  // The running generation, and the base / source it was started for: a newer
  // Generate or another base or source makes it stale.
  const requestRef = useRef(0)
  const keysRef = useRef(`${baseKey}|${sourceKey}|${castKey}`)
  useEffect(() => {
    keysRef.current = `${baseKey}|${sourceKey}|${castKey}`
  }, [baseKey, sourceKey, castKey])

  const castSize = members.length
  const isCast = castSize >= 2
  // The first character's gender places them in a one-character pack; a cast needs everyone's role.
  const subject = members[0]?.role ?? subjectOfTags(members[0]?.candidates ?? NO_TAGS)
  const missingRoles = useMemo(
    () => (isCast ? members.filter((m) => !m.role).map((m) => m.character) : NO_TAGS),
    [isCast, members]
  )
  const namedPeople = useMemo<PackPeople>(
    () => (isCast ? castPeople(members.map((m) => m.role)) : subject === 'girl' ? { girls: 1, boys: 0 } : { girls: 0, boys: 1 }),
    [isCast, members, subject]
  )

  const chipKey = (character: string, tag: string) => `${character}\u0000${tag}`
  const { blocks, pinned, never } = useMemo(() => {
    const out: SceneCharacterBlock[] = []
    const pinnedAll: string[] = []
    const neverAll: string[] = []
    members.forEach((member, index) => {
      const own = new Map<string, ChipState>()
      choices.forEach((state, key) => {
        const [character, tag] = key.split('\u0000')
        if (character === member.character) own.set(tag, state)
      })
      const result = sceneChips({
        candidates: member.candidates,
        added: added.get(member.character) ?? NO_TAGS,
        // The rest of a card or pasted prompt belongs to the base character.
        extras: index === 0 ? baseExtras : NO_TAGS,
        removed: removedTags,
        choices: own,
        // Until the permanence data loads, only the people counts are known to come from the scene.
        permanence: permanence ?? (() => 'identity'),
        overrides,
      })
      out.push({ character: member.character, role: member.role, chips: result.chips, removed: result.never })
      pinnedAll.push(...result.pinned, ...(index === 0 ? baseFixed.filter((tag) => !removedTags.has(tag)) : []))
      neverAll.push(...result.never)
    })
    return { blocks: out, pinned: pinnedAll, never: neverAll }
  }, [members, choices, added, baseExtras, baseFixed, removedTags, permanence, overrides])
  // Each block keeps its own tags, even ones another character also has: they are different people.
  const pinnedTags = useMemo(
    () => (isCast ? pinned : Array.from(new Set(pinned))),
    [isCast, pinned]
  )
  const neverTags = useMemo(
    () => Array.from(new Set([...never, ...splitCommaSeparatedTags(neverIncludeText).map(normalizeTagForPack).filter(Boolean)])),
    [never, neverIncludeText]
  )

  const toggleChip = useCallback((character: string, tag: string) => {
    const current = blocks.find((block) => block.character === character)?.chips.find((chip) => chip.tag === tag)
    if (!current) return
    setChoices((prev) => new Map(prev).set(chipKey(character, tag), current.state === 'pinned' ? 'scene' : 'pinned'))
  }, [blocks])
  const resetChip = useCallback((character: string, tag: string) => {
    setChoices((prev) => {
      const key = chipKey(character, tag)
      if (!prev.has(key)) return prev
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }, [])
  const addTraits = useCallback((character: string, text: string): string[] => {
    const tags = splitCommaSeparatedTags(text).map(normalizeTagForPack).filter(Boolean)
    const refused = tags.filter(isCompositionPattern)
    const accepted = tags.filter((tag) => !isCompositionPattern(tag))
    if (accepted.length > 0) {
      setAdded((prev) => new Map(prev).set(character, Array.from(new Set([...(prev.get(character) ?? []), ...accepted]))))
      // Added tags start pinned, even one the base already offered from the scene.
      setChoices((prev) => {
        const next = new Map(prev)
        accepted.forEach((tag) => next.set(chipKey(character, tag), 'pinned'))
        return next
      })
    }
    return refused
  }, [])

  const rated = useMemo(
    () => (enabled ? postsForRating(posts, contentRating) : EMPTY_POSTS),
    [enabled, posts, contentRating]
  )
  const tagKinds = useMemo(() => tagKindsFromPosts(rated), [rated])

  // Built once without a composition: lists the compositions and covers the default case.
  const basePool = useMemo(() => {
    if (!enabled || !permanence) return null
    return buildScenePool(rated, { overrides, permanence, subject, cast: namedPeople, tagKind: (tag) => tagKinds.get(tag) })
  }, [enabled, permanence, rated, overrides, subject, namedPeople, tagKinds])

  const firstCandidates = members[0]?.candidates ?? NO_TAGS
  const baseComposition = useMemo(
    () => ({ declared: compositionOfIdentity([...firstCandidates, ...baseExtras]), character: baseFromCharacter }),
    [firstCandidates, baseExtras, baseFromCharacter]
  )
  const allCompositions = basePool?.stats.compositions ?? NO_COMPOSITIONS
  // A cast is offered only the compositions with room for everyone it names.
  const compositions = useMemo(
    () => (isCast ? allCompositions.filter((c) => holdsCast(c.people, namedPeople)) : allCompositions),
    [isCast, allCompositions, namedPeople]
  )
  const castHasNoScenes = isCast && missingRoles.length === 0 && !!basePool && compositions.length === 0
  const peopleKey = peopleKeyOf(
    !basePool || (isCast && missingRoles.length > 0)
      ? null
      : isCast
        ? castComposition(compositions, namedPeople, pickedPeople)
        : defaultComposition(compositions, subject, pickedPeople, baseComposition)
  )
  // One object per composition, so the result only changes when the composition does.
  const people = useMemo<PackPeople | null>(() => {
    if (!peopleKey) return null
    const [girls, boys] = peopleKey.split('/').map(Number)
    return { girls, boys }
  }, [peopleKey])
  const pool = useMemo(() => {
    if (!basePool || !permanence) return null
    if (!people || peopleKey === peopleKeyOf(basePool.stats.composition)) return basePool
    return buildScenePool(rated, { overrides, permanence, subject, cast: namedPeople, tagKind: (tag) => tagKinds.get(tag), people })
  }, [basePool, permanence, people, peopleKey, rated, overrides, subject, namedPeople, tagKinds])

  const setPeople = useCallback((next: PackPeople) => {
    setPickedPeople(next)
    // Prompts of another composition no longer match the pick.
    setPrompts(EMPTY_PROMPTS)
    setShortBy(0)
    requestRef.current++
    setIsGenerating(false)
  }, [])
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
      identity: pinnedTags,
      alwaysAdd,
      people,
      castSize,
      never: neverTags,
      baseClothing,
      subject,
      settings,
      count: promptCount,
      seed,
      disabledSituations,
      overrides,
      library,
      // A scene is a real, coherent picture: the user's settings apply (exclude, find and
      // replace, characters, weights), but tags are not merged or pruned as they are for
      // the classic engine's mixed prompts.
      clean: (tags, locked) => cleanSyntheticPrompt(
        tags,
        characterTags,
        { ...cleanOptions, optimizeTags: false, tagOverrides: overrides, globalWeights, isGlobalWeightsEnabled, lockedTags: locked },
        locked
      ),
      resolution: (aspect) => resolutionForAspect(aspect, prefs),
    }
  }, [
    useLibrary, outfitLibrary, libraryStyles, outfitOptions.detail, pinnedTags, alwaysAdd, people, castSize, neverTags, baseClothing, subject,
    settings, promptCount, disabledSituations, overrides, characterTags, cleanOptions, globalWeights, isGlobalWeightsEnabled,
  ])

  const generate = useCallback(() => {
    const id = ++requestRef.current
    if (!pool || missingRoles.length > 0) {
      setPrompts(EMPTY_PROMPTS)
      setShortBy(0)
      setIsGenerating(false)
      return
    }
    const keys = keysRef.current
    const stale = () => requestRef.current !== id || keysRef.current !== keys
    let first = true
    setIsGenerating(true)
    void generateScenePackAsync(pool, packArgs(Math.floor(Math.random() * 1e9)), {
      // The first pause lets the busy button paint; the rest only let input through.
      pause: () => {
        if (!first) return nextTask()
        first = false
        return nextFrame()
      },
      cancelled: stale,
    })
      .then((result) => {
        if (stale()) {
          if (requestRef.current === id) setIsGenerating(false)
          return
        }
        setIsGenerating(false)
        if (!result) return
        setPrompts(result.prompts)
        setShortBy(result.shortBy)
      })
      .catch((err) => {
        console.error('Scene pack generation failed:', err)
        if (requestRef.current === id) setIsGenerating(false)
      })
  }, [pool, packArgs, missingRoles])

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
      // Every named character the prompt still has; the converter tells them apart by name.
      characters: members.map((m) => m.character).filter(Boolean),
      copyrights: natural.copyrights,
      contentRating,
      baseRating: natural.baseRating,
      outfits: outfitsById,
      descriptions: outfitDescriptions,
    }),
    [natural, members, contentRating, outfitsById, outfitDescriptions]
  )

  const otherRatingPosts = enabled ? posts.length - rated.length : 0
  const omitted = useMemo(() => alwaysAddOmitted(alwaysAdd, people), [alwaysAdd, people])
  const hasBaseClothing = baseClothing.length > 0
  return useMemo(() => ({
    ready: !!permanence,
    loadFailed: loadFailed && !permanence,
    retryLoad,
    pool,
    blocks,
    pinnedTags,
    toggleChip,
    resetChip,
    addTraits,
    castSize,
    missingRoles,
    castHasNoScenes,
    hasBaseClothing,
    alwaysAddOmitted: omitted,
    compositions,
    people,
    setPeople,
    disabledSituations,
    toggleSituation,
    enableAllSituations,
    enabledScenes,
    otherRatingPosts,
    libraryOutfitCount,
    prompts,
    shortBy,
    isGenerating,
    generate,
    reroll,
    naturalSourceOf,
  }), [
    permanence, loadFailed, retryLoad, pool, blocks, pinnedTags, toggleChip, resetChip, addTraits, castSize, missingRoles, castHasNoScenes, hasBaseClothing, omitted,
    compositions, people, setPeople, disabledSituations, toggleSituation, enableAllSituations, enabledScenes,
    otherRatingPosts, libraryOutfitCount, prompts, shortBy, isGenerating, generate, reroll, naturalSourceOf,
  ])
}
