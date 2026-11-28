/**
 * The brief: one record of what a pack asks for (who is in it, what every prompt
 * carries, what none may, how many people, what changes from prompt to prompt).
 * Pure data and pure functions; every operation returns a new brief and leaves the
 * one it received untouched.
 */
import { getTagSlotFromOverrides } from '../tag-taxonomy'
import { splitCommaSeparatedTags } from '../utils/tag-utils'
import { readWeightedTag, writeWeight } from '../weight-utils'
import { normalizeTagForPack } from './pack-generator'
import { COUNT_TAG_RE, createPermanence, type Permanence } from './scene/permanence'
import { briefRouteOf, tagRole, type TagRole, type TagRoleContext } from './tag-role'
import { loadedTagRelations, type TagRelations } from '../tag-relations'
import { MAX_CAST, MAX_TURNS_CAST, type CastRole } from './scene/cast'
import type { PackPeople } from './scene/scene-pool'
import type { CastGender, CastSource } from './cast-picker'

/** What a requested tag is about. Decides how the engine treats it. */
export type RequestRole = 'wearing' | 'doing' | 'where' | 'also'

export interface PackRequest {
  tag: string
  role: RequestRole
  /**
   * Wearing and Where: true when this exact tag goes in every prompt. Otherwise (the default) the tag
   * is a condition: each prompt meets it with a different form of it (briefConditions).
   */
  exact?: true
  /**
   * Where: the time of day, the weather, the light ("night"). Like a place, a condition by default:
   * each prompt gets a place that has it. Exact, it goes on whatever scene each prompt has (as Also).
   */
  ambience?: true
}

/** What differs from one prompt to the next. */
export type ChangesAxis = 'scene' | 'outfit' | 'pose' | 'place' | 'expression'

export interface BriefCharacter {
  /** Character tag ("tifa lockhart"), or null for an unnamed one (a pasted prompt, an original character). */
  tag: string | null
  role?: CastRole
  /** Look tags the user added (hair, eyes, body). */
  addedLook: string[]
  /** Look tags the user took off the character's usual look. */
  removedLook: string[]
}

export interface PackBrief {
  who: BriefCharacter[]        // 1 to castLimit(brief): MAX_CAST together, MAX_TURNS_CAST one per prompt
  requests: PackRequest[]      // in every prompt
  never: string[]              // in none
  /** The Style row: style, meta, artist and copyright tags, and tags the taxonomy doesn't know (LoRA triggers). First in every prompt, as typed. */
  literal: string[]
  /** How the people of the pack who are not its characters look ("dark-skinned male"). */
  others: string[]
  people: PackPeople | null    // null: decided from the scenes
  changes: ChangesAxis         // default 'scene'
  leftOut: string[]            // ids of scenes the user removed
  /** With `changes` on one part: the post id of the scene that repeats, when the user chose one. */
  baseScene?: number
  /** With `changes` on one part: ids of the scenes whose part the user left out. Kept apart from `leftOut`. */
  leftOutVariants?: string[]
  /** Wearing: styles of the outfit library ("swimwear"): every prompt wears a whole outfit of one of them. */
  outfitStyles?: string[]
  /**
   * How much of each library outfit of `outfitStyles` goes in a prompt: its main pieces ('simple',
   * the default when missing) or all of it ('full'). This pack's own; the gallery's Random outfit
   * keeps its own setting.
   */
  outfitDetail?: 'simple' | 'full'
  /** More make-ups the pack mixes with `people` (ScenePackArgs.compositions); none: `people` alone. */
  peopleMix?: PackPeople[]
  /**
   * With two or more named characters: 'together' (missing, the default) puts all of them in every
   * prompt; 'turns' gives each prompt one of them, in turn (castTurns, lib/pack/cast-turns.ts).
   */
  castMode?: CastMode
  /**
   * Who has no named character and each prompt gets a different known character, drawn from the
   * most posted ones or a series (lib/pack/random-cast.ts). Ends when a character is named.
   */
  randomCast?: RandomCast
  /**
   * Prompt weights the user typed with a tag ("(excessive cum:2)"), by normalized tag. The brief
   * routes, matches and asks for the bare tag; the weight is written on that tag in every prompt
   * it appears in (writeBriefWeights), over the app's global weight for it. Never 1, never on a
   * Never tag, and only for tags the brief has (pruneWeights). Missing: no weights.
   */
  weights?: Record<string, number>
}

/** Random known characters, one per prompt. */
export interface RandomCast {
  source: CastSource
  /** 'auto': the gender the People line leaves room for (randomCastGender). */
  gender: CastGender | 'auto'
  /**
   * The characters drawn for the pack, in prompt order, as the pack's site names them. Generate
   * again draws others (the rows that are locked keep theirs). Stored, so a reload shows the same.
   */
  drawn: CastMember[]
}

/** How the named characters share a pack: all in every prompt, or one per prompt in turn. */
export type CastMode = 'together' | 'turns'

/** The engine's view of a brief. */
export interface SceneRequests {
  select: string[]    // role 'doing': the engine chooses scenes that have them
  wearing: string[]   // imposed; replace the character's and the scene's clothes
  where: string[]     // imposed; replace the scene's place
  also: string[]      // imposed; pass the same ownership rule
  literal: string[]   // first, as typed
  others?: string[]   // how the people who are not the characters look; only where the prompt has someone besides them
  /**
   * Tags of `wearing` and `where` the pack meets as conditions: each prompt wears (or is at) the tag
   * or a qualified form of it ("white bikini" for "bikini"), a different one per prompt where the
   * scenes, the donor posts (ScenePackArgs.donorPosts) and the outfit library offer them. A tag of
   * `wearing` / `where` not listed here is exact: imposed as typed, as when this field is missing.
   */
  conditions?: string[]
  /**
   * Styles of the outfit library (lib/outfit-swap.ts OutfitStyle: "summer", "swimwear"...): every
   * prompt wears a whole library outfit of one of them, a different one per prompt
   * (ScenePackArgs.outfitLibrary). With `wearing` conditions too, only outfits that meet them.
   */
  outfitStyles?: string[]
}

/** What toSceneRequests gives the engine (kept as a name for the callers that use it). */
export type BriefSceneRequests = SceneRequests

/** Where a typed tag belongs in the brief. */
export type BriefRoute =
  | { kind: 'request'; role: RequestRole }
  | { kind: 'character' }   // a character-name tag
  | { kind: 'look' }        // a lasting trait: hair, eyes, body
  | { kind: 'people' }      // a people-count tag, or "solo"
  | { kind: 'composition' } // who is in the picture and how they pair up ("hetero", "male focus"): set by People, never a tag
  | { kind: 'literal' }     // how the picture is made (style, meta), a name of an artist or a work, or unknown

// ── Weighted tags ───────────────────────────────────────────────────────────────

/**
 * A tag as typed or pasted, read once for every way into the brief: `name` is what the brief
 * routes, matches and stores (normalized, no weight), `typed` the bare tag as typed (the Style row
 * keeps it so), `weight` the weight the text gave (undefined: none given).
 */
export function readBriefTag(raw: string): { name: string; typed: string; weight?: number } {
  const { tag, weight } = readWeightedTag(raw)
  return { name: normalizeTagForPack(tag), typed: tag, ...(weight !== undefined ? { weight } : {}) }
}

/** The brief's name of a typed tag: normalized, without a weight ("(Excessive_Cum:2)" -> "excessive cum"). */
export const briefTagName = (raw: string): string => readBriefTag(raw).name

/** Sets the weight of a tag on a brief being built (`next` is a clone): 1 clears it, undefined leaves it. */
function setWeight(next: PackBrief, name: string, weight: number | undefined): void {
  if (weight === undefined || !name) return
  const weights = { ...(next.weights ?? {}) }
  if (weight === 1) delete weights[name]
  else weights[name] = weight
  if (Object.keys(weights).length > 0) next.weights = weights
  else delete next.weights
}

/** The brief without weights for tags it no longer puts in the prompts (removed, or in Never). */
function pruneWeights(brief: PackBrief): PackBrief {
  if (!brief.weights) return brief
  const kept = new Set(briefTags(brief).map(normalizeTagForPack))
  const entries = Object.entries(brief.weights).filter(([name]) => kept.has(name))
  if (entries.length === Object.keys(brief.weights).length) return brief
  const next = { ...brief }
  if (entries.length > 0) next.weights = Object.fromEntries(entries)
  else delete next.weights
  return next
}

/** The weight the brief gives a tag, if any. */
export const tagWeight = (brief: Pick<PackBrief, 'weights'>, tag: string): number | undefined =>
  brief.weights?.[briefTagName(tag)]

/** A tag as the brief shows and stores it in a list of typed tags (Style defaults): with its weight. */
export const weightedTag = (brief: Pick<PackBrief, 'weights'>, tag: string): string => writeWeight(tag, tagWeight(brief, tag))

/**
 * A finished prompt with the brief's weights written on its tags: "excessive cum" becomes
 * "(excessive cum:2)". A tag the app's global weights already weighted takes the brief's weight
 * instead (the pack's own wins); every other tag stays as it is. Without weights, the same text.
 */
export function writeBriefWeights(prompt: string, weights: Readonly<Record<string, number>> | undefined): string {
  if (!weights || Object.keys(weights).length === 0 || !prompt) return prompt
  let changed = false
  const out = prompt.split(',').map((piece) => {
    const token = piece.trim()
    if (!token) return piece
    const { tag } = readWeightedTag(token)
    const weight = weights[normalizeTagForPack(tag)]
    if (weight === undefined) return piece
    changed = true
    return writeWeight(tag, weight)
  })
  return changed ? out.map((t) => t.trim()).filter(Boolean).join(', ') : prompt
}

/** A pack prompt with the brief's weights written on it (writeBriefWeights); the same object without any. */
export function weighPrompt<P extends { prompt: string }>(prompt: P, brief: Pick<PackBrief, 'weights'>): P {
  const text = writeBriefWeights(prompt.prompt, brief.weights)
  return text === prompt.prompt ? prompt : { ...prompt, prompt: text }
}

/**
 * A brief stored before weights were read (a pack kept across a reload): weight syntax left in its
 * tags ("(excessive cum:2)" as a request) becomes the bare tag and its weight. The same object
 * when there is none.
 */
export function liftBriefWeights(brief: PackBrief): PackBrief {
  const weighted = (t: string) => readWeightedTag(t).weight !== undefined
  const lists = [brief.never, brief.literal, brief.others, ...brief.who.map((c) => c.addedLook), brief.requests.map((r) => r.tag), brief.who.flatMap((c) => (c.tag ? [c.tag] : []))]
  if (!lists.some((list) => list.some(weighted))) return brief
  const next = cloneBrief(brief)
  const lift = (t: string, keep?: 'typed') => {
    const read = readBriefTag(t)
    if (read.weight === undefined) return t
    setWeight(next, read.name, read.weight)
    return keep ? read.typed : read.name
  }
  next.requests = next.requests.map((r) => ({ ...r, tag: lift(r.tag) }))
  next.literal = next.literal.map((t) => lift(t, 'typed'))
  next.others = next.others.map((t) => lift(t))
  next.who = next.who.map((c) => ({ ...c, tag: c.tag === null ? null : lift(c.tag), addedLook: c.addedLook.map((t) => lift(t)) }))
  next.never = next.never.map(briefTagName)
  return pruneWeights(next)
}

const same = (a: string, b: string) => normalizeTagForPack(a) === normalizeTagForPack(b)
const without = (list: readonly string[], tag: string) => list.filter((t) => !same(t, tag))
const has = (list: readonly string[], tag: string) => list.some((t) => same(t, tag))

/** A people-count tag ("1girl", "2boys", "6+girls") or "solo". */
function isPeopleTag(normalized: string): boolean {
  return normalized === 'solo' || COUNT_TAG_RE.test(normalized)
}

// ── The role of a tag (lib/pack/tag-role.ts) ──────────────────────────────────

/**
 * What the brief reads a tag's role with besides the taxonomy: the permanence data (what lasts
 * and what belongs to the picture) once the app has loaded it. Until then the slots' defaults
 * apply. The measured relations are read where the app keeps them (loadedTagRelations).
 * A call can pass the permanence it reads instead (`permanence`): a start made before the data
 * loaded is placed again with it once it has (settleStart), whenever the app sets it here.
 */
let routePermanence: ((tag: string) => Permanence) | undefined
export function setRoutePermanence(permanence: ((tag: string) => Permanence) | undefined): void {
  routePermanence = permanence
}

// One context per set of data: tagRole caches its answers per context object.
let lastContext: { overrides: Record<string, string>; permanence?: (tag: string) => Permanence; relations: TagRelations | null; ctx: TagRoleContext } | null = null
const castContexts = new WeakMap<TagRoleContext, Map<string, TagRoleContext>>()
function routeContext(overrides: Record<string, string>, permanence: ((tag: string) => Permanence) | undefined = routePermanence): TagRoleContext {
  if (permanence && permanence !== routePermanence) return contextWith(overrides, permanence)
  const relations = loadedTagRelations()
  if (lastContext && lastContext.overrides === overrides && lastContext.permanence === routePermanence && lastContext.relations === relations) {
    return lastContext.ctx
  }
  const ctx: TagRoleContext = { overrides, permanence: routePermanence ?? lookStaysPermanence(overrides), relations }
  lastContext = { overrides, permanence: routePermanence, relations, ctx }
  return ctx
}
// A context for a permanence passed by the caller: one per permanence, rebuilt when the data it reads changes.
const explicitContexts = new WeakMap<(tag: string) => Permanence, TagRoleContext>()
function contextWith(overrides: Record<string, string>, permanence: (tag: string) => Permanence): TagRoleContext {
  const relations = loadedTagRelations()
  const found = explicitContexts.get(permanence)
  if (found && found.overrides === overrides && found.relations === relations) return found
  const ctx: TagRoleContext = { overrides, permanence, relations }
  explicitContexts.set(permanence, ctx)
  return ctx
}

/**
 * Until the permanence data loads: the slots' defaults, except that a look tag (hair, eyes, body,
 * demographics) is a trait, as before. Which looks belong to the picture ("navel") only the data says.
 */
const fallbackPermanences = new WeakMap<Record<string, string>, (tag: string) => Permanence>()
function lookStaysPermanence(overrides: Record<string, string>): (tag: string) => Permanence {
  let lookup = fallbackPermanences.get(overrides)
  if (lookup) return lookup
  const byDefault = createPermanence({}, overrides)
  lookup = (tag: string) => {
    const kind = byDefault(tag)
    return kind === 'state' && getTagSlotFromOverrides(normalizeTagForPack(tag), overrides)?.category === 'appearance' ? 'identity' : kind
  }
  fallbackPermanences.set(overrides, lookup)
  return lookup
}
function castContext(base: TagRoleContext, cast: readonly CastRole[]): TagRoleContext {
  const key = [...cast].sort().join('+')
  let byCast = castContexts.get(base)
  if (!byCast) castContexts.set(base, (byCast = new Map()))
  let ctx = byCast.get(key)
  if (!ctx) byCast.set(key, (ctx = { ...base, cast: [...cast] }))
  return ctx
}

/** The role of a tag as the brief reads it (taxonomy, permanence, relations). */
export const briefRole = (tag: string, overrides: Record<string, string>, permanence?: (tag: string) => Permanence): TagRole =>
  tagRole(briefTagName(tag), routeContext(overrides, permanence))

/**
 * Decides where a tag goes from its role (lib/pack/tag-role.ts briefRouteOf), one rule for every
 * way in: a lasting trait of the character to Who; how the character looks in this picture
 * ("navel", "closed eyes") to Also; a garment, a signature accessory ("hat") included, to Wearing;
 * what is done with a garment to Doing ("shirt lift") or Also ("open jacket"); an action, one with
 * an object ("holding sword", "reading") included, to Doing; a place, and the time, weather and
 * light, to Where; who is in the picture to People; how the picture is made, artists and works,
 * and what nothing knows, to Style. People counts come first. `permanence`: see routePermanence.
 */
export function routeTag(tag: string, overrides: Record<string, string>, permanence?: (tag: string) => Permanence): BriefRoute {
  const normalized = briefTagName(tag)
  if (isPeopleTag(normalized)) return { kind: 'people' }
  return routeOfRole(briefRole(normalized, overrides, permanence))
}

/** "holding sword", "carrying under arm": a hand verb with what it holds. */
const GRIP_PHRASE = /^(holding|carrying|wielding|riding)\s/

function routeOfRole(role: TagRole): BriefRoute {
  // "holding sword" stays Also for now: the engine's own test fixes it there (an object asked for,
  // not a pose that picks scenes). An action filed with the objects ("reading", "carrying") is Doing.
  if (role.kind === 'action' && GRIP_PHRASE.test(role.tag) && !role.slot?.startsWith('pose:')) return { kind: 'request', role: 'also' }
  switch (briefRouteOf(role)) {
    case 'Who': return role.kind === 'name' ? { kind: 'character' } : { kind: 'look' }
    // Without a cast nobody is "the others": isOthersTag decides it with the cast.
    case 'Others': return role.kind === 'aspect' && role.duration === 'state' ? { kind: 'request', role: 'also' } : { kind: 'look' }
    case 'Wearing': return { kind: 'request', role: 'wearing' }
    case 'Doing': return { kind: 'request', role: 'doing' }
    case 'Where':
    case 'Ambience': return { kind: 'request', role: 'where' }
    case 'Also': return { kind: 'request', role: 'also' }
    case 'People': return { kind: 'composition' }
    case 'Style': return { kind: 'literal' }
  }
}

/** True for the time of day, the weather, the light and effects ("night", "rain"): shown in Where, asked of the engine as Also. */
export const isAmbienceTag = (tag: string, overrides: Record<string, string>, permanence?: (tag: string) => Permanence): boolean =>
  briefRole(tag, overrides, permanence).kind === 'ambience'

/** A row of the brief a tag can be typed in. `style` is the row of `literal`. */
export type TypedRow = 'who' | RequestRole | 'style'

/** What a suggestion of the autocomplete said a tag is: a general tag, or an artist, a work, a meta tag. */
export type SuggestedKind = 'general' | 'artist' | 'copyright' | 'meta'

/**
 * The request role for `addTag` when a tag is typed in a row; undefined puts a literal tag in
 * `literal` (the Style row). A tag with a role goes where its role says, wherever it is typed. A
 * tag nothing knows: "@name" goes to Style; one picked from a suggestion follows what the
 * suggestion said (a general tag to Also; an artist, a work or a meta tag to Style); typed in
 * Wearing, Doing or Where it stays there; typed anywhere else it goes to Style, which the prompt
 * carries first and as typed.
 */
export function typedRole(tag: string, typedIn: TypedRow, overrides: Record<string, string>, suggested?: SuggestedKind): RequestRole | undefined {
  const route = routeTag(tag, overrides)
  if (route.kind === 'request') return route.role
  if (route.kind !== 'literal') return undefined
  if (briefRole(tag, overrides).kind !== 'unknown') return undefined
  if (readWeightedTag(tag).tag.startsWith('@')) return undefined
  if (suggested) return suggested === 'general' ? 'also' : undefined
  return typedIn === 'wearing' || typedIn === 'doing' || typedIn === 'where' ? typedIn : undefined
}

/**
 * True for a tag about the people of the pack who are not its characters (tag-role owner
 * `others`): a tag that names a person of a gender none of the characters has ("dark-skinned
 * male" next to a girl), what the gender data gives to the other gender ("penis"), or a comparison
 * of the people of the picture ("interracial"). Decided only when the characters are all of one
 * gender: with both, a "male" tag may be one of them, and the tag stays where it was typed. Counts
 * and pairings ("male focus", "hetero") are the composition, not anyone's look.
 */
export function isOthersTag(
  tag: string,
  castRoles: ReadonlyArray<CastRole | null | undefined>,
  overrides: Record<string, string>,
  permanence: (tag: string) => Permanence
): boolean {
  const cast = Array.from(new Set(castRoles.filter((r): r is CastRole => !!r)))
  if (cast.length !== 1) return false
  const name = briefTagName(tag)
  if (isPeopleTag(name)) return false
  const role = tagRole(name, castContext(routeContext(overrides, permanence), cast))
  if (role.owner === 'others') return role.kind !== 'composition'
  // The genitals of the other sex are another person's, a lasting trait too ("huge penis" next to a girl).
  if (role.kind !== 'aspect') return false
  const other = cast[0] === 'girl' ? MALE_GENITALS : FEMALE_GENITALS
  return other.test(name)
}
const MALE_GENITALS = /\b(penis(es)?|testicles|scrotum|foreskin)\b/
const FEMALE_GENITALS = /\b(pussy|vulva|vagina|clitoris|labia)\b/

/** Adds a tag to the others' look (and takes it off Never and the characters' added look). */
export function addOther(brief: PackBrief, tag: string): PackBrief {
  const { name, weight } = readBriefTag(tag)
  if (!name) return brief
  const next = cloneBrief(brief)
  next.never = without(next.never, name)
  next.who.forEach((c) => { c.addedLook = without(c.addedLook, name) })
  if (!has(next.others, name)) next.others.push(name)
  setWeight(next, name, weight)
  return next
}

function cloneBrief(brief: PackBrief): PackBrief {
  return {
    ...brief,
    who: brief.who.map((c) => ({ ...c, addedLook: [...c.addedLook], removedLook: [...c.removedLook] })),
    requests: brief.requests.map((r) => ({ ...r })),
    never: [...brief.never],
    literal: [...brief.literal],
    others: [...brief.others],
    people: brief.people ? { ...brief.people } : null,
    leftOut: [...brief.leftOut],
    ...(brief.leftOutVariants ? { leftOutVariants: [...brief.leftOutVariants] } : {}),
    ...(brief.outfitStyles ? { outfitStyles: [...brief.outfitStyles] } : {}),
    ...(brief.peopleMix ? { peopleMix: brief.peopleMix.map((p) => ({ ...p })) } : {}),
    ...(brief.randomCast ? { randomCast: { ...brief.randomCast, drawn: brief.randomCast.drawn.map((m) => ({ ...m })) } } : {}),
    ...(brief.weights ? { weights: { ...brief.weights } } : {}),
  }
}

/**
 * True when each prompt has one of the brief's named characters, in turn: 'turns' with two or more
 * of them. With one, there is nothing to take turns with and the pack is that character's own.
 */
export const castTurns = (brief: Pick<PackBrief, 'who' | 'castMode'>): boolean =>
  brief.castMode === 'turns' && brief.who.filter((c) => c.tag !== null).length >= 2

/** Most characters the brief can name: MAX_CAST together, MAX_TURNS_CAST one per prompt. */
export const castLimit = (brief: Pick<PackBrief, 'castMode'>): number => (brief.castMode === 'turns' ? MAX_TURNS_CAST : MAX_CAST)

/** Named characters of the brief. */
const namedCount = (brief: Pick<PackBrief, 'who'>) => brief.who.filter((c) => c.tag !== null).length

/**
 * Sets how the named characters share the pack ('together' is the default and is not stored).
 * Together holds at most MAX_CAST characters: with more, the brief stays as it is.
 */
export function setCastMode(brief: PackBrief, mode: CastMode): PackBrief {
  if ((brief.castMode ?? 'together') === mode) return brief
  if (mode === 'together' && namedCount(brief) > MAX_CAST) return brief
  const next = cloneBrief(brief)
  if (mode === 'turns') next.castMode = 'turns'
  else delete next.castMode
  return next
}

/**
 * A turns brief as one brief per named character, in brief order: the same brief with that
 * character alone in Who (their own look, role and edits), as a pack of only them would have it.
 */
export function turnBriefs(brief: PackBrief): PackBrief[] {
  return brief.who.filter((c) => c.tag !== null).map((c) => {
    const next = cloneBrief(brief)
    next.who = [{ ...c, addedLook: [...c.addedLook], removedLook: [...c.removedLook] }]
    delete next.castMode
    return next
  })
}

const unnamedCharacter = (): BriefCharacter => ({ tag: null, addedLook: [], removedLook: [] })

export function emptyBrief(): PackBrief {
  return { who: [unnamedCharacter()], requests: [], never: [], literal: [], others: [], people: null, changes: 'scene', leftOut: [] }
}

/**
 * Puts a typed tag where it belongs. `into` is the slot of the brief the user typed it
 * in, and it only matters for a tag the taxonomy doesn't know: that one stays in the
 * slot as a request. A known request keeps its own role (the role decides how the
 * engine treats it: a pose picks scenes, a place is imposed), and a character, a look
 * tag or a count goes where it goes. Counts are ignored here: the number of people
 * is decided elsewhere. `permanence`: see routePermanence.
 */
export function addTag(
  brief: PackBrief,
  tag: string,
  overrides: Record<string, string>,
  into?: RequestRole,
  permanence?: (tag: string) => Permanence
): PackBrief {
  const { name, typed, weight } = readBriefTag(tag)
  if (!name) return brief
  const route = routeTag(name, overrides, permanence)
  // A count sets People; a pairing ("hetero") or a focus is who is in the picture: neither is a tag of the brief.
  if (route.kind === 'people' || route.kind === 'composition') return brief

  const next = cloneBrief(brief)
  // Asking for a tag undoes a "never" for it.
  next.never = without(next.never, name)

  if (route.kind === 'character' || route.kind === 'look') {
    const added = route.kind === 'character' ? addCharacter(next, name) : addLook(next, next.who[0].tag, name)
    if (added === next) return next
    setWeight(added, name, weight)
    return pruneWeights(added)
  }

  const role: RequestRole | null = route.kind === 'request' ? route.role : into ?? null
  if (role) {
    // The time, the weather or the light shows in Where with the places (see PackRequest.ambience).
    const ambience = role === 'where' && isAmbienceTag(name, overrides, permanence)
    if (!next.requests.some((r) => same(r.tag, name))) next.requests.push(ambience ? { tag: name, role, ambience: true } : { tag: name, role })
  } else if (!has(next.literal, name)) {
    next.literal.push(typed)
  }
  setWeight(next, name, weight)
  return next
}

/**
 * Adds a character by name, without asking the taxonomy (a name from a character search
 * may not be in the overrides yet). It is normalized, never repeated and capped at
 * castLimit. The first named character takes over the unnamed one with its look and role:
 * a pasted single-character prompt must not become a group.
 */
export function addCharacter(brief: PackBrief, name: string): PackBrief {
  const { name: tag, weight } = readBriefTag(name)
  if (!tag) return brief
  const next = cloneBrief(brief)
  // A named character ends random characters.
  delete next.randomCast
  setWeight(next, tag, weight)
  if (next.who.some((c) => c.tag !== null && same(c.tag, tag))) return next
  const [first] = next.who
  if (next.who.length === 1 && first.tag === null) {
    next.who = [{ ...first, tag }]
  } else if (next.who.length < castLimit(next)) {
    next.who.push({ tag, addedLook: [], removedLook: [] })
  }
  return pruneWeights(next)
}

/** A character a quick cast adds (lib/pack/cast-picker.ts): their name and, when the data knows it, their gender. */
export interface CastMember {
  tag: string
  role?: CastRole | null
}

/**
 * Adds several characters at once (a quick cast), each with their gender, as addCharacter adds one:
 * names already in Who are skipped. With two or more named characters after it, the pack is one per
 * prompt (castMode 'turns'), which is what a cast picked at once is for, and can hold up to
 * MAX_TURNS_CAST of them; characters past that are left out. The user can still choose Together
 * while the pack has no more than MAX_CAST.
 */
export function addCast(brief: PackBrief, members: readonly CastMember[]): PackBrief {
  const fresh = members.filter((m) => briefTagName(m.tag))
  if (fresh.length === 0) return brief
  let next = cloneBrief(brief)
  const wasTurns = next.castMode === 'turns'
  next.castMode = 'turns'
  for (const member of fresh) {
    const tag = briefTagName(member.tag)
    const had = namedCount(next)
    next = addCharacter(next, member.tag)
    if (namedCount(next) === had || !member.role) continue
    const added = next.who.find((c) => c.tag !== null && same(c.tag, tag))
    if (added && !added.role) added.role = member.role
  }
  // One character alone has no one to take turns with: the pack stays as it was.
  if (namedCount(next) < 2 && !wasTurns) delete next.castMode
  return next
}

/** The character with this tag (null: the unnamed one), or undefined. */
const findCharacter = (brief: PackBrief, character: string | null) =>
  brief.who.find((c) => (character === null ? c.tag === null : c.tag !== null && same(c.tag, character)))

/** Adds a look tag to a character and takes it off that character's removed look. Unknown character: unchanged. */
export function addLook(brief: PackBrief, character: string | null, tag: string): PackBrief {
  const { name, weight } = readBriefTag(tag)
  if (!name || !findCharacter(brief, character)) return brief
  const next = cloneBrief(brief)
  const target = findCharacter(next, character)!
  target.removedLook = without(target.removedLook, name)
  if (!has(target.addedLook, name)) target.addedLook.push(name)
  setWeight(next, name, weight)
  return next
}

/**
 * Takes a look tag off a character. One the user added just goes; otherwise it is one of
 * the character's usual traits and joins the removed look. Unknown character: unchanged.
 */
export function removeLook(brief: PackBrief, character: string | null, tag: string): PackBrief {
  const name = briefTagName(tag)
  if (!name || !findCharacter(brief, character)) return brief
  const next = cloneBrief(brief)
  const target = findCharacter(next, character)!
  if (has(target.addedLook, name)) target.addedLook = without(target.addedLook, name)
  else if (!has(target.removedLook, name)) target.removedLook.push(name)
  return pruneWeights(next)
}

/** Gives back a usual trait that was taken off a character. Unknown character: unchanged. */
export function restoreLook(brief: PackBrief, character: string | null, tag: string): PackBrief {
  if (!findCharacter(brief, character)) return brief
  const next = cloneBrief(brief)
  const target = findCharacter(next, character)!
  target.removedLook = without(target.removedLook, briefTagName(tag))
  return next
}

/** Takes a tag off the requests, the literals, the others' look and every character's added look. */
export function removeTag(brief: PackBrief, tag: string): PackBrief {
  return pruneWeights(dropTag(brief, briefTagName(tag)))
}

/** removeTag, keeping the weight (settleStart puts the tag back elsewhere). */
function dropTag(brief: PackBrief, name: string): PackBrief {
  const next = cloneBrief(brief)
  next.requests = next.requests.filter((r) => !same(r.tag, name))
  next.literal = without(next.literal, name)
  next.others = without(next.others, name)
  next.who.forEach((c) => { c.addedLook = without(c.addedLook, name) })
  return next
}

/** "Never include": the tag leaves everything the brief asks for and joins `never`, without a weight. */
export function addNever(brief: PackBrief, tag: string): PackBrief {
  const name = briefTagName(tag)
  if (!name) return brief
  const next = dropTag(brief, name)
  if (!has(next.never, name)) next.never.push(name)
  return pruneWeights(next)
}

export function removeNever(brief: PackBrief, tag: string): PackBrief {
  const next = cloneBrief(brief)
  next.never = without(next.never, briefTagName(tag))
  return next
}

/** Drops a character; the brief always keeps at least the unnamed one. */
export function removeCharacter(brief: PackBrief, tag: string): PackBrief {
  const next = cloneBrief(brief)
  next.who = next.who.filter((c) => c.tag === null || !same(c.tag, briefTagName(tag)))
  if (next.who.length === 0) next.who = [unnamedCharacter()]
  return pruneWeights(next)
}

/** Sets (or, with undefined, clears) the role of the character with this tag; null picks the unnamed one. */
export function setCharacterRole(brief: PackBrief, tag: string | null, role: CastRole | undefined): PackBrief {
  const next = cloneBrief(brief)
  for (const c of next.who) {
    const match = tag === null ? c.tag === null : c.tag !== null && same(c.tag, tag)
    if (!match) continue
    if (role) c.role = role
    else delete c.role
  }
  return next
}

/** Sets the one make-up of the pack (the others it mixed in go). */
export function setPeople(brief: PackBrief, people: PackPeople | null): PackBrief {
  const next: PackBrief = { ...cloneBrief(brief), people: people ? { ...people } : null }
  delete next.peopleMix
  return next
}

const samePeople = (a: PackPeople, b: PackPeople) => a.girls === b.girls && a.boys === b.boys

/** The make-ups the brief asks for: `people` and the ones mixed in; none while the scenes decide. */
export const briefCompositions = (brief: Pick<PackBrief, 'people' | 'peopleMix'>): PackPeople[] =>
  brief.people ? [brief.people, ...(brief.peopleMix ?? [])] : []

/**
 * Marks or unmarks a make-up on People. `current` is the one the pack uses while the brief sets
 * none (it becomes the first). The last one marked can't be unmarked: a pack has people.
 */
export function toggleComposition(brief: PackBrief, option: PackPeople, current: PackPeople | null): PackBrief {
  const selected = brief.people ? briefCompositions(brief) : current ? [current] : []
  const marked = selected.some((p) => samePeople(p, option))
  if (marked && selected.length <= 1) return brief
  const list = marked ? selected.filter((p) => !samePeople(p, option)) : [...selected, option]
  const next = setPeople(brief, list[0] ?? null)
  if (list.length > 1) next.peopleMix = list.slice(1).map((p) => ({ ...p }))
  return next
}

export function setChanges(brief: PackBrief, changes: ChangesAxis): PackBrief {
  return { ...cloneBrief(brief), changes }
}

/**
 * Chooses what changes. Another part starts its own choices again (the scene that
 * repeats, the variants left out); the scenes left out of a whole-scene pack stay.
 */
export function chooseChanges(brief: PackBrief, changes: ChangesAxis): PackBrief {
  const next = { ...cloneBrief(brief), changes }
  if (changes === brief.changes) return next
  delete next.baseScene
  delete next.leftOutVariants
  return next
}

/** The scene that repeats in a one-part pack (undefined: the pack's own choice). */
export function setBaseScene(brief: PackBrief, postId: number | undefined): PackBrief {
  const next = cloneBrief(brief)
  if (postId === undefined) delete next.baseScene
  else {
    next.baseScene = postId
    // The scene that repeats can't be left out.
    if (next.leftOutVariants) next.leftOutVariants = next.leftOutVariants.filter((x) => x !== String(postId))
  }
  return next
}

export function leaveOutVariant(brief: PackBrief, id: string): PackBrief {
  const next = cloneBrief(brief)
  const list = next.leftOutVariants ?? []
  next.leftOutVariants = list.includes(id) ? list : [...list, id]
  return next
}

export function restoreVariant(brief: PackBrief, id: string): PackBrief {
  const next = cloneBrief(brief)
  next.leftOutVariants = (next.leftOutVariants ?? []).filter((x) => x !== id)
  return next
}

export function leaveOutScene(brief: PackBrief, id: string): PackBrief {
  const next = cloneBrief(brief)
  if (!next.leftOut.includes(id)) next.leftOut.push(id)
  return next
}

export function restoreScene(brief: PackBrief, id: string): PackBrief {
  const next = cloneBrief(brief)
  next.leftOut = next.leftOut.filter((x) => x !== id)
  return next
}

/**
 * Splits a pasted prompt into the brief; counts and "solo" come back apart, none is lost.
 * `permanence`: see routePermanence.
 */
export function briefFromPrompt(
  text: string,
  overrides: Record<string, string>,
  permanence?: (tag: string) => Permanence
): { brief: PackBrief; peopleTags: string[] } {
  let brief = emptyBrief()
  const peopleTags: string[] = []
  for (const tag of splitCommaSeparatedTags(text)) {
    const name = briefTagName(tag)
    if (!name) continue
    // Counts set People; a pairing or focus ("hetero") is who is in the picture too: kept apart, never lost.
    const kind = routeTag(name, overrides, permanence).kind
    if (kind === 'people' || kind === 'composition') {
      if (!peopleTags.includes(name)) peopleTags.push(name)
    } else {
      brief = addTag(brief, tag, overrides, undefined, permanence)
    }
  }
  return { brief, peopleTags }
}

/**
 * The brief a gallery card starts. Characters and look go in; its clothes and poses
 * are only offered (the card's moment is not what the pack asks for); the rest is dropped.
 * `permanence`: see routePermanence.
 */
export function briefFromCard(
  tags: readonly string[],
  overrides: Record<string, string>,
  permanence?: (tag: string) => Permanence
): { brief: PackBrief; offered: { outfit: string[]; pose: string[] }; peopleTags: string[] } {
  let brief = emptyBrief()
  const offered = { outfit: [] as string[], pose: [] as string[] }
  const peopleTags: string[] = []
  const offer = (list: string[], name: string) => { if (!list.includes(name)) list.push(name) }
  for (const tag of tags) {
    const name = briefTagName(tag)
    if (!name) continue
    const route = routeTag(name, overrides, permanence)
    if (route.kind === 'people' || route.kind === 'composition') offer(peopleTags, name)
    else if (route.kind === 'character' || route.kind === 'look') brief = addTag(brief, tag, overrides, undefined, permanence)
    else if (route.kind === 'request' && route.role === 'wearing') offer(offered.outfit, name)
    else if (route.kind === 'request' && route.role === 'doing') offer(offered.pose, name)
  }
  return { brief, offered, peopleTags }
}

/** Where a brief has a tag: a character's added look, a request of a role, the Style row, or nowhere. */
function placeOf(brief: PackBrief, tag: string): string | null {
  if (brief.who.some((c) => has(c.addedLook, tag))) return 'look'
  const request = brief.requests.find((r) => same(r.tag, tag))
  if (request) return `request:${request.role}${request.ambience ? ':ambience' : ''}`
  return has(brief.literal, tag) ? 'literal' : null
}

/**
 * A start made before the permanence data loaded (briefFromPrompt, briefFromCard), once it has:
 * `start` is the brief the start made then, `settled` the one the same start makes with the data,
 * `current` the brief now. Each tag the two place differently ("navel" a trait in Who, then in
 * Also) goes where `settled` has it, unless the user has moved or removed it since (it is no
 * longer where `start` put it). Characters, people and Never stay as they are.
 */
export function settleStart(start: PackBrief, settled: PackBrief, current: PackBrief): PackBrief {
  const looks = (b: PackBrief) => b.who.flatMap((c) => c.addedLook)
  const tags = [start, settled].flatMap((b) => [...looks(b), ...b.requests.map((r) => r.tag), ...b.literal])
  let next = current
  const seen = new Set<string>()
  for (const tag of tags) {
    const name = normalizeTagForPack(tag)
    if (seen.has(name)) continue
    seen.add(name)
    const was = placeOf(start, name)
    const now = placeOf(settled, name)
    if (was === now || placeOf(next, name) !== was) continue
    // Put elsewhere by the user (Never, Others) or a character: theirs.
    if (has(next.never, name) || has(next.others, name) || next.who.some((c) => c.tag !== null && same(c.tag, name))) continue
    next = dropTag(next, name)
    if (now === 'look') {
      const owner = settled.who.find((c) => has(c.addedLook, name))?.tag ?? null
      next = addLook(next, findCharacter(next, owner) ? owner : next.who[0].tag, name)
    } else if (now === 'literal') {
      next.literal.push(settled.literal.find((t) => same(t, name))!)
    } else if (now) {
      next.requests.push({ ...settled.requests.find((r) => same(r.tag, name))! })
    }
  }
  return pruneWeights(next)
}

export function toSceneRequests(brief: PackBrief): BriefSceneRequests {
  // An exact ambience goes on the scene each prompt has (Also, after Also's own tags); any other
  // ambience is a place condition, asked as Where.
  const onScene = (r: PackRequest) => !!r.ambience && !!r.exact
  const of = (role: RequestRole) => brief.requests.filter((r) => r.role === role && !onScene(r)).map((r) => r.tag)
  const ambience = brief.requests.filter(onScene).map((r) => r.tag)
  const requests = { select: of('doing'), wearing: of('wearing'), where: of('where'), also: [...of('also'), ...ambience], literal: [...brief.literal] }
  return brief.others.length > 0 ? { ...requests, others: [...brief.others] } : requests
}

/** Every tag the brief puts in the prompts (never excluded), without repeats. */
export function briefTags(brief: PackBrief): string[] {
  const all = [
    ...brief.who.flatMap((c) => (c.tag ? [c.tag] : [])),
    ...brief.who.flatMap((c) => c.addedLook),
    ...brief.requests.map((r) => r.tag),
    ...brief.literal,
    ...brief.others,
  ]
  const seen = new Set<string>()
  return all.filter((t) => {
    const key = normalizeTagForPack(t)
    if (seen.has(key) || has(brief.never, key)) return false
    seen.add(key)
    return true
  })
}

// ── Wearing and Where as conditions ─────────────────────────────────────────────

/** Places a condition can vary; the time of day, the weather and the things in a place ("night", "bed") stay exact. */
const CONDITION_PLACE_SLOTS = new Set(['scenery:setting'])

/**
 * True when a request can be met as a condition (with a different form per prompt): any garment of
 * Wearing, and a place of Where. Atmosphere and props of Where stay as typed, as before.
 */
export function canBeCondition(request: Pick<PackRequest, 'tag' | 'role' | 'ambience'>, overrides: Record<string, string>): boolean {
  if (request.role === 'wearing') return true
  if (request.role !== 'where') return false
  if (request.ambience) return true
  const found = getTagSlotFromOverrides(normalizeTagForPack(request.tag), overrides)
  return !found?.slot || CONDITION_PLACE_SLOTS.has(found.slot)
}

/** The brief's Wearing and Where tags met as conditions (SceneRequests.conditions): those not marked exact. */
export function briefConditions(brief: Pick<PackBrief, 'requests'>, overrides: Record<string, string>): string[] {
  return brief.requests.filter((r) => !r.exact && canBeCondition(r, overrides)).map((r) => r.tag)
}

/** Marks a Wearing or Where tag exact (the same tag in every prompt) or back to a condition. */
export function setRequestExact(brief: PackBrief, raw: string, exact: boolean): PackBrief {
  const tag = briefTagName(raw)
  if (!brief.requests.some((r) => same(r.tag, tag))) return brief
  const next = cloneBrief(brief)
  next.requests = next.requests.map((r) => {
    if (!same(r.tag, tag)) return r
    const { exact: _drop, ...rest } = r
    void _drop
    return exact ? { ...rest, exact: true } : rest
  })
  return next
}

/** Adds a style of the outfit library to Wearing. */
export function addOutfitStyle(brief: PackBrief, style: string): PackBrief {
  if (brief.outfitStyles?.includes(style)) return brief
  return { ...cloneBrief(brief), outfitStyles: [...(brief.outfitStyles ?? []), style] }
}

export function removeOutfitStyle(brief: PackBrief, style: string): PackBrief {
  if (!brief.outfitStyles?.includes(style)) return brief
  const next = cloneBrief(brief)
  const rest = (brief.outfitStyles ?? []).filter((s) => s !== style)
  if (rest.length > 0) next.outfitStyles = rest
  else delete next.outfitStyles
  return next
}

/** Sets how much of each library outfit the pack's styles put in a prompt (PackBrief.outfitDetail). */
export function setOutfitDetail(brief: PackBrief, detail: 'simple' | 'full'): PackBrief {
  if (brief.outfitDetail === detail) return brief
  return { ...cloneBrief(brief), outfitDetail: detail }
}

/**
 * addTag, and a garment or place it adds is exact: this tag in every prompt (Always on a tag of a
 * prompt asks for that tag, not for any form of it).
 */
export function addTagExactly(brief: PackBrief, tag: string, overrides: Record<string, string>, into?: RequestRole): PackBrief {
  const next = addTag(brief, tag, overrides, into)
  const name = briefTagName(tag)
  const added = next.requests.find((r) => same(r.tag, name))
  return added && (added.role === 'wearing' || added.role === 'where') ? setRequestExact(next, name, true) : next
}
