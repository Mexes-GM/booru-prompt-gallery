/**
 * The brief: one record of what a pack asks for (who is in it, what every prompt
 * carries, what none may, how many people, what changes from prompt to prompt).
 * Pure data and pure functions; every operation returns a new brief and leaves the
 * one it received untouched.
 */
import { getTagSlotFromOverrides } from '../tag-taxonomy'
import { splitCommaSeparatedTags } from '../utils/tag-utils'
import { normalizeTagForPack } from './pack-generator'
import { COUNT_TAG_RE } from './scene/permanence'
import { MAX_CAST, type CastRole } from './scene/cast'
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
  /** Tags the taxonomy doesn't know (LoRA triggers, quality tags): first in every prompt, as typed. */
  literal: string[]
  people: PackPeople | null    // null: decided from the scenes
  changes: ChangesAxis         // default 'scene'
  leftOut: string[]            // ids of scenes the user removed
}

/** The engine's view of a brief. */
export interface SceneRequests {
  select: string[]    // role 'doing': the engine chooses scenes that have them
  wearing: string[]   // imposed; replace the character's and the scene's clothes
  where: string[]     // imposed; replace the scene's place
  also: string[]      // imposed; pass the same ownership rule
  literal: string[]   // first, as typed
}

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
  if (category === 'equipment' || category === 'creature') return { kind: 'request', role: 'also' }
  if (!slot) return { kind: 'literal' }
  if (DOING_SLOTS.has(slot)) return { kind: 'request', role: 'doing' }
  if (ALSO_SLOTS.has(slot)) return { kind: 'request', role: 'also' }
  if (WHERE_SLOTS.has(slot)) return { kind: 'request', role: 'where' }
  if (LOOK_SLOTS.has(slot)) return { kind: 'look' }
  if (slot === 'other:character') return { kind: 'character' }
  return { kind: 'literal' }
}

function cloneBrief(brief: PackBrief): PackBrief {
  return {
    ...brief,
    who: brief.who.map((c) => ({ ...c, addedLook: [...c.addedLook], removedLook: [...c.removedLook] })),
    requests: brief.requests.map((r) => ({ ...r })),
    never: [...brief.never],
    literal: [...brief.literal],
    people: brief.people ? { ...brief.people } : null,
    leftOut: [...brief.leftOut],
  }
}

const unnamedCharacter = (): BriefCharacter => ({ tag: null, addedLook: [], removedLook: [] })

export function emptyBrief(): PackBrief {
  return { who: [unnamedCharacter()], requests: [], never: [], literal: [], people: null, changes: 'scene', leftOut: [] }
}

/**
 * Puts a typed tag where it belongs. `into` is the slot of the brief the user typed it
 * in: it settles requests and unknown tags, but a character, a look tag or a count
 * goes where it goes whatever the user typed it into. Counts are ignored here: the
 * number of people is decided elsewhere.
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

  if (route.kind === 'character') {
    if (next.who.some((c) => c.tag !== null && same(c.tag, name))) return next
    const [first] = next.who
    if (next.who.length === 1 && first.tag === null && first.addedLook.length === 0 && first.removedLook.length === 0) {
      next.who = [{ ...first, tag: name }]
    } else if (next.who.length < MAX_CAST) {
      next.who.push({ tag: name, addedLook: [], removedLook: [] })
    }
    return next
  }

  if (route.kind === 'look') {
    const first = next.who[0]
    first.removedLook = without(first.removedLook, name)
    if (!has(first.addedLook, name)) first.addedLook.push(name)
    return next
  }

  const role: RequestRole | null = into ?? (route.kind === 'request' ? route.role : null)
  if (role) {
    if (!next.requests.some((r) => same(r.tag, name))) next.requests.push({ tag: name, role })
  } else if (!has(next.literal, name)) {
    next.literal.push(typed)
  }
  return next
}

/** Takes a tag off the requests, the literals and every character's added look. */
export function removeTag(brief: PackBrief, tag: string): PackBrief {
  const next = cloneBrief(brief)
  next.requests = next.requests.filter((r) => !same(r.tag, tag))
  next.literal = without(next.literal, tag)
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

export function toSceneRequests(brief: PackBrief): SceneRequests {
  const of = (role: RequestRole) => brief.requests.filter((r) => r.role === role).map((r) => r.tag)
  return { select: of('doing'), wearing: of('wearing'), where: of('where'), also: of('also'), literal: [...brief.literal] }
}

/** Every tag the brief puts in the prompts (never excluded), without repeats. */
export function briefTags(brief: PackBrief): string[] {
  const all = [
    ...brief.who.flatMap((c) => (c.tag ? [c.tag] : [])),
    ...brief.who.flatMap((c) => c.addedLook),
    ...brief.requests.map((r) => r.tag),
    ...brief.literal,
  ]
  const seen = new Set<string>()
  return all.filter((t) => {
    const key = normalizeTagForPack(t)
    if (seen.has(key) || has(brief.never, key)) return false
    seen.add(key)
    return true
  })
}
