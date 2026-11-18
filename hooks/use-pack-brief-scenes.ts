"use client"

/**
 * The scenes engine for a pack's brief: the source plan, each character's look, the
 * scene pool, the compositions a pose offers, the scenes that fit, and the prompts.
 * The brief's counterpart of usePackScenes (which keeps serving the old builder); the
 * mapping itself lives in lib/pack/brief-pack.ts.
 *
 * Order of calls (the engine's contract): pool without a composition -> poseCompositions
 * -> defaultComposition / castComposition with the poses and the user's pick -> pool of
 * that composition -> sceneCandidates (deferred, never during render) and
 * generateScenePackAsync on Generate.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { BooruPost, BooruProvider } from "@/lib/booru/types"
import type { PackBrief } from "@/lib/pack/brief"
import { briefCompositions, briefConditions, isOthersTag, setRoutePermanence, toSceneRequests } from "@/lib/pack/brief"
import { knownAliases, loadConditionAliases } from "@/lib/pack/condition-aliases"
import {
  briefIdentity,
  lookReplacedByWearing,
  conditionSupply,
  coreKeyOf,
  peopleChoices,
  type ConditionSupply,
  briefPackArgs,
  generateLayout,
  oneAxis,
  placeGenerated,
  leftOutPosts,
  rotationAfter,
  rotationPlan,
  opAfterEnd,
  placeRows,
  peopleLineState,
  resolveLook,
  type BriefOutfit,
  type ResolvedLook,
} from "@/lib/pack/brief-pack"
import { cleanSyntheticPrompt, type BulkSendCleanOptions } from "@/lib/pack/bulk-send"
import { chosenOutfit, loadCharacterOutfits, outfitTags, type CharacterOutfits } from "@/lib/pack/character-outfits"
import { poolSoloShare, profileIdentity, subjectForPool, typicalLook, typicalSubject } from "@/lib/pack/character-identity"
import { normalizeTagForPack, type PackPrompt } from "@/lib/pack/pack-generator"
import { packNaturalSource } from "@/lib/pack/pack-natural"
import type { SavedResult } from "@/lib/pack/saved-pack"
import { loadPackVocabulary, loadedTagBaseline, tagBaselineOf } from "@/lib/pack/pack-vocabulary"
import { resolutionForAspect } from "@/lib/pack/prompt-resolution"
import { planSources, type AppearanceSearch, type SourcePlan } from "@/lib/pack/source-plan"
import { holdsCast, roleFromProfile, roleFromSubject, type CastRole } from "@/lib/pack/scene/cast"
import { createPermanence, type PermanenceData } from "@/lib/pack/scene/permanence"
import type { TagKind } from "@/lib/pack/scene/scene"
import { buildScenePool, compositionOfIdentity, compositionsOf, type PackPeople, type ScenePool } from "@/lib/pack/scene/scene-pool"
import {
  castComposition,
  defaultComposition,
  gelbooruTagKinds,
  generateScenePackAsync,
  poseCompositions,
  poseNeedsScene,
  postsForRating,
  rerollScenePrompt,
  sceneCandidates,
  tagKindsFromPosts,
  untypedTags,
  type LibraryOutfit,
  type PoseComposition,
  type SceneCandidate,
  type ScenePackArgs,
  type ScenePackIssue,
} from "@/lib/pack/scene-pack"
import { clampMaxLongSide } from "@/lib/extension/generation-resolution"
import { ADULT_OUTFIT_STYLES, OUTFIT_STYLES, outfitPackDraw, outfitTags as libraryOutfitTags, type Outfit, type OutfitDetail, type OutfitStyle } from "@/lib/outfit-swap"
import type { NaturalPromptSource } from "@/lib/prompt/natural-format"
import { getCharacterTraits, getNoCharacterTraits, loadCharacterTraits, loadTraitAliases, subscribeCharacterTraits } from "@/lib/prompt/natural-prompt-loader"
import { userPreferences } from "@/lib/storage"
import { fetchGelbooruTagCategories } from "@/lib/supabase/client-queries"
import { yieldToPage, nextPaint } from "@/lib/utils/yield-to-page"
import { useCharacterLooks } from "./use-character-looks"
import { useDebounce } from "./use-debounce"
import { useOutfitDescriptions, useOutfitLibrary } from "./use-outfit-settings"
import { usePromptFormat } from "./use-natural-prompt"
import type { PackRatingMode } from "./use-pack-seed-search"
import { useTagRelations } from "./use-tag-relations"

/** Edits wait this long before the source plan (and so the searches) follows them. */
export const PLAN_DELAY_MS = 400
/** Edits wait this long before the scenes that fit are worked out again. */
const CANDIDATES_DELAY_MS = 150
const GELBOORU_LOOKUP_TIMEOUT_MS = 8000
const LIBRARY_DRAW_SIZE = 60
const NO_POSES: PoseComposition[] = []
const NO_NAMES: string[] = []

export interface UsePackBriefScenesArgs {
  brief: PackBrief
  /** The source's posts (usePackSources' allPosts). */
  posts: readonly BooruPost[]
  /** Posts the source found as the character's own: their scenes go first. */
  preferredPosts: readonly number[]
  provider: BooruProvider
  rating: PackRatingMode
  includeSensitive: boolean
  /** The gallery's search, for a brief without a named character. */
  gallerySearch: string
  promptCount: number
  outfit: BriefOutfit
  overrides: Record<string, string>
  enrichTagSlots: (tags: string[]) => Promise<boolean>
  cleanOptions: Pick<
    BulkSendCleanOptions,
    "excludeInput" | "addInput" | "findInput" | "replaceInput" | "includeCharacters" | "optimizeTags" | "smartTagExclusion" | "experimentalPromptRules"
  >
  globalWeights: Record<string, number>
  isGlobalWeightsEnabled: boolean
  outfitOptions: { styles: readonly OutfitStyle[]; detail: OutfitDetail }
  /** Posts only the donor searches brought (they lend clothes or a place, never a scene of their own). */
  donorPosts?: readonly number[]
  /**
   * The results of a pack kept across a reload (lib/pack/saved-pack.ts), made from `brief` and
   * `outfit` as they are on the first render unless they say otherwise. Read once.
   */
  restored?: SavedResult | null
  /**
   * The source isn't fetching or about to fetch pages: a pack kept across a reload takes the pool
   * then (re-rolls and corrections work on it), not the first page's.
   */
  sourceSettled?: boolean
}

/** How a pack was made, so a correction can make it again the same way. */
export interface PackMade {
  pool: ScenePool
  seed: number
  /** Prompts asked of the engine (the free rows). */
  genCount: number
  preferredPosts: readonly number[]
  /** Scenes of the rows locked at Generate: never used again. */
  lockedScenes: readonly number[]
  /** Scenes this run left aside because the last runs of the same brief used them (another set). */
  skipScenes?: readonly number[]
  /** The row each prompt of the engine went to. */
  slots: readonly number[]
  /** One-part pack: the scene that repeats (part of how it was made, for Undo and corrections). */
  baseScene?: number
  /** Rows re-rolled since, in order, each with its seed and the slot of its row (if any). */
  rerolls: ReadonlyArray<{ index: number; seed: number; slot?: number }>
  /** Where the posts came from (booru, rating, characters): another source makes another pack. */
  sourceKey: string
  /** Kept across a reload: `pool` is a stand-in until the source's posts are back. */
  restored?: true
}

// The pool of a pack kept across a reload until its posts are fetched again: nothing reads it then.
const NO_POOL: ScenePool = buildScenePool([], { overrides: {}, permanence: () => "identity", subject: "girl" })

/** What a correction's remake did: the caller closes its notice in every case. */
export type RecomposeOutcome =
  | { status: "done"; before: BriefPackResult; after: BriefPackResult }
  /** Another run replaced it before it landed. */
  | { status: "superseded" }
  /** Nothing to remake (no pack, no pool, roles missing, or the source changed). */
  | { status: "skipped" }
  | { status: "failed" }

export interface BriefPackResult {
  prompts: PackPrompt[]
  /** Rows that keep their prompt through corrections, re-rolls and Generate. */
  locked: number[]
  shortBy: number
  issues: ScenePackIssue[]
  /** The brief, count and outfit the prompts were made from. */
  brief: PackBrief
  count: number
  outfit: BriefOutfit
  made: PackMade
}

export interface UsePackBriefScenesResult {
  plan: SourcePlan
  /** Each named character's look as read (before the user's edits), keyed by brief tag. */
  looks: Readonly<Record<string, ResolvedLook>>
  identity: ReturnType<typeof briefIdentity>
  /** Per character, the tags of their look the garments in Wearing replace (lookReplacedByWearing). */
  replacedLook: Readonly<Record<string, string[]>>
  /** True for a look tag about the people who are not the characters (isOthersTag), wherever it is typed. */
  othersTag: (tag: string) => boolean
  /** Wearing and Where met as conditions, with the loaded pictures that meet them (for the fit line's forecast). */
  conditionSupply: readonly ConditionSupply[]
  /** Outfits of the library per style allowed at the pack's rating; empty until the library loads. */
  styleCounts: Readonly<Partial<Record<OutfitStyle, number>>>
  /** Styles of the library allowed at the pack's rating. */
  allowedStyles: readonly OutfitStyle[]
  /** The first character's official outfits, by name. */
  officialOutfits: string[]
  /** The permanence data has loaded. */
  ready: boolean
  loadFailed: boolean
  retryLoad: () => void
  /** The pool of the composition in use; null until it can be built. */
  pool: ScenePool | null
  /** poseCompositions: what the requested poses offer. */
  poses: PoseComposition[]
  /** The composition in use. */
  people: PackPeople | null
  /** Every composition of the pool the characters fit in; null until the pool is built. */
  available: PoseComposition[] | null
  peopleLine: ReturnType<typeof peopleLineState>
  /** The make-ups the pack uses: the ones the brief marks, else the one the scenes give. */
  peopleSelected: readonly PackPeople[]
  /** Make-ups the scenes have with no room for the characters: shown, not offered. */
  peopleBlocked: readonly PoseComposition[]
  /** Scenes that fit (left-out ones included, so they stay on the sheet); null until worked out once. */
  candidates: SceneCandidate[] | null
  /** The scenes are being worked out again; `candidates` are the previous ones. */
  candidatesPending: boolean
  result: BriefPackResult | null
  isGenerating: boolean
  /** A correction is being applied. */
  isCorrecting: boolean
  /** Any run is going on: re-roll and the tag menu wait for it. */
  busy: boolean
  /** The pack was made from another source (booru, rating, characters): corrections and re-rolls need Generate first. */
  sourceChanged: boolean
  /** A pack kept across a reload whose posts aren't back yet: corrections and re-rolls wait for them. */
  poolPending: boolean
  /** Generates; `count` defaults to the brief's. */
  generate: () => void
  /** Remakes the pack for the brief as it is now (a correction from the results). */
  recompose: () => Promise<RecomposeOutcome>
  /** Puts a pack back as it was (Undo of a correction). */
  restore: (snapshot: BriefPackResult | null) => void
  toggleLock: (index: number) => void
  /** Replaces one prompt with another scene. False when there is none left. */
  reroll: (index: number) => boolean
  naturalSourceOf: (prompt: PackPrompt) => NaturalPromptSource
}

function sizePrefs() {
  try {
    return { maxLongSide: clampMaxLongSide(userPreferences.getMatchResolutionMaxLongSide()), strictCap: userPreferences.getMatchResolutionStrictCap() }
  } catch {
    return { maxLongSide: 1536, strictCap: false }
  }
}

const peopleKeyOf = (people: PackPeople | null | undefined) => (people ? `${people.girls}/${people.boys}` : "")
const fromPeopleKey = (key: string): PackPeople | null => {
  if (!key) return null
  const [girls, boys] = key.split("/").map(Number)
  return { girls, boys }
}

/** Every appearance search, once. */
function mergeSearches(...lists: ReadonlyArray<readonly AppearanceSearch[]>): AppearanceSearch[] {
  const seen = new Set<string>()
  return lists.flat().filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
}

/** Tags of the posts, display-normalized, for the slot lookup. */
function postTagNames(posts: readonly BooruPost[]): string[] {
  const out = new Set<string>()
  for (const post of posts) {
    for (const raw of [post.tag_string, post.tag_string_character]) {
      if (!raw) continue
      for (const tag of raw.split(/\s+/)) {
        const name = normalizeTagForPack(tag)
        if (name) out.add(name)
      }
    }
  }
  return Array.from(out)
}

export function usePackBriefScenes(args: UsePackBriefScenesArgs): UsePackBriefScenesResult {
  const {
    brief, posts, preferredPosts, provider, rating, includeSensitive, gallerySearch, promptCount, outfit, overrides,
    enrichTagSlots, cleanOptions, globalWeights, isGlobalWeightsEnabled, outfitOptions, donorPosts,
  } = args
  const restoredArgs = args.restored
  const sourceSettled = args.sourceSettled ?? true
  const relations = useTagRelations(true)

  // ── Who: trait profiles and the characters' looks ─────────────────────────────
  // From a key, not from `brief.who`: every edit of the brief makes a new array, and
  // everything downstream (looks, identity, the scenes that fit) would be worked out again.
  const namedKey = brief.who.flatMap((c) => (c.tag ? [c.tag] : [])).join("|")
  const named = useMemo(() => (namedKey ? namedKey.split("|") : NO_NAMES), [namedKey])
  /** Where the posts come from: a pack made from another one can't be corrected on it. */
  const sourceKey = `${provider}|${rating}|${rating === "sfw" ? includeSensitive : ""}|${namedKey}`
  const traitData = useSyncExternalStore(subscribeCharacterTraits, getCharacterTraits, getNoCharacterTraits)
  useEffect(() => {
    if (namedKey) void loadCharacterTraits(namedKey.split("|")).catch(() => {})
  }, [namedKey])
  const [baseline, setBaseline] = useState(loadedTagBaseline)
  useEffect(() => {
    if (baseline) return
    let active = true
    void loadPackVocabulary().then((v) => { if (active && v) setBaseline(tagBaselineOf(v)) }).catch(() => {})
    return () => { active = false }
  }, [baseline])

  const profileOf = useCallback(
    (character: string) => {
      const name = normalizeTagForPack(character)
      return traitData.profiles[name] ?? traitData.profiles[traitData.aliases[name] ?? ""]
    },
    [traitData]
  )
  const profileRoles = useMemo(() => {
    const out: Record<string, CastRole | null> = {}
    for (const c of named) out[c] = roleFromProfile(profileOf(c))
    return out
  }, [named, profileOf])
  const profileLooks = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const c of named) out[c] = profileOf(c) ? profileIdentity(c, traitData.profiles, overrides, traitData.aliases, baseline) : []
    return out
  }, [named, profileOf, traitData, overrides, baseline])
  useEffect(() => {
    const tags = Object.values(profileLooks).flat()
    if (tags.length > 0) void enrichTagSlots(tags).catch(() => false)
  }, [profileLooks, enrichTagSlots])

  // ── The source plan ───────────────────────────────────────────────────────────
  // Edits settle before the searches follow them.
  const plannedBrief = useDebounce(brief, PLAN_DELAY_MS)
  const env = useMemo(() => ({ provider, rating, includeSensitive, gallerySearch }), [provider, rating, includeSensitive, gallerySearch])
  const plannedNamed = useMemo(() => plannedBrief.who.flatMap((c) => (c.tag ? [c] : [])), [plannedBrief])
  // The appearance searches don't depend on the roles but for whether the pool is the
  // base character's: ask for both plans' searches, so a role that arrives later finds them.
  const lookSearches = useMemo(() => {
    const known = planSources(plannedBrief, { ...env, roles: plannedNamed.map((c) => c.role ?? profileRoles[c.tag!] ?? null) })
    const asGroup = plannedNamed.length >= 2 ? planSources(plannedBrief, { ...env, roles: plannedNamed.map(() => "girl" as const) }).appearance : []
    return mergeSearches(known.appearance, asGroup)
  }, [plannedBrief, plannedNamed, env, profileRoles])
  const soloLooks = useCharacterLooks({ searches: lookSearches, provider, overrides, enrichTagSlots })
  const soloOf = useCallback((character: string) => {
    const key = normalizeTagForPack(character)
    return soloLooks[character] ?? Object.entries(soloLooks).find(([name]) => normalizeTagForPack(name) === key)?.[1]
  }, [soloLooks])

  const plan = useMemo(() => {
    const roles = plannedNamed.map((c) => {
      const solo = soloOf(c.tag!)
      const fromSubject = solo?.status === "ready" ? roleFromSubject(solo.subject) : null
      return c.role ?? fromSubject ?? profileRoles[c.tag!] ?? null
    })
    // A pack mixing make-ups searches with no head count (one-part packs never mix).
    const mix = plannedBrief.changes === "scene" ? briefCompositions(plannedBrief) : []
    return planSources(plannedBrief, { ...env, roles, conditions: briefConditions(plannedBrief, overrides), ...(mix.length >= 2 ? { compositions: mix } : {}) })
  }, [plannedBrief, plannedNamed, env, soloOf, profileRoles, overrides])

  // ── Looks ─────────────────────────────────────────────────────────────────────
  const base = named[0] ?? null
  const poolIsOwn = plan.scenes.length === 1 && plan.scenes[0].kind === "own"
  const soloShare = useMemo(() => poolSoloShare(posts), [posts])
  const poolLook = useMemo(() => {
    if (!poolIsOwn || !base || posts.length === 0) return null
    const look = typicalLook(posts, base, overrides, baseline)
    if (!look?.length) return null
    return { look, subject: subjectForPool(typicalSubject(posts, base, overrides) ?? [], soloShare) }
  }, [poolIsOwn, base, posts, overrides, baseline, soloShare])
  const looks = useMemo(() => {
    const out: Record<string, ResolvedLook> = {}
    named.forEach((c, i) => {
      const solo = soloOf(c)
      out[c] = resolveLook({
        solo: solo ? { ...solo, subject: subjectForPool(solo.subject, soloShare) } : null,
        pool: i === 0 ? poolLook : null,
        profile: profileLooks[c],
        inCast: named.length >= 2,
      })
    })
    return out
  }, [named, soloOf, soloShare, poolLook, profileLooks])

  // ── Permanence data ───────────────────────────────────────────────────────────
  const [permanenceData, setPermanenceData] = useState<PermanenceData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  useEffect(() => {
    if (permanenceData) return
    const controller = new AbortController()
    fetch("/tag-permanence.json", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`tag-permanence.json: HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (!data || typeof data !== "object" || !Array.isArray(data.state)) throw new Error("Invalid tag-permanence.json format")
        setPermanenceData(data as PermanenceData)
      })
      .catch((err) => {
        if (err?.name === "AbortError") return
        console.error("Failed to load tag permanence:", err)
        setLoadFailed(true)
      })
    return () => controller.abort()
  }, [permanenceData, loadAttempt])
  const retryLoad = useCallback(() => {
    setLoadFailed(false)
    setLoadAttempt((n) => n + 1)
  }, [])
  const permanence = useMemo(() => (permanenceData ? createPermanence(permanenceData, overrides) : null), [permanenceData, overrides])
  // Where a typed tag goes reads the same permanence data (what lasts, what belongs to the picture).
  useEffect(() => { setRoutePermanence(permanence ?? undefined) }, [permanence])

  // ── Identity ─────────────────────────────────────────────────────────────────
  // Everything but the left-out scenes: leaving a scene out must not rebuild the pool or the sheet.
  // A one-part pack keeps the whole-scene choices (they rule out scenes) and shows its
  // variants left out on the sheet; the scene that repeats is part of it.
  const axis = oneAxis(brief)
  const coreKey = coreKeyOf(brief)
  const coreBrief = useMemo<PackBrief>(
    () => ({ ...brief, leftOut: axis ? brief.leftOut : [], leftOutVariants: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coreKey]
  )
  const identity = useMemo(
    () => briefIdentity({ brief: coreBrief, looks, profileRoles, permanence: permanence ?? (() => "identity"), overrides }),
    [coreBrief, looks, profileRoles, permanence, overrides]
  )
  const replacedLook = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const c of coreBrief.who) {
      if (c.tag) out[c.tag] = lookReplacedByWearing(coreBrief, looks[c.tag]?.look ?? [], overrides, permanence ?? (() => "identity"))
    }
    return out
  }, [coreBrief, looks, overrides, permanence])
  const castRoles = useMemo(() => identity.members.map((m) => m.role), [identity.members])
  const othersTag = useCallback(
    (tag: string) => !!permanence && isOthersTag(tag, castRoles, overrides, permanence),
    [castRoles, overrides, permanence]
  )
  const { subject, cast, castSize, missingRoles } = identity
  const castKey = peopleKeyOf(cast)
  const isCast = castSize >= 2

  // ── The pool ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (posts.length > 0) void enrichTagSlots(postTagNames(posts)).catch(() => false)
  }, [posts, enrichTagSlots])
  const rated = useMemo(() => postsForRating(posts as BooruPost[], rating), [posts, rating])
  const postKinds = useMemo(() => tagKindsFromPosts(rated), [rated])

  // Gelbooru: its own tag list tells names apart, as in usePackScenes.
  const lookupNames = useMemo(() => (provider === "gelbooru" ? untypedTags(rated, postKinds, overrides) : null), [provider, rated, postKinds, overrides])
  const lookupKey = lookupNames ? lookupNames.join("\n") : null
  const [lookup, setLookup] = useState<{ key: string; kinds: Map<string, TagKind> | null } | null>(null)
  useEffect(() => {
    if (lookupKey === null || !lookupNames) return
    let active = true
    const timer = setTimeout(() => { if (active) setLookup({ key: lookupKey, kinds: null }) }, GELBOORU_LOOKUP_TIMEOUT_MS)
    fetchGelbooruTagCategories(lookupNames)
      .then((categories) => { if (active) setLookup({ key: lookupKey, kinds: gelbooruTagKinds(categories) }) })
      .catch(() => { if (active) setLookup({ key: lookupKey, kinds: null }) })
      .finally(() => clearTimeout(timer))
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [lookupKey, lookupNames])
  const waitingForLookup = lookupKey !== null && lookup === null
  const tableKinds = lookupKey !== null ? lookup?.kinds ?? null : null
  const tagKinds = useMemo(() => {
    if (!tableKinds) return postKinds
    const merged = new Map(tableKinds)
    if (lookupKey !== lookup?.key) lookupNames?.forEach((tag) => { if (!merged.has(tag)) merged.set(tag, "unlisted") })
    postKinds.forEach((kind, tag) => merged.set(tag, kind))
    return merged
  }, [postKinds, tableKinds, lookupKey, lookup, lookupNames])

  const castPeopleMemo = useMemo(() => fromPeopleKey(castKey)!, [castKey])
  const basePool = useMemo(() => {
    if (!permanence || waitingForLookup || rated.length === 0) return null
    return buildScenePool(rated, { overrides, permanence, subject, cast: castPeopleMemo, tagKind: (tag) => tagKinds.get(tag), provider })
  }, [permanence, waitingForLookup, rated, overrides, subject, castPeopleMemo, tagKinds, provider])

  const requests = useMemo(() => toSceneRequests(coreBrief), [coreBrief])
  const leftOutKey = brief.leftOut.join(",")
  const poseArgs = useMemo(
    // The donors' posts only lend: they are no scene of the pack, so they count in no composition.
    () => ({ requests, never: identity.never, overrides, removedScenes: [...(leftOutKey ? leftOutKey.split(",").map(Number) : []), ...(donorPosts ?? [])] }),
    // `relations` is read inside poseCompositions: a new value means new answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, identity.never, overrides, leftOutKey, relations, donorPosts]
  )
  const poses = useMemo(() => (basePool ? poseCompositions(basePool, poseArgs) : NO_POSES), [basePool, poseArgs])

  const firstCandidates = identity.members[0]?.candidates ?? NO_NAMES
  // The make-ups of the scenes that can be a prompt's scene: the donors' posts only lend, so
  // they count in none (the pool's own stats count every scene).
  const sceneCompositions = useMemo(() => {
    if (!basePool) return null
    if (!donorPosts?.length) return basePool.stats.compositions
    const donors = new Set(donorPosts)
    return compositionsOf((basePool.allScenes ?? basePool.scenes).filter((scene) => !donors.has(scene.postId)))
  }, [basePool, donorPosts])
  // The make-ups with room for the characters (one or several), the requested poses' apart; those
  // without room are only shown, once (peopleChoices). Null until the pool is built.
  const choices = useMemo(
    () => (sceneCompositions ? peopleChoices({ compositions: sceneCompositions, poses, cast: castPeopleMemo, hasPoses: requests.select.length > 0 }) : null),
    [sceneCompositions, poses, castPeopleMemo, requests.select.length]
  )
  const available = choices?.fitting ?? null
  const peopleKey = useMemo(() => {
    if (!basePool || !choices || missingRoles.length > 0) return ""
    // Only make-ups with room for the characters: the default can't be one without.
    if (isCast) return peopleKeyOf(castComposition(choices.fitting, castPeopleMemo, brief.people, choices.fittingPoses))
    const declared = compositionOfIdentity(firstCandidates)
    return peopleKeyOf(defaultComposition(choices.fitting, subject, brief.people, { declared, character: !!base }, choices.fittingPoses))
  }, [basePool, choices, missingRoles, isCast, castPeopleMemo, brief.people, firstCandidates, subject, base])
  const people = useMemo(() => fromPeopleKey(peopleKey), [peopleKey])

  const pool = useMemo(() => {
    if (!basePool || !permanence) return null
    if (!people || peopleKey === peopleKeyOf(basePool.stats.composition)) return basePool
    return buildScenePool(rated, { overrides, permanence, subject, cast: castPeopleMemo, tagKind: (tag) => tagKinds.get(tag), people, provider })
  }, [basePool, permanence, people, peopleKey, rated, overrides, subject, castPeopleMemo, tagKinds, provider])

  const peopleLine = useMemo(
    () => peopleLineState({
      poses: requests.select,
      needsCompany: (tag) => poseNeedsScene(tag, overrides, relations),
      // Only the make-ups with room for the characters: "2 boys" is no option for one girl.
      compositions: choices?.fittingPoses ?? NO_POSES,
      current: people,
      picked: brief.people,
      available: available ?? undefined,
      // The pack uses one make-up: whenever the scenes have several, the line shows them.
      whenSeveral: true,
    }),
    [requests.select, overrides, relations, choices, people, brief.people, available]
  )
  // Several make-ups: the ones the brief marks with room for the characters, the first being `people`.
  const mixKey = JSON.stringify(axis ? [] : briefCompositions(coreBrief))
  const peopleSelected = useMemo<PackPeople[]>(() => {
    const marked = (JSON.parse(mixKey) as PackPeople[]).filter((p) => holdsCast(p, castPeopleMemo))
    return marked.length > 0 ? marked : people ? [people] : []
  }, [mixKey, castPeopleMemo, people])
  const peopleBlocked = choices?.blocked ?? NO_POSES

  // ── Clothes ───────────────────────────────────────────────────────────────────
  const [outfitData, setOutfitData] = useState<ReadonlyMap<string, CharacterOutfits | null>>(() => new Map())
  useEffect(() => {
    if (!namedKey) return
    let active = true
    const names = namedKey.split("|").map(normalizeTagForPack)
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
    return () => { active = false }
  }, [namedKey])
  const firstOutfits = base ? outfitData.get(normalizeTagForPack(base)) ?? null : null
  const officialOutfits = useMemo(() => firstOutfits?.official.map((o) => o.name) ?? NO_NAMES, [firstOutfits])
  const characterOutfits = useMemo(() => {
    if (outfit.kind !== "usual" && outfit.kind !== "official") return undefined
    const map = new Map<string, string[]>()
    identity.blocks.forEach((block, i) => {
      const outfits = outfitData.get(block.character)
      if (!outfits) return
      const picked = i === 0 && outfit.kind === "official" ? chosenOutfit(outfits, outfit.name) : chosenOutfit(outfits, undefined)
      map.set(block.character, outfitTags(outfits, picked))
    })
    return map
  }, [outfit, identity.blocks, outfitData])

  const useLibrary = outfit.kind === "library"
  // The library also offers its styles in Wearing and lends outfits to the conditions: loaded with the pack.
  const outfitLibrary = useOutfitLibrary(true)
  const allowedStyles = useMemo(
    () => OUTFIT_STYLES.filter((style) => rating !== "sfw" || !ADULT_OUTFIT_STYLES.includes(style)),
    [rating]
  )
  const styleCounts = useMemo(() => {
    const out: Partial<Record<OutfitStyle, number>> = {}
    for (const o of outfitLibrary) if (allowedStyles.includes(o.style)) out[o.style] = (out[o.style] ?? 0) + 1
    return out
  }, [outfitLibrary, allowedStyles])
  // Every outfit allowed at the rating, whole, for the conditions and the styles (ScenePackArgs.outfitLibrary).
  const conditionLibrary = useMemo<LibraryOutfit[]>(
    () => outfitLibrary
      .filter((o) => allowedStyles.includes(o.style))
      .map((o) => ({ outfitId: o.id, tags: libraryOutfitTags(o, "full").map(normalizeTagForPack), style: o.style })),
    [outfitLibrary, allowedStyles]
  )
  const conditions = useMemo(() => briefConditions(coreBrief, overrides), [coreBrief, overrides])
  // Other names of the conditions: asked once, never waited for.
  const conditionsKey = conditions.map(normalizeTagForPack).sort().join("|")
  const [aliases, setAliases] = useState<{ key: string; names: Record<string, string[]> }>({ key: "", names: {} })
  useEffect(() => {
    if (!conditionsKey) return
    let active = true
    void loadConditionAliases(conditionsKey.split("|")).then((names) => { if (active) setAliases({ key: conditionsKey, names }) })
    return () => { active = false }
  }, [conditionsKey])
  const conditionAliases = useMemo(
    () => (aliases.key === conditionsKey ? aliases.names : knownAliases(conditions)),
    [aliases, conditionsKey, conditions]
  )
  // The different forms of each condition the loaded scenes and the library offer, for the fit
  // line before generating: what condition-variety will count, at most.
  const supply = useMemo(() => {
    if (!basePool) return []
    const scenes = basePool.allScenes ?? basePool.scenes
    const wearing = requests.wearing.filter((t) => conditions.includes(t))
    const where = requests.where.filter((t) => conditions.includes(t))
    const styles = (coreBrief.outfitStyles ?? []).filter((style) => allowedStyles.includes(style as OutfitStyle))
    const base = { scenes, library: conditionLibrary, overrides, aliases: conditionAliases }
    return [
      ...(wearing.length > 0 || styles.length > 0 ? [conditionSupply({ ...base, role: "wearing", tags: wearing, styles })] : []),
      ...(where.length > 0 ? [conditionSupply({ ...base, role: "where", tags: where })] : []),
    ]
  }, [basePool, requests, conditions, coreBrief.outfitStyles, allowedStyles, conditionLibrary, overrides, conditionAliases])
  const libraryStyles = useMemo(
    () => (rating === "sfw" ? outfitOptions.styles.filter((s) => !ADULT_OUTFIT_STYLES.includes(s)) : outfitOptions.styles),
    [rating, outfitOptions.styles]
  )

  // ── Arguments ─────────────────────────────────────────────────────────────────
  const characterTags = useMemo(() => named.map(normalizeTagForPack), [named])
  const clean = useCallback<ScenePackArgs["clean"]>(
    (tags, locked) => cleanSyntheticPrompt(
      tags,
      characterTags,
      { ...cleanOptions, optimizeTags: false, tagOverrides: overrides, globalWeights, isGlobalWeightsEnabled, lockedTags: locked },
      locked
    ),
    [characterTags, cleanOptions, overrides, globalWeights, isGlobalWeightsEnabled]
  )
  const argsFor = useCallback(
    (forBrief: PackBrief, seed: number, count: number, baseScene?: number): ScenePackArgs => {
      const library: LibraryOutfit[] | undefined = useLibrary && outfitLibrary.length > 0
        ? outfitPackDraw(outfitLibrary, libraryStyles, outfitOptions.detail, seed, LIBRARY_DRAW_SIZE)
            .map(({ outfit: o, tags }) => ({ outfitId: o.id, tags: tags.map(normalizeTagForPack) }))
        : undefined
      const prefs = sizePrefs()
      return briefPackArgs(forBrief, identity, {
        overrides,
        permanence: permanence ?? (() => "identity"),
        count,
        seed,
        people,
        preferredPosts,
        outfit,
        characterOutfits,
        library,
        clean,
        resolution: (aspect) => resolutionForAspect(aspect, prefs),
        baseScene,
        conditions: briefConditions(forBrief, overrides),
        outfitStyles: (forBrief.outfitStyles ?? []).filter((style) => allowedStyles.includes(style as OutfitStyle)),
        donorPosts,
        outfitLibrary: conditionLibrary,
        conditionAliases,
        compositions: oneAxis(forBrief) ? [] : briefCompositions(forBrief).filter((p) => holdsCast(p, castPeopleMemo)),
      })
    },
    [useLibrary, outfitLibrary, libraryStyles, outfitOptions.detail, identity, overrides, permanence, people, preferredPosts, outfit, characterOutfits, clean, allowedStyles, donorPosts, conditionLibrary, conditionAliases, castPeopleMemo]
  )

  // The pack made last (see "Generating and correcting" below).
  // A pack kept across a reload starts with its rows; its pool comes with the posts (below).
  const [result, setResult] = useState<BriefPackResult | null>(() => restoredArgs
    ? {
        prompts: restoredArgs.prompts,
        locked: restoredArgs.locked,
        shortBy: restoredArgs.shortBy,
        issues: restoredArgs.issues,
        count: restoredArgs.count,
        // The same objects as the pack's when the prompts were made from them: not out of date.
        brief: restoredArgs.brief ?? brief,
        outfit: restoredArgs.outfit ?? outfit,
        made: { ...restoredArgs.made, pool: NO_POOL, restored: true },
      }
    : null)
  // The posts are back, from the same source, and done loading: the pack is whole again.
  if (result?.made.restored && pool && sourceSettled && result.made.sourceKey === sourceKey) {
    const { restored: _done, ...made } = result.made
    void _done
    setResult({ ...result, made: { ...made, pool } })
  }
  const resultRef = useRef(result)
  useEffect(() => { resultRef.current = result }, [result])

  // ── The scenes that fit (deferred: up to a second and a half of work) ─────────
  // A one-part pack with locked rows keeps repeating the scene those rows repeat.
  const keptBase = axis && result && result.locked.length > 0 ? result.made.baseScene : undefined
  const [candidateState, setCandidateState] = useState<{ pool: ScenePool; args: unknown; axis: string | null; list: SceneCandidate[] } | null>(null)
  const candidateArgs = useMemo(
    () => (pool && missingRoles.length === 0 ? argsFor(coreBrief, 1, 1, keptBase) : null),
    [pool, missingRoles, argsFor, coreBrief, keptBase]
  )
  useEffect(() => {
    if (!pool || !candidateArgs) return
    let active = true
    const timer = setTimeout(() => {
      if (!active) return
      try {
        const list = sceneCandidates(pool, candidateArgs)
        if (active) setCandidateState({ pool, args: candidateArgs, axis: candidateArgs.changes ?? null, list })
      } catch (err) {
        console.error("Working out the pack's scenes failed:", err)
      }
    }, CANDIDATES_DELAY_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [pool, candidateArgs])
  const candidatesPending = !!pool && !!candidateArgs && (candidateState?.pool !== pool || candidateState?.args !== candidateArgs)

  // ── Generating and correcting ─────────────────────────────────────────────────
  // A pack is a function of (brief, source, seed, locked rows, re-rolls): Generate draws a
  // seed; a correction remakes the free rows with the same seed, pool and scene order; a
  // re-roll is replayed with its own seed. One operation runs at a time: each has an id,
  // only the newest is applied, and every one clears its own indicator in `finally`.
  const [op, setOp] = useState<{ id: number; kind: "generate" | "correct" } | null>(null)
  // The scenes used by the runs of one brief (another set each time; see generate).
  const rotationRef = useRef<{ brief: PackBrief; used: number[] } | null>(null)
  const opRef = useRef(0)
  const startOp = useCallback((kind: "generate" | "correct") => {
    const id = ++opRef.current
    setOp({ id, kind })
    return id
  }, [])
  // Only the operation that still owns the indicator clears it: one that replaced it keeps it.
  const endOp = useCallback((id: number) => setOp((cur) => opAfterEnd(cur, id)), [])
  const control = useCallback((id: number) => {
    let first = true
    return {
      pause: () => {
        if (!first) return yieldToPage()
        first = false
        return nextPaint()
      },
      cancelled: () => opRef.current !== id,
    }
  }, [])

  /** The engine's arguments for a run of `made`. */
  const runArgs = useCallback((forBrief: PackBrief, made: PackMade): ScenePackArgs => {
    const base = argsFor(forBrief, made.seed, made.genCount, made.baseScene)
    return {
      ...base,
      preferredPosts: made.preferredPosts,
      removedScenes: [...(base.removedScenes ?? []), ...made.lockedScenes, ...(made.skipScenes ?? [])],
    }
  }, [argsFor])

  /** Replays the re-rolls on fresh rows: each on the row its slot went to, if that row is still free. */
  const replayRerolls = useCallback((rows: PackPrompt[], locked: ReadonlySet<number>, slots: readonly number[], made: PackMade, forBrief: PackBrief) => {
    let out = rows
    const kept: PackMade["rerolls"][number][] = []
    for (const r of made.rerolls) {
      const index = r.slot !== undefined ? slots[r.slot] : r.index
      if (index === undefined || index >= out.length || locked.has(index)) continue
      const replacement = rerollScenePrompt(made.pool, out, index, argsFor(forBrief, r.seed, made.genCount, made.baseScene))
      if (!replacement) continue
      out = out.map((p, i) => (i === index ? replacement : p))
      kept.push({ ...r, index })
    }
    return { rows: out, rerolls: kept }
  }, [argsFor])

  /** Issues of a run, counted over the whole pack (rows it didn't remake included). */
  const withKept = (issues: ScenePackIssue[], kept: number): ScenePackIssue[] =>
    kept === 0 ? issues : issues.map((issue) =>
      issue.kind === "few-scenes" || issue.kind === "few-variations" ? { ...issue, prompts: issue.prompts + kept } : issue)

  // The scene the sheet marks as the one that repeats is the one Generate repeats.
  // Only from the list made for this pool, part and arguments (not one still being replaced).
  const fixedBase = axis && candidateState?.pool === pool && candidateState.axis === axis && candidateState.args === candidateArgs &&
    candidateState.list[0]?.axisRole === "base" ? candidateState.list[0].postId : undefined

  const generate = useCallback(() => {
    if (!pool || missingRoles.length > 0) return
    const id = startOp("generate")
    // Generate replaces the pack: locked rows stay in their place, every other row is new,
    // and none is made from a locked row's scene.
    const before = resultRef.current
    const previous = before?.prompts ?? []
    const locked = new Set((before?.locked ?? []).filter((i) => i < previous.length))
    const layout = generateLayout(locked, promptCount)
    const slots = layout.slots
    // A one-part pack repeats one scene: what a row holds of its own is its donor.
    const ownScene = (p: PackPrompt | undefined) => {
      const scene = p?.scene
      if (!scene) return undefined
      return axis ? scene.donors?.find((d) => d !== scene.postId) : scene.postId
    }
    const lockedScenes = Array.from(locked).flatMap((i) => {
      const own = ownScene(previous[i])
      return own !== undefined ? [own] : []
    })
    // Generate again draws another set: for the same brief, the scenes the last runs used
    // stay aside while the rest are enough, then the cycle starts again. The source's own
    // posts still go first; in a one-part pack the variants turn, never the scene that repeats.
    const listed = candidateState?.pool === pool && (candidateState.axis ?? null) === (axis ?? null) ? candidateState.list : null
    const leftOutIds = new Set(leftOutPosts(brief))
    const lockedSet = new Set(lockedScenes)
    const available = (listed ? (axis ? listed.slice(1) : listed).map((c) => c.postId) : pool.scenes.map((sc) => sc.postId))
      .filter((pid) => !leftOutIds.has(pid) && !lockedSet.has(pid))
    const cycle = rotationRef.current?.brief === brief ? rotationRef.current.used : []
    const turn = rotationPlan({ available, used: cycle, needed: slots.length, own: preferredPosts })
    const preferred = turn.preferred
    const made: PackMade = {
      pool,
      seed: Math.floor(Math.random() * 1e9),
      genCount: slots.length,
      preferredPosts: preferred,
      lockedScenes,
      skipScenes: turn.exclude,
      slots,
      // With locked rows, the scene they repeat is the pack's; otherwise the one the sheet marks.
      baseScene: axis ? (locked.size > 0 ? before?.made.baseScene : undefined) ?? brief.baseScene ?? fixedBase : undefined,
      rerolls: [],
      sourceKey,
    }
    const startedWith = { brief, count: promptCount, outfit }
    void (async () => {
      try {
        const out = await generateScenePackAsync(pool, runArgs(brief, made), control(id))
        if (opRef.current !== id || !out) return
        rotationRef.current = {
          brief,
          used: rotationAfter(turn, cycle, out.prompts.flatMap((p) => {
            const own = ownScene(p)
            return own !== undefined ? [own] : []
          })),
        }
        // Applied on the pack as it is now: a row locked meanwhile keeps its prompt.
        setResult((prev) => {
          const now = new Set(prev?.locked ?? [])
          const placed = placeGenerated(prev?.prompts ?? previous, layout, out.prompts, now)
          return {
            prompts: placed.rows,
            locked: placed.locked,
            shortBy: Math.max(0, promptCount - placed.rows.length),
            issues: withKept(out.issues, placed.rows.length - out.prompts.length),
            made: { ...made, slots: placed.slots, baseScene: axis ? made.baseScene ?? out.prompts[0]?.scene?.postId : undefined },
            ...startedWith,
          }
        })
      } catch (err) {
        console.error("Scene pack generation failed:", err)
      } finally {
        endOp(id)
      }
    })()
  }, [pool, missingRoles, startOp, endOp, promptCount, axis, preferredPosts, brief, fixedBase, sourceKey, outfit, runArgs, control, candidateState])

  /**
   * Remakes the pack for the brief as it is now: same seed, same pool (unless the brief
   * asks for other people), same scene order. Rows that are locked, or that no slot
   * remakes, stay. Says what happened, so the caller always closes its notice.
   */
  const recompose = useCallback(async (): Promise<RecomposeOutcome> => {
    const before = resultRef.current
    if (!before || !pool || missingRoles.length > 0 || before.made.restored || before.made.sourceKey !== sourceKey) return { status: "skipped" }
    const id = startOp("correct")
    const samePeople = peopleKeyOf(before.made.pool.stats.composition) === peopleKeyOf(pool.stats.composition)
    const made: PackMade = samePeople ? before.made : { ...before.made, pool }
    try {
      const out = await generateScenePackAsync(made.pool, runArgs(brief, made), control(id))
      if (opRef.current !== id || !out) return { status: "superseded" }
      // On the pack as it is now (locks changed meanwhile count).
      const now = resultRef.current ?? before
      const locked = new Set(now.locked)
      const placed = placeRows(now.prompts, locked, made.slots, out.prompts)
      const replayed = replayRerolls(placed.rows, new Set(placed.locked), placed.slots, made, brief)
      // A row whose text didn't change keeps its object: it doesn't redraw or convert again.
      const prompts = replayed.rows.map((p, i) => (now.prompts[i]?.prompt === p.prompt ? now.prompts[i] : p))
      const after: BriefPackResult = {
        prompts,
        locked: placed.locked,
        shortBy: Math.max(0, now.count - prompts.length),
        issues: withKept(out.issues, prompts.length - out.prompts.length),
        made: { ...made, slots: placed.slots, rerolls: replayed.rerolls },
        brief,
        count: now.count,
        outfit,
      }
      resultRef.current = after
      setResult(after)
      return { status: "done", before: now, after }
    } catch (err) {
      console.error("Remaking the pack failed:", err)
      return { status: "failed" }
    } finally {
      endOp(id)
    }
  }, [pool, missingRoles, sourceKey, startOp, endOp, brief, outfit, runArgs, replayRerolls, control])

  /** Puts a pack back exactly as it was (Undo of a correction). Cancels a run on its way. */
  const restore = useCallback((snapshot: BriefPackResult | null) => {
    opRef.current++
    setOp(null)
    setResult(snapshot)
  }, [])

  // Locking works at any time: a run that lands later reads the locks it finds then.
  const toggleLock = useCallback((index: number) => {
    setResult((prev) => {
      if (!prev || index < 0 || index >= prev.prompts.length) return prev
      const locked = prev.locked.includes(index) ? prev.locked.filter((i) => i !== index) : [...prev.locked, index].sort((a, b) => a - b)
      return { ...prev, locked }
    })
  }, [])

  // A re-roll follows the brief as it is now, never touches a locked row, and waits for no
  // run (the interface offers it only when none is running and the source is the pack's).
  const reroll = useCallback((index: number): boolean => {
    const now = resultRef.current
    if (!now || op || index < 0 || index >= now.prompts.length || now.locked.includes(index)) return false
    if (now.made.sourceKey !== sourceKey || now.made.restored) return false
    const seed = Math.floor(Math.random() * 1e9)
    const replacement = rerollScenePrompt(now.made.pool, now.prompts, index, argsFor(brief, seed, now.made.genCount, now.made.baseScene))
    if (!replacement) return false
    const slot = now.made.slots.indexOf(index)
    setResult((prev) => (prev ? {
      ...prev,
      prompts: prev.prompts.map((p, i) => (i === index ? replacement : p)),
      made: {
        ...prev.made,
        rerolls: [...prev.made.rerolls.filter((r) => r.index !== index), { index, seed, ...(slot >= 0 ? { slot } : {}) }],
      },
    } : prev))
    return true
  }, [op, sourceKey, brief, argsFor])

  // ── Natural-language formats ──────────────────────────────────────────────────
  const { format: promptFormat } = usePromptFormat()
  const outfitDescriptions = useOutfitDescriptions(useLibrary && promptFormat !== "tags" && outfitLibrary.length > 0)
  const outfitsById = useMemo(() => new Map<number, Outfit>(outfitLibrary.map((o) => [o.id, o])), [outfitLibrary])
  const naturalSourceOf = useCallback(
    (prompt: PackPrompt) => packNaturalSource(prompt, {
      provider,
      character: characterTags[0] ?? null,
      characters: characterTags,
      contentRating: rating,
      outfits: outfitsById,
      descriptions: outfitDescriptions,
    }),
    [provider, characterTags, rating, outfitsById, outfitDescriptions]
  )

  return useMemo(() => ({
    plan,
    looks,
    identity,
    replacedLook,
    othersTag,
    conditionSupply: supply,
    styleCounts,
    allowedStyles,
    officialOutfits,
    ready: !!permanence,
    loadFailed: loadFailed && !permanence,
    retryLoad,
    pool,
    poses,
    people,
    available,
    peopleLine,
    peopleSelected,
    peopleBlocked,
    // Another part (or none) than the one asked for is another list: not shown as this one.
    // Nothing when there is nothing to work them out from (roles missing, no pool).
    candidates: pool && candidateArgs && candidateState && candidateState.axis === (axis ?? null) ? candidateState.list : null,
    candidatesPending,
    result,
    isGenerating: op?.kind === "generate",
    isCorrecting: op?.kind === "correct",
    busy: !!op,
    sourceChanged: !!result && result.made.sourceKey !== sourceKey,
    poolPending: !!result?.made.restored,
    generate,
    recompose,
    restore,
    toggleLock,
    reroll,
    naturalSourceOf,
  }), [
    plan, looks, identity, replacedLook, othersTag, supply, styleCounts, allowedStyles, officialOutfits, permanence, loadFailed, retryLoad, pool, poses, people, available, peopleLine, peopleSelected, peopleBlocked, candidateState, axis, candidateArgs,
    candidatesPending, result, op, sourceKey, generate, recompose, restore, toggleLock, reroll, naturalSourceOf,
  ])
}
