/**
 * The brief: one record of what a pack asks for (who is in it, what every prompt
 * carries, what none may, how many people, what changes from prompt to prompt).
 * Pure data and pure functions; every operation returns a new brief and leaves the
 * one it received untouched.
 */
import { getTagSlotFromOverrides } from '../tag-taxonomy'
import { splitCommaSeparatedTags } from '../utils/tag-utils'
import { normalizeTagForPack } from './pack-generator'
import { COUNT_TAG_RE, isCanonRelativeTag, type Permanence } from './scene/permanence'
import { MAX_CAST, type CastRole } from './scene/cast'
import { isVerbTag } from './scene/scene-compose'
import type { PackPeople } from './scene/scene-pool'

/** What a requested tag is about. Decides how the engine treats it. */
export type RequestRole = 'wearing' | 'doing' | 'where' | 'also'

export interface PackRequest { tag: string; role: RequestRole }

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
  who: BriefCharacter[]        // 1 to MAX_CAST
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
}

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
  | { kind: 'look' }        // hair, eyes, body
  | { kind: 'people' }      // a people-count tag, or "solo"
  | { kind: 'literal' }     // unknown to the taxonomy, or style/meta/artist/copyright

const DOING_SLOTS = new Set([
  'pose:posture', 'pose:gesture', 'pose:kinetic', 'pose:combat', 'pose:interaction', 'pose:physiological',
])
const ALSO_SLOTS = new Set(['pose:expression', 'pose:camera'])
const WHERE_SLOTS = new Set(['scenery:setting', 'scenery:props', 'scenery:atmosphere'])
const LOOK_SLOTS = new Set(['appearance:hair', 'appearance:eyes', 'appearance:anatomy', 'appearance:demographics'])

const same = (a: string, b: string) => normalizeTagForPack(a) === normalizeTagForPack(b)
const without = (list: readonly string[], tag: string) => list.filter((t) => !same(t, tag))
const has = (list: readonly string[], tag: string) => list.some((t) => same(t, tag))

/** A people-count tag ("1girl", "2boys", "6+girls") or "solo". */
function isPeopleTag(normalized: string): boolean {
  return normalized === 'solo' || COUNT_TAG_RE.test(normalized)
}

/** Decides where a typed tag goes, from its taxonomy slot. The count check comes first. */
export function routeTag(tag: string, overrides: Record<string, string>): BriefRoute {
  const normalized = normalizeTagForPack(tag)
  if (isPeopleTag(normalized)) return { kind: 'people' }
  const found = getTagSlotFromOverrides(normalized, overrides)
  if (!found) return { kind: 'literal' }
  const { category, slot } = found
  if (category === 'clothing') return { kind: 'request', role: 'wearing' }
  // An action the taxonomy files with the things it is done with ("reading", "carrying") is what
  // the body does, like a posture; the thing itself ("book", "holding sword") is not.
  if (category === 'equipment' || category === 'creature') return { kind: 'request', role: isVerbTag(normalized) ? 'doing' : 'also' }
  if (!slot) return { kind: 'literal' }
  if (DOING_SLOTS.has(slot)) return { kind: 'request', role: 'doing' }
  if (ALSO_SLOTS.has(slot)) return { kind: 'request', role: 'also' }
  if (WHERE_SLOTS.has(slot)) return { kind: 'request', role: 'where' }
  if (LOOK_SLOTS.has(slot)) return { kind: 'look' }
  if (slot === 'other:character') return { kind: 'character' }
  return { kind: 'literal' }
}

/** A row of the brief a tag can be typed in. `style` is the row of `literal`. */
export type TypedRow = 'who' | RequestRole | 'style'

/**
 * The request role for `addTag` when a tag is typed in a row; undefined puts a
 * literal tag in `literal` (the style row). A tag the taxonomy files as style, meta,
 * artist or copyright goes to `literal` wherever it is typed. A tag the taxonomy does
 * not know stays in Wearing, Doing or Where when typed there; typed anywhere else it
 * goes to `literal`, which the prompt carries first and as typed.
 */
export function typedRole(tag: string, typedIn: TypedRow, overrides: Record<string, string>): RequestRole | undefined {
  const route = routeTag(tag, overrides)
  if (route.kind === 'request') return route.role
  if (route.kind !== 'literal') return undefined
  if (getTagSlotFromOverrides(normalizeTagForPack(tag), overrides)) return undefined
  return typedIn === 'wearing' || typedIn === 'doing' || typedIn === 'where' ? typedIn : undefined
}

// The words a tag names a person's gender with ("dark-skinned male", "old man", "cat girl").
const GENDER_WORDS: Readonly<Record<string, CastRole>> = {
  male: 'boy', males: 'boy', man: 'boy', men: 'boy', boy: 'boy', boys: 'boy',
  female: 'girl', females: 'girl', woman: 'girl', women: 'girl', girl: 'girl', girls: 'girl',
}

/** The genders a tag names ("clothed male nude female" names both). */
function gendersNamed(tag: string): Set<CastRole> {
  const words = normalizeTagForPack(tag).split(/[\s()-]+/)
  return new Set(words.flatMap((w) => (GENDER_WORDS[w] ? [GENDER_WORDS[w]] : [])))
}

/**
 * True for a look tag about the people of the pack who are not its characters: it names
 * a person of a gender none of the characters has ("dark-skinned male" next to a girl),
 * or it compares the people of the picture ("interracial", "age difference"). Decided
 * only when the characters are all of one gender: with both, a "male" tag may be one of
 * them, and the tag stays where it was typed. Counts and pairings ("male focus",
 * "hetero") are about the composition, not anyone's look.
 */
export function isOthersTag(
  tag: string,
  castRoles: ReadonlyArray<CastRole | null | undefined>,
  overrides: Record<string, string>,
  permanence: (tag: string) => Permanence
): boolean {
  if (routeTag(tag, overrides).kind !== 'look') return false
  const cast = new Set(castRoles.filter((r): r is CastRole => !!r))
  if (cast.size !== 1) return false
  const kind = permanence(tag)
  if (kind === 'composition') return false
  const named = gendersNamed(tag)
  if (named.size > 0) return [...named].some((g) => !cast.has(g))
  return kind === 'relative' && !isCanonRelativeTag(tag)
}

/** Adds a tag to the others' look (and takes it off Never and the characters' added look). */
export function addOther(brief: PackBrief, tag: string): PackBrief {
  const name = normalizeTagForPack(tag)
  if (!name) return brief
  const next = cloneBrief(brief)
  next.never = without(next.never, name)
  next.who.forEach((c) => { c.addedLook = without(c.addedLook, name) })
  if (!has(next.others, name)) next.others.push(name)
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
  }
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
 * is decided elsewhere.
 */
export function addTag(brief: PackBrief, tag: string, overrides: Record<string, string>, into?: RequestRole): PackBrief {
  const typed = tag.trim()
  const name = normalizeTagForPack(typed)
  if (!name) return brief
  const route = routeTag(name, overrides)
  if (route.kind === 'people') return brief

  const next = cloneBrief(brief)
  // Asking for a tag undoes a "never" for it.
  next.never = without(next.never, name)

  if (route.kind === 'character') return addCharacter(next, name)

  if (route.kind === 'look') return addLook(next, next.who[0].tag, name)

  const role: RequestRole | null = route.kind === 'request' ? route.role : into ?? null
  if (role) {
    if (!next.requests.some((r) => same(r.tag, name))) next.requests.push({ tag: name, role })
  } else if (!has(next.literal, name)) {
    next.literal.push(typed)
  }
  return next
}

/**
 * Adds a character by name, without asking the taxonomy (a name from a character search
 * may not be in the overrides yet). It is normalized, never repeated and capped at
 * MAX_CAST. The first named character takes over the unnamed one with its look and role:
 * a pasted single-character prompt must not become a group.
 */
export function addCharacter(brief: PackBrief, name: string): PackBrief {
  const tag = normalizeTagForPack(name)
  if (!tag) return brief
  const next = cloneBrief(brief)
  if (next.who.some((c) => c.tag !== null && same(c.tag, tag))) return next
  const [first] = next.who
  if (next.who.length === 1 && first.tag === null) {
    next.who = [{ ...first, tag }]
  } else if (next.who.length < MAX_CAST) {
    next.who.push({ tag, addedLook: [], removedLook: [] })
  }
  return next
}

/** The character with this tag (null: the unnamed one), or undefined. */
const findCharacter = (brief: PackBrief, character: string | null) =>
  brief.who.find((c) => (character === null ? c.tag === null : c.tag !== null && same(c.tag, character)))

/** Adds a look tag to a character and takes it off that character's removed look. Unknown character: unchanged. */
export function addLook(brief: PackBrief, character: string | null, tag: string): PackBrief {
  const name = normalizeTagForPack(tag)
  if (!name || !findCharacter(brief, character)) return brief
  const next = cloneBrief(brief)
  const target = findCharacter(next, character)!
  target.removedLook = without(target.removedLook, name)
  if (!has(target.addedLook, name)) target.addedLook.push(name)
  return next
}

/**
 * Takes a look tag off a character. One the user added just goes; otherwise it is one of
 * the character's usual traits and joins the removed look. Unknown character: unchanged.
 */
export function removeLook(brief: PackBrief, character: string | null, tag: string): PackBrief {
  const name = normalizeTagForPack(tag)
  if (!name || !findCharacter(brief, character)) return brief
  const next = cloneBrief(brief)
  const target = findCharacter(next, character)!
  if (has(target.addedLook, name)) target.addedLook = without(target.addedLook, name)
  else if (!has(target.removedLook, name)) target.removedLook.push(name)
  return next
}

/** Gives back a usual trait that was taken off a character. Unknown character: unchanged. */
export function restoreLook(brief: PackBrief, character: string | null, tag: string): PackBrief {
  if (!findCharacter(brief, character)) return brief
  const next = cloneBrief(brief)
  const target = findCharacter(next, character)!
  target.removedLook = without(target.removedLook, tag)
  return next
}

/** Takes a tag off the requests, the literals, the others' look and every character's added look. */
export function removeTag(brief: PackBrief, tag: string): PackBrief {
  const next = cloneBrief(brief)
  next.requests = next.requests.filter((r) => !same(r.tag, tag))
  next.literal = without(next.literal, tag)
  next.others = without(next.others, tag)
  next.who.forEach((c) => { c.addedLook = without(c.addedLook, tag) })
  return next
}

/** "Never include": the tag leaves everything the brief asks for and joins `never`. */
export function addNever(brief: PackBrief, tag: string): PackBrief {
  const name = normalizeTagForPack(tag)
  if (!name) return brief
  const next = removeTag(brief, name)
  if (!has(next.never, name)) next.never.push(name)
  return next
}

export function removeNever(brief: PackBrief, tag: string): PackBrief {
  const next = cloneBrief(brief)
  next.never = without(next.never, tag)
  return next
}

/** Drops a character; the brief always keeps at least the unnamed one. */
export function removeCharacter(brief: PackBrief, tag: string): PackBrief {
  const next = cloneBrief(brief)
  next.who = next.who.filter((c) => c.tag === null || !same(c.tag, tag))
  if (next.who.length === 0) next.who = [unnamedCharacter()]
  return next
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

export function setPeople(brief: PackBrief, people: PackPeople | null): PackBrief {
  return { ...cloneBrief(brief), people: people ? { ...people } : null }
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

/** Splits a pasted prompt into the brief; counts and "solo" come back apart, none is lost. */
export function briefFromPrompt(text: string, overrides: Record<string, string>): { brief: PackBrief; peopleTags: string[] } {
  let brief = emptyBrief()
  const peopleTags: string[] = []
  for (const tag of splitCommaSeparatedTags(text)) {
    const name = normalizeTagForPack(tag)
    if (!name) continue
    if (routeTag(name, overrides).kind === 'people') {
      if (!peopleTags.includes(name)) peopleTags.push(name)
    } else {
      brief = addTag(brief, tag, overrides)
    }
  }
  return { brief, peopleTags }
}

/**
 * The brief a gallery card starts. Characters and look go in; its clothes and poses
 * are only offered (the card's moment is not what the pack asks for); the rest is dropped.
 */
export function briefFromCard(
  tags: readonly string[],
  overrides: Record<string, string>
): { brief: PackBrief; offered: { outfit: string[]; pose: string[] }; peopleTags: string[] } {
  let brief = emptyBrief()
  const offered = { outfit: [] as string[], pose: [] as string[] }
  const peopleTags: string[] = []
  const offer = (list: string[], name: string) => { if (!list.includes(name)) list.push(name) }
  for (const tag of tags) {
    const name = normalizeTagForPack(tag)
    if (!name) continue
    const route = routeTag(name, overrides)
    if (route.kind === 'people') offer(peopleTags, name)
    else if (route.kind === 'character' || route.kind === 'look') brief = addTag(brief, name, overrides)
    else if (route.kind === 'request' && route.role === 'wearing') offer(offered.outfit, name)
    else if (route.kind === 'request' && route.role === 'doing') offer(offered.pose, name)
  }
  return { brief, offered, peopleTags }
}

export function toSceneRequests(brief: PackBrief): BriefSceneRequests {
  const of = (role: RequestRole) => brief.requests.filter((r) => r.role === role).map((r) => r.tag)
  const requests = { select: of('doing'), wearing: of('wearing'), where: of('where'), also: of('also'), literal: [...brief.literal] }
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
