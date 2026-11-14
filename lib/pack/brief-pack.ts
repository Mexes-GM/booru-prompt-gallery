/**
 * From a brief to a pack: what the scenes engine receives (who the characters are,
 * what no prompt may have, the whole ScenePackArgs) and what the interface says about
 * it (the fit line before and after generating, the People line). The React side is
 * hooks/use-pack-brief-scenes.ts; this module is pure.
 */
import { lookYieldingTo, splitSignature } from './character-identity'
import { normalizeTagForPack, type PackPrompt } from './pack-generator'
import { addCharacter, addNever, briefFromPrompt, setPeople, toSceneRequests, type ChangesAxis, type PackBrief } from './brief'
import { castPeople, roleFromSubject, type CastRole } from './scene/cast'
import { COUNT_TAG_RE, type Permanence } from './scene/permanence'
import type { PackPeople } from './scene/scene-pool'
import {
  DEFAULT_SCENE_SETTINGS,
  REUSES_PER_SCENE,
  castChips,
  identityWithOutfits,
  subjectOfTags,
  type CastChipsBlock,
  type LibraryOutfit,
  type PoseComposition,
  type SceneCandidate,
  type ScenePackArgs,
  type ScenePackIssue,
  type ScenePackSettings,
} from './scene-pack'

// ── The characters' looks ─────────────────────────────────────────────────────

/** Where a character's usual look was read from. */
export type LookSource = 'solo' | 'pool' | 'profile' | 'loading' | 'none'

export interface ResolvedLook {
  /** Hair, eyes, body and signature accessories, as read; the user's edits are applied later. */
  look: string[]
  /** Subject tags their posts agree on ("1girl"); empty when unknown. */
  subject: string[]
  source: LookSource
}

export interface LookInputs {
  /** Read from the character's own solo posts (useCharacterLooks). */
  solo?: { status: 'loading' | 'ready' | 'none'; look: string[] | null; subject: string[] } | null
  /** typicalLook over the pack's own posts, when the pool is the character's ("name, solo"). */
  pool?: { look: string[]; subject: string[] } | null
  /** Their static trait profile (profileIdentity); empty when there is none. */
  profile?: readonly string[]
  /** The pack names more than one character: a profile lends a partner's traits, so it waits for the solo posts. */
  inCast?: boolean
}

/**
 * The look a character is drawn with, as the old builder chose it: their solo posts,
 * else the pack's own posts of them, else their trait profile (in a cast, only once
 * their solo posts turned out too few), else nothing but the name.
 */
export function resolveLook({ solo, pool, profile = [], inCast = false }: LookInputs): ResolvedLook {
  if (solo?.status === 'ready' && solo.look?.length) return { look: [...solo.look], subject: [...solo.subject], source: 'solo' }
  if (pool?.look.length) return { look: [...pool.look], subject: [...pool.subject], source: 'pool' }
  const waiting = solo?.status === 'loading'
  if (profile.length > 0 && !(inCast && waiting)) return { look: [...profile], subject: [], source: 'profile' }
  return { look: [], subject: [], source: waiting ? 'loading' : 'none' }
}

// ── Identity ──────────────────────────────────────────────────────────────────

export interface BriefMember {
  /** The character tag; '' for the unnamed character. */
  character: string
  /** Name, subject, look and signature accessories: what castChips reads. */
  candidates: string[]
  role: CastRole | null
  lookSource: LookSource
}

export interface BriefIdentityInput {
  brief: PackBrief
  /** Keyed by the brief's character tag. */
  looks: Readonly<Record<string, ResolvedLook>>
  /** Roles a trait profile gives (roleFromProfile), keyed by character tag. */
  profileRoles?: Readonly<Record<string, CastRole | null | undefined>>
  permanence: (tag: string) => Permanence
  overrides: Record<string, string>
}

export interface BriefIdentity {
  members: BriefMember[]
  /** One per member, from castChips. */
  blocks: CastChipsBlock[]
  /** The tags every prompt keeps for the characters (ScenePackArgs.identity). */
  identity: string[]
  /** Removed traits and the Never row (ScenePackArgs.never). */
  never: string[]
  /** The first character's gender. */
  subject: 'girl' | 'boy'
  /** The people the characters themselves are. */
  cast: PackPeople
  castSize: number
  /** Characters of a cast whose role nobody knows yet: the brief asks. */
  missingRoles: string[]
}

const unique = (tags: readonly string[]) => Array.from(new Set(tags.filter(Boolean)))
const NO_LOOK: ResolvedLook = { look: [], subject: [], source: 'none' }

/**
 * Who the pack's characters are for the engine, the way usePackMode and usePackScenes
 * build it for a character chosen by name: name, subject and look, with signature
 * accessories after; every permanent trait pinned, picture state left to the scene.
 * `addedLook` adds traits (and, like "Always add" did, a typed trait of a kind replaces
 * the character's own); `removedLook` takes one out and keeps it out of every prompt.
 */
export function briefIdentity({ brief, looks, profileRoles = {}, permanence, overrides }: BriefIdentityInput): BriefIdentity {
  const requests = toSceneRequests(brief)
  const typed = [...requests.also, ...requests.literal]
  const members: BriefMember[] = brief.who.map((c) => {
    const character = c.tag ? normalizeTagForPack(c.tag) : ''
    const resolved = c.tag ? looks[c.tag] ?? looks[character] ?? NO_LOOK : NO_LOOK
    const look = lookYieldingTo(resolved.look, [...c.addedLook, ...typed])
    const { look: traits, signature } = splitSignature(look, overrides)
    return {
      character,
      candidates: character ? unique([character, ...resolved.subject, ...traits, ...signature]) : [],
      role: c.role ?? roleFromSubject(resolved.subject) ?? (c.tag ? profileRoles[c.tag] ?? null : null),
      lookSource: resolved.source,
    }
  })

  const byCharacter = new Map(brief.who.map((c, i) => [members[i].character, c]))
  const NO_CHOICES = new Map()
  const result = castChips({
    members,
    choices: () => NO_CHOICES,
    added: (character) => (byCharacter.get(character)?.addedLook ?? []).map(normalizeTagForPack).filter(Boolean),
    removed: (character) => new Set((byCharacter.get(character)?.removedLook ?? []).map(normalizeTagForPack)),
    baseExtras: [],
    baseFixed: [],
    permanence,
    overrides,
  })

  const castSize = members.filter((m) => m.character).length
  const isCast = castSize >= 2
  const subject = members[0]?.role ?? subjectOfTags(members[0]?.candidates ?? [])
  const never = unique([...result.never, ...brief.never.map(normalizeTagForPack)])
  return {
    members,
    blocks: result.blocks,
    identity: isCast ? result.pinned : unique(result.pinned),
    never,
    subject,
    cast: isCast ? castPeople(members.map((m) => m.role)) : subject === 'girl' ? { girls: 1, boys: 0 } : { girls: 0, boys: 1 },
    castSize: Math.max(1, castSize),
    missingRoles: isCast ? members.filter((m) => m.character && !m.role).map((m) => m.character) : [],
  }
}

// ── Clothes ───────────────────────────────────────────────────────────────────

/** Where the clothes come from while Wearing is empty (the brief's outfit menu). */
export type BriefOutfit =
  | { kind: 'scene' }
  | { kind: 'usual' }
  | { kind: 'official'; name: string }
  | { kind: 'library' }

/** The engine's clothing option for an outfit choice, and what it needs to apply. */
export function outfitSetting(
  outfit: BriefOutfit,
  wearingAsked: boolean,
  has: { characterOutfits: boolean; library: boolean; outfitChanges?: boolean }
): ScenePackSettings['clothing'] {
  if (wearingAsked || has.outfitChanges) return 'scene'
  switch (outfit.kind) {
    case 'scene': return 'scene'
    case 'usual':
    case 'official': return has.characterOutfits ? 'character' : 'scene'
    case 'library': return has.library ? 'library' : 'scene'
  }
}

// ── The engine's arguments ────────────────────────────────────────────────────

export interface BriefPackEnv {
  overrides: Record<string, string>
  permanence: (tag: string) => Permanence
  count: number
  seed: number
  /** The composition the pack uses (defaultComposition / castComposition). */
  people: PackPeople | null
  /** Posts the source found as the character's own. */
  preferredPosts?: readonly number[]
  outfit: BriefOutfit
  /** For 'usual' and 'official': each character's outfit tags, keyed by character tag (normalized). */
  characterOutfits?: ReadonlyMap<string, readonly string[]>
  /** For 'library': the outfits drawn for this pack. */
  library?: readonly LibraryOutfit[]
  clean: ScenePackArgs['clean']
  resolution?: ScenePackArgs['resolution']
  /** One-part pack: the scene that repeats when the brief doesn't choose one (the one a pack was made with). */
  baseScene?: number
}

/** The scene ids the brief left out, as the engine counts them (post ids). */
export const leftOutPosts = (brief: PackBrief): number[] =>
  [...brief.leftOut, ...(oneAxis(brief) ? brief.leftOutVariants ?? [] : [])].map(Number).filter((id) => Number.isInteger(id) && id > 0)

/** The part that changes in a one-part pack, or null for a whole-scene pack. */
export const oneAxis = (brief: Pick<PackBrief, 'changes'>): OneAxis | null => (brief.changes && brief.changes !== 'scene' ? brief.changes : null)
export type OneAxis = Exclude<ChangesAxis, 'scene'>

/** Requests on the part that changes: they stay in every prompt (the engine's `axis-requested`). */
export function axisRequests(brief: PackBrief, axis: OneAxis): string[] {
  const r = toSceneRequests(brief)
  return axis === 'outfit' ? r.wearing : axis === 'place' ? r.where : axis === 'pose' ? r.select : []
}

/** Everything generateScenePack needs for a brief. The settings the brief doesn't show keep their defaults. */
export function briefPackArgs(brief: PackBrief, who: BriefIdentity, env: BriefPackEnv): ScenePackArgs {
  const requests = toSceneRequests(brief)
  const outfits = env.characterOutfits
  const hasOutfits = !!outfits && who.blocks.some((b) => (outfits.get(b.character)?.length ?? 0) > 0)
  const axis = oneAxis(brief)
  // "Only the outfit" takes every outfit from the scenes: no outfit of the character's own.
  const clothing = outfitSetting(env.outfit, requests.wearing.length > 0, {
    characterOutfits: hasOutfits,
    library: (env.library?.length ?? 0) > 0,
    outfitChanges: axis === 'outfit',
  })
  const worn = clothing === 'character' && outfits
    ? who.blocks.map((b) => ({ pinned: b.pinned, outfit: outfits.get(b.character) ?? [] }))
    : null
  const identity = worn ? identityWithOutfits(worn, who.never) : who.identity
  return {
    identity: who.castSize >= 2 ? identity : unique(identity),
    alwaysAdd: [],
    people: env.people,
    castSize: who.castSize,
    never: who.never,
    characterOutfit: worn ? worn.flatMap((w) => w.outfit) : undefined,
    subject: who.subject,
    settings: { ...DEFAULT_SCENE_SETTINGS, clothing },
    count: env.count,
    seed: env.seed,
    overrides: env.overrides,
    library: clothing === 'library' ? env.library : undefined,
    clean: env.clean,
    resolution: env.resolution,
    requests,
    permanence: env.permanence,
    preferredPosts: env.preferredPosts ?? [],
    removedScenes: leftOutPosts(brief),
    ...(axis ? { changes: axis, ...(brief.baseScene !== undefined || env.baseScene !== undefined ? { baseScene: brief.baseScene ?? env.baseScene } : {}) } : {}),
  }
}

/** Post ids whose search is the character's own: the scenes the engine uses first. */
export function preferredPostIds(originOf: ReadonlyMap<number, string>, ownSearchIds: ReadonlySet<string>): number[] {
  const out: number[] = []
  originOf.forEach((search, id) => { if (ownSearchIds.has(search)) out.push(id) })
  return out
}

// ── The fit line ──────────────────────────────────────────────────────────────

/** One sentence of the fit line, as data; components/prompt-gallery/pack/pack-text.ts words it. */
export type FitNote =
  | { kind: 'finding'; found: number }
  | { kind: 'fit'; scenes: number }
  /** Few scenes at the safe content rating; the user can allow sensitive ones too. */
  | { kind: 'few-rated' }
  /** `done`: said of prompts already made. */
  | { kind: 'reuse'; scenes: number; reused: number; done?: boolean }
  | { kind: 'similar'; tag: string }
  /** `what` names the poses ("this pose"); without it the pack is short of scenes of any kind. */
  | { kind: 'short'; made: number; asked: number; scenes: number; what?: string }
  | { kind: 'imposed'; tag: string; prompts: number; done?: boolean }
  /** The chosen people have no scene with the pose; `scenes` with other people do. */
  | { kind: 'no-pose-here'; people: PackPeople; cast: PackPeople; scenes: number; what: string }
  | { kind: 'needs-company'; tag: string; prompts: number }
  | { kind: 'dropped'; tag: string; reason: 'never' | 'composition' }
  /** The brief changed after the prompts were made. */
  | { kind: 'stale' }
  /** The people the user asked for ("2girls") aren't in any scene; `using` are. */
  | { kind: 'people-missing'; asked: PackPeople; using: PackPeople | null; cast: PackPeople }
  /** Fetching stopped at the pace limit while the source still has posts; one more page can be asked for. */
  | { kind: 'paused' }
  /** One-part pack: how many values of the part go with the scene that repeats. */
  | { kind: 'axis-fit'; axis: OneAxis; variations: number }
  /** One-part pack: the variants are being worked out. */
  | { kind: 'finding-variants'; axis: OneAxis }
  /** The People option chosen has no room for every character. */
  | { kind: 'people-short-of-cast' }
  /** The page the user asked for brought no new scene; `exhausted`: the source has nothing more. */
  | { kind: 'no-new'; exhausted: boolean }
  /** One-part pack: what was asked for on that part stays in every prompt; the rest of the part changes. */
  | { kind: 'kept-on-axis'; axis: Exclude<ChangesAxis, 'scene'>; tags: string[] }
  /** One-part pack that came out short: only `variations` values of the part go with the base scene. */
  | { kind: 'few-variations'; axis: Exclude<ChangesAxis, 'scene'>; variations: number; made: number; asked: number }

export const poseWords = (poses: number) => (poses === 1 ? 'this pose' : 'these poses')

export interface PredictInput {
  /** Scenes the pack can use (sceneCandidates, without the left-out ones); null until worked out. */
  candidates: readonly Pick<SceneCandidate, 'hasPose'>[] | null
  count: number
  /** The requested poses (SceneRequests.select). */
  poses: readonly string[]
  /** More posts are on their way, or will be fetched to reach `count`. */
  finding: boolean
  /** Sensitive posts can still be added (a safe pack that leaves them out). */
  canOfferSensitive: boolean
  /** Fetching stopped at the pace limit and the source has more: the line offers another page. */
  paused?: boolean
  /** One-part pack: the part that changes and what was asked for on it. */
  axis?: { axis: OneAxis; requested: readonly string[] } | null
}

/**
 * What the fit line says before generating, from the scenes that fit and how many
 * prompts were asked for. With poses it follows the engine's ladder: each scene with
 * the pose once, then again with other parts (REUSES_PER_SCENE), then the pose imposed
 * on the scenes that can take it; the rest is missing.
 */
export function predictFit(input: PredictInput): FitNote[] {
  const notes = predictNotes(input)
  return input.paused && notes.some((n) => n.kind !== 'fit' && n.kind !== 'finding') ? [...notes, { kind: 'paused' }] : notes
}

function predictNotes({ candidates, count, poses, finding, canOfferSensitive, axis }: PredictInput): FitNote[] {
  if (axis) {
    // One scene repeats: the variants are the scenes that lend it the part (the first is the scene itself).
    if (!candidates) return [{ kind: 'finding-variants', axis: axis.axis }]
    const variations = candidates.length
    const kept: FitNote[] = axis.requested.length > 0 ? [{ kind: 'kept-on-axis', axis: axis.axis, tags: [...axis.requested] }] : []
    if (variations >= count) return [{ kind: 'axis-fit', axis: axis.axis, variations }, ...kept]
    if (finding) return [{ kind: 'finding', found: variations }, ...kept]
    return [{ kind: 'few-variations', axis: axis.axis, variations, made: variations, asked: count }, ...kept]
  }
  if (!candidates) return [{ kind: 'finding', found: 0 }]
  const total = candidates.length
  if (poses.length === 0) {
    if (total >= count) return [{ kind: 'fit', scenes: total }]
    if (finding) return [{ kind: 'finding', found: total }]
    const notes: FitNote[] = [{ kind: 'short', made: total, asked: count, scenes: total }]
    return canOfferSensitive ? [{ kind: 'few-rated' }, ...notes] : notes
  }
  const have = candidates.filter((c) => c.hasPose).length
  const imposable = total - have
  if (have >= count) return [{ kind: 'fit', scenes: have }]
  if (finding) return [{ kind: 'finding', found: have }]
  const notes: FitNote[] = []
  const reuseCap = have * (1 + REUSES_PER_SCENE)
  if (have > 0) notes.push({ kind: 'reuse', scenes: have, reused: Math.min(count, reuseCap) - have })
  const imposed = Math.min(Math.max(0, count - reuseCap), imposable)
  if (imposed > 0) notes.push({ kind: 'imposed', tag: poses.join(', '), prompts: imposed })
  const made = Math.min(count, reuseCap + imposable)
  if (made < count) notes.push({ kind: 'short', made, asked: count, scenes: have, what: poseWords(poses.length) })
  return canOfferSensitive ? [{ kind: 'few-rated' }, ...notes] : notes
}

export interface IssuesInput {
  issues: readonly ScenePackIssue[]
  count: number
  made: number
  /** The characters themselves, so a composition reads as who else is there. */
  cast: PackPeople
  /** Scenes that fit (for the line when nothing went wrong). */
  scenes: number | null
  canOfferSensitive: boolean
  /** As in PredictInput. */
  paused?: boolean
}

/** What the fit line says after generating: one sentence for every issue the engine reported, none dropped. */
export function issuesFit(input: IssuesInput): FitNote[] {
  const notes = issueNotes(input)
  return input.paused && notes.some((n) => n.kind !== 'fit') ? [...notes, { kind: 'paused' }] : notes
}

function issueNotes({ issues, count, made, cast, scenes, canOfferSensitive }: IssuesInput): FitNote[] {
  const order: Record<ScenePackIssue['kind'], number> = {
    'few-scenes': 0, 'few-variations': 0, 'composition-without-pose': 1, 'scenes-reused': 2, 'pose-imposed': 3, 'needs-company': 4,
    'request-dropped': 5, 'axis-requested': 6,
  }
  const notes = [...issues].sort((a, b) => order[a.kind] - order[b.kind]).map((issue): FitNote => {
    switch (issue.kind) {
      case 'few-scenes': return { kind: 'short', made: issue.prompts, asked: count, scenes: issue.scenes, what: poseWords(issue.tags.length) }
      case 'composition-without-pose': return { kind: 'no-pose-here', people: issue.people, cast, scenes: issue.scenes, what: poseWords(issue.tags.length) }
      case 'scenes-reused': return { kind: 'reuse', scenes: issue.scenes, reused: issue.prompts, done: true }
      case 'pose-imposed': return { kind: 'imposed', tag: issue.tag, prompts: issue.prompts, done: true }
      case 'needs-company': return { kind: 'needs-company', tag: issue.tag, prompts: issue.prompts }
      case 'request-dropped': return { kind: 'dropped', tag: issue.tag, reason: issue.reason }
      case 'axis-requested': return { kind: 'kept-on-axis', axis: issue.axis, tags: [...issue.tags] }
      case 'few-variations': return { kind: 'few-variations', axis: issue.axis, variations: issue.variations, made: issue.prompts, asked: count }
    }
  })
  const shortNoted = notes.some((n) => n.kind === 'short' || n.kind === 'few-variations')
  if (made < count && !shortNoted) notes.unshift({ kind: 'short', made, asked: count, scenes: made })
  if (notes.length === 0) return [{ kind: 'fit', scenes: scenes ?? made }]
  const lacking = made < count || notes.some((n) => n.kind === 'reuse' || n.kind === 'imposed')
  // Only information: with nothing else to say, the pack still fits.
  if (notes.every((n) => n.kind === 'kept-on-axis') && made >= count) return [{ kind: 'fit', scenes: scenes ?? made }, ...notes]
  return canOfferSensitive && lacking ? [{ kind: 'few-rated' }, ...notes] : notes
}

export interface SearchProgress {
  /** A page is on its way, asked for by the builder or by the user. */
  loading: boolean
  /** Scenes that fit so far. */
  found: number
  /** The page the user asked for came back without a new scene. */
  nothingNew?: { exhausted: boolean } | null
}

/**
 * The fit line with the source's progress on top: while a page is on its way it says
 * it is searching (the offer of another page goes until it lands); a page asked for
 * by hand that brought nothing new says so, and when the source has nothing more the
 * offer goes for good.
 */
export function withSearchProgress(notes: readonly FitNote[], progress: SearchProgress): FitNote[] {
  if (progress.loading) {
    const rest = notes.filter((n) => n.kind !== 'finding' && n.kind !== 'paused' && n.kind !== 'fit')
    return [{ kind: 'finding', found: progress.found }, ...rest]
  }
  if (!progress.nothingNew) return [...notes]
  const { exhausted } = progress.nothingNew
  const rest = exhausted ? notes.filter((n) => n.kind !== 'paused') : [...notes]
  const at = rest.findIndex((n) => n.kind === 'paused')
  const note: FitNote = { kind: 'no-new', exhausted }
  return at < 0 ? [...rest, note] : [...rest.slice(0, at), note, ...rest.slice(at)]
}

// ── People ────────────────────────────────────────────────────────────────────

export interface PeopleLineInput {
  /** The requested poses. */
  poses: readonly string[]
  /** True for a pose only a scene that has it can give and that needs someone else (poseNeedsScene). */
  needsCompany: (tag: string) => boolean
  /** poseCompositions. */
  compositions: readonly PoseComposition[]
  /** The composition the pack uses. */
  current: PackPeople | null
  /** The people the user set (brief.people), e.g. by typing "2girls". */
  picked?: PackPeople | null
  /** Every composition of the pool (with room for the cast): the options when no pose asks for company. */
  available?: readonly PoseComposition[]
}

const samePeople = (a: PackPeople | null | undefined, b: PackPeople | null | undefined) =>
  !!a && !!b && a.girls === b.girls && a.boys === b.boys

/**
 * The People line: shown when a requested pose needs more than one person and some
 * scene has it, or when the user set who is in the picture (then a composition the
 * pool lacks is listed too, with no scenes).
 */
export function peopleLineState({ poses, needsCompany, compositions, current, picked, available = [] }: PeopleLineInput): {
  options: PoseComposition[]
  value: PackPeople | null
  poseNeeds?: number
} | null {
  if (poses.some(needsCompany) && compositions.length > 0) {
    const sizes = compositions.map((c) => c.people.girls + c.people.boys).filter((n) => n >= 2)
    return { options: [...compositions], value: current, poseNeeds: sizes.length > 0 ? Math.min(...sizes) : 2 }
  }
  if (!picked) return null
  const options = [...available]
  if (!options.some((o) => samePeople(o.people, picked))) options.push({ people: { ...picked }, scenes: 0 })
  return { options, value: current }
}

/** The fit line's word when the People option chosen has no room for every character. */
export function castPeopleNote(picked: PackPeople | null, cast: PackPeople): FitNote | null {
  return picked && (picked.girls < cast.girls || picked.boys < cast.boys) ? { kind: 'people-short-of-cast' } : null
}

/** The fit line's word on the people the user set, when the pool has no scene of them. */
export function pickedPeopleNote({ picked, available, using, cast }: {
  picked: PackPeople | null
  /** Every composition of the pool; null while it isn't built. */
  available: readonly { people: PackPeople }[] | null
  using: PackPeople | null
  cast: PackPeople
}): FitNote | null {
  if (!picked || !available || available.some((c) => samePeople(c.people, picked))) return null
  return { kind: 'people-missing', asked: { ...picked }, using, cast }
}

/**
 * The people a typed count asks for ("2girls", "1boy", "solo"), given who the
 * characters are. A gender the tags don't mention keeps the cast's own count, so
 * "1boy" next to one girl is a girl and a boy; never fewer than the cast. Null when
 * no tag is a count.
 */
export function peopleFromCountTags(tags: readonly string[], cast: PackPeople): PackPeople | null {
  let girls: number | null = null
  let boys: number | null = null
  let solo = false
  for (const raw of tags) {
    const tag = normalizeTagForPack(raw)
    if (tag === 'solo') { solo = true; continue }
    const match = COUNT_TAG_RE.exec(tag)
    if (!match) continue
    const n = Number(match[1])
    if (match[3].startsWith('girl')) girls = (girls ?? 0) + n
    else if (match[3].startsWith('boy')) boys = (boys ?? 0) + n
  }
  if (girls === null && boys === null) return solo ? { ...cast } : null
  return { girls: Math.max(girls ?? cast.girls, cast.girls), boys: Math.max(boys ?? cast.boys, cast.boys) }
}

// ── Starts from a prompt or a search ──────────────────────────────────────────

/**
 * A pasted prompt's brief with its people counts applied: "1girl, 1boy" sets People to
 * one of each. Counts say everyone in the picture, so they don't add to the cast.
 */
export function withPromptPeople(brief: PackBrief, peopleTags: readonly string[]): PackBrief {
  const people = peopleFromCountTags(peopleTags, { girls: 0, boys: 0 })
  return people && people.girls + people.boys > 0 ? setPeople(brief, people) : brief
}

/**
 * The tags of a gallery search a pack can use: everything but search filters
 * ("rating:general", "order:score"); a "-tag" counts (it goes to Never).
 */
export function usableSearchTags(search: string): string[] {
  return search.split(',').map((t) => t.trim()).filter((t) => t && t !== '-' && !t.includes(':'))
}

/**
 * The brief a gallery search starts: its tags go where a pasted prompt's would, a
 * "-tag" goes to Never, the character the results are about is in Who, and search
 * filters ("rating:general", "order:score") stay out and come back in `skipped`.
 */
export function briefFromSearch(
  search: string,
  overrides: Record<string, string>,
  character: string | null
): { brief: PackBrief; skipped: string[] } {
  const tokens = search.split(',').map((t) => t.trim()).filter(Boolean)
  const skipped = tokens.filter((t) => t.includes(':') && !t.startsWith('-'))
  const excluded = tokens.filter((t) => t.startsWith('-')).map((t) => t.slice(1).trim())
  const kept = tokens.filter((t) => !t.includes(':') && !t.startsWith('-'))
  skipped.push(...excluded.filter((t) => t.includes(':')).map((t) => `-${t}`))
  const parsed = briefFromPrompt(kept.join(', '), overrides)
  let brief = withPromptPeople(parsed.brief, parsed.peopleTags)
  if (character) brief = addCharacter(brief, character)
  for (const tag of excluded) if (!tag.includes(':')) brief = addNever(brief, tag)
  return { brief, skipped }
}

// ── Suggestions ───────────────────────────────────────────────────────────────

/** A tag the lookup returned (lib/supabase/client-queries.ts's TagResult). */
export interface FoundTag { name: string; postCount: number; category: number }

/** Danbooru tag categories: 0 general, 4 character. */
const GENERAL = 0
const CHARACTER = 4

/** What a slot of the brief offers while typing: characters in Who, general tags elsewhere. */
export function slotSuggestions(found: readonly FoundTag[], slot: 'who' | 'other', limit = 8): Array<{ name: string; count: number; kind?: string }> {
  const wanted = slot === 'who' ? CHARACTER : GENERAL
  return found
    .filter((t) => t.category === wanted)
    .slice(0, limit)
    .map((t) => ({ name: t.name, count: t.postCount, ...(slot === 'who' ? { kind: 'Character' } : {}) }))
}

// ── Results ───────────────────────────────────────────────────────────────────

/**
 * A pack's rows after the engine made (or remade) the free ones. `slots[k]` is the row
 * the k-th prompt the engine makes goes to; a locked row keeps what it has. With fewer
 * prompts than slots, the rows left without one go and the rest close up (locked rows
 * keep their order); with more, the extra ones go at the end. Returns the rows, which
 * of them are locked, and the slots for the next remake.
 */
export function placeRows<T>(
  previous: readonly T[],
  locked: ReadonlySet<number>,
  slots: readonly number[],
  fresh: readonly T[]
): { rows: T[]; locked: number[]; slots: number[] } {
  const length = Math.max(previous.length, ...slots.map((s) => s + 1), 0)
  const cells: Array<{ row: T; slot: number | null } | null> = Array.from({ length }, (_, i) =>
    locked.has(i) && i < previous.length ? { row: previous[i], slot: null } : null
  )
  slots.forEach((slot, k) => {
    if (k >= fresh.length) return
    if (cells[slot]) cells[slot]!.slot = k
    else cells[slot] = { row: fresh[k], slot: k }
  })
  const rows: T[] = []
  const lockedOut: number[] = []
  const slotOf: number[] = []
  cells.forEach((cell, i) => {
    if (!cell) return
    if (locked.has(i) && i < previous.length) lockedOut.push(rows.length)
    if (cell.slot !== null) slotOf[cell.slot] = rows.length
    rows.push(cell.row)
  })
  for (let k = slots.length; k < fresh.length; k++) {
    slotOf[k] = rows.length
    rows.push(fresh[k])
  }
  return { rows, locked: lockedOut, slots: slotOf.slice(0, fresh.length) }
}

/** Rows whose text differs at the same position (a row added or gone counts too). */
export function changedRows(before: readonly { prompt: string }[], after: readonly { prompt: string }[]): number {
  let changed = Math.abs(before.length - after.length)
  for (let i = 0; i < Math.min(before.length, after.length); i++) if (before[i].prompt !== after[i].prompt) changed++
  return changed
}

/** Locked rows that still have `tag` (or a weighted form of it). */
export function lockedWithTag(rows: readonly { prompt: string }[], locked: Iterable<number>, tag: string): number {
  const name = normalizeTagForPack(tag)
  let n = 0
  for (const i of locked) {
    const row = rows[i]
    if (row && promptTokens(row).some((t) => normalizeTagForPack(t.replace(/^\(+/, '').replace(/(:[\d.]+)?\)+$/, '')) === name)) n++
  }
  return n
}

/** Tags the prompt shows, split the way the results list shows them. */
export const promptTokens = (prompt: Pick<PackPrompt, 'prompt'>): string[] =>
  prompt.prompt.split(',').map((t) => t.trim()).filter(Boolean)
