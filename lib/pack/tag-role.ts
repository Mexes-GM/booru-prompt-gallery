/**
 * The role of a tag in a pack: whose it is, whether it lasts, and what it is.
 *
 * The taxonomy files a tag by topic ("navel" is anatomy, "holding sword" a weapon,
 * "shirt lift" a top, "night" atmosphere). A pack needs the tag's role instead: who
 * it describes (the named character, the other people, the scene, the picture, or
 * it is a name), whether it is a trait or the moment, and what kind of thing it is.
 * `tagRole` reads that from the data the app already has, in this order of trust:
 *
 *  1. the taxonomy slot (curated by topic);
 *  2. the permanence data (identity / state / signature / relative / composition);
 *  3. the measured tag relations (what a tag requires, what needs company, what is held);
 *  4. the booru's own type for the tag, when known;
 *  5. the gender affinity measured on solo posts;
 *  6. the shape of the tag, through short closed lists of grammatical words.
 *
 * A later source refines an earlier one ("shirt lift" is filed as a top; its form
 * and the relations say it is something done to a shirt) but never overrides a
 * more trusted one that says the opposite; `why` records what each source said.
 * When nothing decides, the kind is `unknown`: the role is never guessed.
 *
 * Pure: no React, no requests. `briefRouteOf` and `sceneUnitOf` derive where a role
 * goes in the brief and in a scene.
 */
import { getTagSlotFromOverrides, TAG_SUBCATEGORIES } from '../tag-taxonomy'
import { needsCompany, relationKey, requiredBy, requiredSlots, type TagRelations } from '../tag-relations'
import { GENDER_AFFINITY } from '../prompt/natural/gender-affinity'
import { COUNT_TAG_RE, createPermanence, isCanonRelativeTag, isCompositionPattern, type Permanence } from './scene/permanence'
import { isQualifiedName } from './scene/franchise'
import { isPlainBackgroundTag, isSceneTag } from './background-coherence'
import type { TagKind, UnitName } from './scene/scene'
import type { CastRole } from './scene/cast'

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Whose the tag is:
 *  - `character` the people the pack names (their look, clothes, face, what they do);
 *  - `others`    the people of the picture the pack does not name (an anonymous partner);
 *  - `scene`     what is or happens in the picture (place, light, objects, how many people, the shot);
 *  - `picture`   how the picture is made (style, medium, meta, censorship, speech bubbles);
 *  - `name`      a name: a character, an artist, a work.
 */
export type RoleOwner = 'character' | 'others' | 'scene' | 'picture' | 'name'

/** Whether the tag is a trait (`permanent`) or belongs to this picture (`state`). */
export type RoleDuration = 'permanent' | 'state'

/**
 * What the tag is. `garment-state` is something done to or about a garment
 * ("shirt lift", "open jacket", "no panties"); `ambience` is time of day, weather,
 * light and effects; `composition` is how many people there are, how they pair up
 * and who the picture is about; `framing` the shot and the gaze.
 */
export type RoleKind =
  | 'aspect' | 'garment' | 'garment-state' | 'action' | 'object' | 'place' | 'ambience'
  | 'composition' | 'expression' | 'framing' | 'style' | 'name' | 'unknown'

export type NameKind = 'character' | 'artist' | 'copyright'

/**
 * How a garment-state tag treats its garment: `worn` in some state ("open jacket",
 * "torn shirt"), `moved` for the moment ("shirt lift", "panties aside"), `off` not
 * worn ("no panties", "bra removed").
 */
export type GarmentHow = 'worn' | 'moved' | 'off'

/** The source that decided the kind. */
export type RoleSource = 'taxonomy' | 'permanence' | 'relations' | 'booru' | 'affinity' | 'form' | 'none'

export interface TagRole {
  /** The tag in the app's spelling (lower case, spaces). */
  tag: string
  /** Null only for an `unknown` kind. */
  owner: RoleOwner | null
  /** Null for names, the picture, composition and `unknown`. */
  duration: RoleDuration | null
  kind: RoleKind
  /** The taxonomy slot the tag was read with ("clothing:top", or the bare category), or null. */
  slot: string | null
  /** garment-state: the garment it refers to ("shirt"), or "*" for clothes in general. */
  garment?: string
  how?: GarmentHow
  /** action: the object it names ("sword" for "holding sword"). */
  object?: string
  /** action: the measured relations say it needs an object it doesn't name ("drinking"). */
  needsObject?: true
  /** object: part of the surroundings (furniture, plants) rather than something carried. */
  fixture?: true
  /** name: what it names, when known. */
  name?: NameKind
  /**
   * Compares whoever the picture shows with their canon version ("alternate costume",
   * "genderswap", "cosplay"): it means something for the pack's own character, never
   * for a scene moved onto someone else.
   */
  canon?: true
  /** Id of the rule that decided the kind (see RULES in the report): for debugging and measuring. */
  rule: string
  source: RoleSource
  /** What each source said, in the order they were read. */
  why: string[]
}

export interface TagRoleContext {
  /** tag (spaces) -> "category:subcategory", as the app builds them. */
  overrides: Record<string, string>
  /** The permanence lookup (createPermanence); built from the slots alone when missing. */
  permanence?: (tag: string) => Permanence
  /** The measured tag relations, once loaded. Without them the relation rules stay silent. */
  relations?: TagRelations | null
  /** What the booru says a tag is, when known. */
  tagKind?: (tag: string) => TagKind | undefined
  /** Genders of the named characters. Unknown or mixed: no gendered tag is given to the others. */
  cast?: ReadonlyArray<CastRole | null | undefined>
}

// ── Closed word lists (grammar only) ─────────────────────────────────────────

/**
 * Words a tag names a person's gender with ("dark-skinned male", "old man", "fox girl").
 * The same list as `brief.ts`'s isOthersTag. Whole words only, so "tomboy" or "manly" never match.
 */
const GENDER_WORDS: Readonly<Record<string, CastRole>> = {
  male: 'boy', males: 'boy', man: 'boy', men: 'boy', boy: 'boy', boys: 'boy',
  female: 'girl', females: 'girl', woman: 'girl', women: 'girl', girl: 'girl', girls: 'girl',
}

/**
 * Possessives that point at a body: someone else's ("grabbing another's breasts") or the
 * subject's own ("presenting own body", "lifting own clothes"). A tag with one is an act
 * done to that body, whatever slot it is filed in.
 */
const BODY_POSSESSIVE_RE = /\b(another(?:'s)?|own)\b/

/** "A and B", "A x B": two people named together ("teacher and student", "oc x canon"): who is in the picture. */
const PAIR_RE = /^.+ (and|x) .+$/

/**
 * Prepositions that place one thing against another ("food on face", "flower over eye"):
 * such a tag is a state of the scene, not the thing it starts with.
 */
const PLACED_RE = /^.+ (on|over|under|in|into|to|between|around|behind|against|through|from|with) .+$/

/** A decade on its own ("90s", "1990s"): the era the picture is drawn in (the rule of scene.ts). */
const DECADE_RE = /^(\d0|\d{3}0)s$/

/**
 * Grip verbs: the tag is an act of holding something, and what follows is the thing
 * ("holding sword", "carrying umbrella"). The verbs `scene-compose.ts` treats as needing an object.
 */
const GRIP_VERBS = new Set(['holding', 'carrying', 'wielding', 'riding'])

/** A one-word gerund ("reading", "fishing"): an act. The rule `isVerbTag` applies. */
const GERUND = /^[a-z]{3,}ing$/

/**
 * Garment-state grammar, the words `scene-compose.ts` reads for dangling references,
 * plus the ones of absence. After the garment, a movement of the moment ("skirt lift",
 * "panties aside", "hood down") or its removal ("bra removed"); before it, the state the
 * garment is worn in ("open jacket", "torn shirt"), or its absence ("no panties", "unworn hat",
 * "missing headwear"). "partially" may come before the verb ("jacket partially removed").
 */
const AFTER_GARMENT = /^(.+?) (?:partially )?(lift|lifted|pull|pulled|aside|tug|tugged|removed|down|up)$/
const BEFORE_GARMENT = /^(open|unbuttoned|unzipped|untied|torn|unworn|missing|no) (.+)$/
/** A garment moved around a limb ("panties around one leg"), as `scene-compose.ts` reads it. */
const AROUND_GARMENT = /^(.+?) (around) .+$/
/** Words for clothes in general: the state applies to whatever is worn. */
const GENERIC_CLOTHES = new Set(['clothes', 'clothing'])
/** The taxonomy's own names for kinds of garment ("headwear", "legwear", "top"): a tag ending in one names a garment. */
const GARMENT_KIND_WORDS: ReadonlySet<string> = new Set(TAG_SUBCATEGORIES.clothing.filter((s) => s !== 'accents'))

// ── Helpers ───────────────────────────────────────────────────────────────────

const normalize = (tag: string): string => tag.toLowerCase().replace(/_/g, ' ').replace(/\\([()])/g, '$1').replace(/\s+/g, ' ').trim()
const words = (tag: string): string[] => tag.split(/[\s()-]+/).filter(Boolean)
const lastWord = (tag: string): string => tag.slice(tag.lastIndexOf(' ') + 1)

/** The genders a tag names ("clothed male nude female" names both). */
export function gendersNamed(tag: string): Set<CastRole> {
  return new Set(words(normalize(tag)).flatMap((w) => (GENDER_WORDS[w] ? [GENDER_WORDS[w]] : [])))
}

/** Minimum share of solo posts for the affinity table to speak, and how many times more common one gender must be (scene.ts tagGender). */
const AFFINITY_MIN_SHARE = 0.01
const AFFINITY_RATIO = 4

/**
 * The gender the affinity table gives a tag: every rating bucket where the tag is
 * present (at least AFFINITY_MIN_SHARE of either gender's solo posts) must give it to
 * the same gender, by AFFINITY_RATIO. "penis" (adult posts only) is a man's; "nipples"
 * is a man's in general posts but nobody's in adult ones, so it is nobody's.
 */
export function affinityGender(tag: string): CastRole | null {
  const affinity = GENDER_AFFINITY[normalize(tag)]
  if (!affinity) return null
  let gender: CastRole | null = null
  for (const offset of [0, 2]) {
    const woman = affinity[offset]
    const man = affinity[offset + 1]
    if (woman < AFFINITY_MIN_SHARE && man < AFFINITY_MIN_SHARE) continue
    const claim: CastRole | null = man >= AFFINITY_RATIO * woman ? 'boy' : woman >= AFFINITY_RATIO * man ? 'girl' : null
    if (!claim || (gender && gender !== claim)) return null
    gender = claim
  }
  return gender
}

interface SlotRead {
  category: string
  slot: string | null
  /** The overrides have the tag itself, not only a word-suffix of it ("holding sword" vs "blue skirt" -> "skirt"). */
  exact: boolean
}

function readSlot(tag: string, overrides: Record<string, string>): SlotRead | null {
  const info = getTagSlotFromOverrides(tag, overrides)
  if (!info) return null
  const exact = !!(overrides[tag] ?? overrides[tag.replace(/ /g, '_')])
  return { category: info.category, slot: info.slot ?? null, exact }
}

const singleGender = (cast: TagRoleContext['cast']): CastRole | null => {
  const genders = new Set((cast ?? []).filter((g): g is CastRole => !!g))
  return genders.size === 1 ? [...genders][0] : null
}


// ── The role ─────────────────────────────────────────────────────────────────

interface Draft {
  owner: RoleOwner | null
  duration: RoleDuration | null
  kind: RoleKind
  rule: string
  source: RoleSource
  extra?: Partial<Pick<TagRole, 'garment' | 'how' | 'object' | 'needsObject' | 'fixture' | 'name' | 'canon'>>
}

const caches = new WeakMap<TagRoleContext, Map<string, TagRole>>()
const fallbackPermanence = new WeakMap<Record<string, string>, (tag: string) => Permanence>()

function permanenceOf(ctx: TagRoleContext): (tag: string) => Permanence {
  if (ctx.permanence) return ctx.permanence
  let lookup = fallbackPermanence.get(ctx.overrides)
  if (!lookup) fallbackPermanence.set(ctx.overrides, (lookup = createPermanence({}, ctx.overrides)))
  return lookup
}

/** The role of `tag` in a pack. Cached per context object: build the context once and reuse it. */
export function tagRole(tag: string, ctx: TagRoleContext): TagRole {
  return roleOf(normalize(tag), ctx, 0)
}

/** How deep the relations are followed ("shirt rolled up" -> "clothes lift" is one step). */
const MAX_GENUS_DEPTH = 2

function roleOf(tag: string, ctx: TagRoleContext, depth: number): TagRole {
  let cache = caches.get(ctx)
  if (!cache) caches.set(ctx, (cache = new Map()))
  const hit = cache.get(tag)
  if (hit) return hit
  const why: string[] = []
  const slot = readSlot(tag, ctx.overrides)
  const draft = decide(tag, slot, ctx, depth, why)
  const role: TagRole = {
    tag,
    owner: draft.owner,
    duration: draft.duration,
    kind: draft.kind,
    slot: slot ? slot.slot ?? slot.category : null,
    ...draft.extra,
    rule: draft.rule,
    source: draft.source,
    why,
  }
  // A role read at depth > 0 may have stopped short of the relations; only the full reading is cached.
  if (depth === 0) cache.set(tag, role)
  return role
}

const NAME_SLOTS: Readonly<Record<string, NameKind>> = { 'other:character': 'character', 'other:artist': 'artist', 'other:copyright': 'copyright' }

function decide(tag: string, read: SlotRead | null, ctx: TagRoleContext, depth: number, why: string[]): Draft {
  const permanence = permanenceOf(ctx)
  const kindOf = ctx.tagKind?.(tag)
  why.push(read ? `taxonomy: ${read.slot ?? read.category}${read.exact ? '' : ' (by word suffix)'}` : 'taxonomy: no slot')
  if (kindOf) why.push(`booru: ${kindOf}`)
  // A slot read only from the tag's last words ("... (4th costume)" -> "costume") is a guess
  // by shape; the booru saying the tag is none of its own outweighs it.
  const slot = read && !read.exact && kindOf === 'unlisted' ? null : read
  if (read && !slot) why.push('the slot by word suffix gives way to the booru not knowing the tag')

  // ── Names and the picture ──
  if (!slot && /^@[a-z0-9]/.test(tag)) {
    why.push('form: "@name", the artist syntax of the generators')
    return { owner: 'name', duration: null, kind: 'name', rule: 'name.at-sign', source: 'form', extra: { name: 'artist' } }
  }
  const bookName: NameKind | null = kindOf === 'artist' || kindOf === 'copyright' || kindOf === 'character' ? kindOf : null
  const slotName = slot?.slot ? NAME_SLOTS[slot.slot] : undefined
  if (slotName) {
    // The slot gives the topic; the booru says whether the tag is a name. A general tag
    // about an artist or a work ("artist name", "copyright logo") is text in the picture.
    // The relations are measured on general tags only, so a tag they list is one too.
    const inRelations = !kindOf && !!ctx.relations?.index.has(relationKey(tag))
    if (kindOf === 'general' || inRelations) {
      why.push(`${inRelations ? 'relations: measured as a general tag' : 'booru: a general tag'}, so it is about a name, not one`)
      return { owner: 'picture', duration: null, kind: 'style', rule: 'picture.name-topic', source: inRelations ? 'relations' : 'booru' }
    }
    return { owner: 'name', duration: null, kind: 'name', rule: 'name.slot', source: 'taxonomy', extra: { name: bookName ?? slotName } }
  }
  if (bookName && (!slot || slot.category === 'other')) {
    return { owner: 'name', duration: null, kind: 'name', rule: 'name.booru', source: 'booru', extra: { name: bookName } }
  }
  if (bookName) why.push(`booru says ${bookName}; the slot is trusted more`)
  if (slot?.category === 'other') return { owner: 'picture', duration: null, kind: 'style', rule: 'picture.slot', source: 'taxonomy' }
  if (!slot && kindOf === 'meta') return { owner: 'picture', duration: null, kind: 'style', rule: 'picture.booru-meta', source: 'booru' }
  if (!slot && DECADE_RE.test(tag)) {
    why.push('form: a decade, the era the picture is drawn in')
    return { owner: 'picture', duration: null, kind: 'style', rule: 'picture.decade', source: 'form' }
  }
  if (!slot && isQualifiedName(tag, ctx.tagKind)) {
    why.push('booru: qualified by a work or a character it knows')
    return { owner: 'name', duration: null, kind: 'name', rule: 'name.qualified', source: 'booru' }
  }

  // ── Composition ──
  const perm = permanence(tag)
  if (COUNT_TAG_RE.test(tag) || isCompositionPattern(tag)) {
    why.push('form: a people count or a pairing')
    return { owner: 'scene', duration: null, kind: 'composition', rule: 'composition.form', source: 'form' }
  }
  if (perm === 'composition') {
    why.push('permanence: composition')
    return { owner: 'scene', duration: null, kind: 'composition', rule: 'composition.permanence', source: 'permanence' }
  }

  // ── Something done to or about a garment ──
  const garmentState = garmentStateOf(tag, ctx, depth, why)
  if (garmentState) return garmentState

  return slot ? bySlot(tag, slot, perm, ctx, depth, why) : withoutSlot(tag, perm, kindOf, ctx, depth, why)
}

/** "shirt lift", "open jacket", "no panties", "clothes lift"; or a tag the relations say is one of those. */
function garmentStateOf(tag: string, ctx: TagRoleContext, depth: number, why: string[]): Draft | null {
  const after = AFTER_GARMENT.exec(tag) ?? AROUND_GARMENT.exec(tag)
  const before = BEFORE_GARMENT.exec(tag)
  const phrase = after?.[1] ?? before?.[2]
  const marker = after?.[2] ?? before?.[1]
  if (phrase && marker) {
    const generic = GENERIC_CLOTHES.has(lastWord(phrase))
    if (generic || isGarmentPhrase(phrase, ctx)) {
      const how: GarmentHow = marker === 'no' || marker === 'unworn' || marker === 'missing' || marker === 'removed' ? 'off' : before ? 'worn' : 'moved'
      why.push(`form: "${marker}" with a garment (${generic ? 'clothes in general' : phrase})`)
      return { owner: 'character', duration: 'state', kind: 'garment-state', rule: 'garment-state.form', source: 'form', extra: { garment: generic ? '*' : phrase, how } }
    }
  }
  // The relations: it requires a garment state ("shirt rolled up" requires "clothes lift").
  const rel = ctx.relations
  if (!rel || depth >= MAX_GENUS_DEPTH) return null
  const required = requiredBy(rel, tag).filter((r) => r !== tag)
  const states = required.map((r) => roleOf(r, ctx, depth + 1)).filter((r) => r.kind === 'garment-state')
  if (states.length === 0) return null
  const named = new Set(words(tag).map(stem))
  const garment = required.find((r) => named.has(stem(lastWord(r))) && readSlot(r, ctx.overrides)?.category === 'clothing' && roleOf(r, ctx, depth + 1).kind === 'garment')
  why.push(`relations: requires ${states.map((s) => `"${s.tag}"`).join(', ')}${garment ? ` and "${garment}"` : ''}`)
  const genus = states[0]
  return { owner: 'character', duration: 'state', kind: 'garment-state', rule: 'garment-state.relations', source: 'relations', extra: { garment: garment ?? genus.garment ?? '*', how: genus.how ?? 'moved' } }
}

/**
 * True when a phrase names a garment: the taxonomy files it (or its plural: "panty" ->
 * "panties") as clothing, or it ends in one of the taxonomy's names for a kind of garment.
 */
function isGarmentPhrase(phrase: string, ctx: TagRoleContext): boolean {
  const plurals = [phrase, `${phrase}s`, phrase.replace(/y$/, 'ies')]
  return plurals.some((p) => readSlot(p, ctx.overrides)?.category === 'clothing') || GARMENT_KIND_WORDS.has(lastWord(phrase))
}

/** Comparable form of a word: "ears" and "ear", "panties" and "panty". */
function stem(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  return word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

/** Owner and duration of a tag about a person's body or look. */
function personOf(tag: string, slot: string | null, perm: Permanence, ctx: TagRoleContext, why: string[]): Pick<Draft, 'owner' | 'duration' | 'rule' | 'source' | 'extra'> {
  const duration: RoleDuration = perm === 'identity' || perm === 'signature' ? 'permanent' : 'state'
  why.push(`permanence: ${perm}`)
  if (isCanonRelativeTag(tag)) {
    // Of the pack's own character it says who they are in this pack ("genderswap"), as a trait.
    why.push('compares with the canon version of whoever the picture shows')
    return { owner: 'character', duration: 'permanent', rule: 'person.canon', source: 'permanence', extra: { canon: true } }
  }
  if (perm === 'relative') {
    why.push('a comparison between the people of the picture')
    return { owner: 'others', duration: 'permanent', rule: 'others.relative', source: 'permanence' }
  }
  const named = gendersNamed(tag)
  if (named.size === 2) {
    why.push('names both genders: about the people of the picture together')
    return { owner: 'others', duration, rule: 'others.both-genders', source: 'form' }
  }
  const cast = singleGender(ctx.cast)
  if (named.size === 1) {
    if (!cast) {
      why.push('names a gender; the cast is unknown or mixed')
      return { owner: 'character', duration, rule: 'person.gender-word-no-cast', source: 'form' }
    }
    if (!named.has(cast)) {
      why.push(`names a ${[...named][0]}, the cast is ${cast}`)
      return { owner: 'others', duration, rule: 'others.gender-word', source: 'form' }
    }
    return { owner: 'character', duration, rule: 'person.gender-word', source: 'form' }
  }
  // A body part the picture shows belongs to whoever has it, and the affinity table says
  // who. A trait, a face or makeup the user describes stays the character's.
  if (duration === 'state' && cast && slot === 'appearance:anatomy') {
    const gender = affinityGender(tag)
    if (gender && gender !== cast) {
      why.push(`affinity: a ${gender}'s in solo posts, the cast is ${cast}`)
      return { owner: 'others', duration, rule: 'others.affinity', source: 'affinity' }
    }
  }
  return { owner: 'character', duration, rule: duration === 'permanent' ? 'person.permanent' : 'person.state', source: 'permanence' }
}

/** Something an action can be done with or to: a hand object, a creature, a prop, or what the relations say people hold. */
function isThing(tag: string, ctx: TagRoleContext): boolean {
  const s = readSlot(tag, ctx.overrides)
  if (s && (s.category === 'equipment' || s.category === 'creature' || s.slot === 'scenery:props')) return true
  const i = ctx.relations?.index.get(relationKey(tag))
  return i !== undefined && !!ctx.relations?.held.has(i)
}

/** The object an action names: what follows a grip verb, or a thing it requires and names ("holding sword" -> "sword"). */
function objectNamed(tag: string, ctx: TagRoleContext): string | undefined {
  const [first, ...rest] = tag.split(' ')
  if (GRIP_VERBS.has(first) && rest.length > 0 && isThing(rest.join(' '), ctx)) return rest.join(' ')
  if (!ctx.relations) return undefined
  const named = new Set(words(tag))
  return requiredBy(ctx.relations, tag)
    .filter((r) => r !== tag && words(r).every((w) => named.has(w)) && !GRIP_VERBS.has(r.split(' ')[0]) && isThing(r, ctx))
    .sort((a, b) => b.length - a.length)[0]
}

const OBJECT_SLOT_PREFIXES = ['equipment:', 'creature:']
/** The measured relations say the tag needs something of a hand-object or creature slot ("drinking"). */
const needsAnObject = (tag: string, ctx: TagRoleContext): boolean =>
  !!ctx.relations && requiredSlots(ctx.relations, tag).some((s) => OBJECT_SLOT_PREFIXES.some((p) => s.startsWith(p)))

/** An action, with the object it names or a flag that it needs one. */
function action(tag: string, ctx: TagRoleContext, rule: string, source: RoleSource): Draft {
  const object = objectNamed(tag, ctx)
  const extra: Draft['extra'] = object ? { object } : needsAnObject(tag, ctx) ? { needsObject: true } : {}
  return { owner: 'character', duration: 'state', kind: 'action', rule, source, extra }
}

/**
 * Equipment and creatures: an act done with a thing ("holding sword", "reading") or the
 * thing ("sword", "book"). In order: a grip verb; the relations (it requires an act it
 * names, like "holding"; it is a kind of a thing it requires, like "pudding" of "food";
 * it needs an object of its own, like "drinking"); a one-word gerund.
 */
function actOrThing(tag: string, ctx: TagRoleContext, depth: number, why: string[]): Draft {
  const first = tag.split(' ')[0]
  if (GRIP_VERBS.has(first)) {
    why.push(`form: grip verb "${first}"`)
    return action(tag, ctx, 'action.grip-verb', 'form')
  }
  const rel = ctx.relations
  if (rel && depth < MAX_GENUS_DEPTH) {
    const named = new Set(words(tag))
    const required = requiredBy(rel, tag).filter((r) => r !== tag)
    const act = required.find((r) => words(r).every((w) => named.has(w)) && roleOf(r, ctx, depth + 1).kind === 'action')
    if (act) {
      why.push(`relations: requires the act "${act}", which it names`)
      return action(tag, ctx, 'action.relations-act', 'relations')
    }
    if (required.some((r) => roleOf(r, ctx, depth + 1).kind === 'object')) {
      why.push('relations: a kind of a thing it requires')
      return { owner: 'scene', duration: 'state', kind: 'object', rule: 'object.relations-genus', source: 'relations' }
    }
    if (needsAnObject(tag, ctx)) {
      why.push('relations: needs an object of its own')
      return action(tag, ctx, 'action.relations-needs-object', 'relations')
    }
  }
  if (GERUND.test(tag)) {
    why.push('form: one-word gerund')
    return action(tag, ctx, 'action.gerund', 'form')
  }
  return { owner: 'scene', duration: 'state', kind: 'object', rule: 'object.slot', source: 'taxonomy' }
}

const SKELETON_SLOTS = new Set(['pose:posture', 'pose:gesture', 'pose:kinetic', 'pose:combat', 'pose:interaction', 'pose:physiological'])

function bySlot(tag: string, slot: SlotRead, perm: Permanence, ctx: TagRoleContext, depth: number, why: string[]): Draft {
  const s = slot.slot
  switch (slot.category) {
    case 'appearance': {
      if (BODY_POSSESSIVE_RE.test(tag)) {
        why.push('form: done to a body ("own", "another\'s")')
        return action(tag, ctx, 'action.possessive', 'form')
      }
      const person = personOf(tag, s, perm, ctx, why)
      return { ...person, kind: 'aspect', rule: `aspect.${person.rule}` }
    }
    case 'clothing': {
      if (isCanonRelativeTag(tag)) {
        why.push('compares with the canon version of whoever the picture shows')
        return { owner: 'character', duration: 'state', kind: 'garment', rule: 'garment.canon', source: 'permanence', extra: { canon: true } }
      }
      if (perm === 'signature') {
        why.push("permanence: signature, usually the character's own")
        return { owner: 'character', duration: 'permanent', kind: 'garment', rule: 'garment.signature', source: 'permanence' }
      }
      return { owner: 'character', duration: 'state', kind: 'garment', rule: 'garment.slot', source: 'taxonomy' }
    }
    case 'equipment':
    case 'creature':
      return actOrThing(tag, ctx, depth, why)
    case 'pose': {
      if (s === 'pose:expression') return { owner: 'character', duration: 'state', kind: 'expression', rule: 'expression.slot', source: 'taxonomy' }
      if (s === 'pose:camera') return { owner: 'scene', duration: 'state', kind: 'framing', rule: 'framing.slot', source: 'taxonomy' }
      return action(tag, ctx, s && SKELETON_SLOTS.has(s) ? 'action.slot' : 'action.category', 'taxonomy')
    }
    case 'scenery': {
      if (s === 'scenery:atmosphere') return { owner: 'scene', duration: 'state', kind: 'ambience', rule: 'ambience.slot', source: 'taxonomy' }
      if (s === 'scenery:props') return { owner: 'scene', duration: 'state', kind: 'object', rule: 'object.fixture', source: 'taxonomy', extra: { fixture: true } }
      return { owner: 'scene', duration: 'state', kind: 'place', rule: 'place.slot', source: 'taxonomy' }
    }
    default:
      return { owner: null, duration: null, kind: 'unknown', rule: 'unknown.category', source: 'none' }
  }
}

/** Kinds a genus is preferred in when two required tags are as close. */
const KIND_PRIORITY: readonly RoleKind[] = ['action', 'garment-state', 'garment', 'aspect', 'expression', 'framing', 'object', 'place', 'ambience']

/**
 * What the relations say an unslotted tag is a kind of: the role of a tag it requires.
 * A required tag that ends like it is its head ("triangle bikini top" requires "bikini top"),
 * then one that shares a word ("nipple tweak" requires "nipple pull"). One that shares
 * nothing counts only as the category of a thing ("vibrator" requires "sex toy"), and not
 * for a tag that places one thing on another ("food on face" is not food).
 */
function genusOf(tag: string, ctx: TagRoleContext, depth: number): { required: string; role: TagRole } | null {
  if (!ctx.relations || depth >= MAX_GENUS_DEPTH) return null
  const own = new Set(words(tag).map(stem))
  const head = stem(lastWord(tag))
  const placed = PLACED_RE.test(tag)
  const candidates = requiredBy(ctx.relations, tag)
    .filter((r) => r !== tag)
    .map((required) => {
      const role = roleOf(required, ctx, depth + 1)
      const closeness = stem(lastWord(required)) === head ? 2 : words(required).some((w) => own.has(stem(w))) ? 1 : 0
      return { required, role, closeness }
    })
    .filter(({ role, closeness }) => {
      if (role.kind === 'unknown' || role.kind === 'composition' || role.owner === 'name' || role.owner === 'picture') return false
      return closeness > 0 || (role.kind === 'object' && !placed)
    })
    .sort((a, b) => b.closeness - a.closeness || KIND_PRIORITY.indexOf(a.role.kind) - KIND_PRIORITY.indexOf(b.role.kind))
  return candidates[0] ?? null
}

/**
 * A tag the taxonomy doesn't know. In order: a possessive of a body; a backdrop by its
 * form; what the relations say it is a kind of, needs company for, or needs an object
 * for; a grip verb; a person noun ("wolf boy"); the permanence lists; the booru not
 * knowing it (a name it never typed). Otherwise unknown.
 */
function withoutSlot(tag: string, perm: Permanence, kindOf: TagKind | undefined, ctx: TagRoleContext, depth: number, why: string[]): Draft {
  if (BODY_POSSESSIVE_RE.test(tag)) {
    why.push('form: done to a body ("own", "another\'s")')
    return action(tag, ctx, 'action.possessive', 'form')
  }
  if (tag.endsWith(' background') || isPlainBackgroundTag(tag) || isSceneTag(tag, ctx.overrides)) {
    why.push('form: a background, a known place or sky')
    return { owner: 'scene', duration: 'state', kind: 'place', rule: 'place.environment-form', source: 'form' }
  }
  const rel = ctx.relations
  if (rel) {
    const genus = genusOf(tag, ctx, depth)
    if (genus) {
      why.push(`relations: a kind of "${genus.required}" (${genus.role.kind})`)
      const { kind, owner, duration } = genus.role
      if (kind === 'action') return action(tag, ctx, 'genus.action', 'relations')
      const extra: Draft['extra'] = kind === 'object' && genus.role.fixture ? { fixture: true } : kind === 'garment-state' ? { garment: genus.role.garment, how: genus.role.how } : {}
      return { owner, duration, kind, rule: `genus.${kind}`, source: 'relations', extra }
    }
    if (needsCompany(rel, tag)) {
      if (PAIR_RE.test(tag)) {
        why.push('relations: needs more than one person; form: two people named together')
        return { owner: 'scene', duration: null, kind: 'composition', rule: 'composition.pair', source: 'form' }
      }
      why.push('relations: needs more than one person')
      return action(tag, ctx, 'action.company', 'relations')
    }
    if (needsAnObject(tag, ctx)) {
      why.push(`relations: needs something of ${requiredSlots(rel, tag).join(', ')}`)
      return action(tag, ctx, 'action.relations-needs-object', 'relations')
    }
  }
  const first = tag.split(' ')[0]
  if (GRIP_VERBS.has(first) && tag.includes(' ')) {
    why.push(`form: grip verb "${first}"`)
    return action(tag, ctx, 'action.grip-verb', 'form')
  }
  if (GENDER_WORDS[lastWord(tag)]) {
    why.push('form: a kind of person ("... boy", "... girl")')
    const person = personOf(tag, null, 'identity', ctx, why)
    return { ...person, duration: 'permanent', kind: 'aspect', rule: 'aspect.person-noun', source: 'form' }
  }
  // Without a slot the permanence default is `state`: anything else comes from the data's lists ("faceless").
  if (perm !== 'state') {
    const person = personOf(tag, null, perm, ctx, why)
    return { ...person, kind: 'aspect', rule: 'aspect.permanence-list', source: 'permanence' }
  }
  if (kindOf === 'unlisted') {
    why.push('booru: not one of its tags, most likely a name it never typed')
    return { owner: 'name', duration: null, kind: 'name', rule: 'name.unlisted', source: 'booru' }
  }
  return { owner: null, duration: null, kind: 'unknown', rule: 'unknown', source: 'none' }
}

// ── Where a role goes ─────────────────────────────────────────────────────────

/**
 * The rows of the brief. `Ambience` is proposed apart from `Where`: a time of day or the
 * weather goes with any place and should not replace the scene's.
 */
export type BriefRow = 'Who' | 'Others' | 'Wearing' | 'Doing' | 'Where' | 'Ambience' | 'Also' | 'Style' | 'People'

/** Where a tag with this role goes in the brief. An `unknown` tag goes to Style, first and as typed (today's rule). */
export function briefRouteOf(role: TagRole): BriefRow {
  switch (role.kind) {
    case 'name': return role.name === 'character' ? 'Who' : 'Style'
    case 'style':
    case 'unknown': return 'Style'
    case 'composition': return 'People'
    case 'place': return 'Where'
    case 'ambience': return 'Ambience'
    case 'framing': return 'Also'
    default: break
  }
  if (role.owner === 'others') return 'Others'
  switch (role.kind) {
    case 'aspect': return role.duration === 'permanent' ? 'Who' : 'Also'
    case 'garment': return role.duration === 'permanent' ? 'Who' : 'Wearing'
    // A garment worn in some state is a garment asked for; a movement or an absence is what happens.
    case 'garment-state': return role.how === 'worn' && role.garment !== '*' ? 'Wearing' : 'Doing'
    case 'action': return 'Doing'
    case 'expression': return 'Also'
    case 'object': return role.fixture ? 'Where' : 'Also'
    default: return 'Style'
  }
}

/** A scene unit, the scene's pairing (composition), or null for what never travels with a scene (names, the picture, the donor's identity). */
export type SceneUnitRoute = UnitName | 'pairing' | null

/** The unit a state of the body travels in, by its slot (unitOfSlot's mapping). */
const ASPECT_UNIT: Readonly<Record<string, UnitName>> = {
  'appearance:eyes': 'face',
  'appearance:hair': 'body',
  'appearance:anatomy': 'exposure',
  'appearance:demographics': 'outfit',
}

/** The scene unit a tag with this role should travel in. */
export function sceneUnitOf(role: TagRole): SceneUnitRoute {
  // A comparison with someone's canon is about the donor: it never moves to another character.
  if (role.canon) return null
  switch (role.kind) {
    case 'name':
    case 'style': return null
    case 'composition': return 'pairing'
    case 'unknown': return 'loose'
    case 'place':
    case 'ambience': return 'place'
    case 'framing': return 'camera'
    case 'expression': return 'face'
    case 'action': return 'skeleton'
    // The state of a garment travels with the clothes it refers to.
    case 'garment':
    case 'garment-state': return 'outfit'
    case 'object': return role.fixture ? 'place' : 'extras'
    default: break
  }
  if (role.owner === 'others') return 'body'
  // An aspect: a trait is the donor's identity there; a state travels by its slot.
  if (role.duration === 'permanent') return null
  return (role.slot && ASPECT_UNIT[role.slot]) || 'exposure'
}
