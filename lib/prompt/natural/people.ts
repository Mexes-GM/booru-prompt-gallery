/**
 * People in a scene: how gendered tags read, what only one gender has, and who
 * does what to whom. `attributeTraits` (scene.ts) decides who owns each trait;
 * this module holds the vocabulary it relies on and the wording of acts between
 * two people ("The man is performing oral sex on the woman"), which a shared
 * "They are performing oral sex on a woman" turns into a third person.
 */
import type { Scene, SceneCharacter } from "./scene"
import { capitalize, joinList, takesPluralVerb } from "./english"

export type Gender = "female" | "male" | "futa"

// "dark-skinned female", "muscular male", "dark-skinned futa": one adjective and
// who it describes. Longer tags ("futa with female") are pairings, not traits.
const GENDERED_TRAIT_RE = /^([a-z][a-z-]*) (female|male|futa|futanari)$/
// "clothed female nude male" (and the reverse): one state for each person.
const CLOTHED_PAIR_RE = /^(clothed|nude|naked) (female|male) (clothed|nude|naked) (female|male)$/
const GENDER_WORDS = new Set(["female", "male", "futa", "futanari", "solo", "only"])

/** The person and the adjective a gendered tag describes: "muscular male" -> male, "muscular". */
export function genderedTraits(tag: string): { gender: Gender; trait: string }[] {
  const pair = tag.match(CLOTHED_PAIR_RE)
  if (pair) return [{ gender: pair[2] as Gender, trait: pair[1] }, { gender: pair[4] as Gender, trait: pair[3] }]
  const m = tag.match(GENDERED_TRAIT_RE)
  if (!m || GENDER_WORDS.has(m[1])) return []
  return [{ gender: m[2] === "futanari" ? "futa" : (m[2] as Gender), trait: m[1] }]
}

export const FUTA_RE = /\bfuta(nari)?\b/
export const CROSSDRESSING_RE = /^(crossdressing|trap|otoko no ko|femboy|feminization|male in dress)$/

// For tags the gender profiles do not list (rare ones, other boorus' spellings):
// body parts and garments only one of them has. "penis on face" or "cum on
// breasts" relate two things, so they belong to no one in particular.
const FEMALE_BODY_RE = /\b(breasts?|boobs|tits|cleavage|underboob|sideboob|nipples?|areolae?|areola|pussy|vulva|vagina|labia|clitoris|clitoral hood|cameltoe|cleft of venus|lactation|pregnant|busty|voluptuous|curvaceous|wide hips)\b/
const MALE_BODY_RE = /\b(penis(es)?|cock|dick|erection|testicles|balls|scrotum|foreskin|precum|pectorals|beard|facial hair|mustache|stubble|bulge)\b/
const RELATION_RE = /\b(on|in|into|inside|between|against|under|over|from|to|through|around|with)\b/
const FEMALE_GARMENT_RE = /\b(bikini|bra|panties|lingerie|negligee|babydoll|nightgown|dress|sundress|skirt|miniskirt|microskirt|thighhighs|pantyhose|stockings|garter belt|garter straps|leotard|swimsuit|bodystocking|high heels|corset|bustier|camisole|chemise|playboy bunny|serafuku|pasties)\b/
const MALE_GARMENT_RE = /\b(male swimwear|swim trunks|swim briefs|boxers|boxer briefs|jockstrap|fundoshi|male underwear)\b/

/** The gender a body or garment tag implies by its words alone, or null. */
export function ruleGender(tag: string): "female" | "male" | null {
  if (RELATION_RE.test(tag)) return null
  if (MALE_GARMENT_RE.test(tag) || MALE_BODY_RE.test(tag)) return "male"
  if (FEMALE_BODY_RE.test(tag) || (FEMALE_GARMENT_RE.test(tag) && !/\bdress shirt\b/.test(tag))) return "female"
  return null
}

const NOUNS: Record<"female" | "male", { young: [string, string]; adult: [string, string] }> = {
  female: { young: ["girl", "girls"], adult: ["woman", "women"] },
  male: { young: ["boy", "boys"], adult: ["man", "men"] },
}

/**
 * "girl" / "boy" as booru counts write them, "woman" / "man" in questionable
 * and explicit posts, where "a girl and a boy" would read as minors.
 */
export function personNoun(scene: Pick<Scene, "rating">, gender: "female" | "male", plural: boolean): string {
  const nouns = NOUNS[gender][scene.rating === "q" || scene.rating === "e" ? "adult" : "young"]
  return nouns[plural ? 1 : 0]
}

/** A person or a group as a sentence subject: "the woman", "the women", "Kitagawa Marin", "one of the girls". */
export interface Role {
  label: string
  plural: boolean
  possessive: string
  /** The one entry of `scene.people` it names; absent for "one of the women" and "one of them". */
  person?: SceneCharacter
  /** The gender a "one of the women" role was picked from. */
  pool?: Gender
}

export function possessivePronoun(person: Pick<SceneCharacter, "gender" | "plural">): string {
  return person.plural ? "their" : person.gender === "male" ? "his" : person.gender === "female" ? "her" : "their"
}

export interface SceneRoles {
  /** The one person (or group) of this gender, as the owner or object of something. */
  owner(gender: Gender): Role | null
  /** Who a gendered adjective or an act describes: that person, or "one of the women" among several. */
  one(gender: Gender): Role | null
  /** Who has this anatomy: the man (or the futanari when there is none), the woman (not the futanari when there is another). */
  body(anatomy: "female" | "male"): Role | null
  /** Everyone but `role`, as one subject: the other of two people, or "the woman" when the rest are one woman. */
  besides(role: Role): Role | null
  /** Someone the tags do not single out: "one of the girls", or "one of them" in a mixed picture. */
  someone: Role
  /** How many people the picture shows. */
  count: number
  mixed: boolean
  futa: boolean
}

/** Roles for a scene with several people (`scene.people`), or null for one person. */
export function sceneRoles(scene: Scene): SceneRoles | null {
  if (scene.girls + scene.boys + scene.others < 2 && scene.people.length < 2) return null
  const futa = scene.people.some((p) => p.futa)
  const mixed = scene.girls > 0 && scene.boys > 0
  const of = (g: Gender) => (g === "futa" ? scene.people.filter((p) => p.futa) : scene.people.filter((p) => p.gender === g))
  const count = (g: Gender) => (g === "male" ? scene.boys : scene.girls)
  const asRole = (p: SceneCharacter): Role => ({ label: p.name, plural: !!p.plural, possessive: possessivePronoun(p), person: p, pool: p.futa ? "futa" : p.gender })
  const owner = (g: Gender): Role | null => {
    const pool = of(g)
    return pool.length === 1 ? asRole(pool[0]) : null
  }
  const one = (g: Gender): Role | null => {
    const pool = of(g)
    if (pool.length === 1 && !pool[0].plural) return asRole(pool[0])
    if (g === "futa" || count(g) < 2) return null
    return { label: `one of the ${personNoun(scene, g, true)}`, plural: false, possessive: g === "female" ? "her" : "his", pool: g }
  }
  const body = (anatomy: "female" | "male"): Role | null => {
    if (anatomy === "male") return scene.boys > 0 || !futa ? one("male") : one("futa")
    const women = scene.people.filter((p) => p.gender === "female" && !p.futa)
    if (women.length === 1 && !women[0].plural) return asRole(women[0])
    // "2girls" with no names has no entries in `scene.people`, only the count.
    if (women.length || (!futa && scene.girls > 0)) return one("female")
    return futa ? one("futa") : null
  }
  // A stand-in ("the woman" who may be the named character) is no extra person.
  const people = Math.max(scene.girls + scene.boys + scene.others, scene.people.filter((p) => !p.standIn).reduce((n, p) => n + (p.count ?? 1), 0))
  const besides = (role: Role): Role | null => {
    const rest = role.person ? scene.people.filter((p) => p !== role.person) : scene.people.filter((p) => role.pool && p.gender !== role.pool && !(role.pool === "futa" && p.futa))
    if (rest.length === 1 && !rest[0].plural) return asRole(rest[0])
    // A named character of unknown gender and the stand-in who may be her: the stand-in names them.
    const standIn = rest.find((p) => p.standIn)
    if (standIn && !standIn.plural && rest.every((p) => p === standIn || !p.gender)) return asRole(standIn)
    const genders = new Set(rest.map((p) => (p.futa ? "futa" : p.gender)))
    return genders.size === 1 && rest.length ? one([...genders][0] as Gender) : null
  }
  // Someone the tags do not single out: "one of the girls" when they are all girls.
  const only = scene.others === 0 && !mixed ? one(scene.boys > 0 ? "male" : "female") : null
  const someone = only && !only.person ? only : ONE_OF_THEM
  return { owner, one, body, besides, someone, count: people, mixed, futa }
}

/** Who an act describes in a picture of several people; see `roleAct`. */
export type ActWho = "together" | "self" | "female" | "male" | "doer" | "receiver"
/** The body the other person in an act must have ("anyone" when it does not matter, "none" when there is no one). */
export type ActPartner = "female" | "male" | "anyone" | "none"

const PENETRATION_RE = /^(female|male|futa) (penetrated|penetrating)(?: (female|male|futa))?$/
// "a man having vaginal intercourse with a woman": the act with its subject in it.
const NOUN_SUBJECT_RE = /^an? (man|woman) ([a-z]+ing\b.*)$/
// How a phrase written for one person names the other: "another person's", "someone", "a partner".
const PARTNER_POSSESSIVE_RE = /\b(?:another person's|another's|someone(?: else)?'s|(?:a|another|the|her|his|their) (?:(?:female|male) )?partner's)/g
const PARTNER_NOUN_RE = /\b(?:another person|someone(?: else)?|(?:a|another|the|her|his|their) (?:(?:female|male) )?partner)\b/g
// ... or by sex ("a woman"), which names the partner only when the partner is of that sex.
const PARTNER_BY_SEX_RE = {
  female: /\b(?:a|another) (?:woman|girl)('s)?\b/g,
  male: /\b(?:a|another) (?:man|boy)('s)?\b/g,
}
const ORGAN_RE = { male: /\b(?:a|the) (penis|cock|testicles)\b/g, female: /\b(?:a|the) (vulva|vagina|pussy|clitoris)\b/g }
const ONE_OF_THEM: Role = { label: "one of them", plural: false, possessive: "their" }

/**
 * Names the other person in a phrase written for one: "spanking another person"
 * -> "spanking the woman", "performing oral sex on a penis" -> "... on the man's penis".
 * "Together with another woman" stays when the partner is the man.
 */
export function namePartner(text: string, label: string, partner: ActPartner): string {
  let out = text.replace(PARTNER_POSSESSIVE_RE, possessiveOf(label)).replace(PARTNER_NOUN_RE, label)
  for (const sex of ["female", "male"] as const) {
    if (partner === sex || partner === "anyone") out = out.replace(PARTNER_BY_SEX_RE[sex], (_, s?: string) => (s ? possessiveOf(label) : label))
  }
  if (partner === "male" || partner === "female") out = out.replace(ORGAN_RE[partner], `${possessiveOf(label)} $1`)
  return out
}

/** A mutual act said of everyone: "hugging a partner" -> "hugging each other" ("with two women and a man" stays). */
export function eachOther(text: string): string {
  return text.replace(PARTNER_POSSESSIVE_RE, "each other's").replace(PARTNER_NOUN_RE, "each other")
}

/**
 * Who does an act and to whom, from its dictionary roles (`who`, `partner`):
 * the partner is found by their body, the subject is then the other person.
 * "doer"/"male" in a picture of a woman and a man: the woman performs oral sex
 * on the man. When the body decides nothing, two people are "one of them" and
 * "the other". Null leaves the act to the shared sentence.
 */
function castAct(who: ActWho, partner: ActPartner, roles: SceneRoles): { subject: Role; partner: string | null } | null {
  const target = partner === "female" || partner === "male" ? roles.body(partner) : null
  // Two picks from one pool ("one of the women" twice) are one person and "the other".
  const sameKind = (a: Role, b: Role) => a.label === b.label || (!!a.pool && a.pool === b.pool && (!a.person || !b.person))
  const otherOf = (subject: Role, other: Role | null) =>
    other && !sameKind(subject, other) ? other.label : roles.count === 2 ? "the other" : null
  if (who === "female" || who === "male") {
    const subject = roles.body(who)
    if (!subject) return null
    return { subject, partner: partner === "none" ? null : otherOf(subject, target ?? roles.besides(subject)) }
  }
  if (who !== "doer" && who !== "receiver") return null
  if (target) {
    const subject = roles.besides(target)
    if (subject) return { subject, partner: otherOf(subject, target) }
  }
  return { subject: roles.someone, partner: roles.count === 2 ? "the other" : null }
}

/**
 * A sex act or contact as one person's action ("The man is performing oral sex
 * on the woman"), from the dictionary's roles for the tag (or the tag itself:
 * "male penetrating female"). Null leaves the act to the shared sentence.
 */
export function roleAct(
  tag: string,
  entry: { text: string; who?: ActWho; partner?: ActPartner } | undefined,
  roles: SceneRoles | null,
): { role: Role; text: string } | null {
  if (!roles) return null
  const pen = tag.match(PENETRATION_RE)
  if (pen) {
    const actor = roles.one(pen[1] as Gender)
    if (!actor) return null
    const target = pen[3] ? roles.one(pen[3] as Gender) : null
    const object = target && target.label !== actor.label && target.person ? target.label : target ? "the other" : null
    return { role: actor, text: pen[2] === "penetrated" ? "being penetrated" : object ? `penetrating ${object}` : "penetrating a partner" }
  }
  if (!entry?.who) return null
  const partner = entry.partner ?? "none"
  const cast = castAct(entry.who, partner, roles)
  if (!cast) return null
  let text = entry.text.replace(NOUN_SUBJECT_RE, "$2").replace(/\{pos\}/g, cast.subject.possessive)
  // "The man is shown with a penis ...": an organ of the subject's own sex is the subject's, not the partner's.
  if (entry.who === "female" || entry.who === "male") text = text.replace(ORGAN_RE[entry.who], `${cast.subject.possessive} $1`)
  if (cast.partner) text = namePartner(text, cast.partner, partner === entry.who ? "anyone" : partner)
  return { role: cast.subject, text }
}

export function possessiveOf(label: string): string {
  return /s$/.test(label) ? `${label}'` : `${label}'s`
}

// Adjectives that cannot describe the same person: they are two of them.
const OPPOSITES: [string, string][] = [
  ["smaller", "bigger"], ["smaller", "larger"], ["shorter", "taller"], ["short", "tall"],
  ["dark-skinned", "pale-skinned"], ["dark-skinned", "light-skinned"], ["pale-skinned", "tan"],
  ["dominant", "submissive"], ["older", "younger"], ["clothed", "nude"], ["clothed", "naked"],
  ["chubby", "slim"], ["fat", "slim"], ["fat", "thin"], ["flat-chested", "busty"],
]
const opposed = (a: string, b: string) => OPPOSITES.some(([x, y]) => (a === x && b === y) || (a === y && b === x))

/** Groups adjectives into people: ["smaller", "dark-skinned", "bigger"] -> [["smaller", "dark-skinned"], ["bigger"]]. */
export function splitOpposites(adjectives: string[]): string[][] {
  const people: string[][] = []
  for (const adjective of adjectives) {
    const fits = people.find((p) => !p.some((a) => opposed(a, adjective)))
    if (fits) fits.push(adjective)
    else people.push([adjective])
  }
  return people
}

// Whole-body postures: one person holds one of them at a time.
const POSTURES: [string, RegExp][] = [
  ["standing", /^(standing|tiptoes|on tiptoes|standing on one leg|contrapposto)$|^standing on /],
  ["sitting", /^(sitting|seiza|wariza|indian style|m legs|butterfly sitting)$|^sitting on /],
  ["lying", /^(lying|on back|on stomach|on side)$|^lying on /],
  ["kneeling", /^(kneeling|on knees|on one knee)$/],
  ["squatting", /^squatting$/],
  ["all fours", /^(all fours|on all fours)$/],
]
// Where both arms or hands are ("hands on hips", "arms behind back"), or one of them ("arm up").
const BOTH_ARMS_RE = /^(?:both )?(?:arms|hands) (behind back|behind head|on hips|on knees|on head|up|over head|at sides|on own (?:head|chest|knees|thighs|cheeks|face))$|^(crossed|spread|outstretched) arms$/
const ONE_ARM_RE = /^(?:arm|hand) (up|behind back|behind head|on hip|on own (?:hip|head|chest|knee|thigh|cheek|face))$|^(outstretched) arm$/

/** What a pose takes of one person's body, or null when it is not a pose of one body. */
function poseUse(tag: string): { posture?: string; both?: string; one?: string } | null {
  const posture = POSTURES.find(([, re]) => re.test(tag))?.[0]
  if (posture) return { posture }
  const both = tag.match(BOTH_ARMS_RE)
  if (both) return { both: both[1] ?? both[2] }
  const one = tag.match(ONE_ARM_RE)
  return one ? { one: one[1] ?? one[2] } : null
}

/**
 * Poses that cannot be one person's, split into people: "lying" and "standing
 * on tiptoes", or "hands behind back", "hands on hips" and "hands on knees"
 * among three women. Poses of no particular body part are left out. One group
 * means everything fits one body, so the shared sentence is right.
 */
export function splitPoses<T extends { tag: string }>(poses: T[]): T[][] {
  const people: { posture?: string; both?: string; ones: Set<string>; items: T[] }[] = []
  for (const pose of poses) {
    const use = poseUse(pose.tag)
    if (!use) continue
    const fits = people.find((p) =>
      (!use.posture || !p.posture || p.posture === use.posture) &&
      (!use.both || ((!p.both || p.both === use.both) && [...p.ones].every((o) => o === use.both))) &&
      (!use.one || ((!p.both || p.both === use.one) && (p.ones.has(use.one) || p.ones.size < 2))))
    let person = fits
    if (!person) {
      person = { ones: new Set(), items: [] }
      people.push(person)
    }
    person.posture ??= use.posture
    person.both ??= use.both
    if (use.one) person.ones.add(use.one)
    person.items.push(pose)
  }
  return people.map((p) => p.items)
}

/** "One of them is lying down, and another is standing on tiptoes." */
export function posesSentence(groups: { states: string[]; withs: string[] }[]): string {
  const clause = (g: { states: string[]; withs: string[] }, i: number) => {
    const who = i === 0 ? "One of them" : "another"
    if (!g.states.length) return `${who} ${i === 0 ? "is shown " : ""}with ${joinList(g.withs)}`
    return `${who} is ${joinList(g.states)}${g.withs.length ? `, with ${joinList(g.withs)}` : ""}`
  }
  const clauses = groups.map(clause)
  return `${clauses.length > 2 ? `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}` : clauses.join(", and ")}.`
}

/** "One of them is smaller, and another is bigger." — or one clause when nothing is opposed. */
export function oneOfSentence(role: Role, adjectives: string[]): string {
  const people = splitOpposites(adjectives)
  if (!people.length) return ""
  const rest = people.slice(1).flat()
  return `${capitalize(role.label)} is ${joinList(people[0])}${rest.length ? `, and another is ${joinList(rest)}` : ""}.`
}

/** "The man's penis is visible." */
export function visibleSentence(label: string, parts: string[]): string {
  if (!parts.length) return ""
  const many = parts.length > 1 || takesPluralVerb(parts[0])
  return `${capitalize(possessiveOf(label))} ${joinList(parts)} ${many ? "are" : "is"} visible.`
}
