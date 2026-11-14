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
import { toSceneRequests } from "@/lib/pack/brief"
import {
  briefIdentity,
  briefPackArgs,
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
import { loadPackVocabulary, loadedTagBaseline, tagBaselineOf } from "@/lib/pack/pack-vocabulary"
import { resolutionForAspect } from "@/lib/pack/prompt-resolution"
import { planSources, type AppearanceSearch, type SourcePlan } from "@/lib/pack/source-plan"
import { holdsCast, roleFromProfile, roleFromSubject, type CastRole } from "@/lib/pack/scene/cast"
import { createPermanence, type PermanenceData } from "@/lib/pack/scene/permanence"
import type { TagKind } from "@/lib/pack/scene/scene"
import { buildScenePool, compositionOfIdentity, type PackPeople, type ScenePool } from "@/lib/pack/scene/scene-pool"
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
import { ADULT_OUTFIT_STYLES, outfitPackDraw, type Outfit, type OutfitDetail, type OutfitStyle } from "@/lib/outfit-swap"
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
}

export interface BriefPackResult {
  prompts: PackPrompt[]
  shortBy: number
  issues: ScenePackIssue[]
  /** The brief, count and outfit the prompts were made from. */
  brief: PackBrief
  count: number
  outfit: BriefOutfit
}

export interface UsePackBriefScenesResult {
  plan: SourcePlan
  /** Each named character's look as read (before the user's edits), keyed by brief tag. */
  looks: Readonly<Record<string, ResolvedLook>>
  identity: ReturnType<typeof briefIdentity>
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
  /** Scenes that fit (left-out ones included, so they stay on the sheet); null until worked out once. */
  candidates: SceneCandidate[] | null
  /** The scenes are being worked out again; `candidates` are the previous ones. */
  candidatesPending: boolean
  result: BriefPackResult | null
  isGenerating: boolean
  /** Generates; `count` defaults to the brief's. */
  generate: () => void
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
    enrichTagSlots, cleanOptions, globalWeights, isGlobalWeightsEnabled, outfitOptions,
  } = args
  const relations = useTagRelations(true)

  // ── Who: trait profiles and the characters' looks ─────────────────────────────
  const named = useMemo(() => brief.who.flatMap((c) => (c.tag ? [c.tag] : [])), [brief.who])
  const namedKey = named.join("|")
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
    return planSources(plannedBrief, { ...env, roles })
  }, [plannedBrief, plannedNamed, env, soloOf, profileRoles])

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

  // ── Identity ─────────────────────────────────────────────────────────────────
  // Everything but the left-out scenes: leaving a scene out must not rebuild the pool or the sheet.
  const coreKey = JSON.stringify([brief.who, brief.requests, brief.never, brief.literal, brief.people, brief.changes])
  const coreBrief = useMemo<PackBrief>(
    () => ({ ...brief, leftOut: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coreKey]
  )
  const identity = useMemo(
    () => briefIdentity({ brief: coreBrief, looks, profileRoles, permanence: permanence ?? (() => "identity"), overrides }),
    [coreBrief, looks, profileRoles, permanence, overrides]
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
    return buildScenePool(rated, { overrides, permanence, subject, cast: castPeopleMemo, tagKind: (tag) => tagKinds.get(tag) })
  }, [permanence, waitingForLookup, rated, overrides, subject, castPeopleMemo, tagKinds])

  const requests = useMemo(() => toSceneRequests(coreBrief), [coreBrief])
  const leftOutKey = brief.leftOut.join(",")
  const poseArgs = useMemo(
    () => ({ requests, never: identity.never, overrides, removedScenes: leftOutKey ? leftOutKey.split(",").map(Number) : [] }),
    // `relations` is read inside poseCompositions: a new value means new answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, identity.never, overrides, leftOutKey, relations]
  )
  const poses = useMemo(() => (basePool ? poseCompositions(basePool, poseArgs) : NO_POSES), [basePool, poseArgs])

  const firstCandidates = identity.members[0]?.candidates ?? NO_NAMES
  // Every composition of the pool the characters fit in; null until the pool is built.
  const available = useMemo(() => {
    if (!basePool) return null
    const all = basePool.stats.compositions
    return isCast ? all.filter((c) => holdsCast(c.people, castPeopleMemo)) : all
  }, [basePool, isCast, castPeopleMemo])
  const peopleKey = useMemo(() => {
    if (!basePool || missingRoles.length > 0) return ""
    const all = basePool.stats.compositions
    if (isCast) return peopleKeyOf(castComposition(all.filter((c) => holdsCast(c.people, castPeopleMemo)), castPeopleMemo, brief.people, poses))
    const declared = compositionOfIdentity(firstCandidates)
    return peopleKeyOf(defaultComposition(all, subject, brief.people, { declared, character: !!base }, poses))
  }, [basePool, missingRoles, isCast, castPeopleMemo, brief.people, poses, firstCandidates, subject, base])
  const people = useMemo(() => fromPeopleKey(peopleKey), [peopleKey])

  const pool = useMemo(() => {
    if (!basePool || !permanence) return null
    if (!people || peopleKey === peopleKeyOf(basePool.stats.composition)) return basePool
    return buildScenePool(rated, { overrides, permanence, subject, cast: castPeopleMemo, tagKind: (tag) => tagKinds.get(tag), people })
  }, [basePool, permanence, people, peopleKey, rated, overrides, subject, castPeopleMemo, tagKinds])

  const peopleLine = useMemo(
    () => peopleLineState({
      poses: requests.select,
      needsCompany: (tag) => poseNeedsScene(tag, overrides, relations),
      compositions: poses,
      current: people,
      picked: brief.people,
      available: available ?? undefined,
    }),
    [requests.select, overrides, relations, poses, people, brief.people, available]
  )

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
  const outfitLibrary = useOutfitLibrary(useLibrary)
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
    (forBrief: PackBrief, seed: number, count: number): ScenePackArgs => {
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
      })
    },
    [useLibrary, outfitLibrary, libraryStyles, outfitOptions.detail, identity, overrides, permanence, people, preferredPosts, outfit, characterOutfits, clean]
  )

  // ── The scenes that fit (deferred: up to a second and a half of work) ─────────
  const [candidateState, setCandidateState] = useState<{ pool: ScenePool; args: unknown; list: SceneCandidate[] } | null>(null)
  const candidateArgs = useMemo(
    () => (pool && missingRoles.length === 0 ? argsFor(coreBrief, 1, 1) : null),
    [pool, missingRoles, argsFor, coreBrief]
  )
  useEffect(() => {
    if (!pool || !candidateArgs) return
    let active = true
    const timer = setTimeout(() => {
      if (!active) return
      try {
        const list = sceneCandidates(pool, candidateArgs)
        if (active) setCandidateState({ pool, args: candidateArgs, list })
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

  // ── Generating ────────────────────────────────────────────────────────────────
  const [result, setResult] = useState<BriefPackResult | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const requestRef = useRef(0)
  const generate = useCallback(() => {
    const id = ++requestRef.current
    if (!pool || missingRoles.length > 0) {
      setIsGenerating(false)
      return
    }
    const startedWith = { brief, count: promptCount, outfit }
    let first = true
    setIsGenerating(true)
    void generateScenePackAsync(pool, argsFor(brief, Math.floor(Math.random() * 1e9), promptCount), {
      pause: () => {
        if (!first) return yieldToPage()
        first = false
        return nextPaint()
      },
      cancelled: () => requestRef.current !== id,
    })
      .then((out) => {
        if (requestRef.current !== id) return
        setIsGenerating(false)
        if (out) setResult({ prompts: out.prompts, shortBy: out.shortBy, issues: out.issues, ...startedWith })
      })
      .catch((err) => {
        console.error("Scene pack generation failed:", err)
        if (requestRef.current === id) setIsGenerating(false)
      })
  }, [pool, missingRoles, brief, promptCount, outfit, argsFor])

  const reroll = useCallback((index: number): boolean => {
    if (!pool || !result || index < 0 || index >= result.prompts.length) return false
    const replacement = rerollScenePrompt(pool, result.prompts, index, argsFor(result.brief, Math.floor(Math.random() * 1e9), result.count))
    if (!replacement) return false
    setResult((prev) => (prev ? { ...prev, prompts: prev.prompts.map((p, i) => (i === index ? replacement : p)) } : prev))
    return true
  }, [pool, result, argsFor])

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
    officialOutfits,
    ready: !!permanence,
    loadFailed: loadFailed && !permanence,
    retryLoad,
    pool,
    poses,
    people,
    available,
    peopleLine,
    candidates: candidateState?.list ?? null,
    candidatesPending,
    result,
    isGenerating,
    generate,
    reroll,
    naturalSourceOf,
  }), [
    plan, looks, identity, officialOutfits, permanence, loadFailed, retryLoad, pool, poses, people, available, peopleLine, candidateState,
    candidatesPending, result, isGenerating, generate, reroll, naturalSourceOf,
  ])
}
