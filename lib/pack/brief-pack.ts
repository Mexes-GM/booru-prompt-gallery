/**
 * From a brief to a pack: what the scenes engine receives (who the characters are,
 * what no prompt may have, the whole ScenePackArgs) and what the interface says about
 * it (the fit line before and after generating, the People line). The React side is
 * hooks/use-pack-brief-scenes.ts; this module is pure.
 */
import { lookYieldingTo, splitSignature } from './character-identity'
import { normalizeTagForPack, type PackPrompt } from './pack-generator'
import { getTagSlotFromOverrides } from '../tag-taxonomy'
import type { BooruProvider } from '../booru/types'
import type { PackRatingMode } from '../../hooks/use-pack-seed-search'
import { ADULT_OUTFIT_STYLES, OUTFIT_STYLES, outfitTags, type Outfit, type OutfitDetail, type OutfitStyle } from '../outfit-swap'
import { planRatings } from './source-plan'
import { withResolutionPrefix } from './prompt-resolution'
import { addCharacter, addNever, addTag, briefFromCard, briefFromPrompt, castTurns, setPeople, toSceneRequests, turnBriefs, type ChangesAxis, type PackBrief } from './brief'
import { castPeople, roleFromSubject, type CastRole } from './scene/cast'
import { COUNT_TAG_RE, type Permanence } from './scene/permanence'
import type { PackPeople } from './scene/scene-pool'
import type { Scene } from './scene/scene'
import { requestSpelling } from './scene/spelling'
import { garmentPieces, garmentRegion, layersOver, meetsAll, regionTags, valueKey } from './scene/scene-conditions'
import { loadedTagRelations, requiredBy, type TagRelations } from '../tag-relations'
import {
  DEFAULT_SCENE_SETTINGS,
  REUSES_PER_SCENE,
  castChips,
  castComposition,
  defaultComposition,
  identityWithOutfits,
  isWornByCharacter,
  poseNeedsScene,
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
  /**
   * Read from the character's own solo posts (useCharacterLooks). `aloneShare`: of the
   * posts tagged "solo" that name only them, the share read as them alone (postsAloneShare).
   */
  solo?: { status: 'loading' | 'ready' | 'none'; look: string[] | null; subject: string[]; aloneShare?: number | null } | null
  /** typicalLook over the pack's own posts, when the pool shows only the character alone (SourcePlan.baseLookFromPool). */
  pool?: { look: string[]; subject: string[] } | null
  /** Their static trait profile (profileIdentity); empty when there is none. */
  profile?: readonly string[]
  /** The pack names more than one character: a profile lends a partner's traits, so it waits for the solo posts. */
  inCast?: boolean
}

/**
 * Least share of the posts their site tags "solo" (and that name only the character)
 * that the solo look must be read from (postsAloneShare). Those posts are the
 * character alone by the site's own word; when the reading of who is in each picture
 * sets most of them aside, it is misreading the site's people tags, and the few posts
 * left say little about the character. Half: the look then speaks for most of the
 * posts that show them alone.
 */
export const MIN_SOLO_LOOK_SHARE = 0.5

/**
 * The look a character is drawn with, as the old builder chose it: their solo posts
 * (when the look speaks for most of them, MIN_SOLO_LOOK_SHARE), else the pack's own
 * posts of them, else their trait profile (in a cast, only once their solo posts
 * turned out too few), else nothing but the name.
 */
export function resolveLook({ solo, pool, profile = [], inCast = false }: LookInputs): ResolvedLook {
  const representative = solo?.aloneShare == null || solo.aloneShare >= MIN_SOLO_LOOK_SHARE
  if (solo?.status === 'ready' && solo.look?.length && representative) return { look: [...solo.look], subject: [...solo.subject], source: 'solo' }
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
  /**
   * One per prompt in turn (castTurns): each named character's identity as a pack of only them has
   * it, in brief order. The fields above then are the first character's as a pack of one (subject,
   * cast, castSize 1, identity), while `members`, `blocks` and `never` still cover everyone.
   */
  turns?: BriefIdentity[]
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
export function briefIdentity(input: BriefIdentityInput): BriefIdentity {
  const together = identityOf(input)
  if (!castTurns(input.brief)) return together
  // One per prompt: each character as a pack of only them, through the same path.
  const turns = turnBriefs(input.brief).map((brief) => identityOf({ ...input, brief }))
  const lead = turns[0]
  return { ...together, identity: lead.identity, subject: lead.subject, cast: lead.cast, castSize: 1, missingRoles: [], turns }
}

function identityOf({ brief, looks, profileRoles = {}, permanence, overrides }: BriefIdentityInput): BriefIdentity {
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

/**
 * The tags of a character's look the garments in Wearing replace: what the character
 * wears ("earrings", "fingerless gloves"), not what they are (hair, body) or their
 * signature accessories ("glasses"). The engine leaves these out of every prompt while
 * Wearing has something (isWornByCharacter); empty while Wearing is empty.
 */
export function lookReplacedByWearing(
  brief: PackBrief,
  look: readonly string[],
  overrides: Record<string, string>,
  permanence: (tag: string) => Permanence
): string[] {
  if (!brief.requests.some((r) => r.role === 'wearing')) return []
  return look.filter((tag) => isWornByCharacter(tag, overrides, permanence))
}

/**
 * Where the clothes come from while Wearing is empty (the brief's outfit menu). 'library' is no
 * longer offered (the library is chosen in Wearing, by style); a pack saved with it reads as 'scene'
 * (menuOutfit).
 */
export type BriefOutfit =
  | { kind: 'scene' }
  | { kind: 'usual' }
  | { kind: 'official'; name: string }
  | { kind: 'library' }

/** The outfit menu's choice for `outfit`: one the menu offers, 'scene' for anything else. */
export const menuOutfit = (outfit: BriefOutfit | null | undefined): Exclude<BriefOutfit, { kind: 'library' }> =>
  !outfit || outfit.kind === 'library' ? { kind: 'scene' } : outfit

/**
 * What a new pack's characters wear while Wearing is empty: their usual outfit, the one they are
 * known by. Without a named character, or one whose outfit isn't known, the engine takes each
 * scene's own (outfitSetting), and the menu says so (shownOutfit).
 */
export const NEW_PACK_OUTFIT: BriefOutfit = { kind: 'usual' }

/** The outfit choice as the menu shows it: the usual outfit reads as each scene's when there is none to take. */
export function shownOutfit(outfit: BriefOutfit, usualOutfitKnown: boolean): Exclude<BriefOutfit, { kind: 'library' }> {
  const choice = menuOutfit(outfit)
  return choice.kind === 'usual' && !usualOutfitKnown ? { kind: 'scene' } : choice
}

// ── The outfit library in a pack ──────────────────────────────────────────────

/** The library styles a pack offers in Wearing: every one, less the adult ones at the Safe rating. */
export function packOutfitStyles(rating: PackRatingMode): OutfitStyle[] {
  return OUTFIT_STYLES.filter((style) => rating !== 'sfw' || !ADULT_OUTFIT_STYLES.includes(style))
}

/**
 * How much of each library outfit the pack puts in a prompt: the brief's choice (main pieces by
 * default) when it asks for library styles. Without styles the library only lends the garments
 * Wearing asks for, so its outfits stay whole.
 */
export function packOutfitDetail(brief: Pick<PackBrief, 'outfitStyles' | 'outfitDetail'>): OutfitDetail {
  return brief.outfitStyles?.length ? brief.outfitDetail ?? 'simple' : 'full'
}

/** The library's outfits of `styles` at `detail`, as the engine takes them (ScenePackArgs.outfitLibrary). */
export function packLibraryOutfits(library: readonly Outfit[], styles: readonly OutfitStyle[], detail: OutfitDetail): LibraryOutfit[] {
  const allowed = new Set(styles)
  return library
    .filter((o) => allowed.has(o.style))
    .map((o) => ({ outfitId: o.id, tags: outfitTags(o, detail).map(normalizeTagForPack), style: o.style }))
}

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
  /**
   * Wearing and Where met as conditions (briefConditions) and the library styles asked for. Missing:
   * every request exact, as before.
   */
  conditions?: readonly string[]
  outfitStyles?: readonly string[]
  /** Posts that only lend clothes or a place (the donor searches'); they must be in the pool. */
  donorPosts?: readonly number[]
  /** The library outfits allowed at the pack's rating, for the conditions and the styles. */
  outfitLibrary?: readonly LibraryOutfit[]
  /** Other names of each condition (auto_suggest_tags.aliases). */
  conditionAliases?: Readonly<Record<string, readonly string[]>>
  /** The make-ups the pack mixes (ScenePackArgs.compositions), only those with room for the characters; one or none: `people`. */
  compositions?: readonly PackPeople[]
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
  const conditions = env.conditions?.length ? [...env.conditions] : null
  const styles = env.outfitStyles?.length ? [...env.outfitStyles] : null
  const requests = {
    ...toSceneRequests(brief),
    ...(conditions ? { conditions } : {}),
    ...(styles ? { outfitStyles: styles } : {}),
  }
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
    ...(env.donorPosts?.length ? { donorPosts: env.donorPosts } : {}),
    ...((conditions || styles) && env.outfitLibrary?.length ? { outfitLibrary: env.outfitLibrary } : {}),
    ...(conditions && env.conditionAliases && Object.keys(env.conditionAliases).length > 0 ? { conditionAliases: env.conditionAliases } : {}),
    ...(!axis && (env.compositions?.length ?? 0) >= 2 ? { compositions: env.compositions } : {}),
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
  | { kind: 'short'; made: number; asked: number; scenes: number; what?: string; offerSensitive?: boolean }
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
  | { kind: 'paused'; nothingNew?: boolean }
  /** A page waits for the site's pace limit and goes by itself. */
  | { kind: 'waiting' }
  /**
   * Wearing or Where met as conditions: `variants` different forms across `prompts` prompts.
   * `what` names the tags ("bikini and thighhighs"), or the library styles ("swimwear").
   */
  | { kind: 'variety'; role: 'wearing' | 'where'; what: string; styles: boolean; variants: number; prompts: number }
  /** In `prompts` prompts no form of the condition was found: the tags went in as typed (`partial`: some of them). */
  | { kind: 'as-written'; role: 'wearing' | 'where'; what: string; prompts: number; partial: boolean; styles?: boolean }
  /** Before generating: only `variants` different forms of the condition are loaded, for `asked` prompts. */
  | { kind: 'condition-supply'; role: 'wearing' | 'where'; what: string; styles: boolean; variants: number; asked: number }
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
  | {
      kind: 'few-variations'; axis: Exclude<ChangesAxis, 'scene'>; variations: number; made: number; asked: number
      /** What was asked for on that part ("bikini"): the variants have it. */
      kept?: string[]
      offerSensitive?: boolean
    }

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
  /** Wearing and Where met as conditions, with the different forms loaded (conditionSupply). */
  conditions?: readonly ConditionSupply[]
}

/** A condition of the brief (garments or places, or library styles) and the different forms of it the pack has loaded. */
export interface ConditionSupply {
  role: 'wearing' | 'where'
  tags: readonly string[]
  /** Library styles asked for (Wearing); with them the forms are the library's outfits. */
  styles?: readonly string[]
  /** Different forms available: what condition-variety will count as variants, at most. */
  variants: number
}

/**
 * The different forms of a role's conditions the pack has to offer, counted the way the engine
 * counts its variants (condition-variety): a form is the tags a scene would lend, compared as a
 * set (valueKey). Garments: the part of each scene's outfit in the garments' region, from scenes
 * that wear them all with no other whole garment over them (layersOver); library outfits that wear
 * them too. Places: each scene's place that has them all. Styles: the library outfits of those
 * styles (meeting the garments, if any). `scenes` are every scene loaded, the donors' included;
 * `library` the outfits allowed at the rating. A forecast: the engine also skips donors of another
 * make-up and donors that clash with a scene, so it can come out lower, never higher.
 */
export function conditionSupply({ role, tags, styles = [], scenes, library = [], overrides, aliases = {}, permanence }: {
  role: 'wearing' | 'where'
  tags: readonly string[]
  styles?: readonly string[]
  scenes: readonly Pick<Scene, 'units'>[]
  library?: readonly LibraryOutfit[]
  overrides: Record<string, string>
  /** Other names of each condition (auto_suggest_tags.aliases): written as the condition, as the engine does. */
  aliases?: Readonly<Record<string, readonly string[]>>
  /** Permanence lookup: with it, the conditions are spelled as the scenes are by the whole rule (spelling.ts). */
  permanence?: (tag: string) => Permanence
}): ConditionSupply {
  // Compared in the scenes' spelling, as the engine does ("stockings" finds "thighhighs").
  const wanted = tags.map((tag) => requestSpelling(tag, overrides, permanence)).filter(Boolean)
  const renames: Array<[string, string]> = Object.entries(aliases).flatMap(([cond, names]) =>
    names.map((name) => [normalizeTagForPack(name), requestSpelling(cond, overrides, permanence)] as [string, string]))
  const named = (list: readonly string[]) => (renames.length === 0 ? list : list.map((tag) => {
    for (const [name, cond] of renames) {
      if (tag === name) return cond
      if (tag.endsWith(` ${name}`)) return `${tag.slice(0, -name.length)}${cond}`
    }
    return tag
  }))
  const keys = new Set<string>()
  if (role === 'where') {
    for (const scene of scenes) {
      const place = named(scene.units.place)
      if (wanted.length > 0 && meetsAll(place, wanted)) keys.add(valueKey(place))
    }
    return { role, tags: [...tags], variants: keys.size }
  }
  // As the engine: a library style lends the whole outfit; garments, their region.
  const region = wanted.length > 0 && styles.length === 0 ? garmentRegion(wanted, overrides) : null
  const lent = (outfit: readonly string[]) => (region ? regionTags(outfit, region, overrides) : [...outfit])
  // Another whole garment over the one asked for is a layer, unless the measured relations require
  // it ("swimsuit" for "bikini") or it is a piece of the costume, measured on the loaded scenes.
  const relations = loadedTagRelations()
  const outfits = scenes.map((scene) => named(scene.units.outfit))
  const pieces = new Map(wanted.map((garment) => [garment, garmentPieces(garment, outfits, overrides)]))
  const noPieces: ReadonlySet<string> = new Set()
  const layered = (outfit: readonly string[]) =>
    layersOver(outfit, wanted, overrides, relations ? (garment) => requiredBy(relations, garment) : undefined, (garment) => pieces.get(garment) ?? noPieces).length > 0
  const fits = (outfit: readonly string[]) => wanted.length === 0 || (meetsAll(outfit, wanted) && !layered(outfit))
  if (styles.length > 0) {
    for (const o of library) {
      const outfit = o.tags.map(normalizeTagForPack)
      if (o.style && styles.includes(o.style) && fits(outfit)) keys.add(valueKey(lent(outfit)))
    }
    return { role, tags: [...tags], styles: [...styles], variants: keys.size }
  }
  for (const scene of scenes) {
    const outfit = named(scene.units.outfit)
    if (fits(outfit)) keys.add(valueKey(lent(outfit)))
  }
  for (const o of library) {
    const outfit = o.tags.map(normalizeTagForPack)
    if (fits(outfit)) keys.add(valueKey(lent(outfit)))
  }
  return { role, tags: [...tags], variants: keys.size }
}

/**
 * The conditions whose donor search should bring more pages: fewer different forms loaded
 * than prompts asked for, counted on the loaded scenes. Library styles are left out: their
 * forms are the library's outfits, which more pages don't add to.
 */
export function shortConditionRoles(conditions: readonly ConditionSupply[], count: number): Array<'wearing' | 'where'> {
  return conditions
    .filter((c) => c.tags.length > 0 && (c.styles?.length ?? 0) === 0 && c.variants < count)
    .map((c) => c.role)
}

/** "bikini and thighhighs". */
const andList = (tags: readonly string[]) =>
  tags.length <= 1 ? tags.join('') : `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`

/** Before generating: a condition with fewer different forms loaded than prompts asked for (none said while scenes are still coming). */
function supplyNotes(conditions: readonly ConditionSupply[] | undefined, count: number, finding: boolean): FitNote[] {
  if (!conditions || finding) return []
  return conditions
    .filter((c) => (c.tags.length > 0 || (c.styles?.length ?? 0) > 0) && c.variants < count)
    .map((c) => {
      const styles = c.tags.length === 0 && (c.styles?.length ?? 0) > 0
      const what = styles ? andList(c.styles ?? []) : andList(c.tags.map((t) => t.replace(/_/g, ' ')))
      return { kind: 'condition-supply', role: c.role, what, styles, variants: c.variants, asked: count }
    })
}

/**
 * What the fit line says before generating, from the scenes that fit and how many
 * prompts were asked for. With poses it follows the engine's ladder: each scene with
 * the pose once, then again with other parts (REUSES_PER_SCENE), then the pose imposed
 * on the scenes that can take it; the rest is missing.
 */
export function predictFit(input: PredictInput): FitNote[] {
  const notes = [...predictNotes(input), ...supplyNotes(input.conditions, input.count, input.finding)]
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
  /** One-part pack: the part that changes (the line counts its variants, not scenes). */
  axis?: OneAxis | null
}

/** What the fit line says after generating: one sentence for every issue the engine reported, none dropped. */
export function issuesFit(input: IssuesInput): FitNote[] {
  const notes = issueNotes(input)
  return input.paused && notes.some((n) => n.kind !== 'fit') ? [...notes, { kind: 'paused' }] : notes
}

function issueNotes({ issues, count, made, cast, scenes, canOfferSensitive, axis }: IssuesInput): FitNote[] {
  const order: Record<ScenePackIssue['kind'], number> = {
    'few-scenes': 0, 'few-variations': 0, 'composition-without-pose': 1, 'scenes-reused': 2, 'pose-imposed': 3, 'needs-company': 4,
    'request-dropped': 5, 'axis-requested': 6, 'condition-variety': 7,
  }
  const notes = [...issues].sort((a, b) => order[a.kind] - order[b.kind]).flatMap((issue): FitNote[] => {
    if (issue.kind === 'condition-variety') return varietyNotes(issue)
    return [((): FitNote => { switch (issue.kind) {
      case 'few-scenes': return { kind: 'short', made: issue.prompts, asked: count, scenes: issue.scenes, what: poseWords(issue.tags.length) }
      case 'composition-without-pose': return { kind: 'no-pose-here', people: issue.people, cast, scenes: issue.scenes, what: poseWords(issue.tags.length) }
      case 'scenes-reused': return { kind: 'reuse', scenes: issue.scenes, reused: issue.prompts, done: true }
      case 'pose-imposed': return { kind: 'imposed', tag: issue.tag, prompts: issue.prompts, done: true }
      case 'needs-company': return { kind: 'needs-company', tag: issue.tag, prompts: issue.prompts }
      case 'request-dropped': return { kind: 'dropped', tag: issue.tag, reason: issue.reason }
      case 'axis-requested': return { kind: 'kept-on-axis', axis: issue.axis, tags: [...issue.tags] }
      case 'few-variations': return { kind: 'few-variations', axis: issue.axis, variations: issue.variations, made: issue.prompts, asked: count }
    } })()]
  })
  const shortNoted = notes.some((n) => n.kind === 'short' || n.kind === 'few-variations')
  if (made < count && !shortNoted) {
    notes.unshift(axis
      ? { kind: 'few-variations', axis, variations: made, made, asked: count }
      : { kind: 'short', made, asked: count, scenes: made })
  }
  const fit: FitNote = axis ? { kind: 'axis-fit', axis, variations: scenes ?? made } : { kind: 'fit', scenes: scenes ?? made }
  if (notes.length === 0) return [fit]
  // Only how varied the conditions came out: the pack still fits, and the line says both.
  if (notes.every((n) => n.kind === 'variety') && made >= count) return [fit, ...notes]
  const lacking = made < count || notes.some((n) => n.kind === 'reuse' || n.kind === 'imposed')
  // Only information: with nothing else to say, the pack still fits.
  if (notes.every((n) => n.kind === 'kept-on-axis') && made >= count) return [fit, ...notes]
  return canOfferSensitive && lacking ? [{ kind: 'few-rated' }, ...notes] : notes
}

/**
 * A `condition-variety` issue as the fit line says it: how many different forms there were, and
 * the prompts that got the tags as typed (a whole lack, or a donor that met only some tags).
 */
function varietyNotes(issue: Extract<ScenePackIssue, { kind: 'condition-variety' }>): FitNote[] {
  const prompts = issue.fromScene + issue.fromDonors + issue.fromLibrary + issue.imposed
  if (prompts === 0) return []
  const styles = issue.tags.length === 0 && issue.styles.length > 0
  const what = styles ? andList(issue.styles) : andList(issue.tags)
  const notes: FitNote[] = [{ kind: 'variety', role: issue.role, what, styles, variants: issue.variants, prompts }]
  if (issue.imposed > 0) notes.push({ kind: 'as-written', role: issue.role, what, prompts: issue.imposed, partial: false, ...(styles ? { styles } : {}) })
  if (issue.partial > 0) notes.push({ kind: 'as-written', role: issue.role, what, prompts: issue.partial, partial: true })
  return notes
}

/**
 * One fact, one sentence: notes that say the same thing with other words become one,
 * the most concrete. The offer of sensitive pictures joins the line that says the pack is
 * short; what stays on the changing part joins the line that counts its variants; a page
 * that brought nothing joins the offer to search again.
 */
export function mergeFitNotes(notes: readonly FitNote[]): FitNote[] {
  let out = [...notes]
  const shortAt = out.findIndex((n) => n.kind === 'short' || n.kind === 'few-variations')
  if (shortAt >= 0 && out.some((n) => n.kind === 'few-rated')) {
    out[shortAt] = { ...(out[shortAt] as Extract<FitNote, { kind: 'short' | 'few-variations' }>), offerSensitive: true }
    out = out.filter((n) => n.kind !== 'few-rated')
  }
  const fewAt = out.findIndex((n) => n.kind === 'few-variations')
  const kept = out.find((n): n is Extract<FitNote, { kind: 'kept-on-axis' }> => n.kind === 'kept-on-axis')
  if (fewAt >= 0 && kept && (out[fewAt] as Extract<FitNote, { kind: 'few-variations' }>).axis === kept.axis) {
    out[fewAt] = { ...(out[fewAt] as Extract<FitNote, { kind: 'few-variations' }>), kept: [...kept.tags] }
    out = out.filter((n) => n.kind !== 'kept-on-axis')
  }
  const pausedAt = out.findIndex((n) => n.kind === 'paused')
  if (pausedAt >= 0 && out.some((n) => n.kind === 'no-new' && !n.exhausted)) {
    out[pausedAt] = { kind: 'paused', nothingNew: true }
    out = out.filter((n) => n.kind !== 'no-new')
  }
  return out
}

// ── Another set of prompts ────────────────────────────────────────────────────

export interface RotationPlan {
  /** Scenes this run doesn't use (the ones the last runs of this cycle used). */
  exclude: number[]
  /** Scenes this run uses first. */
  preferred: number[]
  /** The cycle starts again: too few scenes are left. */
  reset: boolean
}

/**
 * Where the next Generate takes its scenes from, for the same brief: away from the scenes
 * the runs of this cycle already used, while the rest are enough for the prompts asked;
 * then the cycle starts again, with the scenes left over first. The source's own posts
 * (the character's) still go first. `available`: the scenes that fit (in a one-part pack,
 * the variants, never the scene that repeats).
 */
export function rotationPlan({ available, used, needed, own }: {
  available: readonly number[]
  used: readonly number[]
  needed: number
  own: readonly number[]
}): RotationPlan {
  const usedSet = new Set(used)
  const remaining = available.filter((id) => !usedSet.has(id))
  if (used.length > 0 && remaining.length >= needed) {
    const left = new Set(remaining)
    return { exclude: available.filter((id) => usedSet.has(id)), preferred: own.filter((id) => left.has(id)), reset: false }
  }
  if (used.length === 0) return { exclude: [], preferred: [...own], reset: false }
  // Starting again: what is left goes first, the source's own posts among them first.
  const left = new Set(remaining)
  const ownLeft = own.filter((id) => left.has(id))
  return { exclude: [], preferred: ownLeft.length > 0 ? ownLeft : remaining, reset: true }
}

/** The scenes a cycle has used after a run. */
export const rotationAfter = (plan: RotationPlan, before: readonly number[], usedNow: readonly number[]): number[] =>
  Array.from(new Set([...(plan.reset ? [] : before), ...usedNow]))

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

/**
 * The fit line while a page waits for the site's pace limit: "waiting" in place of
 * "Finding scenes…" (and of a pause, which can't be: the page goes by itself), first;
 * the line as it was once the page goes.
 */
export function withWaiting(notes: readonly FitNote[], waiting: boolean): FitNote[] {
  if (!waiting) return [...notes]
  return [{ kind: 'waiting' }, ...notes.filter((n) => n.kind !== 'finding' && n.kind !== 'paused' && n.kind !== 'waiting')]
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
  /**
   * Also shown whenever the scenes come in more than one make-up (the pack uses one and
   * leaves the others out): those with the requested poses when there are poses, else
   * every one of the pool, each with its count.
   */
  whenSeveral?: boolean
}

const samePeople = (a: PackPeople | null | undefined, b: PackPeople | null | undefined) =>
  !!a && !!b && a.girls === b.girls && a.boys === b.boys

/**
 * The People line: shown when a requested pose needs more than one person and some
 * scene has it, when the user set who is in the picture (then a composition the
 * pool lacks is listed too, with no scenes), or, with `whenSeveral`, when the scenes
 * come in more than one make-up.
 */
export function peopleLineState({ poses, needsCompany, compositions, current, picked, available = [], whenSeveral = false }: PeopleLineInput): {
  options: PoseComposition[]
  value: PackPeople | null
  poseNeeds?: number
} | null {
  if (poses.some(needsCompany) && compositions.length > 0) {
    const sizes = compositions.map((c) => c.people.girls + c.people.boys).filter((n) => n >= 2)
    return { options: [...compositions], value: current, poseNeeds: sizes.length > 0 ? Math.min(...sizes) : 2 }
  }
  const several = poses.length > 0 ? compositions : available
  // The pack's own make-up is missing from the scenes (a cast of three girls whose scenes all have a
  // boy): the line offers the ones there are, since the pack takes none of them unasked (packComposition).
  const elsewhere = several.length > 0 && !several.some((o) => samePeople(o.people, current))
  if (!picked) return whenSeveral && (several.length >= 2 || elsewhere) ? { options: [...several], value: current } : null
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
 * A gallery card's brief: its characters from the post's own character field (a name the
 * taxonomy doesn't know yet is still a character), its look, and its outfit and pose
 * offered apart (briefFromCard). `permanence`: see lib/pack/brief.ts routePermanence.
 */
export function briefFromCardPost(
  tags: readonly string[],
  characters: readonly string[],
  overrides: Record<string, string>,
  permanence?: (tag: string) => Permanence
): { brief: PackBrief; offered: { outfit: string[]; pose: string[] } } {
  const { brief, offered } = briefFromCard(tags, overrides, permanence)
  return { brief: characters.reduce((b, name) => addCharacter(b, name), brief), offered }
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
 * `permanence`: see lib/pack/brief.ts routePermanence.
 */
export function briefFromSearch(
  search: string,
  overrides: Record<string, string>,
  character: string | null,
  permanence?: (tag: string) => Permanence
): { brief: PackBrief; skipped: string[] } {
  const tokens = search.split(',').map((t) => t.trim()).filter(Boolean)
  const skipped = tokens.filter((t) => t.includes(':') && !t.startsWith('-'))
  const excluded = tokens.filter((t) => t.startsWith('-')).map((t) => t.slice(1).trim())
  const kept = tokens.filter((t) => !t.includes(':') && !t.startsWith('-'))
  skipped.push(...excluded.filter((t) => t.includes(':')).map((t) => `-${t}`))
  const parsed = briefFromPrompt(kept.join(', '), overrides, permanence)
  let brief = withPromptPeople(parsed.brief, parsed.peopleTags)
  if (character) brief = addCharacter(brief, character)
  for (const tag of excluded) if (!tag.includes(':')) brief = addNever(brief, tag)
  return { brief, skipped }
}

// ── Examples for an empty brief ───────────────────────────────────────────────

/** A ready-made request the empty brief offers: tags to add (by row), or what changes. */
export interface BriefExample {
  id: string
  tags: ReadonlyArray<{ tag: string; role: 'wearing' | 'doing' | 'where' }>
  changes?: Exclude<ChangesAxis, 'scene'>
}

/**
 * The examples the empty brief offers, all with tags of the taxonomy and safe for any
 * content rating. Picking one fills the brief for the character already in Who.
 */
export const BRIEF_EXAMPLES: readonly BriefExample[] = [
  { id: 'beach-day', tags: [{ tag: 'sundress', role: 'wearing' }, { tag: 'beach', role: 'where' }] },
  { id: 'library', tags: [{ tag: 'sitting', role: 'doing' }, { tag: 'library', role: 'where' }] },
  { id: 'school', tags: [{ tag: 'school uniform', role: 'wearing' }, { tag: 'classroom', role: 'where' }] },
  { id: 'outfits', tags: [], changes: 'outfit' },
]

/** The brief with an example's requests (and what changes) added. */
export function briefWithExample(brief: PackBrief, example: BriefExample, overrides: Record<string, string>): PackBrief {
  let next = example.tags.reduce((b, { tag, role }) => addTag(b, tag, overrides, role), brief)
  if (example.changes) next = { ...next, changes: example.changes }
  return next
}

/** True when the brief asks for nothing yet (only who): the time to offer examples. */
export const briefAsksNothing = (brief: PackBrief): boolean =>
  brief.requests.length === 0 && brief.literal.length === 0 && brief.changes === 'scene'

// ── Suggestions ───────────────────────────────────────────────────────────────

/** A tag the lookup returned (lib/supabase/client-queries.ts's TagResult). */
export interface FoundTag { name: string; postCount: number; category: number }

/** Danbooru tag categories, and the word Style shows for the ones that are not general. */
const GENERAL = 0
const CHARACTER = 4
const STYLE_KINDS: Readonly<Record<number, string | undefined>> = { 0: undefined, 1: 'Artist', 3: 'Series', 5: 'Meta' }

/**
 * What a slot of the brief offers while typing: characters in Who; general tags,
 * artists, series and meta tags in Style; general tags the taxonomy files as appearance
 * in Others (`overrides` says which); general tags elsewhere.
 */
export function slotSuggestions(
  found: readonly FoundTag[],
  slot: 'who' | 'style' | 'look' | 'other',
  limit = 8,
  overrides: Record<string, string> = {}
): Array<{ name: string; count: number; kind?: string }> {
  const kindOf = (category: number): string | undefined =>
    slot === 'who' ? 'Character' : slot === 'style' ? STYLE_KINDS[category] : undefined
  const looks = (name: string) => getTagSlotFromOverrides(normalizeTagForPack(name), overrides)?.category === 'appearance'
  const wanted = (t: FoundTag) =>
    slot === 'who' ? t.category === CHARACTER
      : slot === 'style' ? t.category in STYLE_KINDS
      : slot === 'look' ? t.category === GENERAL && looks(t.name)
      : t.category === GENERAL
  return found
    .filter(wanted)
    .slice(0, limit)
    .map((t) => {
      const kind = kindOf(t.category)
      return { name: t.name, count: t.postCount, ...(kind ? { kind } : {}) }
    })
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
  // A row stays as it is when it is locked, or when no slot remakes it (it was locked when
  // the pack was made and unlocked since): it is never dropped for being outside the slots.
  const cells: Array<{ row: T; slot: number | null } | null> = Array.from({ length }, (_, i) =>
    i < previous.length && (locked.has(i) || !slots.includes(i)) ? { row: previous[i], slot: null } : null
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

// ── Operations on a pack ────────────────────────────────────────────────────────

/**
 * The running operation after the one with `id` ends (applied, replaced, failed or never
 * started): it clears only itself. One that replaced it keeps the indicator.
 */
export function opAfterEnd<T extends { id: number }>(current: T | null, id: number): T | null {
  return current && current.id === id ? null : current
}

/**
 * A correction's notice when the brief changes: the first change after it is its own (it
 * keeps the notice and learns the brief it made); any other retires it, and from then on
 * the brief's own undo applies.
 */
export function correctionAfterBriefChange<C extends { briefBefore: unknown; briefAfter: unknown | null }>(
  correction: C | null,
  brief: unknown
): { correction: C | null; own: boolean } {
  if (!correction) return { correction: null, own: false }
  if (correction.briefAfter === null && brief !== correction.briefBefore) return { correction: { ...correction, briefAfter: brief }, own: true }
  if (brief === correction.briefAfter) return { correction, own: true }
  return { correction: null, own: false }
}

/** Rows whose text differs at the same position (a row added or gone counts too). */
export function changedRows(before: readonly { prompt: string }[], after: readonly { prompt: string }[]): number {
  let changed = Math.abs(before.length - after.length)
  for (let i = 0; i < Math.min(before.length, after.length); i++) if (before[i].prompt !== after[i].prompt) changed++
  return changed
}

/**
 * Where a Generate puts its rows: it replaces the pack, so only locked rows stay. The pack
 * has `count` rows (or as many as there are locked rows); a locked row keeps its place, and
 * one past the new end takes the last free place, in order. `at` maps a new row to the old
 * row it keeps; `slots` are the rows the engine fills, in order.
 */
export function generateLayout(locked: Iterable<number>, count: number): { length: number; at: Map<number, number>; slots: number[] } {
  const sorted = Array.from(new Set(locked)).sort((a, b) => a - b)
  const length = Math.max(count, sorted.length)
  const at = new Map<number, number>()
  const overflow: number[] = []
  for (const i of sorted) {
    if (i < length) at.set(i, i)
    else overflow.push(i)
  }
  let pos = length - 1
  for (const i of overflow.reverse()) {
    while (at.has(pos)) pos--
    at.set(pos, i)
  }
  return { length, at, slots: Array.from({ length }, (_, i) => i).filter((i) => !at.has(i)) }
}

/**
 * The rows of a Generate: the locked rows where `generateLayout` put them, and the fresh
 * prompts in the free slots (fewer prompts: the free rows left over go). A row locked while
 * the run was going keeps its prompt. Nothing else of the old pack survives.
 */
export function placeGenerated<T>(
  previous: readonly T[],
  layout: { length: number; at: ReadonlyMap<number, number>; slots: readonly number[] },
  fresh: readonly T[],
  lockedNow: ReadonlySet<number> = new Set()
): { rows: T[]; locked: number[]; slots: number[] } {
  const slotAt = new Map(layout.slots.map((row, k) => [row, k]))
  const rows: T[] = []
  const locked: number[] = []
  const slotOf: number[] = []
  for (let i = 0; i < layout.length; i++) {
    const old = layout.at.get(i)
    if (old !== undefined) {
      if (old < previous.length) {
        locked.push(rows.length)
        rows.push(previous[old])
      }
      continue
    }
    const k = slotAt.get(i)!
    if (lockedNow.has(i) && i < previous.length) {
      // Locked while the run was going: it keeps its prompt.
      locked.push(rows.length)
      slotOf[k] = rows.length
      rows.push(previous[i])
    } else if (k < fresh.length) {
      slotOf[k] = rows.length
      rows.push(fresh[k])
    }
  }
  return { rows, locked, slots: slotOf.slice(0, fresh.length).filter((x) => x !== undefined) }
}

/**
 * The posts the next Generate prefers: the source's own ones (the character's posts) the
 * last pack didn't use, while there are enough for the prompts asked; otherwise the source's
 * own ones as they are, so "another set" never changes what the source puts first. A source
 * without posts of its own prefers the scenes the last pack didn't use.
 */
export function preferredForAgain(own: readonly number[], used: ReadonlySet<number>, poolScenes: readonly number[], needed: number): number[] {
  if (used.size === 0) return [...own]
  if (own.length === 0) {
    const unused = poolScenes.filter((id) => !used.has(id))
    return unused.length > 0 ? unused : []
  }
  const unusedOwn = own.filter((id) => !used.has(id))
  return unusedOwn.length >= needed ? unusedOwn : [...own]
}

/** Rows a remake leaves as they are: locked now, or not remade by any slot. */
export function keptRows(length: number, locked: ReadonlySet<number>, slots: readonly number[]): { locked: number[]; older: number[] } {
  const remade = new Set(slots)
  const out = { locked: [] as number[], older: [] as number[] }
  for (let i = 0; i < length; i++) {
    if (locked.has(i)) out.locked.push(i)
    else if (!remade.has(i)) out.older.push(i)
  }
  return out
}

/**
 * The character a look tag of a prompt belongs to: the one whose identity block has it.
 * Null when no block or more than one has it (the scene's own hair, a shared trait): then
 * nobody gets it without asking.
 */
export function lookOwner(tag: string, blocks: ReadonlyArray<{ character: string; pinned: readonly string[] }>): string | null {
  const name = normalizeTagForPack(tag)
  const owners = blocks.filter((b) => b.character && b.pinned.some((t) => normalizeTagForPack(t) === name))
  if (blocks.filter((b) => b.character).length <= 1) return blocks.find((b) => b.character)?.character ?? null
  return owners.length === 1 ? owners[0].character : null
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

// ── Where the scenes come from ────────────────────────────────────────────────

/** A booru the pack can take its scenes from, as the pack's site menu offers it. */
export interface PackProviderChoice {
  provider: BooruProvider
  /** False: shown, not offered, with `reason`. */
  available: boolean
  /** Rule34 is adult-only: the gallery asks once before showing it, and the pack does not ask in its place. */
  reason?: 'adult-consent'
  /** The rating works there with a difference worth saying: e621 and e6ai have no sensitive tier. */
  note?: 'no-sensitive'
}

/**
 * The boorus a pack can switch to, in the gallery's order. Every pack rating exists on
 * every booru (planRatings maps them); the safe rating's sensitive pictures do not
 * exist on e621 and e6ai, so a safe pack there is said to be safe only. Rule34 waits
 * for the gallery's adult-content confirmation.
 */
export function packProviderChoices(
  providers: readonly BooruProvider[],
  rating: PackRatingMode,
  adultAcknowledged: boolean
): PackProviderChoice[] {
  return providers.map((provider) => {
    if (provider === 'rule34' && !adultAcknowledged) return { provider, available: false, reason: 'adult-consent' }
    if (rating === 'sfw' && planRatings(rating, true, provider).sensitive === 'unavailable') return { provider, available: true, note: 'no-sensitive' }
    return { provider, available: true }
  })
}

/**
 * What the fit line says of the posts loaded, and whether it offers "Find more scenes":
 * whenever the site has more for this search and nothing else is loading or waiting
 * (a pause for the request pace has its own offer). Null while there is nothing to
 * say: no posts yet, a failed load, or scenes still being found.
 */
export function loadedState(s: {
  posts: number
  noMoreResults: boolean
  failed: boolean
  sessionCapReached: boolean
  paused: boolean
  finding: boolean
  loading: boolean
}): { posts: number; all: boolean; more: boolean } | null {
  if (s.posts === 0 || s.failed || s.finding) return null
  const more = !s.noMoreResults && !s.sessionCapReached && !s.paused && !s.loading
  return { posts: s.posts, all: s.noMoreResults, more }
}

// ── Sizes ─────────────────────────────────────────────────────────────────────

/** A prompt's suggested size as a row shows it ("832×1216"), or null when its scene had no size. */
export const promptSize = (p: Pick<PackPrompt, 'width' | 'height'>): string | null =>
  p.width && p.height ? `${p.width}×${p.height}` : null

/**
 * The text a copy puts on the clipboard: one prompt per line, each with its suggested
 * size in front as "[WIDTHxHEIGHT] " when `withSize` (the form the extension's Import List
 * reads, withResolutionPrefix); a prompt without a size goes without one. `bodies` are
 * the prompts in the chosen format. `unsized` counts the prompts that went without.
 */
export function packCopyText(
  prompts: readonly Pick<PackPrompt, 'width' | 'height'>[],
  bodies: readonly string[],
  withSize: boolean
): { text: string; unsized: number } {
  const lines = bodies.map((body, i) => (withSize ? withResolutionPrefix(body, prompts[i] ?? {}) : body))
  const unsized = withSize ? prompts.filter((p) => !promptSize(p)).length : 0
  return { text: lines.join('\n'), unsized }
}

// ── What the pack is made from ────────────────────────────────────────────────

/**
 * The key of everything in the brief that changes what the pack is made from: all of it but the
 * scenes left out (in a whole-scene pack they don't rebuild the pool or the sheet) and the
 * variants left out. A field the brief gains is in it by default; the make-ups mixed in too.
 */
export function coreKeyOf(brief: PackBrief): string {
  const { leftOut, leftOutVariants, ...rest } = brief
  void leftOutVariants
  return JSON.stringify([rest, oneAxis(brief) ? leftOut : null])
}

/**
 * Whether a requested pose needs a scene that has it (poseNeedsScene), read in the scenes'
 * spelling as the engine reads it (spelling.ts, with the permanence lookup when given): Rule34's
 * "female on top" is asked as Danbooru's "girl on top". For the People line's "needs company".
 */
export function poseNeedsCompany(tag: string, overrides: Record<string, string>, permanence?: (tag: string) => Permanence, relations?: TagRelations | null): boolean {
  const spelled = requestSpelling(tag, overrides, permanence)
  return relations === undefined ? poseNeedsScene(spelled, overrides) : poseNeedsScene(spelled, overrides, relations)
}

/**
 * The most scenes of a pool that can fit the pack, read from the pool alone (sceneCandidates takes
 * seconds on a large pool; this, a few milliseconds): the scenes that fit are among the pool's
 * scenes of the make-up in use, less those `removed` (left out, donors'); with requested poses,
 * among those that have them all (`poses`, from poseCompositions with the same removed scenes).
 * Several make-ups marked (`mix`, two or more): the pool's scenes of any of them (`allScenes`), as
 * the engine mixes them (poolForCompositions). Null when it can't be told this way: no make-up yet,
 * a one-part pack (its variants come from donors), or poses the pool can't read (`poses` empty).
 */
export function sceneEstimate({ scenes, allScenes, people, mix = [], poses, hasPoses, removed, oneAxis = false }: {
  scenes: ReadonlyArray<{ postId: number; people?: PackPeople | null }>
  /** Every scene of the pool, of any make-up (ScenePool.allScenes); `scenes` when missing. */
  allScenes?: ReadonlyArray<{ postId: number; people?: PackPeople | null }>
  people: PackPeople | null
  mix?: readonly PackPeople[]
  poses: ReadonlyArray<{ people: PackPeople; scenes: number }>
  hasPoses: boolean
  removed: readonly number[]
  oneAxis?: boolean
}): number | null {
  const mixed = mix.length >= 2
  const groups = mixed ? mix : people ? [people] : null
  if (!groups || oneAxis) return null
  const same = (a: PackPeople, b: PackPeople | null | undefined) => !!b && a.girls === b.girls && a.boys === b.boys
  if (hasPoses) {
    if (poses.length === 0) return null
    return groups.reduce((sum, g) => sum + (poses.find((p) => same(g, p.people))?.scenes ?? 0), 0)
  }
  const out = new Set(removed)
  const source = mixed ? (allScenes ?? scenes).filter((scene) => groups.some((g) => same(g, scene.people))) : scenes
  return source.filter((scene) => !out.has(scene.postId)).length
}

/**
 * The make-ups People can offer: only those with room for the characters, one or several (never
 * "1 boy" for a girl alone), with the requested poses' and the pool's apart; and the ones without
 * room, each once, shown but not offered. The default make-up is chosen among `fitting` only.
 */
export function peopleChoices<T extends { people: PackPeople }>({ compositions, poses, cast, hasPoses }: {
  compositions: readonly T[]
  poses: readonly T[]
  cast: PackPeople
  hasPoses: boolean
}): { fitting: T[]; fittingPoses: T[]; blocked: T[] } {
  const holds = (c: T) => c.people.girls >= cast.girls && c.people.boys >= cast.boys
  const listed = hasPoses ? poses : compositions
  return {
    fitting: compositions.filter(holds),
    fittingPoses: poses.filter(holds),
    blocked: listed.filter((c) => !holds(c)),
  }
}

/**
 * The make-up a pack uses, out of peopleChoices. Its scenes have exactly the people the pack names
 * (`cast`: one character alone, or the cast's girls and boys) unless the user asked for company:
 *  - a People pick (`picked`, also a typed count) the pool has, which wins;
 *  - for one character, the base's own count tags (`declared`, "1girl, 1boy" on a card);
 *  - a requested act that needs more people than the pack names (`companyPose`, for one
 *    character): then the make-ups of the scenes that have it, as the People line offers them.
 * A make-up with room to spare is otherwise never the default: three girls never get a boy nobody
 * asked for because the only scene found had one. Null when the pool has no allowed make-up.
 */
export function packComposition<T extends PoseComposition>({ choices, cast, isCast, subject, picked = null, declared = null, character = true, companyPose = false }: {
  choices: { fitting: readonly T[]; fittingPoses: readonly T[] }
  cast: PackPeople
  isCast: boolean
  subject: 'girl' | 'boy'
  picked?: PackPeople | null
  declared?: PackPeople | null
  /** The base is a character chosen by name (defaultComposition). */
  character?: boolean
  /** A requested pose needs someone else (poseNeedsCompany). */
  companyPose?: boolean
}): PackPeople | null {
  if (picked && choices.fitting.some((c) => samePeople(c.people, picked))) return { girls: picked.girls, boys: picked.boys }
  if (!isCast && declared && choices.fitting.some((c) => samePeople(c.people, declared))) return { girls: declared.girls, boys: declared.boys }
  const company = companyPose && cast.girls + cast.boys < 2
  const posed = company ? choices.fittingPoses.filter((c) => c.people.girls + c.people.boys >= 2) : []
  const allowed = (c: T) => samePeople(c.people, cast) || posed.some((p) => samePeople(p.people, c.people))
  const fitting = choices.fitting.filter(allowed)
  const poses = choices.fittingPoses.filter(allowed)
  return isCast
    ? castComposition(fitting, cast, null, poses)
    : defaultComposition(fitting, subject, null, { declared: null, character }, poses)
}
