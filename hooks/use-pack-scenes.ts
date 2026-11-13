import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BooruPost } from '@/lib/booru/types'
import type { PackPrompt } from '@/lib/pack/pack-generator'
import { normalizeTagForPack } from '@/lib/pack/pack-generator'
import { cleanSyntheticPrompt, type BulkSendCleanOptions } from '@/lib/pack/bulk-send'
import { createPermanence, isCompositionPattern, type PermanenceData } from '@/lib/pack/scene/permanence'
import { buildScenePool, compositionOfIdentity, type PackPeople, type ScenePool } from '@/lib/pack/scene/scene-pool'
import { castPeople, holdsCast, type CastLookSource, type CastRole } from '@/lib/pack/scene/cast'
import { pinnedConflicts } from '@/lib/pack/classic-chips'
import { ConflictChecker } from '@/lib/tag-conflicts'
import { fetchGelbooruTagCategories } from '@/lib/supabase/client-queries'
import type { TagKind } from '@/lib/pack/scene/scene'
import {
  alwaysAddOmitted,
  castChips,
  gelbooruTagKinds,
  identityWithOutfits,
  untypedTags,
  castComposition,
  defaultComposition,
  enabledSceneCount,
  generateScenePackAsync,
  postsForRating,
  rerollScenePrompt,
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
import type { CharacterChipStore } from '@/hooks/use-pack-mode'
import { resolutionForAspect } from '@/lib/pack/prompt-resolution'
import { clampMaxLongSide } from '@/lib/extension/generation-resolution'
import { userPreferences } from '@/lib/storage'
import { splitCommaSeparatedTags } from '@/lib/utils/tag-utils'
import { useOutfitDescriptions, useOutfitLibrary } from '@/hooks/use-outfit-settings'
import { usePromptFormat } from '@/hooks/use-natural-prompt'
import { ADULT_OUTFIT_STYLES, outfitPackDraw, type Outfit, type OutfitDetail, type OutfitStyle } from '@/lib/outfit-swap'
import { chosenOutfit, loadCharacterOutfits, outfitTags, type CharacterOutfits } from '@/lib/pack/character-outfits'
import { loadTraitAliases } from '@/lib/prompt/natural-prompt-loader'
import { NO_ACTIVE_SCENE_IDEAS, sceneIdeasInUse, type ActiveSceneIdeas } from '@/lib/pack/scene-ideas'
import { useInventedScenes, type InventedScenesStatus } from '@/hooks/use-invented-scenes'
import { SCENE_MODEL_BASE_URL } from '@/lib/scene-model/client'
import { inventedScenesOn } from '@/lib/scene-model/protocol'
import { nextPaint, yieldToPage } from '@/lib/utils/yield-to-page'

/** How long the pool waits for Gelbooru's tag list before it uses the built-in rules. */
const GELBOORU_LOOKUP_TIMEOUT_MS = 8000
/** Library outfits drawn for one pack. */
const LIBRARY_DRAW_SIZE = 60
const EMPTY_POSTS: BooruPost[] = []
const EMPTY_PROMPTS: PackPrompt[] = []
const NO_COMPOSITIONS: PackSceneComposition[] = []
const NO_TAGS: string[] = []
const NO_REMOVED: ReadonlySet<string> = new Set()

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
  members: ReadonlyArray<{ character: string; candidates: string[]; role: CastRole | null; lookSource?: CastLookSource }>
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
  /** The source's booru: Gelbooru's own tag list tells its names apart. */
  provider: string
  /** Pins, dashes and added traits per character, shared with Classic (usePackMode's chipStore). */
  chipStore: CharacterChipStore
  /** What the picked Scene ideas put in or keep out (usePackMode's activeSceneIdeas). */
  sceneIdeas?: ActiveSceneIdeas
  /** Fetches the taxonomy slots of tags no pool post had (usePackMode's enrichTagSlots), for invented scenes. */
  enrichTags?: (tags: string[]) => Promise<unknown>
}

export interface SceneCharacterBlock {
  character: string
  role: CastRole | null
  chips: SceneChip[]
  /** The tags this block puts in every prompt, in order. */
  pinned: string[]
  /** Chips the user removed (they never appear). */
  removed: string[]
  /** In a cast: where the look comes from (see SceneCastMember). */
  lookSource?: CastLookSource
  /** Pinned chips that contradict another pinned chip of the block, with that tag. */
  conflicts: Readonly<Record<string, string>>
}

/** A character of the pack whose own outfits are known (Clothing: "Their outfits"). */
export interface SceneCharacterOutfit {
  character: string
  outfits: CharacterOutfits
  /** The outfit they wear: '' for the usual one, else an official outfit's name. */
  chosen: string
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
  /** Takes back a trait added by hand (it isn't "removed": it simply goes). */
  removeTrait: (character: string, tag: string) => void
  /**
   * Removes (or puts back) a chip of a character other than the first: their own
   * removals, apart from the base's (the first character's go through the base).
   */
  toggleRemovedChip: (character: string, tag: string) => void
  /** Characters the pack names (1 to 3). */
  castSize: number
  /** Characters whose role (girl or boy) nobody has said yet: a cast can't be placed until it is. */
  missingRoles: string[]
  /** The cast has no room in any composition of the pool (a pair in a pool of solo pictures). */
  castHasNoScenes: boolean
  /** The base has clothing, so "From the base" can be offered. */
  hasBaseClothing: boolean
  /**
   * The characters the pack names (by name: a character base, or a card whose character
   * chip is pinned) whose outfits are known. Empty: the character's outfit isn't offered.
   */
  characterOutfits: SceneCharacterOutfit[]
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
  /** Scenes written by the scene model (settings.inventedScenes): loading, generating, how many are in the pool. */
  inventedScenes: InventedScenesStatus
  /** This deployment has a scene model (NEXT_PUBLIC_SCENE_MODEL_URL): without it "Invented scenes" isn't offered. */
  inventedScenesAvailable: boolean
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
    isGlobalWeightsEnabled, outfitOptions, natural, baseKey, sourceKey, provider, chipStore,
    sceneIdeas: addedIdeas = NO_ACTIVE_SCENE_IDEAS, enrichTags,
  } = args
  // Picked scenes apply only while Scenery is on "Pick a scene"; they stay added otherwise.
  const sceneIdeas = useMemo(() => sceneIdeasInUse('scenes', settings.scenery, addedIdeas), [settings.scenery, addedIdeas])

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
  // Pins, dashes and added traits live with the base in usePackMode, shared with Classic.
  const { choices, added } = chipStore
  // Chips removed from the other characters' blocks (the first character's removals are the base's).
  const [removedOwn, setRemovedOwn] = useState<ReadonlyMap<string, ReadonlySet<string>>>(() => new Map())
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
    setRemovedOwn(new Map())
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
    const result = castChips({
      members,
      choices: (character) => {
        const own = new Map<string, ChipState>()
        choices.forEach((state, key) => {
          const [owner, tag] = key.split('\u0000')
          if (owner === character) own.set(tag, state)
        })
        return own
      },
      added: (character) => added.get(character) ?? NO_TAGS,
      // The first character's removals are the base's; each other character has their own.
      removed: (character, index) => (index === 0 ? removedTags : removedOwn.get(character) ?? NO_REMOVED),
      baseExtras,
      baseFixed,
      // Until the permanence data loads, only the people counts are known to come from the scene.
      permanence: permanence ?? (() => 'identity'),
      overrides,
    })
    const out: SceneCharacterBlock[] = result.blocks.map((block, index) => {
      // Pins of one character that contradict each other: both stay (the user chose them), and the block says so.
      const pinnedHere = block.chips.filter((chip) => chip.state === 'pinned').map((chip) => chip.tag)
      const conflicts = pinnedConflicts(pinnedHere, pinnedHere, (tag, others) => new ConflictChecker(others).check(tag))
      return { ...block, role: members[index].role, lookSource: members[index].lookSource, conflicts }
    })
    return { blocks: out, pinned: result.pinned, never: result.never }
  }, [members, choices, added, baseExtras, baseFixed, removedTags, removedOwn, permanence, overrides])
  // Each block keeps its own tags, even ones another character also has: they are different people.
  const neverTags = useMemo(
    () => Array.from(new Set([...never, ...splitCommaSeparatedTags(neverIncludeText).map(normalizeTagForPack).filter(Boolean), ...sceneIdeas.never])),
    [never, neverIncludeText, sceneIdeas]
  )

  // The characters' own outfits (public/character-outfits/), read once per name and page.
  const [outfitData, setOutfitData] = useState<ReadonlyMap<string, CharacterOutfits | null>>(() => new Map())
  const memberNames = members.map((m) => m.character).filter(Boolean).join('|')
  useEffect(() => {
    if (!enabled || !memberNames) return
    let active = true
    const names = memberNames.split('|')
    void loadTraitAliases()
      .then((aliases) => Promise.all(names.map(async (name) => [name, await loadCharacterOutfits(name, aliases)] as const)))
      .then((entries) => {
        if (!active) return
        setOutfitData((prev) => {
          if (entries.every(([name, outfits]) => prev.get(name) === outfits)) return prev
          const next = new Map(prev)
          entries.forEach(([name, outfits]) => next.set(name, outfits))
          return next
        })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [enabled, memberNames])
  const characterOutfits = useMemo<SceneCharacterOutfit[]>(
    () => blocks.flatMap((block) => {
      const outfits = block.character ? outfitData.get(block.character) : null
      // Only a character the prompts name: a card whose character chip was dashed or removed isn't one.
      const named = baseFromCharacter || block.chips.some((chip) => chip.tag === block.character && chip.state === 'pinned')
      if (!outfits || !named) return []
      // The outfit picked for them (saved with the settings), while they still have it.
      return [{ character: block.character, outfits, chosen: chosenOutfit(outfits, settings.characterOutfits?.[block.character]) }]
    }),
    [blocks, outfitData, settings.characterOutfits, baseFromCharacter]
  )
  // "Their outfits": each block's pinned tags, then that character's outfit.
  const wornOutfits = useMemo(() => {
    if (settings.clothing !== 'character' || characterOutfits.length === 0) return null
    return new Map(characterOutfits.map((o) => [o.character, outfitTags(o.outfits, o.chosen)]))
  }, [settings.clothing, characterOutfits])
  const characterOutfitTags = useMemo(() => (wornOutfits ? Array.from(wornOutfits.values()).flat() : NO_TAGS), [wornOutfits])
  const pinnedTags = useMemo(() => {
    const tags = wornOutfits
      ? identityWithOutfits(blocks.map((block) => ({ pinned: block.pinned, outfit: wornOutfits.get(block.character) ?? NO_TAGS })), neverTags)
      : pinned
    // The picked scenes' pinned tags come after every character's.
    const own = new Set(tags)
    const withIdeas = [...tags, ...sceneIdeas.pinned.filter((tag) => !own.has(tag))]
    return isCast ? withIdeas : Array.from(new Set(withIdeas))
  }, [isCast, pinned, wornOutfits, blocks, neverTags, sceneIdeas])

  const toggleChip = useCallback((character: string, tag: string) => {
    const current = blocks.find((block) => block.character === character)?.chips.find((chip) => chip.tag === tag)
    if (!current) return
    chipStore.setChoice(character, tag, current.state === 'pinned' ? 'scene' : 'pinned')
  }, [blocks, chipStore])
  const resetChip = useCallback((character: string, tag: string) => chipStore.setChoice(character, tag, null), [chipStore])
  const addTraits = useCallback((character: string, text: string): string[] => chipStore.addTraits(character, text), [chipStore])
  const removeTrait = useCallback((character: string, tag: string) => chipStore.removeTrait(character, tag), [chipStore])

  const toggleRemovedChip = useCallback((character: string, tag: string) => {
    setRemovedOwn((prev) => {
      const own = new Set(prev.get(character) ?? [])
      if (own.has(tag)) own.delete(tag)
      else own.add(tag)
      return new Map(prev).set(character, own)
    })
  }, [])

  const rated = useMemo(
    () => (enabled ? postsForRating(posts, contentRating) : EMPTY_POSTS),
    [enabled, posts, contentRating]
  )
  const postKinds = useMemo(() => tagKindsFromPosts(rated), [rated])

  // Gelbooru: what its own tag list says the pool's untyped, unslotted tags are. The
  // pool waits for the first answer ("Finding scenes…"); a failed or slow lookup falls
  // back to the engine's own rules (names.ts and the pool-support filter).
  const lookupNames = useMemo(
    () => (enabled && provider === 'gelbooru' ? untypedTags(rated, postKinds, overrides) : null),
    [enabled, provider, rated, postKinds, overrides]
  )
  const lookupKey = lookupNames ? lookupNames.join('\n') : null
  const [lookup, setLookup] = useState<{ key: string; kinds: Map<string, TagKind> | null } | null>(null)
  useEffect(() => {
    if (lookupKey === null || !lookupNames) return
    let active = true
    const timer = setTimeout(() => {
      if (active) setLookup({ key: lookupKey, kinds: null })
    }, GELBOORU_LOOKUP_TIMEOUT_MS)
    fetchGelbooruTagCategories(lookupNames)
      .then((categories) => {
        if (active) setLookup({ key: lookupKey, kinds: gelbooruTagKinds(categories) })
      })
      .catch((err) => {
        console.warn('Gelbooru tag lookup failed; using the built-in rules:', err)
        if (active) setLookup({ key: lookupKey, kinds: null })
      })
      .finally(() => clearTimeout(timer))
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [lookupKey, lookupNames])
  // The first answer gates the pool; later ones (more posts, more slots) refresh it.
  const waitingForLookup = lookupKey !== null && lookup === null
  const tableKinds = lookupKey !== null ? lookup?.kinds ?? null : null
  const tagKinds = useMemo(() => {
    if (!tableKinds) return postKinds
    const merged = new Map(tableKinds)
    // While a refresh is out, tags it asks about count as unlisted: a name must not
    // slip into the scenes in the meantime (a general tag comes back with the answer).
    if (lookupKey !== lookup?.key) lookupNames?.forEach((tag) => { if (!merged.has(tag)) merged.set(tag, 'unlisted') })
    postKinds.forEach((kind, tag) => merged.set(tag, kind))
    return merged
  }, [postKinds, tableKinds, lookupKey, lookup, lookupNames])

  // Built once without a composition: lists the compositions and covers the default case.
  const basePool = useMemo(() => {
    if (!enabled || !permanence || waitingForLookup) return null
    return buildScenePool(rated, { overrides, permanence, subject, cast: namedPeople, tagKind: (tag) => tagKinds.get(tag) })
  }, [enabled, permanence, waitingForLookup, rated, overrides, subject, namedPeople, tagKinds])

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

  // Invented scenes (lib/pack/scene/invented.ts): written in the background for the composition
  // in use (the cast's own when the posts have none), then added to the pool like real posts.
  const inventedPeople = people ?? (basePool && missingRoles.length === 0 ? namedPeople : null)
  const castNames = useMemo(() => members.map((m) => m.character).filter(Boolean), [members])
  const castIdentity = useMemo(() => Array.from(new Set([...pinnedTags, ...members.flatMap((m) => m.candidates)])), [pinnedTags, members])
  const inventedFixed = useMemo(() => Array.from(new Set([...pinnedTags, ...sceneIdeas.core])), [pinnedTags, sceneIdeas])
  // Only where this deployment has a scene model: a saved "on" does nothing without one.
  const inventedOn = inventedScenesOn(settings.inventedScenes, SCENE_MODEL_BASE_URL)
  const invented = useInventedScenes({
    enabled: enabled && inventedOn,
    posts: rated,
    contentRating,
    people: inventedPeople,
    identity: castIdentity,
    characters: castNames,
    copyrights: natural.copyrights,
    fixed: inventedFixed,
    never: neverTags,
    enrichTags,
  })
  const inventedPosts = invented.posts
  const refreshInvented = invented.refresh

  const pool = useMemo(() => {
    if (!basePool || !permanence) return null
    if (inventedPosts.length > 0 && inventedPeople) {
      return buildScenePool([...rated, ...inventedPosts], { overrides, permanence, subject, cast: namedPeople, tagKind: (tag) => tagKinds.get(tag), people: inventedPeople })
    }
    if (!people || peopleKey === peopleKeyOf(basePool.stats.composition)) return basePool
    return buildScenePool(rated, { overrides, permanence, subject, cast: namedPeople, tagKind: (tag) => tagKinds.get(tag), people })
  }, [basePool, permanence, people, peopleKey, rated, overrides, subject, namedPeople, tagKinds, inventedPosts, inventedPeople])

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
      characterOutfit: characterOutfitTags,
      sceneIdea: sceneIdeas.core.length > 0 || sceneIdeas.dashed.length > 0 ? { core: sceneIdeas.core, dashed: sceneIdeas.dashed } : undefined,
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
    useLibrary, outfitLibrary, libraryStyles, outfitOptions.detail, pinnedTags, alwaysAdd, people, castSize, neverTags, baseClothing, characterOutfitTags, sceneIdeas, subject,
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
    // The next pack gets new invented scenes; this one uses those already in the pool.
    if (inventedOn) refreshInvented()
    void generateScenePackAsync(pool, packArgs(Math.floor(Math.random() * 1e9)), {
      // The first pause lets the busy button paint; the rest only let input through.
      pause: () => {
        if (!first) return yieldToPage()
        first = false
        return nextPaint()
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
  }, [pool, packArgs, missingRoles, inventedOn, refreshInvented])

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
    removeTrait,
    toggleRemovedChip,
    castSize,
    missingRoles,
    castHasNoScenes,
    hasBaseClothing,
    characterOutfits,
    alwaysAddOmitted: omitted,
    compositions,
    people,
    setPeople,
    disabledSituations,
    toggleSituation,
    enableAllSituations,
    enabledScenes,
    otherRatingPosts,
    inventedScenes: invented.status,
    inventedScenesAvailable: SCENE_MODEL_BASE_URL !== null,
    libraryOutfitCount,
    prompts,
    shortBy,
    isGenerating,
    generate,
    reroll,
    naturalSourceOf,
  }), [
    permanence, loadFailed, retryLoad, pool, blocks, pinnedTags, toggleChip, resetChip, addTraits, removeTrait, toggleRemovedChip, castSize, missingRoles, castHasNoScenes, hasBaseClothing, characterOutfits, omitted,
    compositions, people, setPeople, disabledSituations, toggleSituation, enableAllSituations, enabledScenes,
    otherRatingPosts, invented.status, libraryOutfitCount, prompts, shortBy, isGenerating, generate, reroll, naturalSourceOf,
  ])
}
